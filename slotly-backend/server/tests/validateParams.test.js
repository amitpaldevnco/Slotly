/**
 * Tests for route-parameter validation.
 *
 * These exist because of a specific, reproduced defect: `GET /api/bookings/abc`
 * returned **500 SERVER_ERROR**. Nothing was injectable — every query is
 * parameterised, so the value travelled as data — but `WHERE id = $1` with a
 * non-numeric string makes PostgreSQL *raise* (SQLSTATE 22P02) rather than
 * return zero rows, and that exception unwound into the controller's catch
 * block. The API blamed itself for the caller's typo.
 *
 * `parseId` is deliberately stricter than `Number()`, and most of what follows
 * pins down the ways `Number()` would have said yes.
 */
import { describe, it, expect, vi } from "vitest";
import { parseId, numericParam } from "../middleware/validateParams.js";

describe("parseId", () => {
  it("accepts a plain positive integer", () => {
    expect(parseId("1")).toBe(1);
    expect(parseId("42")).toBe(42);
    expect(parseId("2147483647")).toBe(2_147_483_647); // largest int4
  });

  it("accepts a number as well as a string", () => {
    // Query-string values arrive as strings, but a JSON body can carry a real
    // number, and both reach the same helper.
    expect(parseId(7)).toBe(7);
  });

  it("rejects the value that caused the 500", () => {
    expect(parseId("abc")).toBeNull();
  });

  it("rejects a SQL-looking payload — as data, which is all it ever was", () => {
    expect(parseId("1;DROP TABLE users")).toBeNull();
    expect(parseId("1 OR 1=1")).toBeNull();
    expect(parseId("1'--")).toBeNull();
  });

  it("rejects everything Number() would have quietly accepted", () => {
    // Each of these is a real hazard rather than a hypothetical:
    //   ""        -> Number("") is 0, a valid-looking id that matches no row
    //   " 12 "    -> Number trims, so whitespace would silently work
    //   "1e999"   -> Number gives Infinity, which PostgreSQL then rejects
    //   "12.5"    -> a non-integer the integer column cannot hold
    //   "0x10"    -> Number reads hex; ids are decimal
    //   "+5"/"-1" -> signed forms that are not what a SERIAL ever looks like
    for (const bad of ["", " ", " 12 ", "12 ", "1e999", "1e3", "12.5", "0x10", "+5", "-1", "Infinity", "NaN"]) {
      expect(parseId(bad), `expected ${JSON.stringify(bad)} to be rejected`).toBeNull();
    }
  });

  it("rejects 0, which is never a SERIAL value", () => {
    expect(parseId("0")).toBeNull();
    expect(parseId("00")).toBeNull();
  });

  it("rejects an id past the int4 ceiling, which the column could not hold", () => {
    expect(parseId("2147483648")).toBeNull();
    expect(parseId("99999999999999999999")).toBeNull();
  });

  it("rejects non-scalar input rather than stringifying it", () => {
    // `{ id: { $gt: 0 } }` style payloads, and anything else that is not a
    // scalar, must not become "[object Object]" on the way to a query.
    for (const bad of [null, undefined, {}, [], ["1"], true, false]) {
      expect(parseId(bad)).toBeNull();
    }
  });
});

describe("numericParam middleware", () => {
  /** Minimal Express double: records the status and JSON body it was given. */
  function mockRes() {
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    return res;
  }

  it("passes a valid id through and calls next", () => {
    const req = { params: { id: "42" } };
    const res = mockRes();
    const next = vi.fn();

    numericParam("id")(req, res, next, "42");

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeNull();
  });

  it("replaces the string with a real number", () => {
    // This is not cosmetic. Ownership checks compare `booking.client_id === id`,
    // and `3 === "3"` is false — leaving the parameter as a string would turn a
    // legitimate owner into a 404.
    const req = { params: { id: "42" } };

    numericParam("id")(req, mockRes(), vi.fn(), "42");

    expect(req.params.id).toBe(42);
    expect(typeof req.params.id).toBe("number");
  });

  it("answers 400 VALIDATION_FAILED for a bad id, and does not call next", () => {
    const req = { params: { id: "abc" } };
    const res = mockRes();
    const next = vi.fn();

    numericParam("id")(req, res, next, "abc");

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(res.body.details).toEqual([
      { field: "id", message: "id must be a positive whole number" },
    ]);
  });

  it("names the parameter it rejected, so a client can fix the right field", () => {
    const res = mockRes();
    numericParam("serviceId")({ params: {} }, res, vi.fn(), "nope");

    expect(res.body.details[0].field).toBe("serviceId");
  });

  it("does not echo the rejected value back", () => {
    // It is attacker-controlled text; reflecting it invites the usual games,
    // and the field name alone is enough for a caller to correct itself.
    const res = mockRes();
    const payload = "<script>alert(1)</script>";
    numericParam("id")({ params: {} }, res, vi.fn(), payload);

    expect(JSON.stringify(res.body)).not.toContain(payload);
  });
});
