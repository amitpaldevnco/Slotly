/**
 * OpenAPI 3.1 description of the Slotly HTTP API, plus the browsable page that
 * renders it.
 *
 * The document is hand-written rather than generated, because the parts a
 * reviewer most needs — which errors an endpoint can return, and what each one
 * means — are not derivable from the route table.
 *
 * Served at:
 *   GET /api/docs               human-readable page
 *   GET /api/docs/openapi.json  the raw document
 */

const bearerNote =
  "Requires a session. Authentication is a signed JWT in an httpOnly `token` cookie, set by the login endpoints; send credentials with the request.";

/** Reusable error response for a given status and set of codes. */
const errorRef = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Slotly API",
    version: "1.0.0",
    description: [
      "Appointment booking API.",
      "",
      "**Every instant in this API is an ISO-8601 UTC string.** Wall-clock values that are not instants —",
      "a provider's recurring weekly hours, an exception's window — are `HH:MM` strings interpreted in the",
      "provider's own timezone, and are documented as such where they appear.",
      "",
      "**Error shape.** Every failure returns `{ success: false, error, code, details? }`. Branch on `code`,",
      "never on `error`, which is prose and may be reworded. `details` is present on validation failures and",
      "carries one `{ field, message }` entry per bad field.",
      "",
      "**The one error worth special-casing:** losing the race for a slot is `409` with code `SLOT_TAKEN`.",
      "It is distinct from `SLOT_UNAVAILABLE` (the time is outside the provider's hours) and from any 5xx.",
    ].join("\n"),
  },
  servers: [{ url: "/api", description: "Same origin as the running server" }],
  tags: [
    { name: "Auth", description: "Registration, login, OAuth and profile" },
    { name: "Providers", description: "Public directory and provider pages" },
    { name: "Services", description: "What a provider offers" },
    { name: "Availability", description: "Recurring hours and one-off exceptions" },
    { name: "Slots", description: "Derived bookable times" },
    { name: "Bookings", description: "Creating and managing appointments" },
  ],

  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "token" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", const: false },
          error: { type: "string", description: "Human-readable. Do not branch on this." },
          code: {
            type: "string",
            description: "Machine-readable. Branch on this.",
            enum: [
              "VALIDATION_FAILED",
              "UNAUTHENTICATED",
              "FORBIDDEN",
              "NOT_FOUND",
              "CONFLICT",
              "SLOT_TAKEN",
              "SLOT_UNAVAILABLE",
              "MINIMUM_NOTICE_REQUIRED",
              "CANCELLATION_WINDOW_CLOSED",
              "BOOKING_NOT_ACTIVE",
              "APPOINTMENT_NOT_STARTED",
              "INVALID_TRANSITION",
              "INVALID_STATUS",
              "ACCOUNT_EXISTS",
              "WRONG_AUTH_METHOD",
              "INVALID_CREDENTIALS",
              "UPLOAD_REJECTED",
              "RANGE_TOO_WIDE",
              "SERVICE_IN_USE",
              "SERVER_ERROR",
            ],
          },
          details: {
            type: "array",
            description: "Present on validation failures: one entry per rejected field.",
            items: {
              type: "object",
              properties: { field: { type: "string" }, message: { type: "string" } },
            },
          },
        },
        required: ["success", "error", "code"],
      },

      LocalisedInstant: {
        type: "object",
        description: "One instant, rendered in both parties' timezones.",
        properties: {
          utc: { type: "string", format: "date-time" },
          client: { $ref: "#/components/schemas/ZonedReading" },
          provider: { $ref: "#/components/schemas/ZonedReading" },
        },
      },
      ZonedReading: {
        type: "object",
        properties: {
          timezone: { type: "string", example: "Europe/London" },
          formatted: { type: "string", example: "13 Jan 2025, 9:00 AM" },
          offset: { type: "string", example: "GMT" },
        },
      },

      Service: {
        type: "object",
        properties: {
          id: { type: "integer" },
          provider_id: { type: "integer" },
          service_name: { type: "string" },
          description: { type: "string", nullable: true },
          price: { type: "string", description: "NUMERIC, serialised as a string to avoid float drift" },
          duration: { type: "integer", description: "Minutes" },
          buffer_before: { type: "integer", description: "Minutes held before the appointment" },
          buffer_after: { type: "integer", description: "Minutes held after the appointment" },
          cover_image: { type: "string", nullable: true, example: "/uploads/services/2_1717.jpg" },
          is_active: { type: "boolean", description: "False once retired; hidden from booking" },
        },
      },

      AvailabilityRule: {
        type: "object",
        properties: {
          id: { type: "integer" },
          weekday: { type: "integer", minimum: 0, maximum: 6, description: "0 = Sunday .. 6 = Saturday" },
          weekdayName: { type: "string", example: "Monday" },
          startTime: { type: "string", example: "09:00", description: "Wall clock, provider's timezone" },
          endTime: { type: "string", example: "17:00", description: '"24:00" is permitted' },
        },
      },

      AvailabilityException: {
        type: "object",
        properties: {
          id: { type: "integer" },
          kind: { type: "string", enum: ["block", "open"] },
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date", description: "Inclusive" },
          startTime: { type: "string", nullable: true },
          endTime: { type: "string", nullable: true },
          isAllDay: { type: "boolean" },
          note: { type: "string", nullable: true },
        },
      },

      Slot: {
        type: "object",
        properties: {
          startsAt: { type: "string", format: "date-time", description: "Pass this back verbatim to book" },
          endsAt: { type: "string", format: "date-time" },
          clientTime: { type: "string", example: "2:30 PM" },
          providerTime: { type: "string", example: "9:00 AM" },
        },
      },

      Booking: {
        type: "object",
        properties: {
          id: { type: "integer" },
          status: {
            type: "string",
            enum: ["booked", "rescheduled", "cancelled", "completed", "no_show"],
          },
          startsAt: { type: "string", format: "date-time" },
          endsAt: { type: "string", format: "date-time" },
          time: { $ref: "#/components/schemas/LocalisedInstant" },
          endTime: { $ref: "#/components/schemas/LocalisedInstant" },
          service: { type: "object" },
          client: { type: "object" },
          provider: { type: "object" },
          clientNote: { type: "string", nullable: true },
          cancellationReason: { type: "string", nullable: true },
          cancelledAt: { type: "string", format: "date-time", nullable: true },
          cancellationCutoffHours: {
            type: "integer",
            description: "Snapshotted when the booking was made; the provider's later changes do not apply.",
          },
          canClientCancel: {
            type: "boolean",
            description: "Only present when the caller is the client. Advisory — the server re-checks.",
          },
        },
      },
    },
  },

  paths: {
    "/health": {
      get: {
        tags: ["Auth"],
        summary: "Liveness check",
        security: [],
        responses: { 200: { description: "Server is up" } },
      },
    },

    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Create an account with email and password",
        description:
          "Sets the session cookie on success. If the email already belongs to a Google or GitHub account, returns 409 and tells the caller which provider to use — a password is never silently attached to a social account.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "email", "password"],
                properties: {
                  name: { type: "string" },
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Account created; session cookie set" },
          400: errorRef("VALIDATION_FAILED"),
          409: errorRef("Email already registered (ACCOUNT_EXISTS / WRONG_AUTH_METHOD)"),
        },
      },
    },

    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Sign in with email and password",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: { email: { type: "string" }, password: { type: "string" } },
              },
            },
          },
        },
        responses: {
          200: { description: "Signed in; session cookie set" },
          401: errorRef("Wrong email or password"),
          409: errorRef("Account uses a social provider (WRONG_AUTH_METHOD)"),
        },
      },
    },

    "/auth/google": {
      post: {
        tags: ["Auth"],
        summary: "Sign in with a Google ID token",
        description:
          "The ID token is verified against Google directly. If its email already belongs to a password account, the two are linked into one user rather than duplicated.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["credential"],
                properties: { credential: { type: "string", description: "Google ID token" } },
              },
            },
          },
        },
        responses: { 200: { description: "Signed in" }, 401: errorRef("Token rejected by Google") },
      },
    },

    "/auth/github": {
      get: {
        tags: ["Auth"],
        summary: "Begin the GitHub OAuth 2.0 flow",
        description: "Redirects the browser to GitHub. Not an XHR endpoint.",
        security: [],
        responses: { 302: { description: "Redirect to GitHub" } },
      },
    },

    "/auth/github/callback": {
      get: {
        tags: ["Auth"],
        summary: "GitHub OAuth 2.0 redirect target",
        description:
          "Exchanges the code, links or creates the user, sets the session cookie, then redirects into the app.",
        security: [],
        parameters: [{ name: "code", in: "query", required: true, schema: { type: "string" } }],
        responses: { 302: { description: "Redirect back to the frontend" } },
      },
    },

    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "The signed-in user",
        description: bearerNote,
        responses: { 200: { description: "Current user" }, 401: errorRef("No session") },
      },
    },

    "/auth/profile": {
      patch: {
        tags: ["Auth"],
        summary: "Update the signed-in user's profile",
        description: `${bearerNote} multipart/form-data. The optional \`profilePicture\` file is validated by sniffing its header — JPG or PNG, 5MB cap — never by its extension.`,
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  phoneNumber: { type: "string" },
                  timezone: { type: "string", description: "IANA name; rejected if unknown" },
                  bio: { type: "string", maxLength: 500, description: "Providers only" },
                  businessName: { type: "string", description: "Providers only" },
                  businessType: { type: "string", description: "Providers only" },
                  profilePicture: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Updated" },
          400: errorRef("VALIDATION_FAILED, including a rejected upload"),
          401: errorRef("No session"),
        },
      },
    },

    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Clear the session cookie",
        security: [],
        responses: { 200: { description: "Signed out" } },
      },
    },

    "/providers": {
      get: {
        tags: ["Providers"],
        summary: "Browse providers",
        security: [],
        parameters: [
          { name: "search", in: "query", schema: { type: "string" }, description: "Name, business or category" },
          { name: "businessType", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 100 } },
        ],
        responses: { 200: { description: "Matching providers" } },
      },
    },

    "/providers/{id}": {
      get: {
        tags: ["Providers"],
        summary: "One provider's public profile",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Provider" }, 404: errorRef("No such provider") },
      },
    },

    "/providers/{id}/services": {
      get: {
        tags: ["Services"],
        summary: "A provider's services",
        description: "Retired services are included only when the caller is the provider themselves.",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: {
            description: "Services",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Service" } },
              },
            },
          },
        },
      },
    },

    "/providers/{id}/availability": {
      get: {
        tags: ["Availability"],
        summary: "A provider's published hours",
        description: "Rules and future exceptions. Times are wall clock in the provider's timezone.",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Availability" }, 404: errorRef("No such provider") },
      },
    },

    "/providers/{id}/slots": {
      get: {
        tags: ["Slots"],
        summary: "Bookable slots for one service",
        description:
          "Slots are derived from the provider's hours, the service's duration and buffers, and existing bookings. `from` and `to` are calendar dates read in `timezone`, and `to` is inclusive. Ranges wider than 62 days are refused with RANGE_TOO_WIDE.",
        security: [],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          { name: "serviceId", in: "query", required: true, schema: { type: "integer" } },
          { name: "from", in: "query", required: true, schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
          {
            name: "timezone",
            in: "query",
            schema: { type: "string" },
            description: "IANA zone to render in. Defaults to the signed-in user's, then UTC.",
          },
        ],
        responses: {
          200: {
            description: "Slots grouped by the caller's local date",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    clientTimezone: { type: "string" },
                    providerTimezone: { type: "string" },
                    totalSlots: { type: "integer" },
                    days: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          date: { type: "string", format: "date" },
                          slots: { type: "array", items: { $ref: "#/components/schemas/Slot" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: errorRef("Bad dates, or RANGE_TOO_WIDE"),
          404: errorRef("No such service for this provider"),
        },
      },
    },

    "/services": {
      post: {
        tags: ["Services"],
        summary: "Create a service",
        description: `${bearerNote} Provider role required. multipart/form-data; the optional \`coverImage\` accepts JPG, PNG or WebP up to 5MB, validated by header.`,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["service_name", "price", "duration"],
                properties: {
                  service_name: { type: "string" },
                  description: { type: "string" },
                  price: { type: "number" },
                  duration: { type: "integer", description: "Minutes, 1–1440" },
                  buffer_before: { type: "integer", description: "Minutes, 0–240" },
                  buffer_after: { type: "integer", description: "Minutes, 0–240" },
                  coverImage: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Created" },
          400: errorRef("VALIDATION_FAILED"),
          403: errorRef("Not a provider"),
        },
      },
    },

    "/services/{id}": {
      put: {
        tags: ["Services"],
        summary: "Update a service",
        description: `${bearerNote} Must be the owning provider. Changing duration or buffers affects future slots only; existing bookings keep their snapshotted duration.`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { description: "Updated" },
          403: errorRef("Not your service"),
          404: errorRef("No such service"),
        },
      },
      delete: {
        tags: ["Services"],
        summary: "Delete or retire a service",
        description:
          "A service that has never been booked is deleted. One with booking history is retired instead (`is_active = false`) so existing appointments survive. The response reports which happened via `deleted` / `retired`.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { description: "Deleted or retired" },
          403: errorRef("Not your service"),
          404: errorRef("No such service"),
        },
      },
    },

    "/availability/rules": {
      put: {
        tags: ["Availability"],
        summary: "Replace the whole weekly pattern",
        description: `${bearerNote} Provider role required. Sends the complete week; the previous rules are replaced in one transaction. Overlapping windows on a day are rejected.`,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["rules"],
                properties: {
                  rules: {
                    type: "array",
                    maxItems: 50,
                    items: {
                      type: "object",
                      required: ["weekday", "startTime", "endTime"],
                      properties: {
                        weekday: { type: "integer", minimum: 0, maximum: 6 },
                        startTime: { type: "string", example: "09:00" },
                        endTime: { type: "string", example: "17:00" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Saved" },
          400: errorRef("VALIDATION_FAILED, including overlapping windows"),
          403: errorRef("Not a provider"),
        },
      },
    },

    "/availability/exceptions": {
      post: {
        tags: ["Availability"],
        summary: "Add a one-off block or extra opening",
        description: `${bearerNote} Provider role required. A \`block\` with no times covers whole days; an \`open\` exception must carry a window.`,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["kind", "startDate"],
                properties: {
                  kind: { type: "string", enum: ["block", "open"] },
                  startDate: { type: "string", format: "date" },
                  endDate: { type: "string", format: "date", description: "Inclusive; defaults to startDate" },
                  startTime: { type: "string", example: "13:00" },
                  endTime: { type: "string", example: "14:00" },
                  note: { type: "string", maxLength: 255 },
                },
              },
            },
          },
        },
        responses: { 201: { description: "Added" }, 400: errorRef("VALIDATION_FAILED") },
      },
    },

    "/availability/exceptions/{id}": {
      delete: {
        tags: ["Availability"],
        summary: "Remove an exception",
        description: `${bearerNote} Provider role required; only your own exceptions.`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Removed" }, 404: errorRef("Not yours, or no such exception") },
      },
    },

    "/availability/settings": {
      patch: {
        tags: ["Availability"],
        summary: "Set the cancellation cutoff",
        description: `${bearerNote} Provider role required. Applies to bookings made from now on; existing bookings keep the value they were made under.`,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["cancellationCutoffHours"],
                properties: {
                  cancellationCutoffHours: { type: "integer", minimum: 0, maximum: 720 },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Saved" }, 400: errorRef("VALIDATION_FAILED") },
      },
    },

    "/bookings": {
      post: {
        tags: ["Bookings"],
        summary: "Book a slot",
        description: [
          bearerNote,
          "Client role required — a client may only book for themselves, which is why there is no `clientId` in the body.",
          "",
          "`startsAt` must be a value returned by the slots endpoint, sent back verbatim.",
          "",
          "**Concurrency.** Exclusivity is enforced by a PostgreSQL exclusion constraint, not by a read-then-write check.",
          "If two requests arrive for the same slot at the same instant, exactly one succeeds; the other gets",
          "`409 SLOT_TAKEN`.",
        ].join("\n"),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["serviceId", "startsAt"],
                properties: {
                  serviceId: { type: "integer" },
                  startsAt: { type: "string", format: "date-time" },
                  note: { type: "string", maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Booked",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Booking" } },
            },
          },
          400: errorRef(
            "VALIDATION_FAILED, the time has already passed, or MINIMUM_NOTICE_REQUIRED (same-day bookings are never offered — see the minimum notice policy in the README)"
          ),
          403: errorRef("Not a client account"),
          404: errorRef("No such service, or it has been retired"),
          409: errorRef("SLOT_TAKEN (lost the race) or SLOT_UNAVAILABLE (outside the provider's hours)"),
        },
      },
      get: {
        tags: ["Bookings"],
        summary: "List your bookings",
        description: `${bearerNote} Role-aware: a client sees bookings they made, a provider sees bookings on their calendar. There is no parameter that returns anyone else's.`,
        parameters: [
          {
            name: "scope",
            in: "query",
            schema: { type: "string", enum: ["upcoming", "past", "all"], default: "all" },
            description: "`upcoming` means future *and* still active.",
          },
          { name: "status", in: "query", schema: { type: "string" }, description: "Comma-separated" },
          { name: "serviceId", in: "query", schema: { type: "integer" } },
          { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
        ],
        responses: { 200: { description: "Bookings" }, 401: errorRef("No session") },
      },
    },

    "/bookings/{id}": {
      get: {
        tags: ["Bookings"],
        summary: "One booking, with its full status timeline",
        description: `${bearerNote} Only the two people involved can read it. Anyone else gets 404 rather than 403, so the endpoint does not confirm the booking exists.`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { description: "Booking plus `timeline`, an ordered list of every status change" },
          404: errorRef("Not found, or not yours"),
        },
      },
    },

    "/bookings/{id}/cancel": {
      post: {
        tags: ["Bookings"],
        summary: "Cancel a booking",
        description: [
          bearerNote,
          "Either party may call this, under different rules:",
          "",
          "- **Client** — allowed only before the provider's cutoff. Past it: `409 CANCELLATION_WINDOW_CLOSED`,",
          "  with `details.deadline` giving the instant it closed.",
          "- **Provider** — allowed at any time, but `reason` is required.",
          "",
          "The row is kept with status `cancelled`, not deleted, and the slot returns to the pool immediately.",
        ].join("\n"),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { reason: { type: "string", maxLength: 500 } },
              },
            },
          },
        },
        responses: {
          200: { description: "Cancelled" },
          400: errorRef("Provider omitted the required reason"),
          404: errorRef("Not found, or not yours"),
          409: errorRef("CANCELLATION_WINDOW_CLOSED or BOOKING_NOT_ACTIVE"),
        },
      },
    },

    "/bookings/{id}/reschedule": {
      post: {
        tags: ["Bookings"],
        summary: "Move a booking to another time",
        description: `${bearerNote} Provider only, and \`reason\` is required. The move is subject to the same exclusion constraint as a new booking, so it can also return \`409 SLOT_TAKEN\`.`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["startsAt", "reason"],
                properties: {
                  startsAt: { type: "string", format: "date-time" },
                  reason: { type: "string", maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Rescheduled; status becomes `rescheduled`" },
          400: errorRef("VALIDATION_FAILED, or a time in the past"),
          403: errorRef("Not the provider"),
          409: errorRef("SLOT_TAKEN, SLOT_UNAVAILABLE or BOOKING_NOT_ACTIVE"),
        },
      },
    },

    "/bookings/{id}/status": {
      patch: {
        tags: ["Bookings"],
        summary: "Mark a booking completed or no-show",
        description: `${bearerNote} Provider only, and only once the appointment has started — otherwise \`409 APPOINTMENT_NOT_STARTED\`. Cancellation is not accepted here; it has its own endpoint.`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: {
                  status: { type: "string", enum: ["completed", "no_show"] },
                  reason: { type: "string", maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Updated" },
          400: errorRef("INVALID_TRANSITION — use /cancel to cancel"),
          403: errorRef("Not the provider"),
          409: errorRef("APPOINTMENT_NOT_STARTED or BOOKING_NOT_ACTIVE"),
        },
      },
    },
  },

  security: [{ sessionCookie: [] }],
};

/**
 * Serves the browsable docs page.
 *
 * Swagger UI is loaded from a CDN rather than installed, so the docs cost the
 * project no dependency and no build step. If the CDN is unreachable the raw
 * document is still available at /api/docs/openapi.json, which the page says.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function docsPage(req, res) {
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Slotly API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #F6F5F1; font-family: system-ui, sans-serif; }
      .fallback { padding: 2rem; color: #5C6F63; }
      .fallback a { color: #3F6C51; }
    </style>
  </head>
  <body>
    <div id="swagger">
      <p class="fallback">
        Loading the API reference… if it does not appear, the raw OpenAPI document is at
        <a href="/api/docs/openapi.json">/api/docs/openapi.json</a>.
      </p>
    </div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      if (window.SwaggerUIBundle) {
        SwaggerUIBundle({ url: "/api/docs/openapi.json", dom_id: "#swagger", docExpansion: "list" });
      }
    </script>
  </body>
</html>`);
}
