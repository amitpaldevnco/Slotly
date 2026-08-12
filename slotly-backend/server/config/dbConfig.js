/**
 * The PostgreSQL connection pool, and the three helpers everything else uses to
 * talk to it.
 *
 * Nothing in the app constructs its own client: every read goes through
 * `query`, every schema statement through `exec`, and every multi-statement
 * write through `transaction`. Keeping that funnel narrow is what makes two
 * guarantees checkable by reading one file — that every value reaching SQL is a
 * bound parameter rather than string-concatenated, and that a write which fails
 * half way leaves nothing behind.
 *
 * ## Two ways to be configured, and why both exist
 *
 * A managed host — Neon, Render, Supabase, Heroku — hands out a single
 * `DATABASE_URL`. A local install is five discrete values. Supporting both
 * means the same code runs in both places with no branch anywhere else, and the
 * connection string wins when set so a deployed environment cannot accidentally
 * be pointed at leftover `DB_*` values.
 *
 * TLS follows from that: on with a connection string, off without one, with
 * `DB_SSL` able to override either way.
 */
import pg from "pg";
import dotenv from "dotenv";

// Load environment variables from the .env file
dotenv.config();

const { Pool, Client } = pg;
// Read database configuration from .env
const dbHost = process.env.DB_HOST;
const dbPort = parseInt(process.env.DB_PORT || "5432", 10);
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD;
const dbName = process.env.DB_NAME;

// A managed host (Render, Neon, Supabase, Heroku) hands out one connection
// string rather than five separate values, so DATABASE_URL takes precedence
// when it is set and the discrete DB_* variables stay as the local-development
// path. Neither form is hardcoded: both come from the environment.
const connectionString = process.env.DATABASE_URL;

// Managed Postgres requires TLS, and its certificate is signed by a CA that is
// not in Node's default trust store, so verification has to be relaxed or the
// handshake fails with SELF_SIGNED_CERT_IN_CHAIN. The traffic is still
// encrypted. Local Postgres normally has no TLS at all, hence the default of
// "on with a connection string, off without one"; DB_SSL overrides both ways.
const useSsl =
    process.env.DB_SSL !== undefined
        ? process.env.DB_SSL === "true"
        : Boolean(connectionString);
const sslOption = useSsl ? { rejectUnauthorized: false } : false;

// Configuration object used to create the PostgreSQL connection pool.
const pgConfig = connectionString
    ? {
          connectionString,
          ssl: sslOption,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
      }
    : {
          host: dbHost,
          port: dbPort,
          user: dbUser,
          password: dbPassword,
          database: dbName,
          ssl: sslOption,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
      };

let pgPool = new Pool(pgConfig);

// Auto-create database if it doesn't exist
async function initPostgresConnection() {
    try {
        await pgPool.query("SELECT 1");
        console.log(
            connectionString
                ? "Connected to Database via DATABASE_URL"
                : `Connected to Database: "${dbName}" at ${dbHost}:${dbPort}`,
        );
    } catch (err) {
        // Only worth attempting locally. A managed database already exists, and
        // its user is not permitted to CREATE DATABASE, so trying would replace
        // a clear connection error with a confusing permissions one.
        if (err.code === "3D000" && !connectionString) {
            // If we get this error, connect to the default
            console.log(
                `Database "${dbName}" does not exist. Creating database`,
            );
            const rootClient = new Client({
                host: dbHost,
                port: dbPort,
                user: dbUser,
                password: dbPassword,
                database: "postgres",
            });
            
            await rootClient.connect();
            // Create the application's database.
            await rootClient.query(`CREATE DATABASE "${dbName}"`);
            // Close the temporary connection.
            await rootClient.end();
            console.log(`Database "${dbName}" created successfully`);
            // Create a new connection pool using the newly created database.
            pgPool = new Pool(pgConfig);
            // Verify the connection.
            await pgPool.query("SELECT 1");
            console.log(`Connected to Database: "${dbName}"`);
        } else {
            // Any other error is unexpected, so log it and stop the application.
            console.error("connection error:", err.message);
            throw err;
        }
    }
}

// Initialize the database connection when the server starts.
await initPostgresConnection();


/**
 * Runs one parameterised statement on a pooled connection.
 *
 * `params` are always sent separately from `text` — PostgreSQL never sees a
 * value spliced into the SQL, which is what makes injection impossible rather
 * than merely unlikely. The one place a name is interpolated instead is
 * `services/accountLinking.js`, and it is chosen from a hardcoded allow-list
 * there for exactly this reason.
 *
 * @param {string} text SQL with $1-style placeholders.
 * @param {Array} [params] Values for those placeholders.
 * @returns {Promise<{rows: Array, count: number}>} `count` is the number of
 *   rows affected, which is what callers use to distinguish "updated nothing"
 *   from "updated something" without a second read.
 * @throws {Error} node-postgres errors pass through untouched, `code` and all,
 *   because callers branch on SQLSTATE — 23P01 becoming a 409 SLOT_TAKEN is the
 *   whole double-booking contract.
 */
export async function query(text, params = []) {
    const res = await pgPool.query(text, params);
    return { rows: res.rows, count: res.rowCount };
}

/**
 * Runs a statement that takes no parameters, for schema work.
 *
 * Separate from `query` so that DDL — which cannot be parameterised, and which
 * is the only SQL in the codebase written as a literal string — is visibly a
 * different kind of call. Every caller is in `config/schema.js`.
 *
 * @param {string} sql One or more statements.
 * @returns {Promise<void>}
 */
export async function exec(sql) {
    await pgPool.query(sql);
}

/**
 * Runs several statements atomically on one connection.
 *
 * The callback receives a handle whose `query` is bound to that single client,
 * which is the point: a pooled `query()` call inside a transaction would take a
 * *different* connection and run outside it, committing independently. Every
 * multi-statement write in the app — booking creation and its audit event,
 * cancellation, reschedule, replacing a week of availability — goes through
 * here so a partial failure can never leave a booking without its timeline row.
 *
 * @param {(tx: {query: Function}) => Promise<T>} callback Receives the handle.
 *   Anything it returns is returned from `transaction`.
 * @returns {Promise<T>} The callback's result, after COMMIT.
 * @throws {Error} Rethrows whatever the callback threw, after ROLLBACK. The
 *   connection is released either way.
 * @template T
 */
export async function transaction(callback) {
    const client = await pgPool.connect();
    try {
        // Start the transaction
        await client.query('BEGIN');
        // Execute all queries using the same database connection
        const result = await callback({
            query: (text, params) => client.query(text, params),
        });
        // Save all changes
        await client.query('COMMIT');
        return result;
    } catch (err) {
        // Undo all changes if an error occurs
        await client.query('ROLLBACK');
        throw err;
    } finally {
        // Return the connection to the pool
        client.release();
    }
}
export default pgPool;