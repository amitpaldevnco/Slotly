/**
 * The database-level guarantees behind messages and reviews.
 *
 * These run against a real PostgreSQL for the same reason the concurrency suite
 * does: each thing asserted here *is* a constraint, so a mock would be testing a
 * fake of the only component enforcing it.
 *
 * Application-level authorization (who may read a thread, who may reply to a
 * review) is checked in the controllers and verified end-to-end over HTTP; what
 * belongs here is the set of invariants no amount of application code can be
 * trusted to hold on its own:
 *
 *   - one review per booking, even under a concurrent double submit
 *   - a rating outside 1–5 cannot be stored
 *   - a blank message cannot be stored
 *   - deleting a booking takes its thread and its review with it
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import dotenv from "dotenv";
import { createTestPool } from "./testDatabase.js";
import { query } from "../config/dbConfig.js";

dotenv.config({ quiet: true });

const RUN_ID = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const emailFor = (label) => `slotly_test_mr_${RUN_ID}_${label}@test.invalid`;

let pool;
let providerId;
let clientId;
let serviceId;
let bookingId;

/** Creates a booking in the given status and returns its id. */
async function makeBooking(status, startsAt) {
  const result = await query(
    `INSERT INTO bookings (
       provider_id, client_id, service_id, starts_at, ends_at, blocked_from, blocked_to, status,
       service_name_snapshot, price_snapshot, duration_snapshot,
       client_timezone_snapshot, provider_timezone_snapshot, cancellation_cutoff_hours_snapshot
     ) VALUES ($1,$2,$3,$4,$5,$4,$5,$6,'Consultation',50,60,'Asia/Kolkata','Europe/London',12)
     RETURNING id`,
    [providerId, clientId, serviceId, startsAt, new Date(new Date(startsAt).getTime() + 3600000), status]
  );
  return result.rows[0].id;
}

beforeAll(async () => {
  await query("SELECT 1");

  // Only the racing-review test needs more than one connection at a time.
  pool = createTestPool({ max: 5 });

  const mkUser = async (label, role) =>
    (
      await query(
        `INSERT INTO users (email, name, role, timezone, password_hash)
         VALUES ($1, $2, $3, 'UTC', 'test-not-a-real-hash') RETURNING id`,
        [emailFor(label), `MR ${label}`, role]
      )
    ).rows[0].id;

  providerId = await mkUser("provider", "provider");
  clientId = await mkUser("client", "client");

  serviceId = (
    await query(
      `INSERT INTO services (provider_id, service_name, price, duration)
       VALUES ($1, 'Consultation', 50, 60) RETURNING id`,
      [providerId]
    )
  ).rows[0].id;
});

beforeEach(async () => {
  // Rebuilt per test so a UNIQUE violation in one cannot affect the next.
  if (bookingId) {
    await query("DELETE FROM reviews WHERE booking_id = $1", [bookingId]);
    await query("DELETE FROM booking_messages WHERE booking_id = $1", [bookingId]);
    await query("DELETE FROM bookings WHERE id = $1", [bookingId]);
  }
  bookingId = await makeBooking("completed", "2030-07-01T10:00:00.000Z");
});

afterAll(async () => {
  if (bookingId) {
    await query("DELETE FROM reviews WHERE booking_id = $1", [bookingId]);
    await query("DELETE FROM booking_messages WHERE booking_id = $1", [bookingId]);
  }
  await query("DELETE FROM bookings WHERE provider_id = $1", [providerId]);
  await query("DELETE FROM services WHERE provider_id = $1", [providerId]);
  await query("DELETE FROM users WHERE id = ANY($1)", [[providerId, clientId]]);
  if (pool) await pool.end();
});

describe("one review per booking", () => {
  it("accepts the first review", async () => {
    const inserted = await query(
      "INSERT INTO reviews (booking_id, provider_id, rating, comment) VALUES ($1,$2,5,'Great') RETURNING id",
      [bookingId, providerId]
    );
    expect(inserted.rows[0].id).toBeGreaterThan(0);
  });

  it("rejects a second review for the same booking", async () => {
    await query("INSERT INTO reviews (booking_id, provider_id, rating) VALUES ($1,$2,5)", [
      bookingId,
      providerId,
    ]);

    await expect(
      query("INSERT INTO reviews (booking_id, provider_id, rating) VALUES ($1,$2,1)", [
        bookingId,
        providerId,
      ])
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("admits exactly one when two submissions race", async () => {
    // The reason this is a UNIQUE constraint and not a read-then-insert: two
    // taps on a slow connection are two concurrent inserts, and only the
    // database can arbitrate between them.
    const attempt = async () => {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        await connection.query(
          "INSERT INTO reviews (booking_id, provider_id, rating) VALUES ($1,$2,5)",
          [bookingId, providerId]
        );
        await connection.query("COMMIT");
        return { ok: true };
      } catch (err) {
        await connection.query("ROLLBACK");
        return { ok: false, code: err.code };
      } finally {
        connection.release();
      }
    };

    const results = await Promise.all([attempt(), attempt()]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)[0].code).toBe("23505");

    const stored = await query("SELECT COUNT(*)::int AS n FROM reviews WHERE booking_id = $1", [
      bookingId,
    ]);
    expect(stored.rows[0].n).toBe(1);
  });

  it("lets the author edit instead of adding a row", async () => {
    const created = await query(
      "INSERT INTO reviews (booking_id, provider_id, rating, comment) VALUES ($1,$2,3,'ok') RETURNING id",
      [bookingId, providerId]
    );

    await query("UPDATE reviews SET rating = 5, comment = 'better', updated_at = NOW() WHERE id = $1", [
      created.rows[0].id,
    ]);

    const rows = await query("SELECT rating, comment FROM reviews WHERE booking_id = $1", [bookingId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].rating).toBe(5);
  });
});

describe("rating bounds", () => {
  it("rejects a rating below 1 and above 5", async () => {
    for (const rating of [0, 6, -1, 100]) {
      await expect(
        query("INSERT INTO reviews (booking_id, provider_id, rating) VALUES ($1,$2,$3)", [
          bookingId,
          providerId,
          rating,
        ])
      ).rejects.toMatchObject({ code: "23514" }); // check_violation
    }
  });

  it("accepts every rating from 1 to 5", async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      await query("DELETE FROM reviews WHERE booking_id = $1", [bookingId]);
      const inserted = await query(
        "INSERT INTO reviews (booking_id, provider_id, rating) VALUES ($1,$2,$3) RETURNING rating",
        [bookingId, providerId, rating]
      );
      expect(inserted.rows[0].rating).toBe(rating);
    }
  });
});

describe("messages", () => {
  it("stores a message from either party", async () => {
    for (const senderId of [clientId, providerId]) {
      const inserted = await query(
        "INSERT INTO booking_messages (booking_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id, read_at",
        [bookingId, senderId, "Hello"]
      );
      expect(inserted.rows[0].id).toBeGreaterThan(0);
      // Unread until the other party opens the thread.
      expect(inserted.rows[0].read_at).toBeNull();
    }
  });

  it("rejects a blank or whitespace-only message", async () => {
    for (const body of ["", "   ", "\n\t "]) {
      await expect(
        query("INSERT INTO booking_messages (booking_id, sender_id, body) VALUES ($1,$2,$3)", [
          bookingId,
          clientId,
          body,
        ])
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("counts only the other party's unread messages", async () => {
    await query("INSERT INTO booking_messages (booking_id, sender_id, body) VALUES ($1,$2,'from client')", [
      bookingId,
      clientId,
    ]);
    await query("INSERT INTO booking_messages (booking_id, sender_id, body) VALUES ($1,$2,'from provider')", [
      bookingId,
      providerId,
    ]);

    // The query the unread badge runs: not sent by me, not yet read.
    const forProvider = await query(
      `SELECT COUNT(*)::int AS n FROM booking_messages m JOIN bookings b ON b.id = m.booking_id
       WHERE (b.client_id = $1 OR b.provider_id = $1) AND m.sender_id <> $1 AND m.read_at IS NULL`,
      [providerId]
    );
    expect(forProvider.rows[0].n).toBe(1); // the client's, not their own

    // Opening the thread clears it.
    await query(
      "UPDATE booking_messages SET read_at = NOW() WHERE booking_id = $1 AND sender_id <> $2 AND read_at IS NULL",
      [bookingId, providerId]
    );
    const after = await query(
      `SELECT COUNT(*)::int AS n FROM booking_messages m JOIN bookings b ON b.id = m.booking_id
       WHERE (b.client_id = $1 OR b.provider_id = $1) AND m.sender_id <> $1 AND m.read_at IS NULL`,
      [providerId]
    );
    expect(after.rows[0].n).toBe(0);
    // …and does not touch the provider's own message, which the client has still
    // not read.
    const forClient = await query(
      `SELECT COUNT(*)::int AS n FROM booking_messages m JOIN bookings b ON b.id = m.booking_id
       WHERE (b.client_id = $1 OR b.provider_id = $1) AND m.sender_id <> $1 AND m.read_at IS NULL`,
      [clientId]
    );
    expect(forClient.rows[0].n).toBe(1);
  });
});

describe("cascade behaviour", () => {
  it("removes a booking's thread and review when the booking is deleted", async () => {
    await query("INSERT INTO booking_messages (booking_id, sender_id, body) VALUES ($1,$2,'x')", [
      bookingId,
      clientId,
    ]);
    await query("INSERT INTO reviews (booking_id, provider_id, rating) VALUES ($1,$2,4)", [
      bookingId,
      providerId,
    ]);

    await query("DELETE FROM bookings WHERE id = $1", [bookingId]);

    const messages = await query("SELECT COUNT(*)::int AS n FROM booking_messages WHERE booking_id = $1", [
      bookingId,
    ]);
    const reviews = await query("SELECT COUNT(*)::int AS n FROM reviews WHERE booking_id = $1", [
      bookingId,
    ]);

    expect(messages.rows[0].n).toBe(0);
    expect(reviews.rows[0].n).toBe(0);

    // Recreated so afterAll's cleanup and the next test both have a booking.
    bookingId = await makeBooking("completed", "2030-07-02T10:00:00.000Z");
  });
});
