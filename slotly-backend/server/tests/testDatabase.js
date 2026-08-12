/**
 * How the database-backed test suites reach PostgreSQL.
 *
 * Two suites here — the double-booking guard and account linking — cannot be
 * mocked, because in both cases the thing under test *is* a database
 * constraint. They therefore need a real connection, and they need it built the
 * same way the application builds its own, or `npm test` would pass locally and
 * fail against the deployed database for reasons that have nothing to do with
 * the code.
 *
 * The suites originally read only the discrete `DB_*` variables, which meant a
 * managed host handing out a single `DATABASE_URL` — Neon, Render, Supabase,
 * Heroku — could not be tested against at all: `DATABASE_URL=… npm test` looked
 * like it should work and silently connected nowhere. This mirrors
 * `config/dbConfig.js` instead: the connection string wins when it is set, the
 * discrete values are the local-development path, and TLS defaults to on for a
 * connection string and off without one.
 *
 * They are not simply importing `config/dbConfig.js` because these suites need
 * their own pool with a raised connection limit — the concurrency test makes ten
 * simultaneous attempts on purpose, and a transaction blocked waiting for a
 * *pool slot* rather than for the constraint would make the test pass for
 * entirely the wrong reason.
 */
import pg from "pg";

/**
 * Builds a pool for a test suite.
 *
 * @param {{max?: number}} [options] `max` is the connection ceiling. Default 15,
 *   comfortably above the ten simultaneous attempts the busiest test makes.
 * @returns {pg.Pool}
 */
export function createTestPool({ max = 15 } = {}) {
  const connectionString = process.env.DATABASE_URL;

  const useSsl =
    process.env.DB_SSL !== undefined
      ? process.env.DB_SSL === "true"
      : Boolean(connectionString);

  // Managed Postgres presents a certificate signed by a CA that is not in
  // Node's default trust store, so verification is relaxed while the traffic
  // stays encrypted — the same trade `config/dbConfig.js` makes, for the same
  // reason.
  const ssl = useSsl ? { rejectUnauthorized: false } : false;

  if (connectionString) {
    return new pg.Pool({ connectionString, ssl, max });
  }

  return new pg.Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl,
    max,
  });
}

/**
 * One line naming where the suite just connected.
 *
 * Printed once per DB-backed suite so a failing run says which database it was
 * talking to. The connection string is never echoed — it carries a password.
 *
 * @returns {string}
 */
export function describeTestDatabase() {
  return process.env.DATABASE_URL
    ? "tests: using DATABASE_URL"
    : `tests: using ${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME}`;
}
