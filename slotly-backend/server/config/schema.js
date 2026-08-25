/**
 * Every table, index and constraint the app needs, created on boot.
 *
 * Two conventions run through the whole schema and are worth stating once:
 *
 *   1. **A real instant is always `TIMESTAMPTZ`; a wall-clock reading is always
 *      an integer.** `bookings.starts_at` is a moment in time and carries its
 *      zone. A provider's "09:00 on Mondays" is not a moment — it has no date
 *      and no zone until paired with a calendar date — so it is stored as `540`,
 *      minutes from midnight. Storing it as `TIME` would invite code to treat it
 *      as an instant, which is the single most likely way to get this wrong;
 *      an integer cannot be mistaken for one, and duration arithmetic on it is
 *      plain integer maths.
 *
 *   2. **A guarantee lives in the database, not in a controller.** No overlap
 *      per provider, one review per booking, one account per email, no
 *      overlapping availability rules: each is a constraint below, so no request
 *      can race past it and no future handler can forget to check. The
 *      exclusion constraint on `bookings` is the important one and carries its
 *      own comment.
 *
 * Every statement is `IF NOT EXISTS` (or wrapped so a duplicate is a no-op), so
 * this runs unchanged against a fresh database and against one that already has
 * data. That is what makes starting the server the only setup step a database
 * needs, and it is why columns added after the first release appear twice: once
 * in `CREATE TABLE` for a new database, and again as `ALTER TABLE ... ADD COLUMN
 * IF NOT EXISTS` for an existing one.
 */
import { exec, query } from "./dbConfig.js";

export async function initSchema() {
  await exec("CREATE EXTENSION IF NOT EXISTS btree_gist;");
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                        SERIAL PRIMARY KEY,
      google_id                 VARCHAR(255) UNIQUE,
      github_id                 VARCHAR(255) UNIQUE,
      email                     VARCHAR(255) UNIQUE NOT NULL,
      name                      VARCHAR(255),
      avatar_url                TEXT,
      role                      VARCHAR(20) CHECK (role IN ('client', 'provider')),
      phone_number              VARCHAR(30),
      timezone                  VARCHAR(100) NOT NULL DEFAULT 'UTC',
      bio                       TEXT,
      business_name             VARCHAR(255),
      business_type             VARCHAR(255),

      -- Free-text credentials shown on the public page: "BPT, MPT (Sports)",
      -- "12 years in practice". Deliberately one unstructured field rather than
      -- a qualifications table: nothing in the app queries, filters or verifies
      -- these, so structuring them would buy nothing and cost a join. If they
      -- ever need to be searchable or verified, that is the point to normalise.
      qualifications            VARCHAR(500),

      -- ISO 4217 code the provider prices in, e.g. 'GBP', 'INR', 'USD'.
      --
      -- On the user and not on the service: a provider bills in one currency
      -- across everything they offer, so putting it on each service would invite
      -- a profile whose services disagree with each other, and would need a
      -- migration to fix rather than being unrepresentable in the first place.
      --
      -- The code alone is stored, never a symbol. Symbols are ambiguous ($ is at
      -- least five different currencies) and are a rendering concern; the client
      -- turns the code into a symbol with Intl at display time, in the reader's
      -- own locale.
      --
      -- Clients carry the column too and simply never use it. Splitting the
      -- table to avoid that would cost a join on every read to save one short
      -- string per row.
      -- The format CHECK is added as a named constraint below rather than inline,
      -- so a fresh database and a migrated one end up with the same one
      -- constraint under the same name instead of two under different ones.
      currency                  CHAR(3) NOT NULL DEFAULT 'INR',

      password_hash             VARCHAR(255),

      -- How many hours before the appointment a client may still cancel it.
      -- Provider-configurable; snapshotted onto each booking at creation time
      -- so changing it later cannot retroactively strand an existing booking.
      cancellation_cutoff_hours INTEGER NOT NULL DEFAULT 12
                                  CHECK (cancellation_cutoff_hours >= 0),

      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Column added after the initial release; existing databases need it backfilled.
  // Nullable with no default, so every existing row simply reads as "not stated"
  // rather than being given a value nobody entered.
  await exec(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS qualifications VARCHAR(500);
  `);

  // Also added after the initial release. Unlike `qualifications` this one is NOT
  // NULL with a default: a price has to be denominated in something, so there is
  // no honest "not stated" reading for it. Existing rows land on 'INR', which is
  // what the frontend hardcoded before this column existed — so the backfill
  // changes nothing that was already on screen, and providers correct it from
  // their profile.
  await exec(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'INR';
  `);
  await exec(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_currency_format;`);
  await exec(`
    ALTER TABLE users
      ADD CONSTRAINT users_currency_format CHECK (currency ~ '^[A-Z]{3}$');
  `);

  // Partial index: only providers are ever browsed, so the discovery query
  // never has to skip past client rows.
  await exec(`
    CREATE INDEX IF NOT EXISTS idx_users_providers
      ON users (id) WHERE role = 'provider';
  `);

  // ---------------------------------------------------------------------------
  // services — what a provider offers. Rows are never hard-deleted while
  // bookings reference them; `is_active = false` retires a service from the
  // public page and the slot picker while leaving its booking history intact.
  // ---------------------------------------------------------------------------
  await exec(`
    CREATE TABLE IF NOT EXISTS services (
      id            SERIAL PRIMARY KEY,
      provider_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      service_name  VARCHAR(255) NOT NULL,
      description   TEXT,
      price         NUMERIC(10,2) NOT NULL CHECK (price >= 0),
      duration      INTEGER NOT NULL CHECK (duration > 0),
      buffer_before INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before >= 0),
      buffer_after  INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after >= 0),

      -- Spacing of the candidate start times offered to clients, in minutes.
      -- Independent of duration on purpose: a 60-minute service on a 30-minute
      -- interval offers 09:00, 09:30, 10:00 …, which overlap each other as
      -- candidates. Booking one removes its neighbours automatically, and the
      -- client gets round times instead of 09:05, 10:15, 11:25.
      slot_interval INTEGER NOT NULL DEFAULT 30
                      CHECK (slot_interval BETWEEN 5 AND 240),

      cover_image   TEXT,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,

      -- True once this service has its own weekly hours/exceptions instead of
      -- inheriting the provider's default ones. A dedicated flag rather than
      -- "does it have any rule rows" because a service can legitimately have
      -- zero windows of its own (paused / fully closed), which must not read
      -- as "no override configured".
      has_custom_availability BOOLEAN NOT NULL DEFAULT FALSE,

      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_services_provider
      ON services (provider_id) WHERE is_active;
  `);

  // Column added after the initial release; existing databases need it backfilled.
  await exec(`
    ALTER TABLE services
      ADD COLUMN IF NOT EXISTS has_custom_availability BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS availability_rules (
      id           SERIAL PRIMARY KEY,
      provider_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      service_id   INTEGER REFERENCES services(id) ON DELETE CASCADE,
      weekday      SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
      end_minute   INTEGER NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT availability_rules_window_ordered CHECK (end_minute > start_minute)
    );
    CREATE INDEX IF NOT EXISTS idx_availability_rules_provider
      ON availability_rules (provider_id, weekday);
  `);

  // Column added after the initial release; existing databases need it backfilled.
  // Must run before the index and constraint below, which reference it — on a
  // fresh table CREATE TABLE already added the column, so this is a no-op.
  await exec(`
    ALTER TABLE availability_rules
      ADD COLUMN IF NOT EXISTS service_id INTEGER REFERENCES services(id) ON DELETE CASCADE;
  `);

  await exec(`
    CREATE INDEX IF NOT EXISTS idx_availability_rules_service
      ON availability_rules (service_id, weekday);
  `);


  await exec(`ALTER TABLE availability_rules DROP CONSTRAINT IF EXISTS availability_rules_no_overlap;`);
  await exec(`
    DO $$
    BEGIN
      ALTER TABLE availability_rules
        ADD CONSTRAINT availability_rules_no_overlap
        EXCLUDE USING gist (
          provider_id WITH =,
          COALESCE(service_id, -1) WITH =,
          weekday     WITH =,
          int4range(start_minute, end_minute) WITH &&
        );
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END $$;
  `);


  await exec(`
    CREATE TABLE IF NOT EXISTS availability_exceptions (
      id           SERIAL PRIMARY KEY,
      provider_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      service_id   INTEGER REFERENCES services(id) ON DELETE CASCADE,
      kind         VARCHAR(10) NOT NULL CHECK (kind IN ('block', 'open')),
      start_date   DATE NOT NULL,
      end_date     DATE NOT NULL,
      start_minute INTEGER CHECK (start_minute >= 0 AND start_minute < 1440),
      end_minute   INTEGER CHECK (end_minute > 0 AND end_minute <= 1440),
      note         VARCHAR(255),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT availability_exceptions_dates_ordered
        CHECK (end_date >= start_date),
      -- Either both minutes are set and ordered, or both are NULL (full day).
      CONSTRAINT availability_exceptions_window_valid CHECK (
        (start_minute IS NULL AND end_minute IS NULL)
        OR (start_minute IS NOT NULL AND end_minute IS NOT NULL AND end_minute > start_minute)
      ),
      -- An 'open' exception with no window would mean "open 24 hours", which is
      -- never what the UI intends; require an explicit window.
      CONSTRAINT availability_exceptions_open_needs_window CHECK (
        kind <> 'open' OR start_minute IS NOT NULL
      )
    );
    CREATE INDEX IF NOT EXISTS idx_availability_exceptions_provider
      ON availability_exceptions (provider_id, start_date, end_date);
  `);

  // Column added after the initial release; existing databases need it backfilled.
  // Must run before the index below, which references it — on a fresh table
  // CREATE TABLE already added the column, so this is a no-op.
  await exec(`
    ALTER TABLE availability_exceptions
      ADD COLUMN IF NOT EXISTS service_id INTEGER REFERENCES services(id) ON DELETE CASCADE;
  `);

  await exec(`
    CREATE INDEX IF NOT EXISTS idx_availability_exceptions_service
      ON availability_exceptions (service_id, start_date, end_date);
  `);

  // ---------------------------------------------------------------------------
  // bookings — the appointment itself.
  //
  // starts_at / ends_at bound the appointment the two people attend.
  // blocked_from / blocked_to additionally include the service's buffers, and
  // are what the double-booking guard actually compares. Keeping both means the
  // UI can show the real appointment time while the constraint reasons about
  // the full occupied span.
  //
  // The *_snapshot columns freeze the service's name, price and duration, and
  // both parties' timezones, at the moment of booking. Without them, a provider
  // renaming a service or moving city would silently rewrite history.
  // ---------------------------------------------------------------------------
  await exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id                                 SERIAL PRIMARY KEY,
      provider_id                        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id                          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      service_id                         INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,

      starts_at                          TIMESTAMPTZ NOT NULL,
      ends_at                            TIMESTAMPTZ NOT NULL,
      blocked_from                       TIMESTAMPTZ NOT NULL,
      blocked_to                         TIMESTAMPTZ NOT NULL,

      status                             VARCHAR(20) NOT NULL DEFAULT 'booked'
                                           CHECK (status IN ('booked','rescheduled','cancelled','completed','no_show')),

      service_name_snapshot              VARCHAR(255) NOT NULL,
      price_snapshot                     NUMERIC(10,2) NOT NULL,
      duration_snapshot                  INTEGER NOT NULL,
      client_timezone_snapshot           VARCHAR(100) NOT NULL,
      provider_timezone_snapshot         VARCHAR(100) NOT NULL,
      cancellation_cutoff_hours_snapshot INTEGER NOT NULL,

      client_note                        VARCHAR(500),
      cancellation_reason                VARCHAR(500),
      cancelled_at                       TIMESTAMPTZ,

      created_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT bookings_interval_ordered CHECK (ends_at > starts_at),
      CONSTRAINT bookings_blocked_contains_appointment
        CHECK (blocked_from <= starts_at AND blocked_to >= ends_at)
    );
  `);

  // THE double-booking guarantee.
  //
  // This is the whole mechanism — there is no read-then-check-then-insert path
  // in the application code. PostgreSQL evaluates the exclusion constraint
  // while holding a lock on the index entry, so two transactions inserting
  // overlapping spans for the same provider are serialised by the database:
  // the first commits, the second is rejected with SQLSTATE 23P01
  // (exclusion_violation), which the booking controller maps to 409 SLOT_TAKEN.
  //
  // tstzrange is half-open, so a booking ending at 10:00 and one starting at
  // 10:00 do not overlap — back-to-back appointments are legal.
  //
  // The WHERE clause makes this a partial constraint: cancelled bookings stop
  // occupying the calendar and their slot returns to the pool, while completed
  // and no-show bookings keep occupying it, because that time really was used.
  await exec(`
    DO $$
    BEGIN
      ALTER TABLE bookings
        ADD CONSTRAINT bookings_no_overlap_per_provider
        EXCLUDE USING gist (
          provider_id WITH =,
          tstzrange(blocked_from, blocked_to) WITH &&
        ) WHERE (status <> 'cancelled');
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END $$;
  `);

  await exec(`
    CREATE INDEX IF NOT EXISTS idx_bookings_client
      ON bookings (client_id, starts_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bookings_provider_time
      ON bookings (provider_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_bookings_service
      ON bookings (service_id);
  `);

  // ---------------------------------------------------------------------------
  // booking_events — append-only audit trail. Every status transition and every
  // reschedule writes a row here, which is what the booking detail page renders
  // as a timeline. Rows are never updated or deleted.
  // ---------------------------------------------------------------------------
  await exec(`
    CREATE TABLE IF NOT EXISTS booking_events (
      id             SERIAL PRIMARY KEY,
      booking_id     INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      from_status    VARCHAR(20),
      to_status      VARCHAR(20) NOT NULL,
      from_starts_at TIMESTAMPTZ,
      to_starts_at   TIMESTAMPTZ,
      actor_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_role     VARCHAR(20) NOT NULL CHECK (actor_role IN ('client','provider','system')),
      reason         VARCHAR(500),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_booking_events_booking
      ON booking_events (booking_id, created_at);
  `);

  // ---------------------------------------------------------------------------
  // booking_messages — the conversation about one appointment.
  //
  // ## Why the thread hangs off a booking and not off a pair of users
  //
  // `booking_id` *is* the conversation. There is deliberately no `conversations`
  // table, because such a row would carry a surrogate key and nothing else,
  // while adding a join to every read.
  //
  // Anchoring on the booking buys two things for free:
  //
  //   - **Authorization.** A booking has exactly two parties, already on the row
  //     as `client_id` and `provider_id`, so "may this person read this thread?"
  //     is answered by the same `viewerRoleFor()` check the booking endpoints
  //     already use. No new concept of membership.
  //   - **Context.** A client with three appointments from the same provider gets
  //     three separate threads, so "do I need to bring anything?" is never
  //     ambiguous about which appointment it refers to.
  //
  // There is no `sender_role` column: it is derivable by comparing `sender_id`
  // against the booking's two parties, and storing it would be duplicate state
  // that could drift from the booking it describes.
  // ---------------------------------------------------------------------------
  await exec(`
    CREATE TABLE IF NOT EXISTS booking_messages (
      id         SERIAL PRIMARY KEY,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      body       VARCHAR(2000) NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Set when the *other* party first loads the thread. Drives the unread
      -- badge; NULL means "not yet seen by the recipient".
      read_at    TIMESTAMPTZ,

      -- A message of pure whitespace is not a message. Enforced here so no
      -- client, however it is written, can create one.
      --
      -- The test is a regex for "contains at least one non-whitespace character"
      -- rather than a length check on a trimmed value. PostgreSQL btrim() strips
      -- only *spaces* by default, so the length version accepted a body made of
      -- newlines and tabs. The POSIX space class covers spaces, tabs, newlines
      -- and carriage returns together.
      CONSTRAINT booking_messages_body_not_blank CHECK (body ~ '[^[:space:]]')
    );
    CREATE INDEX IF NOT EXISTS idx_booking_messages_thread
      ON booking_messages (booking_id, created_at);
  `);

  // The constraint above shipped in a weaker form first (see the comment), so an
  // existing database needs it replaced rather than merely created.
  await exec(`ALTER TABLE booking_messages DROP CONSTRAINT IF EXISTS booking_messages_body_not_blank;`);
  await exec(`
    ALTER TABLE booking_messages
      ADD CONSTRAINT booking_messages_body_not_blank CHECK (body ~ '[^[:space:]]');
  `);

  // Serves the unread badge: "messages on my bookings that I did not send and
  // have not read". Partial, because read messages are the overwhelming majority
  // over time and none of them can ever match.
  await exec(`
    CREATE INDEX IF NOT EXISTS idx_booking_messages_unread
      ON booking_messages (booking_id, sender_id) WHERE read_at IS NULL;
  `);

  // ---------------------------------------------------------------------------
  // reviews — a client's feedback on one completed appointment.
  //
  // ## The shape, and why
  //
  // `booking_id` is UNIQUE: one appointment, one review. That is what stops a
  // client from rating the same session five times, and it is enforced by the
  // database rather than by a check in application code that a retry could race
  // past. Changing your mind is an UPDATE of your own row, not a second row.
  //
  // `provider_id` is denormalised from the booking purely so "every review for
  // this provider" is one indexed read on the public page, instead of a join
  // through bookings on every profile view. `client_id` is deliberately *not*
  // duplicated: it is on the booking, and nothing queries reviews by client.
  //
  // The provider's response lives in `provider_reply` on this same row rather
  // than in a `review_replies` table. A review has at most one reply, from
  // exactly one person, so a separate table would be strictly one-to-one — a
  // join with nothing to show for it. If threaded discussion is ever wanted,
  // that is the point to split it out.
  //
  // Only a booking with status 'completed' may be reviewed; that rule lives in
  // the controller, because it depends on the booking's current status rather
  // than on anything storable here.
  // ---------------------------------------------------------------------------
  await exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id             SERIAL PRIMARY KEY,
      booking_id     INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
      provider_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment        VARCHAR(1000),

      provider_reply VARCHAR(1000),
      replied_at     TIMESTAMPTZ,

      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_provider
      ON reviews (provider_id, created_at DESC);
  `);

  // ---------------------------------------------------------------------------
  // Email is an identifier, not a display string, so it is stored casefolded.
  //
  // Postgres compares VARCHAR case-sensitively, so `Casey@x.com` and
  // `casey@x.com` were two different rows under the UNIQUE constraint — and a
  // login typed with a capital first letter (which every mobile keyboard offers)
  // simply did not match. The controller now lowercases on the way in; this
  // backfills the rows written before it did.
  //
  // Done one row at a time, skipping any address whose lowercase form is already
  // taken, because a straight UPDATE would violate the UNIQUE constraint and
  // abort the whole boot. A skipped row is a genuine duplicate pair that needs a
  // human decision about which account survives, so it is logged rather than
  // guessed at.
  // ---------------------------------------------------------------------------
  const mixedCase = await query(`SELECT id, email FROM users WHERE email <> lower(email)`);
  for (const row of mixedCase.rows ?? []) {
    const lowered = row.email.trim().toLowerCase();
    const clash = await query(`SELECT id FROM users WHERE email = $1 AND id <> $2`, [
      lowered,
      row.id,
    ]);
    if ((clash.rows ?? []).length > 0) {
      console.warn(
        `[schema] user ${row.id} <${row.email}> not casefolded: <${lowered}> already exists. ` +
          `Merge these two accounts by hand.`
      );
      continue;
    }
    await query(`UPDATE users SET email = $1 WHERE id = $2`, [lowered, row.id]);
  }

  // Belt and braces: even with the controller lowercasing, this makes a
  // case-variant duplicate unrepresentable rather than merely unlikely.
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
      ON users (lower(email));
  `);

}
