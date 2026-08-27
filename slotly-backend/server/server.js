/**
 * Express application wiring.
 *
 * Exported without calling `listen` so the same app object can be mounted by
 * `index.js` for real and by supertest in the API tests without binding a port.
 */
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import authRoutes from "./routes/authRoutes.js";
import providerRoutes from "./routes/providerRoutes.js";
import serviceRoutes from "./routes/serviceRoutes.js";
import availabilityRoutes from "./routes/availabilityRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import { openApiDocument, docsPage } from "./docs/openapi.js";
import { allowedOrigins } from "./config/appConfig.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { query } from "./config/dbConfig.js";
import {
  errorResponse,
  ERROR_CODES,
} from "./responseController/responseHandler.js";

const app = express();

// Render terminates TLS at its edge and forwards over HTTP, so without this
// `req.protocol` reads "http" and `req.ip` is the proxy's address rather than
// the caller's. Only the first hop is trusted — Render's own load balancer.
app.set("trust proxy", 1);

// Express advertises itself in an `X-Powered-By` header on every response. It
// serves no purpose here and names the framework and, by implication, its
// version-specific advisories to anyone scanning. The rest of this file is
// deliberate about what it publishes — the allow-listed CORS origin, the
// non-browsable static mount, the narrow provider projection — so this belongs
// with them rather than left at the framework default.
app.disable("x-powered-by");

// A JSON body limit keeps a hostile client from making the server buffer an
// arbitrarily large payload. Uploads bypass this — multer handles them, with its
// own file-size cap.
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// Express 5 leaves `req.body` as `undefined` when a request carries no body at
// all, where Express 4 gave `{}`. Every handler that destructures the body would
// otherwise throw a TypeError on a bodyless POST — a legitimate request, since
// several endpoints have only optional fields — and report it as a 500 instead
// of validating it. Normalising here fixes it for every route at once.
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

// Auth is cookie-based, so `credentials: true` is required for the browser to
// send the session cookie, and that in turn forbids a wildcard origin. The
// allow-list is configurable so a deployed frontend can be added without a code
// change — see config/appConfig.js, which derives it from FRONTEND_URL.
app.use(
  cors({
    origin: (origin, callback) => {
      // A missing Origin header means a same-origin or non-browser caller (curl,
      // the test suite); there is no cross-origin risk to guard against there.
      if (!origin || allowedOrigins.includes(origin))
        return callback(null, true);
      callback(new Error(`Origin ${origin} is not allowed`));
    },
    credentials: true,
  }),
);

// Uploaded images. `index: false` and `dotfiles: "ignore"` stop the directory
// being browsable and hidden files being served.
app.use(
  "/api/uploads",
  express.static(path.join(process.cwd(), "uploads"), {
    index: false,
    dotfiles: "ignore",
  }),
);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to Slotly API",
    docs: "/api/docs",
  });
});

// Liveness. Deliberately touches nothing external: this is the endpoint the
// host polls, and a database round trip on every poll would hold a
// scale-to-zero database permanently awake and burn its free compute allowance
// for no information. "Is the process serving HTTP?" is what a health check is
// actually asking.
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    success: true,
    service: "Slotly API",
    timestamp: new Date().toISOString(),
  });
});

// Readiness, on a separate path so it can be called deliberately rather than on
// a timer. `SELECT 1` proves the pool can reach the database and nothing more —
// no version, host, or connection detail is echoed back, since that would hand a
// stranger a map of the infrastructure.
app.get("/api/health/db", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    console.error("Health check: database unreachable:", err.message);
    res.status(503).json({ status: "error", database: "unreachable" });
  }
});

// API documentation: a browsable page and the raw OpenAPI document behind it.
app.get("/api/docs", docsPage);
app.get("/api/docs/openapi.json", (req, res) => res.json(openApiDocument));

// Broad backstop across the whole API. Mounted after /api/docs so the reference
// page stays readable while someone is clicking through it, and before the
// routers so it runs ahead of any handler. The tighter per-endpoint credential
// limits live on the auth router itself.
app.use("/api", apiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/providers", providerRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/reviews", reviewRoutes);

// Unknown API path. Without this, a typo'd URL falls through to the error
// handler below and reports as a 500, which sends debugging in the wrong
// direction.
app.use("/api", (req, res) => {
  errorResponse(
    res,
    `No such endpoint: ${req.method} ${req.originalUrl}`,
    404,
    ERROR_CODES.NOT_FOUND,
  );
});

/**
 * Global error handler.
 *
 * Controllers handle their own expected failures; anything reaching here is
 * unexpected, so the response is deliberately vague — the detail goes to the
 * server log, not to the client, where it would leak internals.
 *
 * The two exceptions are multer's file-size error and the CORS rejection, which
 * are both ordinary user-facing conditions that happen to surface as thrown
 * errors, and are worth reporting precisely.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity; `next` must stay.
// The last stop for anything thrown past a controller.
//
// Its job is to make sure a *client* mistake never leaves here wearing a 500.
// Everything below this comment is a request that arrived malformed in some way
// the body parsers or multer noticed before any handler ran, so none of it is
// "something went wrong on our side" — and each one gets the same
// `{ error, code }` envelope every other refusal in the API uses, so a caller
// can branch on `code` here exactly as it does everywhere else.
app.use((err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return errorResponse(
      res,
      "That file is larger than the 5MB limit",
      400,
      ERROR_CODES.UPLOAD_REJECTED,
    );
  }

  // Any other multer complaint: too many files, an unexpected field name.
  if (err?.name === "MulterError") {
    return errorResponse(
      res,
      "That upload could not be accepted",
      400,
      ERROR_CODES.UPLOAD_REJECTED,
    );
  }

  // busboy, underneath multer, throws plain Errors for a multipart body it
  // cannot parse — a mismatched boundary, or a filename carrying a null byte.
  // The request is unreadable, which is the client's problem and a 400; left to
  // fall through it was reported as a server fault and logged as a crash.
  if (err?.message === "Malformed part header" || err?.message === "Unexpected end of form") {
    return errorResponse(
      res,
      "That upload could not be read. Please try the file again.",
      400,
      ERROR_CODES.UPLOAD_REJECTED,
    );
  }

  // express.json sets `type` on what it rejects. Both cases carry a usable
  // status of their own; what they lacked was a code and a message that said
  // which of the two happened.
  if (err?.type === "entity.too.large") {
    return errorResponse(
      res,
      "That request body is too large",
      413,
      ERROR_CODES.VALIDATION_FAILED,
    );
  }
  if (err?.type === "entity.parse.failed") {
    return errorResponse(
      res,
      "That request body is not valid JSON",
      400,
      ERROR_CODES.VALIDATION_FAILED,
    );
  }

  if (err?.message?.startsWith("Origin ")) {
    return errorResponse(res, "Origin not allowed", 403, ERROR_CODES.FORBIDDEN);
  }

  console.error("Unhandled API error:", err);
  return errorResponse(
    res,
    "Something went wrong on our side",
    err.statusCode || 500,
  );
});

export default app;
