import "dotenv/config";
import app from "./server.js";
import { query } from "./config/dbConfig.js";
import { initSchema } from "./config/schema.js";
import { describeBackend } from "./services/imageStorage.js";

// The host assigns the port in a deployed environment; 5000 is only the local
// default. `listen` with no host binds every interface, which is what a
// container platform requires — binding 127.0.0.1 would make the service
// unreachable from outside the container.
const PORT = process.env.PORT || 5000;

// A rejected promise or a thrown error with no handler leaves Node in an
// undefined state, and on a platform that restarts the process automatically
// that shows up as an unexplained restart loop. Logging the cause before exiting
// turns it into something diagnosable from the deploy log. Exiting rather than
// continuing is deliberate: the platform's restart is more trustworthy than a
// process that has already lost its footing.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

async function startServer() {
  try {
    await query("SELECT NOW()");
    console.log("Database connected successfully.");

    await initSchema();
    console.log("Schema initialized.");

    // Printed on every boot because "why did my image disappear?" is far easier
    // to answer when the deploy log already says which storage was chosen.
    console.log(describeBackend());

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  }
}

startServer();