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


// Executes a SQL query using the PostgreSQL connection pool.
// Supports parameterized queries to help prevent SQL injection.
// Returns the query result rows and the number of affected rows.
export async function query(text, params = []) {
    const res = await pgPool.query(text, params);
    return { rows: res.rows, count: res.rowCount };
}

// Executes a raw SQL statement.
// Mainly used for schema operations such as
// CREATE TABLE, ALTER TABLE, or DROP TABLE.
export async function exec(sql) {
    await pgPool.query(sql);
}

// Executes multiple database operations inside a transaction.
// If every query succeeds, the transaction is committed.
// If any query fails, all changes are rolled back to
// keep the database consistent.
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