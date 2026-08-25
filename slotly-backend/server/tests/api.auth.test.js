/**
 * HTTP-level tests for authentication and authorization.
 *
 * The brief asks specifically that "what a user can see and do is determined by
 * their role and enforced on the server, not by hiding buttons in the UI". The
 * only way to test that claim is to make the request the hidden button would
 * have made, which is what this file does — every case here is an attempt to do
 * something the UI would never offer.
 *
 * Two shapes of check run throughout:
 *
 *   - **Authentication** — can a caller prove who they are? Forged tokens,
 *     `alg:none`, no cookie at all.
 *   - **Authorization** — given that they are who they say, may they touch
 *     *this* row? A valid session proves nothing about ownership, so the
 *     interesting cases are all cross-tenant.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import {
  createUser,
  createService,
  setWeeklyHours,
  fetchSlots,
  guest,
  client,
  testEmail,
  testPool,
  cleanupApiTestData,
  closeTestPool,
  TEST_PASSWORD,
} from "./apiHarness.js";

let provider;
let clientA;
let clientB;
let service;

beforeAll(async () => {
  await cleanupApiTestData();
  provider = await createUser({ role: "provider", timezone: "Europe/London", label: "authprov" });
  clientA = await createUser({ role: "client", timezone: "America/New_York", label: "authcliA" });
  clientB = await createUser({ role: "client", timezone: "Asia/Kolkata", label: "authcliB" });
  service = await createService(provider);
  await setWeeklyHours(provider);
});

afterAll(async () => {
  await cleanupApiTestData();
  await closeTestPool();
});

// ---------------------------------------------------------------------------
describe("registration and login", () => {
  it("creates an account and sets an httpOnly session cookie", async () => {
    const agent = client();
    const response = await agent
      .post("/api/auth/register")
      .send({ name: "Cookie Check", email: testEmail("cookie"), password: TEST_PASSWORD });

    expect(response.status).toBe(201);

    const cookie = response.headers["set-cookie"].join(" ");
    // httpOnly is the reason the token is not in localStorage: a script injected
    // into the page cannot read it.
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite/i);
  });

  it("never returns the password or its hash", async () => {
    const response = await client()
      .post("/api/auth/register")
      .send({ name: "No Leak", email: testEmail("noleak"), password: TEST_PASSWORD });

    expect(JSON.stringify(response.body)).not.toMatch(/password/i);
    expect(JSON.stringify(response.body)).not.toContain(TEST_PASSWORD);
  });

  it("rejects a short password and a malformed email, field by field", async () => {
    const response = await guest()
      .post("/api/auth/register")
      .send({ name: "Bad", email: "not-an-email", password: "short" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
    expect(response.body.details.map((d) => d.field).sort()).toEqual(["email", "password"]);
  });

  it("refuses a duplicate address with 409 ACCOUNT_EXISTS", async () => {
    const response = await guest()
      .post("/api/auth/register")
      .send({ name: "Dupe", email: clientA.email, password: TEST_PASSWORD });

    expect(response.status).toBe(409);
    // The code is what a client branches on, and it is published in the OpenAPI
    // document — a generic CONFLICT here would make that documentation a lie.
    expect(response.body.code).toBe("ACCOUNT_EXISTS");
  });

  it("gives the same answer for a wrong password and an unknown address", async () => {
    // Different answers here would turn the login form into a way to test
    // whether an address has an account.
    const wrongPassword = await guest()
      .post("/api/auth/login")
      .send({ email: clientA.email, password: "NotThePassword1!" });

    const noSuchUser = await guest()
      .post("/api/auth/login")
      .send({ email: testEmail("ghost"), password: TEST_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPassword.body.code).toBe(noSuchUser.body.code);
    expect(wrongPassword.body.error).toBe(noSuchUser.body.error);
  });

  it("logs a real account in", async () => {
    const response = await client()
      .post("/api/auth/login")
      .send({ email: clientA.email, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(clientA.email);
  });

  // An email is an identifier, not a display string. Postgres compares VARCHAR
  // case-sensitively, so before the address was casefolded on the way in, a
  // capital first letter — which is what every phone keyboard offers by default
  // — simply did not match the row it belonged to, and the same person could
  // register a second account under `Casey@` beside their `casey@` one.
  it("logs in regardless of how the email is capitalised", async () => {
    const response = await client()
      .post("/api/auth/login")
      .send({ email: clientA.email.toUpperCase(), password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(clientA.email);
  });

  it("logs in with surrounding whitespace on the email", async () => {
    const response = await client()
      .post("/api/auth/login")
      .send({ email: `  ${clientA.email}  `, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
  });

  it("refuses to register the same address under a different capitalisation", async () => {
    const response = await client().post("/api/auth/register").send({
      name: "Case Twin",
      email: clientA.email.toUpperCase(),
      password: TEST_PASSWORD,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ACCOUNT_EXISTS");
  });

  it("stores a registered name trimmed, and refuses a blank one", async () => {
    const blank = await client()
      .post("/api/auth/register")
      .send({ name: "   ", email: testEmail("blankname"), password: TEST_PASSWORD });

    expect(blank.status).toBe(400);
    expect(blank.body.details.some((d) => d.field === "name")).toBe(true);

    const padded = await client()
      .post("/api/auth/register")
      .send({ name: "  Padded Name  ", email: testEmail("padded"), password: TEST_PASSWORD });

    expect(padded.status).toBe(201);
    expect(padded.body.data.user.name).toBe("Padded Name");
  });
});

// ---------------------------------------------------------------------------
describe("changing your own password", () => {
  const NEW_PASSWORD = "An0therStr0ngPass!";

  it("refuses without a session", async () => {
    const response = await guest()
      .patch("/api/auth/password")
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

    expect(response.status).toBe(401);
  });

  it("refuses a new password under eight characters", async () => {
    const user = await createUser({ role: "client", label: "pwshort" });
    const response = await user.agent
      .patch("/api/auth/password")
      .send({ currentPassword: TEST_PASSWORD, newPassword: "short" });

    expect(response.status).toBe(400);
    expect(response.body.details.some((d) => d.field === "newPassword")).toBe(true);
  });

  it("insists on the current password", async () => {
    const user = await createUser({ role: "client", label: "pwmissing" });
    const response = await user.agent
      .patch("/api/auth/password")
      .send({ newPassword: NEW_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.details.some((d) => d.field === "currentPassword")).toBe(true);
  });

  // A session cookie proves the browser is signed in, not that the person
  // holding it owns the account. Without this an unattended laptop is enough to
  // take the account permanently.
  it("refuses when the current password is wrong", async () => {
    const user = await createUser({ role: "client", label: "pwwrong" });
    const response = await user.agent
      .patch("/api/auth/password")
      .send({ currentPassword: "not-the-password", newPassword: NEW_PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("refuses a new password identical to the current one", async () => {
    const user = await createUser({ role: "client", label: "pwsame" });
    const response = await user.agent
      .patch("/api/auth/password")
      .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.details.some((d) => d.field === "newPassword")).toBe(true);
  });

  it("changes the password, and the new one is the one that works", async () => {
    const user = await createUser({ role: "client", label: "pwchange" });

    const changed = await user.agent
      .patch("/api/auth/password")
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

    expect(changed.status).toBe(200);
    expect(changed.body.data.hadPassword).toBe(true);

    const withNew = await client()
      .post("/api/auth/login")
      .send({ email: user.email, password: NEW_PASSWORD });
    expect(withNew.status).toBe(200);

    const withOld = await client()
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(withOld.status).toBe(401);
  });

  // A Google- or GitHub-only account has nothing to verify, so this adds a
  // password rather than replacing one — a second way in, not a swap.
  it("adds a password to an account that had none, without asking for one", async () => {
    const user = await createUser({ role: "client", label: "pwsocial" });

    await testPool().query(
      `UPDATE users SET password_hash = NULL, google_id = $2 WHERE email = $1`,
      [user.email, `google-pw-${Date.now()}`]
    );

    const response = await user.agent
      .patch("/api/auth/password")
      .send({ newPassword: NEW_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.hadPassword).toBe(false);

    const login = await client()
      .post("/api/auth/login")
      .send({ email: user.email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("session tokens", () => {
  it("refuses a request with no cookie", async () => {
    const response = await guest().get("/api/auth/me");
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("UNAUTHENTICATED");
  });

  it("refuses a token signed with the wrong key", async () => {
    // The signature is the whole point: without verification a client could
    // edit `userId` in the payload and become anyone.
    const forged = jwt.sign({ userId: provider.id, email: provider.email }, "not-the-real-secret");

    const response = await guest().get("/api/auth/me").set("Cookie", [`token=${forged}`]);
    expect(response.status).toBe(401);
  });

  it("refuses an alg:none token", async () => {
    // The classic JWT bypass: strip the signature and declare the algorithm
    // "none". `jwt.verify` rejects it because the secret implies HS256.
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({ userId: provider.id })}.`;

    const response = await guest().get("/api/auth/me").set("Cookie", [`token=${unsigned}`]);
    expect(response.status).toBe(401);
  });

  it("refuses an expired token", async () => {
    const expired = jwt.sign({ userId: clientA.id, email: clientA.email }, process.env.JWT_SECRET, {
      expiresIn: "-1h",
    });

    const response = await guest().get("/api/auth/me").set("Cookie", [`token=${expired}`]);
    expect(response.status).toBe(401);
  });

  it("refuses a token that is not a token at all", async () => {
    const response = await guest().get("/api/auth/me").set("Cookie", ["token=garbage"]);
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("role enforcement", () => {
  it("stops a client creating a service", async () => {
    const response = await clientA.agent
      .post("/api/services")
      .send({ service_name: "Not mine", price: 10, duration: 30 });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN");
  });

  it("stops a client editing availability", async () => {
    const response = await clientA.agent.put("/api/availability/rules").send({ rules: [] });
    expect(response.status).toBe(403);
  });

  it("stops a provider booking an appointment", async () => {
    const response = await provider.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: new Date(Date.now() + 4 * 86_400_000).toISOString() });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN");
  });

  it("reads the role from the database, not from the token", async () => {
    // A role can change after a token is minted. Signing a token that claims to
    // be the provider still has to be checked against the row — here the token
    // is genuine and the role really is 'client', so the guard must refuse.
    const token = jwt.sign({ userId: clientA.id, email: clientA.email }, process.env.JWT_SECRET);

    const response = await guest()
      .put("/api/availability/rules")
      .set("Cookie", [`token=${token}`])
      .send({ rules: [] });

    expect(response.status).toBe(403);
  });

  it("refuses to change a role once it has been chosen", async () => {
    const response = await clientA.agent
      .patch("/api/auth/complete-profile")
      .send({ role: "provider", phoneNumber: "+441234567890", timezone: "Europe/London", businessName: "X", businessType: "Y" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("INVALID_TRANSITION");
  });
});

// ---------------------------------------------------------------------------
describe("acting on another user's records", () => {
  let booking;

  beforeAll(async () => {
    const slots = await fetchSlots(clientA.agent, provider.id, service.id);
    const created = await clientA.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: slots[0].startsAt });

    expect(created.status).toBe(201);
    booking = created.body.data;
  });

  it("hides a stranger's booking behind 404, not 403", async () => {
    // 403 would confirm the booking exists, which leaks that the provider had
    // an appointment at that id. 404 says nothing either way.
    const response = await clientB.agent.get(`/api/bookings/${booking.id}`);
    expect(response.status).toBe(404);
  });

  it("stops a stranger cancelling it", async () => {
    const response = await clientB.agent.post(`/api/bookings/${booking.id}/cancel`).send({});
    expect(response.status).toBe(404);

    const stillThere = await clientA.agent.get(`/api/bookings/${booking.id}`);
    expect(stillThere.body.data.status).toBe("booked");
  });

  it("stops a stranger rescheduling it", async () => {
    const response = await clientB.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), reason: "mine now" });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("lets the client reschedule their own booking, and judges the time not the caller", async () => {
    // A client moving their *own* appointment is allowed — see
    // `evaluateClientReschedule`. This particular instant is an arbitrary point
    // five days out rather than a published slot start, so it is still refused —
    // but on the merits of the time, not on who asked. A 403 here would mean the
    // client had been turned away at the door.
    const response = await clientA.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), reason: "moving it" });

    expect(response.status).not.toBe(403);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SLOT_UNAVAILABLE");
  });

  it("still stops the client setting their own booking's status", async () => {
    // Rescheduling opened up to clients; recording an outcome did not. Marking an
    // appointment completed or no-show remains the provider's judgement alone.
    const response = await clientA.agent
      .patch(`/api/bookings/${booking.id}/status`)
      .send({ status: "no_show" });

    expect(response.status).toBe(403);
  });

  it("stops the client setting a booking status", async () => {
    const response = await clientA.agent
      .patch(`/api/bookings/${booking.id}/status`)
      .send({ status: "completed" });

    expect(response.status).toBe(403);
  });

  it("stops a non-party reading or posting to the message thread", async () => {
    const read = await clientB.agent.get(`/api/bookings/${booking.id}/messages`);
    const write = await clientB.agent.post(`/api/bookings/${booking.id}/messages`).send({ body: "hello" });

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
  });

  it("lets both actual parties read the thread", async () => {
    expect((await clientA.agent.get(`/api/bookings/${booking.id}/messages`)).status).toBe(200);
    expect((await provider.agent.get(`/api/bookings/${booking.id}/messages`)).status).toBe(200);
  });

  it("scopes the booking list to the caller, whatever they ask for", async () => {
    // There is no request shape that returns someone else's bookings: the
    // filter is applied in SQL from the session, not from a parameter.
    const response = await clientB.agent.get("/api/bookings?scope=all");

    expect(response.status).toBe(200);
    expect(response.body.data.bookings.every((b) => b.client.id === clientB.id)).toBe(true);
    expect(response.body.data.bookings.some((b) => b.id === booking.id)).toBe(false);
  });

  it("ignores fields the caller is not allowed to set", async () => {
    // Mass assignment: client_id comes from the session and status is always
    // 'booked' on creation, no matter what the body claims.
    const slots = await fetchSlots(clientB.agent, provider.id, service.id);
    const response = await clientB.agent.post("/api/bookings").send({
      serviceId: service.id,
      startsAt: slots[0].startsAt,
      clientId: clientA.id,
      providerId: clientA.id,
      status: "completed",
      price_snapshot: 0,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe("booked");
    expect(response.body.data.client.id).toBe(clientB.id);
    expect(Number(response.body.data.service.price)).toBeGreaterThan(0);
  });

  it("stops a provider editing another provider's service", async () => {
    const other = await createUser({ role: "provider", label: "authprov2" });

    const update = await other.agent.put(`/api/services/${service.id}`).send({ price: 1 });
    const remove = await other.agent.delete(`/api/services/${service.id}`);

    expect(update.status).toBeGreaterThanOrEqual(400);
    expect(remove.status).toBeGreaterThanOrEqual(400);

    // And the service is untouched.
    const services = await guest().get(`/api/providers/${provider.id}/services`);
    const mine = services.body.data.find((s) => s.id === service.id);
    expect(Number(mine.price)).toBe(50);
  });

  it("stops a provider setting hours on a service they do not own", async () => {
    const other = await createUser({ role: "provider", label: "authprov3" });

    const response = await other.agent.put("/api/availability/rules").send({
      serviceId: service.id,
      rules: [{ weekday: 1, startTime: "01:00", endTime: "02:00" }],
    });

    expect(response.status).toBe(400);
    expect(response.body.details[0].field).toBe("serviceId");
  });
});

// ---------------------------------------------------------------------------
describe("the public surface", () => {
  it("serves the provider directory to a signed-out visitor", async () => {
    const response = await guest().get("/api/providers");
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data.providers)).toBe(true);
  });

  it("serves a provider page, their services and their slots without a session", async () => {
    const range = "from=2099-01-01&to=2099-01-07";

    expect((await guest().get(`/api/providers/${provider.id}`)).status).toBe(200);
    expect((await guest().get(`/api/providers/${provider.id}/services`)).status).toBe(200);
    expect((await guest().get(`/api/providers/${provider.id}/availability`)).status).toBe(200);
    expect(
      (await guest().get(`/api/providers/${provider.id}/slots?serviceId=${service.id}&${range}`)).status
    ).toBe(200);
  });

  it("keeps every booking endpoint behind a session", async () => {
    for (const path of ["/api/bookings", "/api/bookings/summary", "/api/bookings/unread-count"]) {
      expect((await guest().get(path)).status, path).toBe(401);
    }
  });

  it("answers an unknown API path with 404, not 500", async () => {
    const response = await guest().get("/api/no-such-thing");
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("NOT_FOUND");
  });
});
