/**
 * The country picker's data and its default.
 *
 * The Europe/London case below is the one that matters. Resolving a timezone to
 * a country by requiring the zone to belong to *exactly one* looks like the safe
 * reading and silently drops the United Kingdom, because the Crown dependencies
 * share Europe/London — so every London provider would have got no default at
 * all. The backend made that mistake first and its own backfill left Priya with
 * a null country; this file pins the corrected behaviour on the client so the
 * two stay in step.
 */
import { describe, it, expect } from "vitest";
import { buildCountryOptions, countryFromTimezone } from "./countries";

describe("buildCountryOptions", () => {
  const options = buildCountryOptions();

  it("lists every country, not a shortlist", () => {
    // Unlike a currency, a country is a fact with one right answer, and a list
    // that omits someone's leaves them unable to state it — which for a domestic
    // service means unable to be told whether they may book.
    expect(options.length).toBeGreaterThan(200);
  });

  it("carries a code and a human name for each", () => {
    for (const option of options) {
      expect(option.code).toMatch(/^[A-Z]{2}$/);
      expect(option.name).toBeTruthy();
      expect(option.name).not.toBe(option.code);
    }
  });

  it("is sorted by name", () => {
    const names = options.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("has no duplicate codes", () => {
    expect(new Set(options.map((o) => o.code)).size).toBe(options.length);
  });
});

describe("countryFromTimezone", () => {
  it("resolves the demo accounts' zones", () => {
    expect(countryFromTimezone("Europe/London")).toBe("GB");
    expect(countryFromTimezone("Asia/Kolkata")).toBe("IN");
    expect(countryFromTimezone("America/New_York")).toBe("US");
  });

  it("resolves a zone shared with the Crown dependencies to the primary country", () => {
    // Europe/London lists GB, GG, IM and JE. "Exactly one country" would skip it
    // entirely; the library's own primary-country resolution is the right answer
    // and is what the server's `countryForTimezone` uses too.
    expect(countryFromTimezone("Europe/London")).toBe("GB");
  });

  it("follows the same timezone alias the rest of the app does", () => {
    // The picker keys its list on the historical spelling, so a stored
    // "Asia/Calcutta" has to resolve as well as "Asia/Kolkata" does.
    expect(countryFromTimezone("Asia/Calcutta")).toBe("IN");
  });

  it("returns null for a zone belonging to no country", () => {
    // A real answer rather than a failure: UTC is not a country, and the whole
    // feature is built to tolerate a null country.
    expect(countryFromTimezone("UTC")).toBeNull();
  });

  it("returns null for nonsense rather than throwing", () => {
    for (const input of ["", "Mars/Olympus_Mons", null, undefined, 7]) {
      expect(countryFromTimezone(input)).toBeNull();
    }
  });
});
