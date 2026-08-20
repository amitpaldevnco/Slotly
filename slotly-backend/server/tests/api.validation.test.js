/**
 * HTTP-level tests for server-side input validation.
 *
 * The brief's rule is "every write endpoint validates its input server-side.
 * Never trust the client", and the standard it is held to here is stricter than
 * "does not crash": a bad request must come back as a **4xx with a
 * machine-readable code**, naming the field that was wrong.
 *
 * The largest block below is the malformed-id regression suite. `GET
 * /api/bookings/abc` used to return 500, because `WHERE id = $1` with a
 * non-numeric string makes PostgreSQL raise rather than return no rows. Nothing
 * was ever injectable — the queries are parameterised — but the API reported the
 * caller's typo as its own failure, and every case in that block is now checked
 * on every route that takes an id.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createUser,
  createService,
  setWeeklyHours,
  guest,
  cleanupApiTestData,
  closeTestPool,
} from "./apiHarness.js";

let provider;
let clientUser;
let service;

beforeAll(async () => {
  await cleanupApiTestData();
  provider = await createUser({ role: "provider", timezone: "Europe/London", label: "valprov" });
  clientUser = await createUser({ role: "client", timezone: "America/New_York", label: "valcli" });
  service = await createService(provider);
  await setWeeklyHours(provider);
});

afterAll(async () => {
  await cleanupApiTestData();
  await closeTestPool();
});

/** Values that are not database ids, and the reason each one is a trap. */
const NOT_AN_ID = [
  ["abc", "plain text — the case that produced the original 500"],
  ["1;DROP TABLE users", "SQL-shaped, and inert: it travels as a parameter"],
  ["1 OR 1=1", "the other classic payload"],
  ["1e999", "Number() would make this Infinity"],
  ["12.5", "Number() accepts it; an integer column does not"],
  ["0x10", "Number() reads hex"],
  ["0", "never a SERIAL value"],
  ["-1", "signed, and not a SERIAL value"],
  ["2147483648", "one past the int4 ceiling"],
  ["null", "the literal string, which Number() rejects but truthiness does not"],
];

// ---------------------------------------------------------------------------
describe("malformed ids never reach the database", () => {
  describe.each(NOT_AN_ID)("id %j — %s", (badId) => {
    const encoded = encodeURIComponent(badId);

    it("is refused on GET /api/bookings/:id", async () => {
      const response = await clientUser.agent.get(`/api/bookings/${encoded}`);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_FAILED");
    });

    it("is refused on the public provider routes", async () => {
      for (const path of [
        `/api/providers/${encoded}`,
        `/api/providers/${encoded}/services`,
        `/api/providers/${encoded}/availability`,
        `/api/providers/${encoded}/reviews`,
      ]) {
        const response = await guest().get(path);
        expect(response.status, path).toBe(400);
      }
    });

    it("is refused on the write routes", async () => {
      const responses = await Promise.all([
        clientUser.agent.post(`/api/bookings/${encoded}/cancel`).send({}),
        provider.agent.post(`/api/bookings/${encoded}/reschedule`).send({ startsAt: new Date().toISOString(), reason: "x" }),
        provider.agent.patch(`/api/bookings/${encoded}/status`).send({ status: "completed" }),
        provider.agent.delete(`/api/services/${encoded}`),
        provider.agent.delete(`/api/availability/exceptions/${encoded}`),
        clientUser.agent.patch(`/api/reviews/${encoded}`).send({ rating: 5 }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(400);
      }
    });
  });

  it("names the offending parameter without echoing its value", async () => {
    const payload = "<script>alert(1)</script>";
    const response = await clientUser.agent.get(`/api/bookings/${encodeURIComponent(payload)}`);

    expect(response.body.details[0].field).toBe("id");
    expect(JSON.stringify(response.body)).not.toContain("script");
  });

  it("refuses a malformed serviceId wherever it arrives", async () => {
    const responses = [
      await guest().get(`/api/providers/${provider.id}/slots?serviceId=abc&from=2099-01-01&to=2099-01-02`),
      await clientUser.agent.get("/api/bookings?serviceId=abc"),
      await clientUser.agent.post("/api/bookings").send({ serviceId: "abc", startsAt: new Date().toISOString() }),
      await provider.agent.put("/api/availability/rules").send({ serviceId: "abc", rules: [] }),
      await provider.agent.post("/api/availability/exceptions").send({
        serviceId: "abc",
        kind: "block",
        startDate: "2099-01-01",
        endDate: "2099-01-01",
      }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(400);
    }
  });

  it("does not let a malformed serviceId silently rewrite the default hours", async () => {
    // The subtler half of the same bug. `Number("abc")` is NaN, NaN is falsy, so
    // `serviceId ? Number(serviceId) : null` produced null — and the request went
    // on to replace the provider's *default* weekly pattern while the caller
    // believed it was scoping the write to one service.
    const before = await guest().get(`/api/providers/${provider.id}/availability`);
    expect(before.body.data.rules.length).toBeGreaterThan(0);

    const attempt = await provider.agent
      .put("/api/availability/rules")
      .send({ serviceId: "not-a-service", rules: [] });
    expect(attempt.status).toBe(400);

    const after = await guest().get(`/api/providers/${provider.id}/availability`);
    expect(after.body.data.rules).toHaveLength(before.body.data.rules.length);
  });

  it("still answers 404 for a well-formed id that matches nothing", async () => {
    // The guard must not swallow the genuine not-found case.
    expect((await clientUser.agent.get("/api/bookings/2147483647")).status).toBe(404);
    expect((await guest().get("/api/providers/2147483647")).status).toBe(404);
  });

  it("leaves literal paths registered before /:id alone", async () => {
    // `/bookings/summary` and `/bookings/unread-count` must not be parsed as ids.
    expect((await provider.agent.get("/api/bookings/summary")).status).toBe(200);
    expect((await clientUser.agent.get("/api/bookings/unread-count")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("service validation", () => {
  it("requires a name, a price and a duration", async () => {
    const response = await provider.agent.post("/api/services").send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
    expect(response.body.details.map((d) => d.field).sort()).toEqual(["duration", "price", "serviceName"]);
  });

  it.each([
    ["a negative price", { price: -5 }, "price"],
    ["an absurd price", { price: 99_999_999 }, "price"],
    ["a zero duration", { duration: 0 }, "duration"],
    ["a duration beyond 24 hours", { duration: 99_999 }, "duration"],
    ["a negative buffer", { bufferBefore: -10 }, "bufferBefore"],
    ["a buffer beyond four hours", { bufferAfter: 100_000 }, "bufferAfter"],
    ["a slot interval below the floor", { slotInterval: 1 }, "slotInterval"],
    ["a slot interval above the ceiling", { slotInterval: 9999 }, "slotInterval"],
  ])("rejects %s", async (_label, override, expectedField) => {
    const response = await provider.agent
      .post("/api/services")
      .send({ service_name: "Edge", price: 10, duration: 60, ...override });

    expect(response.status).toBe(400);
    expect(response.body.details.some((d) => d.field === expectedField)).toBe(true);
  });

  it("accepts camelCase as well as snake_case field names", async () => {
    // The API historically took snake_case here and camelCase everywhere else.
    // Both spellings are now accepted so a client does not have to remember
    // which endpoint it is talking to.
    const response = await provider.agent.post("/api/services").send({
      serviceName: "CamelCase Service",
      price: 25,
      duration: 45,
      bufferBefore: 5,
      bufferAfter: 10,
      slotInterval: 15,
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      name: "CamelCase Service",
      duration: 45,
      bufferBefore: 5,
      bufferAfter: 10,
      slotInterval: 15,
    });
  });

  it("returns a service in one consistent camelCase shape", async () => {
    const response = await guest().get(`/api/providers/${provider.id}/services`);
    const [first] = response.body.data;

    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("bufferBefore");
    // Internal columns are not part of the contract and must not leak.
    expect(first).not.toHaveProperty("provider_id");
    expect(first).not.toHaveProperty("service_name");
    expect(first).not.toHaveProperty("has_custom_availability");
  });
});

// ---------------------------------------------------------------------------
describe("availability validation", () => {
  it.each([
    ["an end before the start", { weekday: 1, startTime: "17:00", endTime: "09:00" }],
    ["a weekday outside 0–6", { weekday: 9, startTime: "09:00", endTime: "17:00" }],
    ["an hour past midnight", { weekday: 1, startTime: "09:00", endTime: "33:00" }],
    ["a time that is not HH:MM", { weekday: 1, startTime: "morning", endTime: "17:00" }],
    ["an equal start and end", { weekday: 1, startTime: "09:00", endTime: "09:00" }],
  ])("rejects %s", async (_label, rule) => {
    const response = await provider.agent.put("/api/availability/rules").send({ rules: [rule] });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects two windows that overlap on the same weekday", async () => {
    const response = await provider.agent.put("/api/availability/rules").send({
      rules: [
        { weekday: 1, startTime: "09:00", endTime: "17:00" },
        { weekday: 1, startTime: "10:00", endTime: "11:00" },
      ],
    });

    expect(response.status).toBe(400);
    expect(response.body.details[0].message).toMatch(/overlaps/i);
  });

  it("accepts two windows that merely touch", async () => {
    // 09:00–12:00 and 12:00–17:00 is a split lunch, not an overlap.
    const response = await provider.agent.put("/api/availability/rules").send({
      rules: [
        { weekday: 2, startTime: "09:00", endTime: "12:00" },
        { weekday: 2, startTime: "12:00", endTime: "17:00" },
      ],
    });

    expect(response.status).toBe(200);
  });

  it("rejects an exception whose dates run backwards, or that is not a real date", async () => {
    const backwards = await provider.agent.post("/api/availability/exceptions").send({
      kind: "block",
      startDate: "2099-06-10",
      endDate: "2099-06-01",
    });
    const notADate = await provider.agent.post("/api/availability/exceptions").send({
      kind: "block",
      startDate: "2099-02-30",
      endDate: "2099-02-30",
    });

    expect(backwards.status).toBe(400);
    expect(notADate.status).toBe(400);
  });

  it("rejects an unknown exception kind", async () => {
    const response = await provider.agent.post("/api/availability/exceptions").send({
      kind: "maybe",
      startDate: "2099-06-01",
      endDate: "2099-06-01",
    });

    expect(response.status).toBe(400);
  });

  it("rejects a negative cancellation cutoff", async () => {
    const response = await provider.agent.patch("/api/availability/settings").send({
      cancellationCutoffHours: -5,
    });

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("booking and message body validation", () => {
  it("rejects a startsAt that is not an instant", async () => {
    const response = await clientUser.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: "next tuesday" });

    expect(response.status).toBe(400);
    expect(response.body.details.some((d) => d.field === "startsAt")).toBe(true);
  });

  it("rejects an over-long note", async () => {
    const response = await clientUser.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: new Date().toISOString(), note: "x".repeat(501) });

    expect(response.status).toBe(400);
    expect(response.body.details.some((d) => d.field === "note")).toBe(true);
  });

  it("survives a request with no body at all", async () => {
    // Express 5 leaves req.body undefined for a bodyless POST, which would throw
    // a TypeError in every handler that destructures it and report as a 500.
    const response = await clientUser.agent.post("/api/bookings").set("Content-Type", "application/json");
    expect(response.status).toBe(400);
  });

  it("rejects an unparseable date filter on the booking list", async () => {
    expect((await clientUser.agent.get("/api/bookings?from=nonsense")).status).toBe(400);
    expect((await clientUser.agent.get("/api/bookings?to=nonsense")).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Regression suite: a malformed request must never wear a 500.
//
// Each case below used to reach the generic error handler and come back as
// "Something went wrong on our side" with code SERVER_ERROR — a server fault
// reported for a client mistake. The brief is explicit that errors have to be
// meaningful and machine-readable, and a 500 is neither: a caller cannot tell
// "fix your request" from "try again later", and a monitoring dashboard counts
// every one of these as an outage.
// ---------------------------------------------------------------------------
describe("malformed requests are 4xx with a usable code, never 5xx", () => {
  it("rejects a body that is not valid JSON", async () => {
    const response = await clientUser.agent
      .post("/api/bookings")
      .set("Content-Type", "application/json")
      .send("{ this is not json");

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
    expect(response.body.error).toMatch(/JSON/i);
  });

  it("rejects a body past the size limit with 413 and a code", async () => {
    const response = await clientUser.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: new Date().toISOString(), note: "x".repeat(200_000) });

    expect(response.status).toBe(413);
    expect(response.body.code).toBe("VALIDATION_FAILED");
    expect(response.body.success).toBe(false);
  });

  it("rejects a multipart body it cannot parse", async () => {
    // A null byte in the filename makes the part header unparseable, and busboy
    // throws a plain Error from inside the stream — well outside any handler's
    // try/catch. It surfaced as a 500 and was logged as a crash.
    //
    // CRLF and NUL are built with fromCharCode rather than written as escapes,
    // so the bytes on the wire are unmistakable to a reader and cannot be
    // mangled by an editor or a tool that rewrites line endings.
    const CRLF = String.fromCharCode(13, 10);
    const NUL = String.fromCharCode(0);
    const boundary = "----validationboundary";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}${CRLF}`),
      Buffer.from(
        `Content-Disposition: form-data; name="profilePicture"; filename="a.png${NUL}.sh"${CRLF}`
      ),
      Buffer.from(`Content-Type: image/png${CRLF}${CRLF}`),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
    ]);

    const response = await clientUser.agent
      .patch("/api/auth/profile")
      .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("UPLOAD_REJECTED");
  });

  it("names the format when an image type is refused, instead of 'no fields to update'", async () => {
    // multer drops a file whose declared type is not on the allow-list, so the
    // request reaches the handler with no file *and* no other changed field. It
    // used to be reported as "No fields to update", which is true and tells the
    // user nothing about the GIF they just tried to upload.
    const response = await clientUser.agent
      .patch("/api/auth/profile")
      .attach("profilePicture", Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32)]), {
        filename: "a.gif",
        contentType: "image/gif",
      });

    expect(response.status).toBe(400);
    expect(response.body.details.some((d) => d.field === "profilePicture")).toBe(true);
    expect(response.body.details[0].message).toMatch(/JPG|PNG/i);
  });

  it("rejects a startsAt smuggled in as an array", async () => {
    // `new Date(["2026-01-01T09:00:00Z"])` coerces the array to its single
    // member and parses, so this used to create a real booking through a shape
    // the API never documented.
    const response = await clientUser.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: [new Date(Date.now() + 86_400_000).toISOString()] });

    expect(response.status).toBe(400);
    expect(response.body.details.some((d) => d.field === "startsAt")).toBe(true);
  });

  it("rejects a nonsensical limit rather than silently clamping it", async () => {
    // `?limit=-5` used to be clamped to 1, so a caller with an off-by-one got a
    // single provider back and no indication the API had disagreed with them.
    for (const limit of ["-5", "0", "abc", "1e3", "101", "2.5"]) {
      const response = await guest().get(`/api/providers?limit=${limit}`);
      expect(response.status, `limit=${limit}`).toBe(400);
      expect(response.body.code).toBe("VALIDATION_FAILED");
    }

    // A valid one still works, and an absent one still defaults.
    expect((await guest().get("/api/providers?limit=5")).status).toBe(200);
    expect((await guest().get("/api/providers")).status).toBe(200);
  });
});
