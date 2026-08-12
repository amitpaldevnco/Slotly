/**
 * The double-booking guarantee, tested against a real PostgreSQL database.
 *
 * ## Why this suite cannot be mocked
 *
 * The guarantee *is* the database constraint. Slotly does not check "is this
 * slot free?" and then insert — that sequence has a window between the read and
 * the write in which a second request can insert the same slot, and no amount of
 * care in JavaScript closes it, because the two requests are not talking to each
 * other. Instead the `bookings_no_overlap_per_provider` exclusion constraint
 * decides, and PostgreSQL serialises the contending transactions on the GiST
 * index entry.
 *
 * A mock would therefore prove nothing at all: it would be testing a fake of the
 * only component doing the work. These tests open real pooled connections, run
 * real transactions, and let them race.
 *
 * ## How the race is actually staged
 *
 * Each attempt gets its **own pooled connection** and its **own transaction**.
 * The attempts are started without awaiting between them and handed to
 * `Promise.all`, so both are in flight before either commits. The second INSERT
 * blocks inside PostgreSQL until the first transaction commits, and is then
 * rejected with SQLSTATE 23P01 (`exclusion_violation`) — the code the booking
 * controller maps to 409 + `SLOT_TAKEN`, never a generic 500.
 *
 * ## Requirements
 *
 * A running PostgreSQL — the same one the app uses, configured through `.env`.
 * Fixtures are namespaced under a per-run email prefix and removed afterwards,
 * so the suite neither depends on nor disturbs anything else in the database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

/** SQLSTATE PostgreSQL raises when an exclusion constraint rejects a row. */
const EXCLUSION_VIOLATION = "23P01";

/** Namespaces this run's fixtures so parallel runs and real data never collide. */
const RUN_ID = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const emailFor = (label) => `slotly_test_${RUN_ID}_${label}@test.invalid`;

let pool;
let providerA;
let providerB;
let client;
let serviceA;
let serviceB;

/** A weekday well in the future, so nothing here depends on when the suite runs. */
const SLOT_START = "2030-06-03T13:00:00.000Z"; // Monday 09:00 America/New_York
const DURATION_MINUTES = 60;
const BUFFER_MINUTES = 15;

/**
 * The span a booking occupies, buffers included — the same arithmetic
 * `computeBookingSpan` does, restated here so the test asserts against the
 * constraint rather than against the helper that feeds it.
 */
function span(startsAtIso, { duration = DURATION_MINUTES, bufferBefore = BUFFER_MINUTES, bufferAfter = BUFFER_MINUTES } = {}) {
  const start = new Date(startsAtIso).getTime();
  const minute = 60_000;
  return {
    startsAt: new Date(start),
    endsAt: new Date(start + duration * minute),
    blockedFrom: new Date(start - bufferBefore * minute),
    blockedTo: new Date(start + (duration + bufferAfter) * minute),
  };
}

/**
 * Inserts a booking on its own connection, inside its own transaction.
 *
 * @returns {Promise<{ok: boolean, id?: number, code?: string}>} Never throws —
 *   the whole point is to inspect *which* attempt lost and with what SQLSTATE.
 */
async function attemptBooking({ providerId, serviceId, clientId, startsAt, status = "booked" }) {
  const connection = await pool.connect();
  const s = span(startsAt);

  try {
    await connection.query("BEGIN");
    const result = await connection.query(
      `INSERT INTO bookings (
         provider_id, client_id, service_id,
         starts_at, ends_at, blocked_from, blocked_to, status,
         service_name_snapshot, price_snapshot, duration_snapshot,
         client_timezone_snapshot, provider_timezone_snapshot,
         cancellation_cutoff_hours_snapshot
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Consultation',50,$9,'Asia/Kolkata','America/New_York',12)
       RETURNING id`,
      [providerId, clientId, serviceId, s.startsAt, s.endsAt, s.blockedFrom, s.blockedTo, status, DURATION_MINUTES]
    );
    await connection.query("COMMIT");
    return { ok: true, id: result.rows[0].id };
  } catch (err) {
    await connection.query("ROLLBACK");
    return { ok: false, code: err.code };
  } finally {
    connection.release();
  }
}

/** Moves an existing booking, on its own connection and transaction. */
async function attemptReschedule(bookingId, startsAt) {
  const connection = await pool.connect();
  const s = span(startsAt);

  try {
    await connection.query("BEGIN");
    await connection.query(
      `UPDATE bookings
       SET starts_at = $1, ends_at = $2, blocked_from = $3, blocked_to = $4, status = 'rescheduled'
       WHERE id = $5`,
      [s.startsAt, s.endsAt, s.blockedFrom, s.blockedTo, bookingId]
    );
    await connection.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await connection.query("ROLLBACK");
    return { ok: false, code: err.code };
  } finally {
    connection.release();
  }
}

/** Removes every booking this suite's fixtures own, between tests. */
async function clearBookings() {
  await pool.query("DELETE FROM bookings WHERE provider_id = ANY($1)", [[providerA, providerB]]);
}

beforeAll(async () => {
  pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    // Comfortably more than the ten simultaneous attempts the busiest test makes,
    // so a blocked transaction never waits on the *pool* instead of on the
    // constraint — which would make the test pass for the wrong reason.
    max: 15,
  });

  // Fail loudly and early if the database is not reachable, rather than letting
  // every assertion below fail with an unrelated message.
  await pool.query("SELECT 1");

  const mkUser = async (label, role, timezone) => {
    const result = await pool.query(
      `INSERT INTO users (email, name, role, timezone, password_hash)
       VALUES ($1, $2, $3, $4, 'test-not-a-real-hash') RETURNING id`,
      [emailFor(label), `Test ${label}`, role, timezone]
    );
    return result.rows[0].id;
  };

  providerA = await mkUser("providerA", "provider", "America/New_York");
  providerB = await mkUser("providerB", "provider", "Europe/London");
  client = await mkUser("client", "client", "Asia/Kolkata");

  const mkService = async (providerId) => {
    const result = await pool.query(
      `INSERT INTO services (provider_id, service_name, price, duration, buffer_before, buffer_after)
       VALUES ($1, 'Consultation', 50, $2, $3, $3) RETURNING id`,
      [providerId, DURATION_MINUTES, BUFFER_MINUTES]
    );
    return result.rows[0].id;
  };

  serviceA = await mkService(providerA);
  serviceB = await mkService(providerB);
});

afterAll(async () => {
  if (!pool) return;
  // Order matters: bookings reference services with ON DELETE RESTRICT, so the
  // bookings have to go first.
  await pool.query("DELETE FROM bookings WHERE provider_id = ANY($1)", [[providerA, providerB]]);
  await pool.query("DELETE FROM services WHERE provider_id = ANY($1)", [[providerA, providerB]]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [[providerA, providerB, client]]);
  await pool.end();
});

describe("the constraint exists at all", () => {
  it("has a partial GiST exclusion constraint on bookings", () => {
    // A guard on the guard: if a migration ever drops this, every other test in
    // this file would quietly start passing for the wrong reason.
    return pool
      .query(
        `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
         WHERE conname = 'bookings_no_overlap_per_provider'`
      )
      .then(({ rows }) => {
        expect(rows).toHaveLength(1);
        expect(rows[0].def).toMatch(/EXCLUDE USING gist/i);
        expect(rows[0].def).toMatch(/provider_id/);
        expect(rows[0].def).toMatch(/tstzrange/i);
        // Partial: cancelled bookings must not occupy the calendar.
        expect(rows[0].def).toMatch(/WHERE.*cancelled/is);
      });
  });
});

describe("two clients racing for the same slot", () => {
  it("lets exactly one succeed and rejects the other with 23P01", async () => {
    await clearBookings();

    // Both attempts are started before either is awaited, so they are genuinely
    // in flight together rather than running one after the other.
    const attemptOne = attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });
    const attemptTwo = attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });

    const results = await Promise.all([attemptOne, attemptTwo]);

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    // The specific, distinguishable failure the brief asks for — this is what
    // becomes 409 SLOT_TAKEN rather than a generic 500.
    expect(losers[0].code).toBe(EXCLUSION_VIOLATION);

    const stored = await pool.query("SELECT COUNT(*)::int AS n FROM bookings WHERE provider_id = $1", [providerA]);
    expect(stored.rows[0].n).toBe(1);
  });

  it("still admits exactly one when ten attempts arrive at once", async () => {
    await clearBookings();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        attemptBooking({
          providerId: providerA,
          serviceId: serviceA,
          clientId: client,
          startsAt: SLOT_START,
        })
      )
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(9);
    // Every loser fails the same way. A different SQLSTATE here would mean
    // something other than the constraint rejected it.
    expect(results.filter((r) => !r.ok).every((r) => r.code === EXCLUSION_VIOLATION)).toBe(true);
  });
});

describe("what counts as a collision", () => {
  it("rejects a partial overlap, not just an identical start", async () => {
    await clearBookings();

    const first = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START, // 13:00–14:00 UTC
    });
    expect(first.ok).toBe(true);

    // 13:30 starts inside the existing appointment. A unique index on
    // (provider_id, starts_at) would happily allow this; a range exclusion does not.
    const overlapping = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: "2030-06-03T13:30:00.000Z",
    });

    expect(overlapping.ok).toBe(false);
    expect(overlapping.code).toBe(EXCLUSION_VIOLATION);
  });

  it("rejects an overlap that touches only the buffers", async () => {
    await clearBookings();

    const first = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START, // appointment 13:00–14:00, blocked 12:45–14:15
    });
    expect(first.ok).toBe(true);

    // 14:10 does not overlap the *appointment* (which ended at 14:00) but its
    // leading buffer starts at 13:55, inside the first booking's trailing
    // buffer. The constraint compares blocked_from/blocked_to, so the buffer is
    // genuinely reserved rather than merely displayed.
    const bufferClash = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: "2030-06-03T14:10:00.000Z",
    });

    expect(bufferClash.ok).toBe(false);
    expect(bufferClash.code).toBe(EXCLUSION_VIOLATION);
  });

  it("allows a genuinely back-to-back booking, because tstzrange is half-open", async () => {
    await clearBookings();

    const first = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START, // blocked 12:45–14:15
    });
    expect(first.ok).toBe(true);

    // Blocked span 14:15–15:45 — it starts exactly where the previous one ended.
    // Half-open ranges do not count that as an overlap.
    const adjacent = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: "2030-06-03T14:30:00.000Z",
    });

    expect(adjacent.ok).toBe(true);
  });

  it("does not let one provider's booking block another provider's", async () => {
    await clearBookings();

    const onA = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });
    // Same instant, different provider. `provider_id WITH =` in the constraint
    // means the exclusion only applies within one provider's calendar.
    const onB = await attemptBooking({
      providerId: providerB,
      serviceId: serviceB,
      clientId: client,
      startsAt: SLOT_START,
    });

    expect(onA.ok).toBe(true);
    expect(onB.ok).toBe(true);
  });
});

describe("which statuses occupy the calendar", () => {
  it("frees the slot as soon as a booking is cancelled", async () => {
    await clearBookings();

    const first = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });
    expect(first.ok).toBe(true);

    // Blocked while it is still active …
    const blocked = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });
    expect(blocked.ok).toBe(false);

    await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [first.id]);

    // … and free once it is cancelled, without the row being deleted. This is
    // what lets cancelled bookings stay in history and still return the slot.
    const afterCancel = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });
    expect(afterCancel.ok).toBe(true);

    const rows = await pool.query("SELECT COUNT(*)::int AS n FROM bookings WHERE provider_id = $1", [providerA]);
    expect(rows.rows[0].n).toBe(2); // the cancelled one is still there
  });

  it("keeps the slot occupied for a completed booking", async () => {
    await clearBookings();

    const first = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });
    await pool.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [first.id]);

    // That time really was used, so it must not be re-offered.
    const afterComplete = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });

    expect(afterComplete.ok).toBe(false);
    expect(afterComplete.code).toBe(EXCLUSION_VIOLATION);
  });

  it("keeps the slot occupied for a no-show", async () => {
    await clearBookings();

    const first = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });
    await pool.query("UPDATE bookings SET status = 'no_show' WHERE id = $1", [first.id]);

    const afterNoShow = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });

    expect(afterNoShow.ok).toBe(false);
  });
});

describe("rescheduling is governed by the same constraint", () => {
  it("refuses to move a booking onto an occupied slot", async () => {
    await clearBookings();

    const occupant = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });
    const mover = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: "2030-06-03T16:00:00.000Z",
    });
    expect(occupant.ok).toBe(true);
    expect(mover.ok).toBe(true);

    // An UPDATE is checked by the exclusion constraint exactly as an INSERT is,
    // so a reschedule loses the same race in the same way, with the same code.
    const clash = await attemptReschedule(mover.id, SLOT_START);

    expect(clash.ok).toBe(false);
    expect(clash.code).toBe(EXCLUSION_VIOLATION);
  });

  it("allows moving a booking to a free slot", async () => {
    await clearBookings();

    const mover = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: SLOT_START,
    });

    // Moving onto a free time must not trip over the booking's *own* old span —
    // the row being updated is the one whose old range disappears in the same
    // statement, so it cannot conflict with itself.
    const moved = await attemptReschedule(mover.id, "2030-06-03T16:00:00.000Z");
    expect(moved.ok).toBe(true);

    const row = await pool.query("SELECT starts_at, status FROM bookings WHERE id = $1", [mover.id]);
    expect(new Date(row.rows[0].starts_at).toISOString()).toBe("2030-06-03T16:00:00.000Z");
    expect(row.rows[0].status).toBe("rescheduled");
  });

  it("lets two simultaneous reschedules onto the same free slot resolve to one", async () => {
    await clearBookings();

    const first = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: "2030-06-03T16:00:00.000Z",
    });
    const second = await attemptBooking({
      providerId: providerA,
      serviceId: serviceA,
      clientId: client,
      startsAt: "2030-06-03T18:00:00.000Z",
    });

    const results = await Promise.all([
      attemptReschedule(first.id, SLOT_START),
      attemptReschedule(second.id, SLOT_START),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)[0].code).toBe(EXCLUSION_VIOLATION);
  });
});
