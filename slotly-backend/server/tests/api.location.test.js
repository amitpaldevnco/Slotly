/**
 * Location and booking scope, over HTTP.
 *
 * The rule itself is covered by `bookingScope.test.js`. What these need a real
 * request for is everything that rule is wired into and cannot be seen from a
 * pure function: which status code each refusal carries, that the read path and
 * the write path agree, that the directory's filters narrow what they claim to,
 * and — most importantly — that the *defaults* leave every pre-existing flow
 * working. That last one is the whole reason `booking_scope` defaults to
 * `international`, and it is the assertion most worth having: a service created
 * without mentioning either field must behave exactly as it did before these
 * columns existed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createUser,
  createService,
  setWeeklyHours,
  futureRange,
  fetchSlots,
  guest,
  cleanupApiTestData,
  closeTestPool,
} from "./apiHarness.js";

/** A provider and a client in the same country, for the domestic-allowed cases. */
let sameCountryProvider;
let sameCountryClient;
/** A provider in GB and a client in US, for the cross-border cases. */
let gbProvider;
let usClient;

beforeAll(async () => {
  await cleanupApiTestData();

  gbProvider = await createUser({ role: "provider", label: "locgbprov", country: "GB" });
  usClient = await createUser({ role: "client", label: "locusclient", country: "US" });
  sameCountryProvider = await createUser({ role: "provider", label: "locsameprov", country: "GB" });
  sameCountryClient = await createUser({ role: "client", label: "locsamecli", country: "GB" });

  await Promise.all([setWeeklyHours(gbProvider), setWeeklyHours(sameCountryProvider)]);
}, 30_000);

afterAll(async () => {
  await cleanupApiTestData();
  await closeTestPool();
});

describe("the defaults leave existing behaviour untouched", () => {
  it("a service created without mentioning either field is in-person and international", async () => {
    const service = await createService(gbProvider, { service_name: "Default Service" });

    expect(service.deliveryType).toBe("in_person");
    expect(service.bookingScope).toBe("international");
  });

  it("and is bookable across a border, exactly as it was before these columns existed", async () => {
    // The assertion this whole file exists for. Defaulting `booking_scope` to
    // 'domestic' would have silently made every pre-existing service unbookable
    // by every client in another country — a data migration quietly changing who
    // may book, with nothing erroring and the slots simply not appearing.
    const service = await createService(gbProvider, { service_name: "Cross Border Default" });
    const slots = await fetchSlots(usClient.agent, gbProvider.id, service.id);
    expect(slots.length).toBeGreaterThan(0);

    const booked = await usClient.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: slots[0].startsAt });

    expect(booked.status).toBe(201);
  });
});

describe("publishing a service requires the location it depends on", () => {
  it("refuses an in-person service when the provider has no address", async () => {
    const noAddress = await createUser({
      role: "provider",
      label: "locnoaddr",
      country: "GB",
      businessAddress: "",
    });

    const response = await noAddress.agent.post("/api/services").send({
      service_name: "Nowhere",
      price: 10,
      duration: 30,
      deliveryType: "in_person",
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
    // Keyed to the control the provider can act on, and the message names both
    // ways out — adding the address, or making the service virtual.
    const field = response.body.details.find((d) => d.field === "deliveryType");
    expect(field).toBeTruthy();
    expect(field.message).toMatch(/address/i);
    expect(field.message).toMatch(/virtual/i);
  });

  it("accepts a virtual service from the same provider", async () => {
    // The point of the previous test: the requirement is about what is being
    // published, not about the provider being incomplete.
    const noAddress = await createUser({
      role: "provider",
      label: "locnoaddr2",
      country: "GB",
      businessAddress: "",
    });

    const response = await noAddress.agent.post("/api/services").send({
      service_name: "Online Only",
      price: 10,
      duration: 30,
      deliveryType: "virtual",
    });

    expect(response.status).toBe(201);
    expect(response.body.data.deliveryType).toBe("virtual");
    // Null even though this provider has no address anyway — what matters is that
    // a virtual service never carries one.
    expect(response.body.data.location).toBeNull();
  });

  it("refuses a domestic service when the provider has no country", async () => {
    // UTC belongs to no country, so `complete-profile` infers nothing and the
    // column stays null — the same state every account predating the column is in.
    const noCountry = await createUser({
      role: "provider",
      label: "locnocountry",
      timezone: "UTC",
      country: "",
    });

    const response = await noCountry.agent.post("/api/services").send({
      service_name: "Local Only",
      price: 10,
      duration: 30,
      deliveryType: "virtual",
      bookingScope: "domestic",
    });

    expect(response.status).toBe(400);
    expect(response.body.details.some((d) => d.field === "bookingScope")).toBe(true);
  });

  it("refuses an unrecognised delivery type or scope rather than storing it", async () => {
    for (const [payload, field] of [
      [{ deliveryType: "online" }, "deliveryType"],
      [{ bookingScope: "worldwide" }, "bookingScope"],
    ]) {
      const response = await gbProvider.agent
        .post("/api/services")
        .send({ service_name: "Bad", price: 10, duration: 30, ...payload });

      expect(response.status).toBe(400);
      expect(response.body.details.some((d) => d.field === field)).toBe(true);
    }
  });

  it("lets an unrelated edit through without demanding an address", async () => {
    // A provider correcting a description on a service that predates this feature
    // is not asked for a field they have never been asked for before. The
    // requirement gates publishing, not every edit — see `locationErrors`.
    const provider = await createUser({
      role: "provider",
      label: "locedit",
      country: "GB",
      businessAddress: "1 Real Street",
    });
    const service = await createService(provider, { service_name: "Editable" });

    // Remove the address after the fact, which the API allows on purpose.
    const cleared = await provider.agent.patch("/api/auth/profile").send({ businessAddress: "" });
    expect(cleared.status).toBe(200);

    const edited = await provider.agent
      .put(`/api/services/${service.id}`)
      .send({ description: "A new description and nothing else" });

    expect(edited.status).toBe(200);
  });

  it("but catches an edit that states the delivery type", async () => {
    const provider = await createUser({
      role: "provider",
      label: "locedit2",
      country: "GB",
      businessAddress: "",
    });
    const service = await createService(provider, {
      service_name: "Turning Physical",
      deliveryType: "virtual",
    });

    const edited = await provider.agent
      .put(`/api/services/${service.id}`)
      .send({ deliveryType: "in_person" });

    expect(edited.status).toBe(400);
    expect(edited.body.details.some((d) => d.field === "deliveryType")).toBe(true);
  });
});

describe("a domestic service is enforced on the server", () => {
  let domesticService;

  beforeAll(async () => {
    domesticService = await createService(gbProvider, {
      service_name: "GB Only",
      deliveryType: "in_person",
      bookingScope: "domestic",
    });
  });

  it("reports the refusal on the slot list rather than offering times", async () => {
    const response = await usClient.agent.get(
      `/api/providers/${gbProvider.id}/slots?serviceId=${domesticService.id}` +
        `&from=${futureRange().from}&to=${futureRange().to}`
    );

    // 200, not an error: "there are no times" and "this is not offered in your
    // country" are different facts, and only a success response can carry the
    // second alongside the service details the page still needs.
    expect(response.status).toBe(200);
    expect(response.body.data.eligibility.allowed).toBe(false);
    expect(response.body.data.eligibility.code).toBe("OUTSIDE_SERVICE_AREA");
    // Emptied, because offering a time the write path will refuse is the one
    // outcome the matching gates exist to prevent.
    expect(response.body.data.days).toEqual([]);
    expect(response.body.data.totalSlots).toBe(0);
  });

  it("refuses the booking itself with 409 OUTSIDE_SERVICE_AREA", async () => {
    // Crafted directly rather than taken from the slot list, which returns none —
    // this is the case of a client POSTing past a list that never offered it.
    const local = await fetchSlots(sameCountryClient.agent, gbProvider.id, domesticService.id);
    expect(local.length).toBeGreaterThan(0);

    const response = await usClient.agent
      .post("/api/bookings")
      .send({ serviceId: domesticService.id, startsAt: local[0].startsAt });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("OUTSIDE_SERVICE_AREA");
    expect(response.body.details.providerCountry).toBe("GB");
    expect(response.body.details.clientCountry).toBe("US");
  });

  it("allows a client in the same country", async () => {
    const slots = await fetchSlots(sameCountryClient.agent, gbProvider.id, domesticService.id);
    const response = await sameCountryClient.agent
      .post("/api/bookings")
      .send({ serviceId: domesticService.id, startsAt: slots[0].startsAt });

    expect(response.status).toBe(201);
    expect(response.body.data.service.bookingScope).toBe("domestic");
  });

  it("allows an anonymous caller to browse the slots, since they have no country", async () => {
    // The directory has to keep working for someone who has not signed in. What
    // they are told is the restriction itself, via `service.bookingScope`; whether
    // it applies to them is only answerable once they have an account.
    const response = await guest().get(
      `/api/providers/${gbProvider.id}/slots?serviceId=${domesticService.id}` +
        `&from=${futureRange().from}&to=${futureRange().to}`
    );

    expect(response.status).toBe(200);
    expect(response.body.data.eligibility.allowed).toBe(true);
    expect(response.body.data.service.bookingScope).toBe("domestic");
  });
});

describe("rescheduling is gated the same way as booking", () => {
  it("refuses a client's move once their country puts them outside the area", async () => {
    // Booked while the service was international, then the provider narrows it.
    // The client's existing appointment survives — nothing retroactively cancels
    // it — but they may not move it themselves any more.
    const service = await createService(gbProvider, {
      service_name: "Narrowing Later",
      deliveryType: "virtual",
    });
    const slots = await fetchSlots(usClient.agent, gbProvider.id, service.id);
    const booked = await usClient.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: slots[0].startsAt });
    expect(booked.status).toBe(201);

    const narrowed = await gbProvider.agent
      .put(`/api/services/${service.id}`)
      .send({ bookingScope: "domestic" });
    expect(narrowed.status).toBe(200);

    // Still readable — the appointment was not destroyed by the change.
    const still = await usClient.agent.get(`/api/bookings/${booked.body.data.id}`);
    expect(still.status).toBe(200);
    expect(["booked", "rescheduled"]).toContain(still.body.data.status);

    const moved = await usClient.agent
      .post(`/api/bookings/${booked.body.data.id}/reschedule`)
      .send({ startsAt: slots[2].startsAt });

    expect(moved.status).toBe(409);
    expect(moved.body.code).toBe("OUTSIDE_SERVICE_AREA");
  });

  it("still lets the provider move it", async () => {
    // The asymmetry: a provider moving somebody else's appointment is not
    // entering a new arrangement on their behalf, and the alternative to moving
    // an out-of-area booking would be destroying it.
    const service = await createService(gbProvider, {
      service_name: "Provider Can Move",
      deliveryType: "virtual",
    });
    const slots = await fetchSlots(usClient.agent, gbProvider.id, service.id);
    const booked = await usClient.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: slots[0].startsAt });
    expect(booked.status).toBe(201);

    await gbProvider.agent.put(`/api/services/${service.id}`).send({ bookingScope: "domestic" });

    const moved = await gbProvider.agent
      .post(`/api/bookings/${booked.body.data.id}/reschedule`)
      .send({ startsAt: slots[2].startsAt, reason: "Clinic rota changed" });

    expect(moved.status).toBe(200);
  });
});

describe("the venue reaches the client", () => {
  it("carries the provider's address on an in-person service and booking", async () => {
    const service = await createService(sameCountryProvider, {
      service_name: "At The Clinic",
      deliveryType: "in_person",
    });

    expect(service.deliveryType).toBe("in_person");
    expect(service.location.address).toContain("Test Street");
    expect(service.location.country).toBe("GB");

    const slots = await fetchSlots(sameCountryClient.agent, sameCountryProvider.id, service.id);
    const booked = await sameCountryClient.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: slots[0].startsAt });

    expect(booked.status).toBe(201);
    expect(booked.body.data.service.deliveryType).toBe("in_person");
    expect(booked.body.data.service.location.address).toContain("Test Street");
  });

  it("carries no address on a virtual one, even though the provider has one", () => {
    // An online session does not happen at the provider's clinic, and printing
    // the clinic's address beside it would be telling the client to travel
    // somewhere they should not go.
    return createService(sameCountryProvider, {
      service_name: "Online From The Clinic",
      deliveryType: "virtual",
    }).then((service) => {
      expect(service.location).toBeNull();
    });
  });
});

describe("the directory filters on what it says it filters on", () => {
  it("narrows to providers offering the given delivery type", async () => {
    const virtualOnly = await createUser({
      role: "provider",
      label: "locvirtonly",
      country: "GB",
      businessAddress: "",
    });
    await createService(virtualOnly, { service_name: "Virtual Thing", deliveryType: "virtual" });

    const response = await guest().get("/api/providers?deliveryType=virtual&limit=100");
    expect(response.status).toBe(200);

    const ids = response.body.data.providers.map((p) => p.id);
    expect(ids).toContain(virtualOnly.id);
    // Every provider returned must actually offer something virtual.
    for (const provider of response.body.data.providers) {
      expect(provider.deliveryTypes).toContain("virtual");
    }
  });

  it("reports delivery types and scopes as sets, because a provider can offer both", async () => {
    const mixed = await createUser({
      role: "provider",
      label: "locmixed",
      country: "GB",
      businessAddress: "1 Mixed Street",
    });
    await createService(mixed, { service_name: "In Person", deliveryType: "in_person" });
    await createService(mixed, { service_name: "Online", deliveryType: "virtual" });

    const response = await guest().get("/api/providers?limit=100");
    const card = response.body.data.providers.find((p) => p.id === mixed.id);

    expect(card.deliveryTypes).toEqual(["in_person", "virtual"]);
    // A single value per provider could not express this, which is why the
    // payload carries arrays.
    const inPerson = await guest().get("/api/providers?deliveryType=in_person&limit=100");
    const virtual = await guest().get("/api/providers?deliveryType=virtual&limit=100");
    expect(inPerson.body.data.providers.map((p) => p.id)).toContain(mixed.id);
    expect(virtual.body.data.providers.map((p) => p.id)).toContain(mixed.id);
  });

  it("narrows by booking scope", async () => {
    const response = await guest().get("/api/providers?scope=domestic&limit=100");
    expect(response.status).toBe(200);
    for (const provider of response.body.data.providers) {
      expect(provider.bookingScopes).toContain("domestic");
    }
  });

  it("rejects an unrecognised filter value rather than ignoring it", async () => {
    // Silently returning the whole directory would look like a filter that had
    // been applied — the failure the `limit` validation is already explicit
    // about refusing to repeat.
    for (const query of ["deliveryType=online", "scope=worldwide"]) {
      const response = await guest().get(`/api/providers?${query}`);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_FAILED");
    }
  });

  it("publishes the provider's country and address on the directory and the profile", async () => {
    const list = await guest().get("/api/providers?limit=100");
    const card = list.body.data.providers.find((p) => p.id === sameCountryProvider.id);
    expect(card.country).toBe("GB");
    expect(card.businessAddress).toContain("Test Street");

    const profile = await guest().get(`/api/providers/${sameCountryProvider.id}`);
    expect(profile.body.data.country).toBe("GB");
    expect(profile.body.data.businessAddress).toContain("Test Street");
  });
});

describe("country on the profile", () => {
  it("is inferred from the timezone when not stated", async () => {
    const inferred = await createUser({ role: "client", label: "locinfer", timezone: "Europe/Paris" });
    const me = await inferred.agent.get("/api/auth/me");

    expect(me.body.data.country).toBe("FR");
  });

  it("is null for a timezone that belongs to no country", async () => {
    const none = await createUser({ role: "client", label: "locutc", timezone: "UTC" });
    const me = await none.agent.get("/api/auth/me");

    expect(me.body.data.country).toBeNull();
  });

  it("can be corrected, and cleared", async () => {
    // Clearing has to be possible: the value is inferred for most accounts, so
    // someone whose inferred country is wrong needs a way to say "not this one"
    // as well as a way to correct it.
    const user = await createUser({ role: "client", label: "loccorrect", country: "US" });

    const corrected = await user.agent.patch("/api/auth/profile").send({ country: "ca" });
    expect(corrected.status).toBe(200);
    expect((await user.agent.get("/api/auth/me")).body.data.country).toBe("CA");

    const cleared = await user.agent.patch("/api/auth/profile").send({ country: "" });
    expect(cleared.status).toBe(200);
    expect((await user.agent.get("/api/auth/me")).body.data.country).toBeNull();
  });

  it("comes back on the update response, not just from /auth/me", async () => {
    // The auth context is replaced wholesale with whatever PATCH /auth/profile
    // returns, so a column missing from that RETURNING clause is silently
    // dropped from the signed-in user — and the profile form, which re-seeds
    // itself from the context, blanks the field the moment it is saved. That is
    // exactly what happened: both columns were added to the table and to
    // /auth/me and left out of this one response.
    const user = await createUser({
      role: "provider",
      label: "locreturning",
      country: "GB",
      businessAddress: "",
    });

    const saved = await user.agent
      .patch("/api/auth/profile")
      .send({ country: "IN", businessAddress: "9 Round Trip Road" });

    expect(saved.status).toBe(200);
    // Trimmed, too: CHAR(2) is blank-padded, and a padded "IN " matches no
    // option in a <select> so the control blanks just as surely.
    expect(saved.body.data.country).toBe("IN");
    expect(saved.body.data.business_address).toBe("9 Round Trip Road");
  });

  it("rejects a country code that is not a country", async () => {
    const user = await createUser({ role: "client", label: "locbadcountry", country: "US" });

    for (const country of ["ZZ", "XX", "GBR", "1"]) {
      const response = await user.agent.patch("/api/auth/profile").send({ country });
      expect(response.status).toBe(400);
      expect(response.body.details.some((d) => d.field === "country")).toBe(true);
    }
  });

  it("does not let a client set a business address", async () => {
    // Gated on the role read from the database, like `bio` and `qualifications`:
    // a client has no public page for one to appear on.
    const user = await createUser({ role: "client", label: "locclientaddr", country: "US" });
    await user.agent.patch("/api/auth/profile").send({ businessAddress: "1 Sneaky Street" });

    const me = await user.agent.get("/api/auth/me");
    expect(me.body.data.business_address).toBeNull();
  });
});

describe("the provider's health report names what is missing", () => {
  it("flags an in-person service whose provider has no address", async () => {
    const provider = await createUser({
      role: "provider",
      label: "lochealth",
      country: "GB",
      businessAddress: "1 Temporary Street",
    });
    await setWeeklyHours(provider);
    const service = await createService(provider, {
      service_name: "Needs An Address",
      deliveryType: "in_person",
    });

    // Cleared afterwards, which the API allows: a stale address on a public page
    // is worse than a missing one.
    await provider.agent.patch("/api/auth/profile").send({ businessAddress: "" });

    const health = await provider.agent.get("/api/availability/health");
    expect(health.status).toBe(200);

    const flagged = health.body.data.servicesMissingLocation.find(
      (entry) => entry.serviceId === service.id
    );
    expect(flagged).toBeTruthy();
    expect(flagged.missing).toEqual(["address"]);
    expect(health.body.data.providerLocation.hasAddress).toBe(false);
    expect(health.body.data.providerLocation.country).toBe("GB");
  });

  it("reports nothing for a fully configured provider", async () => {
    const health = await sameCountryProvider.agent.get("/api/availability/health");
    expect(health.body.data.servicesMissingLocation).toEqual([]);
  });
});
