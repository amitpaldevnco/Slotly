/**
 * Applies the schema to whichever database the environment points at, then
 * exits. Run with `npm run db:init`.
 *
 * The server already does this on every boot, so this script is not required for
 * normal operation. It exists for the case where you want to prepare a new
 * database — a fresh Neon project, say — and see the result on its own, without
 * a web process starting up and a deploy log to read it out of.
 *
 * It is safe to run repeatedly and safe to run against a database that already
 * holds data. `config/schema.js` is written entirely as `CREATE ... IF NOT
 * EXISTS` and `ADD COLUMN IF NOT EXISTS`, and the two `DROP CONSTRAINT IF
 * EXISTS` statements immediately re-add the constraint they dropped. Nothing
 * here drops a table, drops a database, or deletes a row.
 *
 * Point it at a database by setting DATABASE_URL (or the local DB_* variables)
 * in the environment, exactly as the server reads them:
 *
 *   DATABASE_URL="postgresql://..." npm run db:init
 */
import "dotenv/config";
import { query } from "../config/dbConfig.js";
import { initSchema } from "../config/schema.js";
import pgPool from "../config/dbConfig.js";

async function main() {
  await query("SELECT NOW()");
  console.log("Connected.");

  await initSchema();
  console.log("Schema applied. Tables, indexes and constraints are in place.");

  // Without this the pool keeps the event loop alive and the script hangs after
  // reporting success, which reads as a failure.
  await pgPool.end();
}

main().catch((err) => {
  console.error("Schema initialization failed:", err.message);
  process.exit(1);
});
