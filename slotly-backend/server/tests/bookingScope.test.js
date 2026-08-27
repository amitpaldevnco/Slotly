/**
 * The service-area and location rules, tested where they are decided.
 *
 * `services/bookingScope.js` is pure — no clock, no connection — for the same
 * reason `bookingRules.js` is: it lets the boundary cases be pinned down exactly
 * rather than approximated through a fixture. The HTTP-level consequences are in
 * `api.location.test.js`; what is checked here is the rule itself, and in
 * particular the two decisions that are easiest to get wrong later:
 *
 *   1. **An unknown country is allowed through.** Deliberate, and the reason it
 *      matters is that the opposite is the intuitive implementation: a null read
 *      as "not the provider's country" would refuse every account created before
 *      the column existed. There is a test for it so that reading it as a bug and
 *      "fixing" it fails the build.
 *   2. **Delivery type and booking scope are independent.** A virtual service can
 *      be domestic and an in-person one international. Deriving either from the
 *      other would make a real arrangement unrepresentable.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateBookingScope,
  checkProviderLocation,
  normaliseDeliveryType,
  normaliseBookingScope,
  isDeliveryType,
  isBookingScope,
  describeServiceScope,
  DELIVERY_TYPES,
  BOOKING_SCOPES,
} from "../services/bookingScope.js";

const domestic = { booking_scope: "domestic", delivery_type: "in_person" };
const international = { booking_scope: "international", delivery_type: "in_person" };

describe("evaluateBookingScope", () => {
  it("allows an international service from anywhere", () => {
    const verdict = evaluateBookingScope({
      service: international,
      clientCountry: "US",
      providerCountry: "GB",
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.code).toBeNull();
    expect(verdict.reason).toBeNull();
  });

  it("allows a domestic service when the countries match", () => {
    const verdict = evaluateBookingScope({
      service: domestic,
      clientCountry: "GB",
      providerCountry: "GB",
    });

    expect(verdict.allowed).toBe(true);
  });

  it("refuses a domestic service across a border, and names both countries", () => {
    const verdict = evaluateBookingScope({
      service: domestic,
      clientCountry: "US",
      providerCountry: "GB",
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe("OUTSIDE_SERVICE_AREA");
    // Both codes appear because the likeliest cause of a surprise refusal is a
    // client whose country was inferred wrongly from their timezone, and they can
    // only work that out if told which one the service wanted.
    expect(verdict.reason).toContain("GB");
    expect(verdict.reason).toContain("US");
    expect(verdict.providerCountry).toBe("GB");
    expect(verdict.clientCountry).toBe("US");
  });

  it("compares case-insensitively and ignores CHAR(2) blank padding", () => {
    // PostgreSQL pads CHAR(n) on the way out, so "GB" from a column can arrive
    // as "GB " and a naive === would refuse a client in the provider's own
    // country. This is the shape of bug that only appears against a real
    // database, which is why it is asserted here rather than left to chance.
    const verdict = evaluateBookingScope({
      service: domestic,
      clientCountry: "gb ",
      providerCountry: " GB",
    });

    expect(verdict.allowed).toBe(true);
  });

  describe("an unknown country is allowed through, on purpose", () => {
    for (const [label, clientCountry, providerCountry] of [
      ["the client has none", null, "GB"],
      ["the provider has none", "US", null],
      ["neither has one", null, null],
      ["the client's is an empty string", "", "GB"],
      ["the client's is not a country code", "ZZZ", "GB"],
    ]) {
      it(label, () => {
        const verdict = evaluateBookingScope({ service: domestic, clientCountry, providerCountry });

        // Refusing here would mean a restriction nobody chose, applied to people
        // who cannot see why: the column was added after the first release, so
        // every account predating it would have lost the ability to book.
        expect(verdict.allowed).toBe(true);
        expect(verdict.code).toBeNull();
      });
    }
  });

  it("treats a service with no scope at all as unrestricted", () => {
    // The column is NOT NULL with an 'international' default so this should not
    // arise, but the safe reading of a missing restriction is that there is no
    // restriction — not that everyone is refused.
    const verdict = evaluateBookingScope({
      service: {},
      clientCountry: "US",
      providerCountry: "GB",
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.scope).toBe("international");
  });

  it("does not let delivery type affect who may book", () => {
    // The two axes are independent. A virtual service is not automatically
    // international, and an in-person one is not automatically domestic.
    const virtualDomestic = { delivery_type: "virtual", booking_scope: "domestic" };
    const inPersonInternational = { delivery_type: "in_person", booking_scope: "international" };

    expect(
      evaluateBookingScope({ service: virtualDomestic, clientCountry: "US", providerCountry: "IN" })
        .allowed
    ).toBe(false);
    expect(
      evaluateBookingScope({
        service: inPersonInternational,
        clientCountry: "US",
        providerCountry: "GB",
      }).allowed
    ).toBe(true);
  });
});

describe("checkProviderLocation", () => {
  const withEverything = { country: "GB", business_address: "1 Somewhere Street" };

  it("passes a virtual, international service for a provider with nothing set", () => {
    // The case that makes the address genuinely optional: a provider who only
    // works online has no premises, and demanding one would be asking for a fact
    // that does not exist.
    const check = checkProviderLocation({
      deliveryType: "virtual",
      bookingScope: "international",
      provider: {},
    });

    expect(check.ok).toBe(true);
    expect(check.missing).toEqual([]);
  });

  it("requires an address for an in-person service", () => {
    const check = checkProviderLocation({
      deliveryType: "in_person",
      bookingScope: "international",
      provider: { country: "GB" },
    });

    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(["address"]);
  });

  it("requires a country for a domestic service", () => {
    // A country alone is enough here, because the only thing a domestic scope
    // does with it is compare it — no client has to travel to a country code.
    const check = checkProviderLocation({
      deliveryType: "virtual",
      bookingScope: "domestic",
      provider: { business_address: "1 Somewhere Street" },
    });

    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(["country"]);
  });

  it("reports both when an in-person domestic service has neither", () => {
    const check = checkProviderLocation({
      deliveryType: "in_person",
      bookingScope: "domestic",
      provider: {},
    });

    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(["address", "country"]);
  });

  it("does not accept whitespace as an address", () => {
    const check = checkProviderLocation({
      deliveryType: "in_person",
      bookingScope: "international",
      provider: { business_address: "   \n  " },
    });

    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(["address"]);
  });

  it("passes when everything it needs is present", () => {
    for (const deliveryType of DELIVERY_TYPES) {
      for (const bookingScope of BOOKING_SCOPES) {
        expect(
          checkProviderLocation({ deliveryType, bookingScope, provider: withEverything }).ok
        ).toBe(true);
      }
    }
  });
});

describe("normalising values off a multipart form", () => {
  it("accepts the spellings a form control might submit", () => {
    // The UI labels these "In-Person" and "Virtual", and a form that submitted
    // its own label should not fail validation over punctuation.
    for (const input of ["in_person", "IN_PERSON", " In-Person ", "in person"]) {
      expect(normaliseDeliveryType(input)).toBe("in_person");
    }
    for (const input of ["domestic", "DOMESTIC", " Domestic "]) {
      expect(normaliseBookingScope(input)).toBe("domestic");
    }
  });

  it("rejects anything else rather than guessing", () => {
    for (const input of ["online", "remote", "", "  ", null, undefined, 7, {}]) {
      expect(normaliseDeliveryType(input)).toBeNull();
    }
    for (const input of ["local", "worldwide", "", null, undefined, 7]) {
      expect(normaliseBookingScope(input)).toBeNull();
    }
  });

  it("guards agree with the canonical lists", () => {
    expect(DELIVERY_TYPES.every(isDeliveryType)).toBe(true);
    expect(BOOKING_SCOPES.every(isBookingScope)).toBe(true);
    expect(isDeliveryType("virtual ")).toBe(false);
    expect(isBookingScope("Domestic")).toBe(false);
  });
});

describe("describeServiceScope", () => {
  it("labels a service for server-composed prose", () => {
    expect(describeServiceScope({ delivery_type: "virtual", booking_scope: "domestic" })).toEqual({
      delivery: "Virtual",
      scope: "Domestic",
    });
  });

  it("falls back to the column defaults for a row that carries neither", () => {
    expect(describeServiceScope({})).toEqual({ delivery: "In-Person", scope: "International" });
  });
});
