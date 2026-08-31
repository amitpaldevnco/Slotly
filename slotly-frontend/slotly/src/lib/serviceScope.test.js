/**
 * The client's copy of the service-area rule.
 *
 * `judgeEligibility` exists to choose a *sentence*, not to decide anything — the
 * API re-checks every booking against the row it is writing. That makes the one
 * property worth testing hardest a slightly unusual one: it has to be
 * **permissive in exactly the same places the server is**. A UI stricter than the
 * server hides a service the client could have booked; a UI looser than the
 * server sends them into a 409. So the unknown-country cases below mirror
 * `server/tests/bookingScope.test.js` deliberately, and the two files should be
 * changed together or not at all.
 */
import { describe, it, expect } from "vitest";
import {
  judgeEligibility,
  describeLocation,
  VIRTUAL_LOCATION_TEXT,
  isInPerson,
  isDomestic,
  deliveryLabel,
  scopeLabel,
  deliveryIcon,
  scopeIcon,
  normaliseCountryCode,
  countryLabel,
  DELIVERY_TYPES,
  BOOKING_SCOPES,
  DELIVERY_OPTIONS,
  SCOPE_OPTIONS,
  DELIVERY_FILTER_OPTIONS,
  SCOPE_FILTER_OPTIONS,
} from "./serviceScope";

describe("judgeEligibility", () => {
  const domestic = { bookingScope: "domestic" };

  it("passes any international service", () => {
    expect(
      judgeEligibility({
        service: { bookingScope: "international" },
        clientCountry: "US",
        providerCountry: "GB",
      })
    ).toEqual({ eligible: true, reason: null });
  });

  it("passes a domestic service when the countries match", () => {
    const verdict = judgeEligibility({
      service: domestic,
      clientCountry: "GB",
      providerCountry: "GB",
    });
    expect(verdict.eligible).toBe(true);
  });

  it("refuses across a border and names both countries in prose", () => {
    const verdict = judgeEligibility({
      service: domestic,
      clientCountry: "US",
      providerCountry: "GB",
    });

    expect(verdict.eligible).toBe(false);
    // Country *names*, not codes: this string is read by a person, and "Only
    // available to clients in GB" asks them to decode it.
    expect(verdict.reason).toContain(countryLabel("GB"));
    expect(verdict.reason).toContain(countryLabel("US"));
  });

  it("ignores case and CHAR(2) blank padding", () => {
    expect(
      judgeEligibility({ service: domestic, clientCountry: "gb ", providerCountry: " GB" }).eligible
    ).toBe(true);
  });

  describe("matches the server's permissiveness on an unknown country", () => {
    for (const [label, clientCountry, providerCountry] of [
      ["client has none", null, "GB"],
      ["provider has none", "US", null],
      ["neither has one", null, null],
      ["client's is empty", "", "GB"],
      ["client's is not a code", "nowhere", "GB"],
      ["client's is undefined", undefined, "GB"],
    ]) {
      it(label, () => {
        // Stricter here than on the server would hide a service the client could
        // actually have booked, which is the worse of the two failures — they
        // would never find out it was available.
        const verdict = judgeEligibility({ service: domestic, clientCountry, providerCountry });
        expect(verdict.eligible).toBe(true);
        expect(verdict.reason).toBeNull();
      });
    }
  });

  it("treats a service with no scope as unrestricted", () => {
    expect(
      judgeEligibility({ service: {}, clientCountry: "US", providerCountry: "GB" }).eligible
    ).toBe(true);
    expect(
      judgeEligibility({ service: null, clientCountry: "US", providerCountry: "GB" }).eligible
    ).toBe(true);
  });

  it("does not let delivery type decide who may book", () => {
    // The two axes are independent, and a UI that coupled them would show the
    // wrong sentence on a virtual-but-domestic service.
    expect(
      judgeEligibility({
        service: { deliveryType: "virtual", bookingScope: "domestic" },
        clientCountry: "US",
        providerCountry: "IN",
      }).eligible
    ).toBe(false);
  });
});

describe("reading a service's two settings", () => {
  it("defaults to the column defaults rather than to 'unknown'", () => {
    // Both columns are NOT NULL server-side, so an absent value means an older
    // payload — not a service whose delivery is genuinely undecided.
    expect(isInPerson({})).toBe(true);
    expect(isDomestic({})).toBe(false);
    expect(deliveryLabel(undefined)).toBe("In-Person");
    expect(scopeLabel(undefined)).toBe("International");
  });

  it("reads a stated value", () => {
    expect(isInPerson({ deliveryType: "virtual" })).toBe(false);
    expect(isDomestic({ bookingScope: "domestic" })).toBe(true);
    expect(deliveryLabel("virtual")).toBe("Virtual");
    expect(scopeLabel("domestic")).toBe("Domestic");
  });

  it("falls back rather than returning nothing for an unrecognised value", () => {
    expect(deliveryLabel("teleportation")).toBe("In-Person");
    expect(scopeLabel("galactic")).toBe("International");
    expect(deliveryIcon("teleportation")).toBeTruthy();
    expect(scopeIcon("galactic")).toBeTruthy();
  });
});

describe("the option lists stay in step with the canonical values", () => {
  it("covers every delivery type and scope, exactly once", () => {
    // A filter offering a value the server does not accept would 400, and one
    // missing a value would make those services unfindable.
    for (const options of [DELIVERY_OPTIONS, DELIVERY_FILTER_OPTIONS]) {
      expect(options.map((o) => o.value).sort()).toEqual([...DELIVERY_TYPES].sort());
    }
    for (const options of [SCOPE_OPTIONS, SCOPE_FILTER_OPTIONS]) {
      expect(options.map((o) => o.value).sort()).toEqual([...BOOKING_SCOPES].sort());
    }
  });

  it("gives the provider's form a hint and an icon on every option", () => {
    // The hint is the whole reason these are cards rather than bare radios: the
    // two choices change what the service *is*, and a four-word label does not
    // convey that.
    for (const option of [...DELIVERY_OPTIONS, ...SCOPE_OPTIONS]) {
      expect(option.label).toBeTruthy();
      expect(option.hint).toBeTruthy();
      expect(option.icon).toBeTruthy();
    }
  });

  it("words the client's filters differently from the provider's form", () => {
    // "Domestic" on a client's screen is ambiguous — domestic to whom? The
    // filter says what the provider decided without the reader having to work
    // out whose country is meant.
    const providerWords = SCOPE_OPTIONS.map((o) => o.label);
    const clientWords = SCOPE_FILTER_OPTIONS.map((o) => o.label);
    expect(clientWords).not.toEqual(providerWords);
    expect(clientWords.join(" ")).toMatch(/country/i);
  });
});

describe("normaliseCountryCode", () => {
  it("accepts a two-letter code in any case, with padding", () => {
    for (const input of ["GB", "gb", " gb ", "Gb"]) {
      expect(normaliseCountryCode(input)).toBe("GB");
    }
  });

  it("rejects anything that is not a two-letter code", () => {
    for (const input of ["GBR", "G", "", "  ", "1B", null, undefined, 7, {}]) {
      expect(normaliseCountryCode(input)).toBeNull();
    }
  });
});

describe("countryLabel", () => {
  it("renders a country name for a code", () => {
    // Via Intl, so it is in the reader's own language — the same reasoning
    // `lib/currencies.js` applies to symbols.
    expect(countryLabel("GB")).toMatch(/kingdom/i);
    expect(countryLabel("IN")).toMatch(/india/i);
  });

  it("returns an empty string for no code, so it can be rendered unguarded", () => {
    expect(countryLabel(null)).toBe("");
    expect(countryLabel("")).toBe("");
    expect(countryLabel("nonsense")).toBe("");
  });
});

describe("describeLocation", () => {
  it("answers the question for a virtual appointment instead of going quiet", () => {
    // The bug this exists to prevent: a virtual appointment has no address by
    // design, and the venue row used to be hidden entirely on one — so the page
    // a client opens on the day said "Virtual" and then nothing.
    const venue = describeLocation({ deliveryType: "virtual" });

    expect(venue.isVirtual).toBe(true);
    expect(venue.term).toBe("Where to attend");
    expect(venue.text).toBe(VIRTUAL_LOCATION_TEXT);
    expect(venue.text).toMatch(/virtual meeting/i);
    expect(venue.address).toBeNull();
  });

  it("names the address for an in-person appointment", () => {
    const venue = describeLocation({
      deliveryType: "in_person",
      location: { address: "Unit 4, 118 Great Portland Street\nLondon W1W 6PP", country: "GB" },
    });

    expect(venue.isVirtual).toBe(false);
    expect(venue.term).toBe("Where to meet");
    expect(venue.address).toContain("Great Portland Street");
    expect(venue.text).toBe(venue.address);
  });

  it("uses different verbs for the two, so neither reads as the other", () => {
    // "Where to meet" is somewhere to travel to; "Where to attend" is something
    // to join. A single "Where" for both made a virtual session read like a
    // venue whose address had gone missing.
    const meet = describeLocation({ deliveryType: "in_person", location: { address: "x" } });
    const attend = describeLocation({ deliveryType: "virtual" });

    expect(meet.term).not.toBe(attend.term);
  });

  it("returns no text for an in-person appointment with no address on file", () => {
    // A real gap rather than something to invent a sentence for: the provider is
    // told about it by their own availability health report, and the caller
    // renders nothing. Asserted so a future default cannot quietly paper over it.
    for (const service of [
      { deliveryType: "in_person", location: null },
      { deliveryType: "in_person" },
      null,
      undefined,
    ]) {
      expect(describeLocation(service).text).toBeNull();
    }
  });

  it("treats an absent delivery type as in-person, matching the column default", () => {
    expect(describeLocation({ location: { address: "x" } }).isVirtual).toBe(false);
    expect(describeLocation({ location: { address: "x" } }).term).toBe("Where to meet");
  });

  it("surfaces a meeting link on a virtual appointment when one is stored", () => {
    // Nothing populates this yet — no column backs it. The conditional is here
    // so the screens already work the day one does, and so that the link is read
    // through `location` and not off six different screens.
    const venue = describeLocation({
      deliveryType: "virtual",
      location: { meetingLink: "https://example.test/room/abc" },
    });

    expect(venue.meetingLink).toBe("https://example.test/room/abc");
  });

  it("never surfaces a meeting link on an in-person appointment", () => {
    // A link on a journey is contradictory: it would tell the client they could
    // join from home an appointment they are expected to travel to.
    const venue = describeLocation({
      deliveryType: "in_person",
      location: { address: "x", meetingLink: "https://example.test/room/abc" },
    });

    expect(venue.meetingLink).toBeNull();
  });
});
