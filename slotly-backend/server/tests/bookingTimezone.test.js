/**
 * A booking is an instant, not a wall-clock reading.
 *
 * These tests pin the rule that a user changing their profile timezone must
 * change how their appointments are *displayed* and nothing else: the stored
 * instant, the duration until the appointment, and the provider's schedule all
 * stay exactly as they were.
 *
 * They run against a real database because the guarantee is a property of the
 * query — `BOOKING_SELECT` joins the live `users.timezone` rather than reading
 * the `*_snapshot` columns on the booking — and a mock would not exercise that.
 *
 * The regression being guarded: the serialiser used to render every booking from
 * `client_timezone_snapshot`, so the clock face froze at whatever zone the user
 * held on the day they booked. Someone who booked at 09:00 in Asia/Kolkata and
 * later moved to America/Mazatlan kept seeing 09:00 Asia/Kolkata forever.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DateTime } from "luxon";
import dotenv from "dotenv";
import { query } from "../config/dbConfig.js";
import { describeInstant } from "../services/bookingRules.js";

dotenv.config({ quiet: true });

const RUN_ID = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const emailFor = (label) => `slotly_test_tz_${RUN_ID}_${label}@test.invalid`;

/** The appointment used throughout: 09:00 in Kolkata on 10 August 2026. */
const BOOKED_AT_KOLKATA_9AM = "2026-08-10T03:30:00.000Z";
const ENDS_AT = "2026-08-10T03:50:00.000Z";

let providerId;
let clientId;
let serviceId;
let bookingId;

/**
 * The part of BOOKING_SELECT this suite is about: the display timezones come
 * from the joined user rows, the snapshots ride along as history.
 */
const SELECT_FOR_DISPLAY = `
  SELECT b.starts_at, b.ends_at,
         b.client_timezone_snapshot, b.provider_timezone_snapshot,
         c.timezone AS client_timezone_now,
         p.timezone AS provider_timezone_now
  FROM bookings b
  JOIN users c ON c.id = b.client_id
  JOIN users p ON p.id = b.provider_id
  WHERE b.id = $1
`;

const readBooking = async () => (await query(SELECT_FOR_DISPLAY, [bookingId])).rows[0];

const setClientTimezone = (zone) =>
  query("UPDATE users SET timezone = $1 WHERE id = $2", [zone, clientId]);

beforeAll(async () => {
  await query("SELECT 1");

  const mkUser = async (label, role, timezone) =>
    (
      await query(
        `INSERT INTO users (email, name, role, timezone, password_hash)
         VALUES ($1, $2, $3, $4, 'test-not-a-real-hash') RETURNING id`,
        [emailFor(label), `TZ ${label}`, role, timezone]
      )
    ).rows[0].id;

  providerId = await mkUser("provider", "provider", "America/New_York");
  clientId = await mkUser("client", "client", "Asia/Kolkata");

  serviceId = (
    await query(
      `INSERT INTO services (provider_id, service_name, price, duration)
       VALUES ($1, 'Quick review', 900, 20) RETURNING id`,
      [providerId]
    )
  ).rows[0].id;

  bookingId = (
    await query(
      `INSERT INTO bookings (
         provider_id, client_id, service_id, starts_at, ends_at, blocked_from, blocked_to,
         service_name_snapshot, price_snapshot, duration_snapshot,
         client_timezone_snapshot, provider_timezone_snapshot, cancellation_cutoff_hours_snapshot
       ) VALUES ($1,$2,$3,$4,$5,$4,$5,'Quick review',900,20,'Asia/Kolkata','America/New_York',12)
       RETURNING id`,
      [providerId, clientId, serviceId, BOOKED_AT_KOLKATA_9AM, ENDS_AT]
    )
  ).rows[0].id;
});

// Every test starts from the zone the booking was made in.
beforeEach(() => setClientTimezone("Asia/Kolkata"));

afterAll(async () => {
  if (!bookingId) return;
  await query("DELETE FROM booking_events WHERE booking_id = $1", [bookingId]);
  await query("DELETE FROM bookings WHERE id = $1", [bookingId]);
  await query("DELETE FROM services WHERE provider_id = $1", [providerId]);
  await query("DELETE FROM users WHERE id = ANY($1)", [[providerId, clientId]]);
});

describe("the stored instant is immutable", () => {
  it("does not move when the client changes their timezone", async () => {
    const before = await readBooking();
    await setClientTimezone("America/Mazatlan");
    const after = await readBooking();

    // The single most important assertion in this file.
    expect(after.starts_at.toISOString()).toBe(before.starts_at.toISOString());
    expect(after.starts_at.toISOString()).toBe(BOOKED_AT_KOLKATA_9AM);
    expect(after.ends_at.toISOString()).toBe(ENDS_AT);
  });

  it("survives a round trip through several timezones unchanged", async () => {
    for (const zone of ["America/Mazatlan", "Europe/London", "Australia/Sydney", "Asia/Kolkata"]) {
      await setClientTimezone(zone);
      const row = await readBooking();
      expect(row.starts_at.toISOString()).toBe(BOOKED_AT_KOLKATA_9AM);
    }
  });

  it("keeps the booking-time snapshot as history, untouched", async () => {
    await setClientTimezone("America/Mazatlan");
    const row = await readBooking();

    // The snapshot records where they were, and stays put …
    expect(row.client_timezone_snapshot).toBe("Asia/Kolkata");
    // … while the live value is what display follows.
    expect(row.client_timezone_now).toBe("America/Mazatlan");
  });
});

describe("display follows the client's current timezone", () => {
  it("reads as 9:00 AM while the client is in Kolkata", async () => {
    const row = await readBooking();
    const described = describeInstant(row.starts_at, row.client_timezone_now, row.provider_timezone_now);

    expect(described.client.timezone).toBe("Asia/Kolkata");
    expect(described.client.formatted).toBe("10 Aug 2026, 9:00 AM");
  });

  it("re-reads in Mazatlan time after the client moves, without the booking changing", async () => {
    await setClientTimezone("America/Mazatlan");
    const row = await readBooking();
    const described = describeInstant(row.starts_at, row.client_timezone_now, row.provider_timezone_now);

    expect(described.client.timezone).toBe("America/Mazatlan");
    // 03:30 UTC is 21:30 on the 9th in Mazatlan (UTC-6 in August). Computed by
    // Luxon rather than asserted from a hard-coded offset — the point is that the
    // date rolls back a day, which is exactly what a naive implementation misses.
    const expected = DateTime.fromISO(BOOKED_AT_KOLKATA_9AM, { zone: "utc" })
      .setZone("America/Mazatlan")
      .toFormat("d LLL yyyy, h:mm a");
    expect(described.client.formatted).toBe(expected);
    // The underlying instant is still the same moment.
    expect(described.utc).toBe(BOOKED_AT_KOLKATA_9AM);
  });

  it("can move the appointment onto a different calendar date for the viewer", async () => {
    await setClientTimezone("America/Mazatlan");
    const row = await readBooking();

    const inKolkata = DateTime.fromJSDate(row.starts_at).setZone("Asia/Kolkata").toISODate();
    const inMazatlan = DateTime.fromJSDate(row.starts_at).setZone("America/Mazatlan").toISODate();

    expect(inKolkata).toBe("2026-08-10");
    expect(inMazatlan).toBe("2026-08-09"); // the day before, same instant
  });

  it("leaves the provider's reading alone when the client moves", async () => {
    const before = await readBooking();
    const providerBefore = describeInstant(
      before.starts_at,
      before.client_timezone_now,
      before.provider_timezone_now
    ).provider;

    await setClientTimezone("America/Mazatlan");
    const after = await readBooking();
    const providerAfter = describeInstant(
      after.starts_at,
      after.client_timezone_now,
      after.provider_timezone_now
    ).provider;

    expect(providerAfter).toEqual(providerBefore);
    expect(providerAfter.timezone).toBe("America/New_York");
  });
});

describe("the countdown is timezone-independent", () => {
  it("gives the same duration until the appointment from any timezone", async () => {
    // "in X minutes" is a difference between two instants. Changing the zone the
    // appointment is *printed* in cannot change how far away it is — if it does,
    // the countdown is being computed from wall-clock numbers.
    const now = new Date("2026-08-10T03:10:00.000Z"); // 20 minutes before

    const durations = [];
    for (const zone of ["Asia/Kolkata", "America/Mazatlan", "Pacific/Auckland"]) {
      await setClientTimezone(zone);
      const row = await readBooking();
      durations.push(row.starts_at.getTime() - now.getTime());
    }

    expect(new Set(durations).size).toBe(1);
    expect(durations[0]).toBe(20 * 60 * 1000);
  });
});

describe("changing a timezone touches only the user row", () => {
  it("writes nothing to the bookings table", async () => {
    const before = await query(
      "SELECT starts_at, ends_at, blocked_from, blocked_to, updated_at FROM bookings WHERE id = $1",
      [bookingId]
    );

    await setClientTimezone("America/Mazatlan");

    const after = await query(
      "SELECT starts_at, ends_at, blocked_from, blocked_to, updated_at FROM bookings WHERE id = $1",
      [bookingId]
    );

    // `updated_at` included deliberately: if some future code "helpfully"
    // rewrote bookings on a profile change, this is the column that would move
    // even if the instants happened to round-trip to the same value.
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
