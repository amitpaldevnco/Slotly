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
    { name: "Messages", description: "The conversation about one appointment" },
    { name: "Reviews", description: "Client feedback on a completed appointment" },
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
              "TIMEZONE_CONFLICT",
              "CANCELLATION_WINDOW_CLOSED",
              "RESCHEDULE_WINDOW_CLOSED",
              "RATE_LIMITED",
              "BOOKING_NOT_ACTIVE",
              "SERVICE_TERMS_CHANGED",
              "APPOINTMENT_NOT_STARTED",
              "INVALID_TRANSITION",
              "INVALID_STATUS",
              "ACCOUNT_EXISTS",
              "WRONG_AUTH_METHOD",
              "INVALID_CREDENTIALS",
              "UPLOAD_REJECTED",
              "RANGE_TOO_WIDE",
              "SERVICE_RETIRED",
              "ALREADY_ACTIVE",
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

      TimezoneImpact: {
        type: "object",
        description:
          "What a provider's timezone change would do to appointments already booked. " +
          "Returned by GET /availability/timezone-impact, and carried in `details` on a " +
          "409 TIMEZONE_CONFLICT from PATCH /auth/profile — one shape, so a client renders " +
          "the preview and the refusal with the same code.",
        properties: {
          currentTimezone: { type: "string", example: "Europe/London" },
          timezone: { type: "string", description: "The candidate zone.", example: "America/New_York" },
          changed: {
            type: "boolean",
            description: "False when the candidate is the zone already stored — nothing to check.",
          },
          safe: {
            type: "boolean",
            description: "The one field to branch on. True means the change may proceed.",
          },
          upcomingCount: {
            type: "integer",
            description: "Active appointments that have not finished yet, conflicting or not.",
          },
          conflictCount: { type: "integer" },
          conflicts: {
            type: "array",
            description:
              "Appointments that fit inside the provider's hours today and would not " +
              "afterwards. Each carries both clock readings of the same unmoved instant, " +
              "so the provider can see what the change does to it.",
            items: { $ref: "#/components/schemas/TimezoneConflict" },
          },
        },
      },
      TimezoneConflict: {
        type: "object",
        properties: {
          bookingId: { type: "integer" },
          status: { type: "string", enum: ["booked", "rescheduled"] },
          startsAt: {
            type: "string",
            format: "date-time",
            description: "The instant, unchanged. A timezone edit never moves it.",
          },
          endsAt: { type: "string", format: "date-time" },
          service: { type: "object" },
          client: { type: "object" },
          current: {
            type: "object",
            description: "How the appointment reads in the zone in force now.",
            properties: {
              timezone: { type: "string" },
              startsAt: { type: "string", example: "Mon 9 Jun 2025, 9:00 AM" },
              endsAt: { type: "string", example: "10:00 AM" },
            },
          },
          proposed: {
            type: "object",
            description: "How the same instant would read in the candidate zone.",
            properties: {
              timezone: { type: "string" },
              startsAt: { type: "string", example: "Mon 9 Jun 2025, 4:00 AM" },
              endsAt: { type: "string", example: "5:00 AM" },
            },
          },
          reason: { type: "string", enum: ["OUTSIDE_AVAILABILITY"] },
          detail: { type: "string", description: "A sentence the UI can show as-is." },
        },
      },

      Service: {
        type: "object",
        description:
          "camelCase throughout, like every other resource in this API. The endpoint " +
          "previously returned raw database rows in snake_case; those field names are " +
          "still accepted on *input* for compatibility, but are no longer returned.",
        properties: {
          id: { type: "integer" },
          providerId: { type: "integer" },
          name: { type: "string", description: "Was `service_name`" },
          description: { type: "string", nullable: true },
          price: { type: "string", description: "NUMERIC, serialised as a string to avoid float drift" },
          duration: { type: "integer", description: "Minutes" },
          bufferBefore: { type: "integer", description: "Minutes held before the appointment" },
          bufferAfter: { type: "integer", description: "Minutes held after the appointment" },
          slotInterval: {
            type: "integer",
            description:
              "Spacing of the offered start times, in minutes. Independent of duration — " +
              "a booking is only accepted on a start this grid produces.",
          },
          coverImage: { type: "string", nullable: true, example: "/uploads/services/2_1717.jpg" },
          isActive: { type: "boolean", description: "False once retired; hidden from booking" },
          hasCustomAvailability: {
            type: "boolean",
            description: "True when the service has its own hours instead of the provider's default ones",
          },
          createdAt: { type: "string", format: "date-time" },
          stats: {
            type: "object",
            description:
              "Booking counts and earnings. Returned **only** to the provider who owns the " +
              "service — a stranger never sees another provider's takings.",
            properties: {
              totalBookings: { type: "integer" },
              completedBookings: { type: "integer" },
              upcomingBookings: { type: "integer" },
              totalEarnings: { type: "string" },
            },
          },
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
          serviceChanges: {
            type: "object",
            nullable: true,
            description:
              "Null unless the provider has changed the service's price or duration since this booking was made, and the booking is still active. `service.price` and `service.duration` remain what the booking itself is held at; these are what a reschedule would move it to. `requiresAcceptance` is true only for the client — see POST /bookings/{id}/reschedule.",
            properties: {
              price: {
                type: "object",
                properties: {
                  booked: { type: "number" },
                  current: { type: "number" },
                  changed: { type: "boolean" },
                },
              },
              duration: {
                type: "object",
                properties: {
                  booked: { type: "integer" },
                  current: { type: "integer" },
                  changed: { type: "boolean" },
                },
              },
              currency: { type: "string", description: "ISO 4217 code both figures are in." },
              requiresAcceptance: { type: "boolean" },
            },
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
        description:
          "Touches nothing external on purpose: this is the endpoint the host polls, and a database round trip on every poll would hold a scale-to-zero database permanently awake.",
        security: [],
        responses: { 200: { description: "Server is up" } },
      },
    },

    "/health/db": {
      get: {
        tags: ["Auth"],
        summary: "Readiness check — can the pool reach PostgreSQL?",
        description:
          "On a separate path from `/health` so it is called deliberately rather than on a timer. Reports reachability and nothing else — no version, host or connection detail, which would hand a stranger a map of the infrastructure.",
        security: [],
        responses: {
          200: { description: "`{ status: \"ok\", database: \"connected\" }`" },
          503: { description: "Database unreachable" },
        },
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

    "/auth/password": {
      patch: {
        tags: ["Auth"],
        summary: "Change your own password",
        description:
          `${bearerNote} Requires the current password as well as the session, because a cookie proves ` +
          "the browser is signed in and not that the person holding it owns the account — without the " +
          "check, an unattended laptop is enough to take the account permanently.\n\nAn account that " +
          "signed up with Google or GitHub has no password to verify, so `currentPassword` is not " +
          "required for it and this call *adds* one rather than replacing it.\n\nThere is deliberately " +
          "no unauthenticated reset route: delivering a reset link needs an email transport, which this " +
          "deployment does not have. An account with a genuinely forgotten password and no social " +
          "identity attached cannot be recovered — social sign-in is the recovery path.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["newPassword"],
                properties: {
                  currentPassword: {
                    type: "string",
                    description: "Required unless the account has no password yet.",
                  },
                  newPassword: { type: "string", minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "`{ hadPassword }` — false when a password was added rather than changed" },
          400: errorRef("New password too short, or unchanged"),
          401: errorRef("No session, or the current password is wrong (INVALID_CREDENTIALS)"),
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

    "/auth/complete-profile": {
      patch: {
        tags: ["Auth"],
        summary: "Choose a role and finish setting up a new account",
        description:
          `${bearerNote} Runs **once per account**. A social sign-up arrives with \`role\` still NULL, ` +
          "and this is the only endpoint that ever writes it.\n\n" +
          "Calling it again on an account that already has a role returns **409 `INVALID_TRANSITION`**. " +
          "Role is the axis every authorization decision turns on — `requireProviderRole`, the client-only " +
          "check on booking creation, and the provider/client split in the booking queries all read it — so " +
          "a user who could rewrite it could grant themselves provider access. It is refused in the other " +
          "direction too: a provider who flipped to `client` would keep their bookings while losing every " +
          "endpoint able to act on one.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["role", "phoneNumber", "timezone"],
                properties: {
                  role: { type: "string", enum: ["client", "provider"] },
                  phoneNumber: { type: "string" },
                  timezone: { type: "string", description: "IANA name; rejected if Luxon cannot resolve it" },
                  businessName: { type: "string", description: "Required when role is provider" },
                  businessType: { type: "string", description: "Required when role is provider" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Profile completed; returns the user" },
          400: errorRef("VALIDATION_FAILED — bad role, missing phone, unknown timezone, or a provider without business details"),
          401: errorRef("No session"),
          409: errorRef("INVALID_TRANSITION — a role has already been chosen for this account"),
        },
      },
    },

    "/auth/profile": {
      patch: {
        tags: ["Auth"],
        summary: "Update the signed-in user's profile",
        description: `${bearerNote} multipart/form-data. The optional \`profilePicture\` file is validated by sniffing its header — JPG or PNG, 5MB cap — never by its extension.

**A provider's \`timezone\` is a guarded field.** It is the zone their availability rules are interpreted in, so changing it can leave appointments already on the calendar outside their working hours. The change is assessed before anything is written and refused with 409 \`TIMEZONE_CONFLICT\` when it would strand any upcoming appointment, with the full report — the same shape \`GET /availability/timezone-impact\` returns — in \`details\`. Nothing at all is written on a refusal, including an uploaded photo in the same request. There is no override: the provider cancels or reschedules the named appointments, or keeps their current zone. A client's timezone drives display only and is never refused.`,
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
          409: errorRef(
            "TIMEZONE_CONFLICT — a provider's new zone would leave upcoming appointments outside their working hours. `details` carries the TimezoneImpact report naming them."
          ),
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
          "Slots are derived from the provider's hours, the service's duration and buffers, and existing bookings. `from` and `to` are calendar dates read in `timezone`, and `to` is inclusive. Ranges wider than 62 days are refused with RANGE_TOO_WIDE.\n\nBooking is real time: the only slot excluded for being too soon is one that has already started, so a range beginning today returns the rest of today, including slots inside the next hour. Because of that, a response held on screen goes stale — it carries no expiry, and the client should re-request rather than trust an old list.\n\nPass `bookingId` when the answer will be used to reschedule that booking. It aligns the list with what `POST /bookings/{id}/reschedule` will accept: the booking stops blocking its own move, slots are sized from its snapshotted duration rather than the service's current one, and a retired service is still answered. Requires a session held by the client or provider on that booking.",
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
          {
            name: "bookingId",
            in: "query",
            schema: { type: "integer" },
            description:
              "An existing booking this list will be used to move. Must belong to the caller and to this provider and service, and must still be active.",
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
          404: errorRef("No such service for this provider, or no such booking for this caller"),
          409: errorRef("BOOKING_NOT_ACTIVE — the `bookingId` names a booking that is already cancelled or closed"),
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
                required: ["serviceName", "price", "duration"],
                properties: {
                  serviceName: {
                    type: "string",
                    description: "Also accepted as `service_name` (legacy spelling)",
                  },
                  description: { type: "string" },
                  price: { type: "number" },
                  duration: { type: "integer", description: "Minutes, 1–1440" },
                  bufferBefore: { type: "integer", description: "Minutes, 0–240. Also accepted as `buffer_before`" },
                  bufferAfter: { type: "integer", description: "Minutes, 0–240. Also accepted as `buffer_after`" },
                  slotInterval: {
                    type: "integer",
                    description: "Minutes, 5–240. Spacing of offered start times. Also accepted as `slot_interval`",
                  },
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
        description: `${bearerNote} Must be the owning provider. Changing duration or buffers affects future slots only; existing bookings keep their snapshotted duration.

Every field is optional: an absent field is left alone rather than cleared, so a caller changing only the price sends only the price. Sending \`coverImage\` replaces the existing image and deletes the old one; omitting it leaves the current image in place.

Editing a retired service is refused with \`SERVICE_RETIRED\` — bring it back with \`POST /services/{id}/reactivate\` first.`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  serviceName: {
                    type: "string",
                    description: "Also accepted as `service_name` (legacy spelling)",
                  },
                  description: { type: "string" },
                  price: { type: "number" },
                  duration: { type: "integer", description: "Minutes, 1–1440" },
                  bufferBefore: { type: "integer", description: "Minutes, 0–240. Also accepted as `buffer_before`" },
                  bufferAfter: { type: "integer", description: "Minutes, 0–240. Also accepted as `buffer_after`" },
                  slotInterval: {
                    type: "integer",
                    description: "Minutes, 5–240. Spacing of offered start times. Also accepted as `slot_interval`",
                  },
                  coverImage: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Updated" },
          400: errorRef("VALIDATION_FAILED"),
          404: errorRef("No such service, or not yours"),
          409: errorRef("SERVICE_RETIRED — reactivate it first"),
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
          404: errorRef("No such service, or not yours"),
        },
      },
    },

    "/services/{id}/reactivate": {
      post: {
        tags: ["Services"],
        summary: "Bring a retired service back",
        description: `${bearerNote} Provider role required, and the service must be your own.

Retiring was always reversible in the data — \`isActive\` is a boolean and nothing is destroyed — but there was no way to reverse it from the app, so a provider who retired a service by mistake had to recreate it. A recreated service is a *different row*, which detaches it from its own booking history and its reviews.

Its own verb rather than \`PUT /services/{id}\` with \`isActive: true\`, because editing a retired service is refused with SERVICE_RETIRED — so this path has to exist outside that rule.`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: {
            description: "Reactivated. Bookable and publicly visible again.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Service" } },
            },
          },
          404: errorRef("No such service, or not yours"),
          409: errorRef("ALREADY_ACTIVE — it was not retired"),
        },
      },
    },

    "/bookings/recent-messages": {
      get: {
        tags: ["Messages"],
        summary: "The viewer's most recently active conversations",
        description: `${bearerNote}

One entry per thread, carrying the latest message in it, newest thread first. Cross-booking, which is why it sits beside \`/bookings/unread-count\` rather than under \`/bookings/{id}\`.

**Reading this does not mark anything read.** Unlike \`GET /bookings/{id}/messages\`, which marks the other party's messages read as a side effect of opening a thread, this is a preview — glancing at a dashboard is not reading your messages, and clearing an unread badge because a summary rendered would lose the only signal there was.`,
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 20, default: 5 },
            description: "Threads to return. Clamped server-side.",
          },
        ],
        responses: {
          200: {
            description: "Newest-first list of threads.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    conversations: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          bookingId: { type: "integer" },
                          serviceName: { type: "string" },
                          bookingStartsAt: { type: "string", format: "date-time" },
                          bookingStatus: { type: "string" },
                          withUser: {
                            type: "object",
                            description: "The other party. A thread has exactly two.",
                            properties: {
                              id: { type: "integer" },
                              name: { type: "string" },
                              avatarUrl: { type: "string", nullable: true },
                            },
                          },
                          lastMessage: {
                            type: "object",
                            properties: {
                              preview: { type: "string", description: "Truncated to 120 characters" },
                              at: { type: "string", format: "date-time" },
                              fromMe: { type: "boolean", description: "Lets the UI write \"You: …\"" },
                            },
                          },
                          unread: { type: "integer", description: "Unread messages in this thread" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: errorRef("No session"),
        },
      },
    },

    "/availability/validate": {
      post: {
        tags: ["Availability"],
        summary: "Dry-run a weekly pattern without saving it",
        description: `${bearerNote} Provider role required.

Runs the same validation and the same slot arithmetic as \`PUT /availability/rules\`, against a draft in the request body, and writes nothing. It answers the question a provider cannot otherwise ask until it is too late: *would these hours actually produce any bookable times?*

They often would not, for a reason that is genuinely surprising. Candidate start times sit on a grid anchored at the window's start, so a 09:00–10:00 window with a 30-minute service, 10-minute buffers and a 30-minute interval has a legal band of 09:10–09:20 and grid positions at 09:00 and 09:30 — which never intersect, and the day silently offers nothing.

\`remedies\` are therefore *verified* rather than guessed: each one is checked against the same arithmetic before being suggested, so the UI never tells a provider to shorten a buffer when a shorter buffer would not help.

POST rather than GET because the thing being checked is a draft in the body, not something already stored.`,
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
                    description: "The draft weekly pattern, same shape as PUT /availability/rules.",
                    items: {
                      type: "object",
                      properties: {
                        weekday: { type: "integer", minimum: 0, maximum: 6 },
                        startTime: { type: "string", example: "09:00" },
                        endTime: { type: "string", example: "17:00" },
                      },
                    },
                  },
                  serviceId: {
                    type: "integer",
                    description:
                      "Judge the draft against this service's duration, buffers and slot interval. Omit to use the provider's defaults.",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "The diagnosis. `valid` reports the rules parsed; `feasibility` reports whether they yield slots.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    bookable: { type: "boolean", description: "False when the whole week yields no slot" },
                    totalSlotsPerWeek: { type: "integer" },
                    minimumWindowMinutes: {
                      type: "integer",
                      description: "Shortest open window that would yield one slot, given the duration, buffers and grid",
                    },
                    problemDays: {
                      type: "array",
                      description: "Only the days that cannot yield a slot. A day that is merely fully booked never appears here.",
                      items: { type: "object" },
                    },
                    remedies: {
                      type: "array",
                      description: "Concrete changes that would fix it, each verified to actually work. The first is the recommendation.",
                      items: {
                        type: "object",
                        properties: {
                          kind: {
                            type: "string",
                            enum: ["extend-availability", "slot-interval", "buffer-before", "duration"],
                          },
                          value: { type: "integer" },
                          summary: { type: "string", example: "Add 40 min to that day — ending at 5:40 PM instead would fit." },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: errorRef("VALIDATION_FAILED — the draft itself is malformed"),
          403: errorRef("Not a provider"),
        },
      },
    },

    "/availability/preview": {
      post: {
        tags: ["Availability"],
        summary: "How many slots would a draft service yield?",
        description: `${bearerNote} Provider role required.

The mirror image of \`/availability/validate\`. That endpoint takes a draft **pattern** and judges it against saved **services**; this takes a draft **service** and judges it against saved **hours**.

It exists because the service form cannot answer the question locally. Duration, the two buffers and the slot spacing interact in a way nobody works out in their head: a 09:00-10:00 window with a 30-minute service, 10-minute buffers and a 30-minute grid yields **nothing at all** — the legal band of starts is 09:10-09:20 and the grid offers 09:00 and 09:30, so the two never meet. Dropping one buffer makes the same window yield a slot.

Routed through the same \`diagnoseSlotFeasibility()\` the validation endpoint uses, which walks the same \`candidateStartsInWindow()\` the real slot list walks — so the count previewed here is the count that will be offered.

**Ignores bookings, one-off exceptions and the booking lead time**, none of which the provider can change from the form in front of them. A day empty only because it is fully booked is not a misconfiguration.`,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["duration"],
                properties: {
                  duration: { type: "integer", description: "Minutes, 1-1440" },
                  bufferBefore: { type: "integer", description: "Also accepted as `buffer_before`" },
                  bufferAfter: { type: "integer", description: "Also accepted as `buffer_after`" },
                  slotInterval: { type: "integer", description: "Also accepted as `slot_interval`" },
                  serviceId: {
                    type: "integer",
                    description:
                      "Which hours to judge against: a service with its own schedule is measured against that, everything else against the provider's default. Omit for a service that does not exist yet.",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "The weekly shape these settings would produce.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    scope: { type: "string", enum: ["service", "provider"] },
                    hasRules: {
                      type: "boolean",
                      description:
                        "False when the provider has no hours at all — a different problem, with a different fix, from hours that cannot fit this service.",
                    },
                    bookable: { type: "boolean" },
                    totalSlotsPerWeek: { type: "integer" },
                    minimumWindowMinutes: {
                      type: "integer",
                      description: "Shortest open window that would yield one slot with these settings",
                    },
                    days: {
                      type: "array",
                      description: "Per weekday, in order, with a slot count each.",
                      items: {
                        type: "object",
                        properties: {
                          weekday: { type: "integer", minimum: 0, maximum: 6 },
                          weekdayName: { type: "string" },
                          slotCount: { type: "integer" },
                          windows: { type: "array", items: { type: "object" } },
                        },
                      },
                    },
                    problemDays: { type: "array", items: { type: "object" } },
                    remedies: {
                      type: "array",
                      description: "Changes that would fix it, each verified against the same arithmetic first.",
                      items: { type: "object" },
                    },
                  },
                },
              },
            },
          },
          400: errorRef("VALIDATION_FAILED — duration is not a positive number of minutes"),
          403: errorRef("Not a provider"),
          404: errorRef("serviceId is not one of yours"),
        },
      },
    },

    "/availability/health": {
      get: {
        tags: ["Availability"],
        summary: "Diagnose the saved configuration, per service",
        description: `${bearerNote} Provider role required.

The same feasibility check as \`POST /availability/validate\`, run against what is already stored rather than a draft, once per active service. This is what powers the dashboard warning that a service is configured so that it can never be booked.

Like the dry run, it deliberately ignores bookings, one-off blocks and the booking lead time: none of those are things a provider can fix by editing their settings, and reporting a fully-booked day as a misconfiguration would be noise.`,
        responses: {
          200: {
            description: "One entry per active service.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    services: {
                      type: "array",
                      description: "Every active service, whether or not it has a problem.",
                      items: {
                        type: "object",
                        properties: {
                          serviceId: { type: "integer" },
                          serviceName: { type: "string" },
                          hasRules: { type: "boolean", description: "False when no hours apply to this service at all" },
                          bookable: { type: "boolean" },
                          totalSlotsPerWeek: { type: "integer" },
                          problemDays: { type: "array", items: { type: "object" } },
                          remedies: { type: "array", items: { type: "object" } },
                        },
                      },
                    },
                    servicesWithoutHours: {
                      type: "array",
                      description:
                        "Names of services with no hours at all. Split out from the next field because the two need different words: this one needs \"set your hours\".",
                      items: { type: "string" },
                    },
                    misconfiguredServices: {
                      type: "array",
                      description:
                        "Services that have hours which nonetheless yield no slot — \"your day is too short for this service\".",
                      items: { type: "object" },
                    },
                  },
                },
              },
            },
          },
          403: errorRef("Not a provider"),
        },
      },
    },

    "/availability/timezone-impact": {
      get: {
        tags: ["Availability"],
        summary: "What would changing timezone do to my calendar?",
        description: `${bearerNote} Provider role required.

A dry run of a timezone change, with no write. Weekly hours are stored as a weekday plus a wall-clock time and are read in the provider's *current* zone, so changing that zone slides every working window along the timeline while appointments already booked stay on the exact instants they were booked for. An appointment can end up outside the hours the provider has just declared.

Every active appointment that has not finished yet is judged twice — under the zone in force now, and under the candidate zone — and reported only when it fits today and would not fit afterwards. An appointment already outside the provider's hours is left out: that is not something this change caused, and no choice of zone fixes it.

A conflict is a 200 here, not an error: it is the answer to the question asked. The enforcement lives on \`PATCH /auth/profile\`, which runs the same assessment again next to the write, because a preview cannot account for a booking that arrives between looking and saving.`,
        parameters: [
          {
            name: "timezone",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "The candidate IANA zone.",
          },
        ],
        responses: {
          200: {
            description: "The assessment. Branch on `safe`.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TimezoneImpact" },
              },
            },
          },
          400: errorRef("VALIDATION_FAILED — missing timezone, or one Luxon cannot resolve"),
          403: errorRef("Not a provider"),
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
            "VALIDATION_FAILED, or SLOT_UNAVAILABLE because the time has already passed. There is no minimum notice: a slot later today, or inside the next hour, is bookable the moment the slot list offers it."
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
            schema: {
              type: "string",
              enum: ["upcoming", "past", "all", "awaiting_outcome"],
              default: "all",
            },
            description:
              "`upcoming` means future *and* still active. `awaiting_outcome` means finished " +
              "*and* still active — appointments the provider has not yet marked completed or " +
              "no-show. Nothing settles those automatically, so this is the provider's outcome " +
              "queue; it is returned oldest-first.",
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
        description:
          `${bearerNote} Either party, on different terms. **Provider:** any time, and \`reason\` is ` +
          "required — the client is being moved without asking, so they are owed an explanation. " +
          "**Client:** their own booking only, up to the same cutoff that governs cancelling it " +
          "(`409 RESCHEDULE_WINDOW_CLOSED` past it, carrying the deadline), and `reason` is optional. " +
          "The two share one deadline because a reschedule frees the original slot exactly as a " +
          "cancellation does; a wider window would let a client dodge the cutoff by moving the " +
          "appointment and cancelling it from its new date. The move is subject to the same exclusion " +
          "constraint as a new booking, so it can also return `409 SLOT_TAKEN`. A caller who is neither " +
          "party gets `404`, not `403`.\n\n" +
          "**Changed service terms.** A client's move enters the service's *current* price and duration, " +
          "so if the provider has edited either since the booking was made the first request is refused " +
          "with `409 SERVICE_TERMS_CHANGED`, carrying both sets of figures in `details`. Nothing is " +
          "written by that refusal — the original booking is untouched — and the move goes through when " +
          "the request is repeated with `acceptChanges: true`. A provider's move keeps the snapshotted " +
          "terms and never needs acceptance: imposing a change and new terms in one action is exactly " +
          "what this gate exists to prevent.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["startsAt"],
                properties: {
                  startsAt: { type: "string", format: "date-time" },
                  reason: {
                    type: "string",
                    maxLength: 500,
                    description: "Required when the caller is the provider; optional for the client.",
                  },
                  acceptChanges: {
                    type: "boolean",
                    description:
                      "The client's confirmation that they accept the service's current price and duration. Only consulted after a SERVICE_TERMS_CHANGED refusal; ignored for a provider.",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Rescheduled; status becomes `rescheduled`" },
          400: errorRef("VALIDATION_FAILED, or a time in the past"),
          404: errorRef("No such booking, or the caller is neither party"),
          409: errorRef(
            "SLOT_TAKEN, SLOT_UNAVAILABLE, BOOKING_NOT_ACTIVE, RESCHEDULE_WINDOW_CLOSED or SERVICE_TERMS_CHANGED"
          ),
        },
      },
    },

    "/bookings/{id}/status": {
      patch: {
        tags: ["Bookings"],
        summary: "Mark a booking completed or no-show",
        description:
          `${bearerNote} Provider only, and only once the appointment has started — otherwise ` +
          "`409 APPOINTMENT_NOT_STARTED`. The outcome stays the provider's to record for **one hour " +
          "after the appointment ends**; past that a booking nobody recorded is automatically marked " +
          "`completed` by a `system` actor and this returns `409 BOOKING_NOT_ACTIVE`. Cancellation is " +
          "not accepted here; it has its own endpoint.",
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

    "/bookings/counts": {
      get: {
        tags: ["Bookings"],
        summary: "How many bookings fall in each tab of the appointments screen",
        description:
          `${bearerNote} Role-aware — a client is counted on the bookings they made, a provider on ` +
          "the bookings on their calendar — which is what distinguishes this from `/bookings/summary`, " +
          "a provider's earnings report that refuses a client outright. The three conditions are the " +
          "same expressions `GET /bookings` uses for `scope=upcoming`, `scope=past` and " +
          "`status=cancelled`, so a count cannot disagree with the list it labels. Counted in SQL, " +
          "because the booking list caps at 500 rows.",
        responses: {
          200: { description: "`{ upcoming, past, cancelled }`" },
          401: errorRef("No session"),
        },
      },
    },

    "/bookings/summary": {
      get: {
        tags: ["Bookings"],
        summary: "Headline counts and lifetime earnings for the dashboard",
        description:
          `${bearerNote} Provider only. Computed in SQL rather than by summing a fetched list, so the ` +
          "figures stay correct however much history exists — the booking list caps at 500 rows, which is " +
          "fine for a page of cards and wrong for a total. Earnings count only `completed` bookings: an " +
          "appointment that has not happened yet was not delivered, and a cancelled one was never paid for. " +
          "Nothing reaches `completed` without the provider recording it, so a finished appointment they " +
          "have not settled yet contributes nothing to `totalEarnings`; it is reported separately as " +
          "`awaitingOutcome` (how many) and `awaitingOutcomeValue` (what they are worth if all are marked " +
          "completed), which is deliberately not folded into the earnings figure.",
        responses: {
          200: {
            description:
              "`{ totalEarnings, completedBookings, upcomingBookings, cancelledBookings, " +
              "awaitingOutcome, awaitingOutcomeValue, totalBookings }`",
          },
          401: errorRef("No session"),
          403: errorRef("FORBIDDEN — client accounts have no summary"),
        },
      },
    },

    "/bookings/unread-count": {
      get: {
        tags: ["Messages"],
        summary: "How many unread messages the caller has across all their bookings",
        description: `${bearerNote} Counts only messages on the caller's own bookings that they did not send and have not read. Drives the navbar badge and the per-conversation dot in the inbox.`,
        responses: {
          200: {
            description:
              "`{ unread, threads, byBooking }` — `byBooking` maps a booking id to that thread's unread count, and omits threads with none.",
          },
          401: errorRef("No session"),
        },
      },
    },

    "/bookings/{id}/messages": {
      get: {
        tags: ["Messages"],
        summary: "Read the conversation about one appointment",
        description:
          `${bearerNote} Readable by the booking's two parties only. Anyone else gets **404, not 403** — ` +
          "confirming a booking exists to an unrelated caller would leak that the provider had an " +
          "appointment at that id. Loading the thread marks the *other* party's messages as read.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { description: "`{ viewerRole, messages: [{ id, body, senderRole, createdAt, readAt }] }`" },
          401: errorRef("No session"),
          404: errorRef("NOT_FOUND — no such booking, or the caller is not a party to it"),
        },
      },
      post: {
        tags: ["Messages"],
        summary: "Send a message on one appointment",
        description: `${bearerNote} Either party. A body of pure whitespace is rejected by a CHECK constraint in the database, not only here.`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["body"],
                properties: { body: { type: "string", maxLength: 2000 } },
              },
            },
          },
        },
        responses: {
          201: { description: "Message sent" },
          400: errorRef("VALIDATION_FAILED — empty, whitespace-only or over-long body"),
          401: errorRef("No session"),
          404: errorRef("NOT_FOUND — not a party to this booking"),
        },
      },
    },

    "/bookings/{id}/review": {
      get: {
        tags: ["Reviews"],
        summary: "The review left on one appointment, if any",
        description: `${bearerNote} Readable by both parties. \`isMine\` marks the caller's own review so the UI can offer to edit it.`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { description: "The review, or null when none has been left" },
          401: errorRef("No session"),
          404: errorRef("NOT_FOUND — not a party to this booking"),
        },
      },
      post: {
        tags: ["Reviews"],
        summary: "Leave a review on a completed appointment",
        description:
          `${bearerNote} **Client only, and only on a booking with status \`completed\`** — a provider ` +
          "cannot review themselves, and an appointment that was cancelled or has not happened yet has " +
          "nothing to rate. One review per booking is enforced by a UNIQUE constraint on `booking_id`, so " +
          "two simultaneous submissions resolve to one row rather than racing past an application check. " +
          "Changing your mind is a PATCH of your own row, not a second review.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["rating"],
                properties: {
                  rating: { type: "integer", minimum: 1, maximum: 5 },
                  comment: { type: "string", maxLength: 1000 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Review created" },
          400: errorRef("VALIDATION_FAILED — rating outside 1–5, or an over-long comment"),
          403: errorRef("FORBIDDEN — a provider cannot review their own booking"),
          404: errorRef("NOT_FOUND — not a party to this booking"),
          409: errorRef("CONFLICT — the appointment is not completed, or it has already been reviewed"),
        },
      },
    },

    "/providers/{id}/reviews": {
      get: {
        tags: ["Reviews"],
        summary: "Every published review for one provider",
        description:
          "Public — reviews are published feedback and appear on the provider's page before anyone signs in. " +
          "A signed-in client's own review comes back flagged with `isMine`.",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { description: "`{ averageRating, count, reviews: [...] }`" },
          404: errorRef("NOT_FOUND — no such provider"),
        },
      },
    },

    "/reviews/{id}": {
      patch: {
        tags: ["Reviews"],
        summary: "Edit your own review",
        description:
          `${bearerNote} The author only, checked against the booking's \`client_id\`. Anyone else gets ` +
          "404 rather than 403, matching the convention used everywhere a resource's existence is itself " +
          "worth not disclosing.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  rating: { type: "integer", minimum: 1, maximum: 5 },
                  comment: { type: "string", maxLength: 1000 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Updated" },
          400: errorRef("VALIDATION_FAILED"),
          404: errorRef("NOT_FOUND — no such review, or not yours"),
        },
      },
    },

    "/reviews/{id}/reply": {
      post: {
        tags: ["Reviews"],
        summary: "Reply to a review of your own service",
        description:
          `${bearerNote} Ownership is checked against \`reviews.provider_id\`, not merely that the caller ` +
          "is *a* provider — being this review's provider is the question, and only the handler can answer it. " +
          "A review has at most one reply.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["reply"],
                properties: { reply: { type: "string", maxLength: 1000 } },
              },
            },
          },
        },
        responses: {
          200: { description: "Reply saved" },
          400: errorRef("VALIDATION_FAILED — empty or over-long reply"),
          403: errorRef("FORBIDDEN — not the reviewed provider"),
          404: errorRef("NOT_FOUND — no such review"),
        },
      },
    },

    "/availability/rules/service/{serviceId}": {
      delete: {
        tags: ["Availability"],
        summary: "Drop a service's dedicated hours so it inherits the provider's defaults",
        description:
          `${bearerNote} Provider only, and only for their own service. Removes that service's own weekly ` +
          "rules and exceptions and clears `has_custom_availability`, after which the service follows the " +
          "provider's default schedule again.",
        parameters: [{ name: "serviceId", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { description: "`{ serviceId }` — the service now follows the default hours" },
          401: errorRef("No session"),
          403: errorRef("FORBIDDEN — not a provider"),
          404: errorRef("NOT_FOUND — no such service, or not yours"),
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
