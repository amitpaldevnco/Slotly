/**
 * Demo data, so a reviewer can log in and book something within a minute.
 *
 * Run with `npm run db:seed`. Safe to run repeatedly: it deletes only the rows
 * it owns (matched by the fixed demo email addresses below) and recreates them,
 * so re-running resets the demo without touching anyone else's account.
 *
 * ## What it creates, and why these particular choices
 *
 * The two providers are picked to make the timezone behaviour visible rather
 * than merely present:
 *
 *   - **Priya Raman — Europe/London.** Observes DST. Her weekly hours are the
 *     same wall-clock 09:00–17:00 all year, so browsing her slots either side of
 *     the March or October transition shows the *UTC* instant moving while the
 *     local reading stays put. That is the behaviour the brief says it will
 *     test.
 *   - **Arjun Mehta — Asia/Kolkata.** Never observes DST, and sits on a
 *     half-hour offset (+05:30). The half hour matters: it catches any code that
 *     assumes whole-hour offsets, which is the most common way this goes wrong.
 *
 * The demo client is in **America/New_York** — a third zone, behind both
 * providers, and DST-observing. So every screen a reviewer opens is doing a real
 * three-way conversion, and a late-afternoon London slot lands on the client's
 * *previous* calendar date rather than the same one.
 *
 * Availability is generated relative to *today* rather than hardcoded, so the
 * demo never goes stale. Bookings are placed on the provider's own upcoming
 * weekdays for the same reason.
 *
 * Avatars and cover images are remote URLs on purpose. Seeding a local file path
 * would point at bytes that do not exist on a freshly deployed container, and a
 * demo that opens with broken images is worse than one with none.
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import { DateTime } from "luxon";
import pgPool, { query } from "../config/dbConfig.js";
import { initSchema } from "../config/schema.js";
import { computeBookingSpan } from "../services/slotEngine.js";

/** The one password every demo account shares. Stated in the README. */
const DEMO_PASSWORD = "SlotlyDemo123!";

/**
 * Every address this script owns. Nothing outside this list is ever deleted,
 * which is what makes the script safe to run against a database that already
 * has real accounts in it.
 */
const DEMO_EMAILS = [
  "priya.provider@slotly.demo",
  "arjun.provider@slotly.demo",
  "casey.client@slotly.demo",
];

const PROVIDERS = [
  {
    email: "priya.provider@slotly.demo",
    name: "Priya Raman",
    timezone: "Europe/London",
    businessName: "Raman Physiotherapy",
    businessType: "Physiotherapy",
    qualifications: "BSc (Hons) Physiotherapy, MCSP — 11 years in practice",
    bio:
      "Musculoskeletal physiotherapist working from a clinic in central London. " +
      "I treat sports injuries, post-operative rehabilitation and long-standing " +
      "back and neck pain, with a focus on getting people moving again rather " +
      "than managing symptoms indefinitely.",
    avatarUrl: "https://i.pravatar.cc/400?img=45",
    cancellationCutoffHours: 24,
    // Monday–Friday 09:00–17:00, with Wednesday split around a long lunch so
    // the slot list visibly demonstrates a window being split rather than
    // cleared. Weekday numbering matches the schema: 0 = Sunday.
    rules: [
      { weekday: 1, startMinute: 540, endMinute: 1020 },
      { weekday: 2, startMinute: 540, endMinute: 1020 },
      { weekday: 3, startMinute: 540, endMinute: 720 },
      { weekday: 3, startMinute: 840, endMinute: 1020 },
      { weekday: 4, startMinute: 540, endMinute: 1020 },
      { weekday: 5, startMinute: 540, endMinute: 960 },
    ],
    services: [
      {
        name: "Initial Assessment",
        description:
          "A full first appointment: history, physical assessment, a working " +
          "diagnosis and a written plan you take away.\n\nAllow the full hour — " +
          "we will not rush the examination.",
        price: 75,
        duration: 60,
        bufferBefore: 15,
        bufferAfter: 15,
        slotInterval: 30,
        coverImage: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80",
      },
      {
        name: "Follow-up Treatment",
        description:
          "A shorter session for anyone already assessed: hands-on treatment, " +
          "progression of your exercises, and a review of how the last fortnight went.",
        price: 45,
        duration: 30,
        bufferBefore: 5,
        bufferAfter: 10,
        slotInterval: 30,
        coverImage: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&q=80",
      },
      {
        name: "Sports Injury Rehab",
        description:
          "Extended rehabilitation for a specific injury, with loading work and " +
          "return-to-sport testing. Ninety minutes, generally fortnightly.",
        price: 110,
        duration: 90,
        bufferBefore: 15,
        bufferAfter: 15,
        slotInterval: 30,
        coverImage: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&q=80",
      },
    ],
  },
  {
    email: "arjun.provider@slotly.demo",
    name: "Arjun Mehta",
    timezone: "Asia/Kolkata",
    businessName: "Mehta Tutoring",
    businessType: "Tutoring",
    qualifications: "MSc Mathematics, IIT Bombay — 8 years teaching",
    bio:
      "I tutor mathematics and physics for school and university entrance, " +
      "online. Sessions are one-to-one and built around the questions you " +
      "actually got stuck on, not a fixed syllabus.",
    avatarUrl: "https://i.pravatar.cc/400?img=12",
    cancellationCutoffHours: 12,
    // Weekday evenings, plus longer hours at the weekend — a genuinely
    // different shape from Priya's, so the two providers do not look identical.
    rules: [
      { weekday: 1, startMinute: 1020, endMinute: 1260 },
      { weekday: 2, startMinute: 1020, endMinute: 1260 },
      { weekday: 3, startMinute: 1020, endMinute: 1260 },
      { weekday: 4, startMinute: 1020, endMinute: 1260 },
      { weekday: 6, startMinute: 600, endMinute: 960 },
      { weekday: 0, startMinute: 600, endMinute: 840 },
    ],
    services: [
      {
        name: "Maths Tutoring (1 hour)",
        description:
          "One hour, one-to-one, online. Bring the problems you are stuck on and " +
          "we will work through them together.",
        price: 30,
        duration: 60,
        bufferBefore: 0,
        bufferAfter: 15,
        slotInterval: 60,
        coverImage: "https://images.unsplash.com/photo-1509228468518-180dd4864904?w=800&q=80",
      },
      {
        name: "Physics Problem Clinic",
        description:
          "A focused 45-minute session on one topic — mechanics, waves, " +
          "electromagnetism — for anyone preparing for an exam.",
        price: 25,
        duration: 45,
        bufferBefore: 0,
        bufferAfter: 15,
        slotInterval: 30,
        coverImage: "https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?w=800&q=80",
      },
    ],
  },
];

const CLIENT = {
  email: "casey.client@slotly.demo",
  name: "Casey Morgan",
  timezone: "America/New_York",
  phoneNumber: "+1 555 0138",
  avatarUrl: "https://i.pravatar.cc/400?img=32",
};

/**
 * Removes everything this script previously created.
 *
 * Ordered by foreign key: bookings reference services with ON DELETE RESTRICT,
 * so services cannot go first. Everything else cascades from `users`.
 */
async function clearExistingDemoData() {
  const { rows } = await query("SELECT id FROM users WHERE email = ANY($1)", [DEMO_EMAILS]);
  if (rows.length === 0) return 0;

  const ids = rows.map((r) => r.id);
  await query("DELETE FROM bookings WHERE provider_id = ANY($1) OR client_id = ANY($1)", [ids]);
  await query("DELETE FROM services WHERE provider_id = ANY($1)", [ids]);
  await query("DELETE FROM users WHERE id = ANY($1)", [ids]);

  return ids.length;
}

/**
 * @param {object} person
 * @param {string} passwordHash Shared across the demo accounts; hashed once by
 *   the caller because bcrypt is deliberately slow and there is no reason to pay
 *   for it three times.
 * @returns {Promise<number>} The new user's id.
 */
async function insertUser(person, passwordHash) {
  const { rows } = await query(
    `INSERT INTO users
       (email, name, password_hash, role, timezone, phone_number,
        bio, business_name, business_type, qualifications, avatar_url,
        cancellation_cutoff_hours)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      person.email,
      person.name,
      passwordHash,
      person.role,
      person.timezone,
      person.phoneNumber ?? "+44 20 7946 0000",
      person.bio ?? null,
      person.businessName ?? null,
      person.businessType ?? null,
      person.qualifications ?? null,
      person.avatarUrl ?? null,
      person.cancellationCutoffHours ?? 12,
    ]
  );
  return rows[0].id;
}

/**
 * Finds the next date on or after `from` that falls on `weekday`, in `zone`.
 *
 * Availability and bookings are anchored to real upcoming dates rather than
 * fixed ones so the demo is still meaningful months from now. The search runs in
 * the provider's own zone because "next Tuesday" is a question about their
 * calendar, not the server's.
 *
 * @param {DateTime} from Search start, inclusive.
 * @param {number} weekday 0 = Sunday, matching the schema.
 * @returns {DateTime} Local midnight on the matching date.
 */
function nextWeekday(from, weekday) {
  let cursor = from.startOf("day");
  for (let i = 0; i < 14; i += 1) {
    if (cursor.weekday % 7 === weekday) return cursor;
    cursor = cursor.plus({ days: 1 });
  }
  throw new Error(`No date matched weekday ${weekday} within a fortnight`);
}

async function main() {
  await query("SELECT NOW()");
  console.log("Connected.");

  // The server does this on boot, but the seed may well be the first thing run
  // against a brand new database.
  await initSchema();

  const removed = await clearExistingDemoData();
  if (removed > 0) console.log(`Removed ${removed} existing demo account(s) and their data.`);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const clientId = await insertUser({ ...CLIENT, role: "client" }, passwordHash);
  console.log(`Client:   ${CLIENT.name} <${CLIENT.email}>  (${CLIENT.timezone})`);

  const createdServices = [];

  for (const provider of PROVIDERS) {
    const providerId = await insertUser({ ...provider, role: "provider" }, passwordHash);
    console.log(`Provider: ${provider.name} <${provider.email}>  (${provider.timezone})`);

    for (const rule of provider.rules) {
      await query(
        `INSERT INTO availability_rules (provider_id, weekday, start_minute, end_minute)
         VALUES ($1, $2, $3, $4)`,
        [providerId, rule.weekday, rule.startMinute, rule.endMinute]
      );
    }

    for (const service of provider.services) {
      const { rows } = await query(
        `INSERT INTO services
           (provider_id, service_name, description, price, duration,
            buffer_before, buffer_after, slot_interval, cover_image)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, duration, buffer_before, buffer_after`,
        [
          providerId,
          service.name,
          service.description,
          service.price,
          service.duration,
          service.bufferBefore,
          service.bufferAfter,
          service.slotInterval,
          service.coverImage,
        ]
      );
      createdServices.push({ ...rows[0], providerId, provider, name: service.name, price: service.price });
    }

    const today = DateTime.now().setZone(provider.timezone);

    // A holiday, and one weekend day opened specially. Both are dated relative
    // to now so they are always in the demo's visible future.
    const holidayStart = today.plus({ days: 10 });
    await query(
      `INSERT INTO availability_exceptions
         (provider_id, kind, start_date, end_date, note)
       VALUES ($1, 'block', $2, $3, $4)`,
      [
        providerId,
        holidayStart.toFormat("yyyy-MM-dd"),
        holidayStart.plus({ days: 2 }).toFormat("yyyy-MM-dd"),
        "Away — annual leave",
      ]
    );

    const extraDay = nextWeekday(today.plus({ days: 3 }), 6); // the coming Saturday
    await query(
      `INSERT INTO availability_exceptions
         (provider_id, kind, start_date, end_date, start_minute, end_minute, note)
       VALUES ($1, 'open', $2, $2, $3, $4, $5)`,
      [providerId, extraDay.toFormat("yyyy-MM-dd"), 600, 780, "Extra Saturday morning"]
    );

    console.log(
      `          ${provider.services.length} services, ${provider.rules.length} weekly windows, ` +
        `1 holiday block, 1 extra opening`
    );
  }

  // A few bookings, so the calendar and the dashboards are not empty on arrival.
  // Each is placed at the start of a real availability window on an upcoming
  // day, and inserted through the same span arithmetic the app itself uses —
  // so the exclusion constraint checks them exactly as it would a real booking.
  let bookingCount = 0;

  for (const service of createdServices.slice(0, 4)) {
    const { provider, providerId } = service;
    const zone = provider.timezone;
    const firstRule = provider.rules[0];

    // Two weeks out, comfortably clear of both the minimum-notice floor and the
    // seeded holiday block.
    const date = nextWeekday(DateTime.now().setZone(zone).plus({ days: 4 }), firstRule.weekday);
    const startsAt = date
      .plus({ minutes: firstRule.startMinute + service.buffer_before + bookingCount * 120 })
      .toUTC()
      .toJSDate();

    const span = computeBookingSpan(startsAt, service);

    try {
      const { rows } = await query(
        `INSERT INTO bookings
           (provider_id, client_id, service_id,
            starts_at, ends_at, blocked_from, blocked_to, status,
            service_name_snapshot, price_snapshot, duration_snapshot,
            client_timezone_snapshot, provider_timezone_snapshot,
            cancellation_cutoff_hours_snapshot, client_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'booked',$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          providerId,
          clientId,
          service.id,
          span.startsAt,
          span.endsAt,
          span.blockedFrom,
          span.blockedTo,
          service.name,
          service.price,
          service.duration,
          CLIENT.timezone,
          zone,
          provider.cancellationCutoffHours,
          "Booked from the seed script — feel free to cancel or reschedule me.",
        ]
      );

      // The audit trail is append-only and every status change writes to it, so
      // a seeded booking with no opening event would render an empty timeline.
      await query(
        `INSERT INTO booking_events
           (booking_id, from_status, to_status, to_starts_at, actor_id, actor_role)
         VALUES ($1, NULL, 'booked', $2, $3, 'client')`,
        [rows[0].id, span.startsAt, clientId]
      );

      bookingCount += 1;
    } catch (err) {
      // 23P01 means this slot overlapped one already seeded for the same
      // provider. Skipping is correct — the constraint is doing its job.
      if (err.code !== "23P01") throw err;
    }
  }

  console.log(`\nSeeded ${bookingCount} upcoming bookings.`);
  console.log("\nDemo accounts — password for all three:  " + DEMO_PASSWORD);
  for (const email of DEMO_EMAILS) console.log(`  ${email}`);

  await pgPool.end();
}

main().catch(async (err) => {
  console.error("Seed failed:", err.message);
  await pgPool.end().catch(() => {});
  process.exit(1);
});
