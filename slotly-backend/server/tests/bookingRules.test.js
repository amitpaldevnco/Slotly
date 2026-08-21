/**
 * Tests for the booking policy rules: the cancellation cutoff, the legal status
 * transitions, and the two-zone rendering every booking payload carries.
 *
 * The cutoff tests deliberately probe the *exact* boundary — one second before,
 * exactly on it, one second after — rather than a comfortable "well before" and
 * "well after". An off-by-one in a cutoff is the kind of bug that only ever
 * shows up as a customer complaint, and it is only catchable by pinning the
 * boundary itself. That is possible here because `evaluateClientCancellation`
 * takes `now` as a parameter instead of reading the system clock.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateClientCancellation,
  evaluateProviderTransition,
  describeInstant,
  describeRescheduleTerms,
  summariseAcceptedTerms,
  BOOKING_STATUSES,
  ACTIVE_STATUSES,
  TIME_FORMAT,
} from "../services/bookingRules.js";

/**
 * A booking fixture.
 *
 * The scenario throughout is the brief's: a 12-hour cutoff on an appointment at
 * Friday 10:00, which closes cancellation at Thursday 22:00.
 */
function booking(overrides = {}) {
  return {
    starts_at: "2025-06-06T10:00:00.000Z", // Friday 10:00 UTC
    status: "booked",
    cancellation_cutoff_hours_snapshot: 12,
    ...overrides,
  };
}

/** Thursday 22:00 UTC — the deadline implied by the fixture above. */
const DEADLINE = "2025-06-05T22:00:00.000Z";

describe("client cancellation — the cutoff boundary", () => {
  it("allows a cancellation one second before the deadline", () => {
    const verdict = evaluateClientCancellation(booking(), new Date("2025-06-05T21:59:59.000Z"));
    expect(verdict.allowed).toBe(true);
    expect(verdict.code).toBeNull();
  });

  it("allows a cancellation exactly on the deadline", () => {
    // The rule is "before Thursday 22:00", implemented as `now > deadline`
    // rejects. Landing exactly on the boundary is therefore still allowed — the
    // inclusive/exclusive choice, pinned so it cannot drift unnoticed.
    const verdict = evaluateClientCancellation(booking(), new Date(DEADLINE));
    expect(verdict.allowed).toBe(true);
  });

  it("refuses a cancellation one second after the deadline", () => {
    const verdict = evaluateClientCancellation(booking(), new Date("2025-06-05T22:00:01.000Z"));
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe("CANCELLATION_WINDOW_CLOSED");
  });

  it("reports the deadline even when it refuses, so the UI can explain why", () => {
    const verdict = evaluateClientCancellation(booking(), new Date("2025-06-06T09:00:00.000Z"));
    expect(verdict.allowed).toBe(false);
    expect(verdict.deadline.toISOString()).toBe(DEADLINE);
    expect(verdict.reason).toMatch(/12 hours/);
  });

  it("computes the deadline from the snapshot, not the provider's current setting", () => {
    // The point of snapshotting: a provider tightening their policy from 12 to
    // 48 hours must not retroactively strand someone who booked under the old
    // one. The booking carries 12, so 24 hours out is still cancellable even
    // though a 48-hour policy would forbid it.
    const verdict = evaluateClientCancellation(
      booking({ cancellation_cutoff_hours_snapshot: 12 }),
      new Date("2025-06-05T10:00:00.000Z") // 24 hours before the appointment
    );
    expect(verdict.allowed).toBe(true);
  });

  it("honours a stricter snapshot on an otherwise identical booking", () => {
    // The mirror image, so the test above cannot pass for the wrong reason.
    const verdict = evaluateClientCancellation(
      booking({ cancellation_cutoff_hours_snapshot: 48 }),
      new Date("2025-06-05T10:00:00.000Z")
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe("CANCELLATION_WINDOW_CLOSED");
  });

  it("treats a zero-hour cutoff as 'any time until it starts'", () => {
    const justBefore = evaluateClientCancellation(
      booking({ cancellation_cutoff_hours_snapshot: 0 }),
      new Date("2025-06-06T09:59:59.000Z")
    );
    const justAfter = evaluateClientCancellation(
      booking({ cancellation_cutoff_hours_snapshot: 0 }),
      new Date("2025-06-06T10:00:01.000Z")
    );

    expect(justBefore.allowed).toBe(true);
    expect(justAfter.allowed).toBe(false);
    expect(justAfter.reason).toMatch(/already started/);
  });

  it("uses the singular for a one-hour cutoff", () => {
    const verdict = evaluateClientCancellation(
      booking({ cancellation_cutoff_hours_snapshot: 1 }),
      new Date("2025-06-06T09:30:00.000Z")
    );
    expect(verdict.reason).toMatch(/1 hour before/);
    expect(verdict.reason).not.toMatch(/hours/);
  });

  it("refuses to cancel a booking that is not active any more", () => {
    for (const status of ["cancelled", "completed", "no_show"]) {
      const verdict = evaluateClientCancellation(booking({ status }), new Date("2025-06-01T00:00:00.000Z"));
      expect(verdict.allowed).toBe(false);
      expect(verdict.code).toBe("BOOKING_NOT_ACTIVE");
    }
  });

  it("allows cancelling a rescheduled booking, which is still active", () => {
    const verdict = evaluateClientCancellation(
      booking({ status: "rescheduled" }),
      new Date("2025-06-01T00:00:00.000Z")
    );
    expect(verdict.allowed).toBe(true);
  });

  it("measures the cutoff from the instant, so the client's zone is irrelevant", () => {
    // The deadline is an absolute moment. A client in Kolkata and a client in
    // Los Angeles booked into the same appointment lose the right to cancel at
    // the same instant, even though their clocks read differently.
    const at = new Date(DEADLINE);
    expect(evaluateClientCancellation(booking(), at).allowed).toBe(true);
    expect(evaluateClientCancellation(booking(), new Date(at.getTime() + 1000)).allowed).toBe(false);
  });
});

describe("provider status transitions", () => {
  const beforeStart = new Date("2025-06-06T09:00:00.000Z");
  const afterStart = new Date("2025-06-06T10:30:00.000Z");

  it("lets a provider cancel at any time, including well before the client's cutoff", () => {
    const verdict = evaluateProviderTransition(booking(), "cancelled", new Date("2025-06-06T09:59:00.000Z"));
    expect(verdict.allowed).toBe(true);
  });

  it("refuses completed or no-show before the appointment has started", () => {
    for (const status of ["completed", "no_show"]) {
      const verdict = evaluateProviderTransition(booking(), status, beforeStart);
      expect(verdict.allowed).toBe(false);
      expect(verdict.code).toBe("APPOINTMENT_NOT_STARTED");
    }
  });

  it("allows completed and no-show once it has started", () => {
    for (const status of ["completed", "no_show"]) {
      expect(evaluateProviderTransition(booking(), status, afterStart).allowed).toBe(true);
    }
  });

  it("refuses any transition out of a terminal status", () => {
    for (const from of ["cancelled", "completed", "no_show"]) {
      const verdict = evaluateProviderTransition(booking({ status: from }), "completed", afterStart);
      expect(verdict.allowed).toBe(false);
      expect(verdict.code).toBe("BOOKING_NOT_ACTIVE");
    }
  });

  it("rejects a status that is not in the schema's list", () => {
    const verdict = evaluateProviderTransition(booking(), "refunded", afterStart);
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe("INVALID_STATUS");
  });

  it("rejects moving an active booking back to 'booked'", () => {
    const verdict = evaluateProviderTransition(booking({ status: "rescheduled" }), "booked", afterStart);
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe("INVALID_TRANSITION");
  });

  it("keeps its status list in step with the schema's CHECK constraint", () => {
    expect(BOOKING_STATUSES).toEqual(["booked", "rescheduled", "cancelled", "completed", "no_show"]);
    expect(ACTIVE_STATUSES).toEqual(["booked", "rescheduled"]);
  });
});

describe("describeInstant — rendering one moment in two zones", () => {
  it("gives both parties their own reading of the same instant", () => {
    const described = describeInstant("2025-06-02T13:00:00.000Z", "Asia/Kolkata", "America/New_York");

    expect(described.utc).toBe("2025-06-02T13:00:00.000Z");
    expect(described.client.timezone).toBe("Asia/Kolkata");
    expect(described.client.formatted).toBe("2 Jun 2025, 6:30 PM");
    expect(described.provider.timezone).toBe("America/New_York");
    expect(described.provider.formatted).toBe("2 Jun 2025, 9:00 AM");
  });

  it("crosses the date line correctly — the two parties are on different dates", () => {
    // 16:00 Monday in New York is 01:30 Tuesday in Kolkata. A confirmation that
    // showed only one date would be wrong for one of the two people reading it,
    // which is why every booking payload carries both.
    const described = describeInstant("2025-06-02T20:00:00.000Z", "Asia/Kolkata", "America/New_York");

    expect(described.provider.formatted).toBe("2 Jun 2025, 4:00 PM");
    expect(described.client.formatted).toBe("3 Jun 2025, 1:30 AM");
  });

  it("labels the offset, including a half-hour one", () => {
    const described = describeInstant("2025-06-02T13:00:00.000Z", "Asia/Kolkata", "Europe/London");
    expect(described.client.offset).toBe("GMT+5:30");
    expect(described.provider.offset).toBe("GMT+1"); // BST in June
  });

  it("shows the provider's offset changing across their DST boundary", () => {
    const winter = describeInstant("2025-01-06T12:00:00.000Z", "Asia/Kolkata", "Europe/London");
    const summer = describeInstant("2025-06-02T12:00:00.000Z", "Asia/Kolkata", "Europe/London");

    expect(winter.provider.offset).toBe("GMT"); // GMT
    expect(summer.provider.offset).toBe("GMT+1"); // BST
    // The client never observes DST, so their offset is unchanged.
    expect(winter.client.offset).toBe("GMT+5:30");
    expect(summer.client.offset).toBe("GMT+5:30");
  });

  it("falls back to UTC rather than emitting 'Invalid DateTime' for an unknown zone", () => {
    const described = describeInstant("2025-06-02T13:00:00.000Z", "Mars/Olympus", "Europe/London");
    expect(described.client.timezone).toBe("UTC");
    expect(described.client.formatted).not.toMatch(/Invalid/);
  });

  it("uses the one clock format shared with the frontend", () => {
    expect(TIME_FORMAT).toBe("h:mm a");
  });
});

// ---------------------------------------------------------------------------
/**
 * The reschedule-terms rule, at the level the controller cannot show.
 *
 * `api.lifecycle.test.js` proves the endpoint asks the client and writes the
 * agreed figures. What it cannot pin down cheaply is the shape of the rule
 * itself: which party is asked, what "applied" resolves to in each of the four
 * combinations of changed/accepted, and that a NUMERIC price arriving from
 * PostgreSQL as the string "30.00" is not read as different from 30.
 */
describe("reschedule terms", () => {
  const held = { price_snapshot: "30.00", duration_snapshot: 60 };
  const unchanged = { price: "30.00", duration: 60 };
  const dearer = { price: "40.00", duration: 60 };
  const shorter = { price: "30.00", duration: 30 };

  it("reads a NUMERIC string and an equal number as the same price", () => {
    const terms = describeRescheduleTerms({
      booking: held,
      service: unchanged,
      actorRole: "client",
    });

    expect(terms.changed).toBe(false);
    expect(terms.requiresAcceptance).toBe(false);
    expect(terms.applied).toEqual({ price: 30, duration: 60 });
  });

  it("asks the client, and only once, per thing that moved", () => {
    const priceOnly = describeRescheduleTerms({
      booking: held,
      service: dearer,
      actorRole: "client",
    });
    expect(priceOnly.price.changed).toBe(true);
    expect(priceOnly.duration.changed).toBe(false);
    expect(priceOnly.requiresAcceptance).toBe(true);

    const durationOnly = describeRescheduleTerms({
      booking: held,
      service: shorter,
      actorRole: "client",
    });
    expect(durationOnly.price.changed).toBe(false);
    expect(durationOnly.duration.changed).toBe(true);
    // A duration change alone still has to be agreed: the client is being asked
    // to attend for a different length of time than they booked.
    expect(durationOnly.requiresAcceptance).toBe(true);
  });

  it("holds the old terms until the client accepts, then applies the new ones", () => {
    const pending = describeRescheduleTerms({ booking: held, service: dearer, actorRole: "client" });
    // The refused case must still name a usable pair — the controller reads
    // `applied` before it knows whether it will refuse.
    expect(pending.applied).toEqual({ price: 30, duration: 60 });
    expect(pending.repriced).toBe(false);

    const agreed = describeRescheduleTerms({
      booking: held,
      service: dearer,
      actorRole: "client",
      accepted: true,
    });
    expect(agreed.requiresAcceptance).toBe(false);
    expect(agreed.applied).toEqual({ price: 40, duration: 60 });
    expect(agreed.repriced).toBe(true);
  });

  it("never asks the provider, and never lets them apply new terms", () => {
    // Including when they claim acceptance: consent is not theirs to give, so
    // `accepted` is simply not consulted on this branch.
    for (const accepted of [false, true]) {
      const terms = describeRescheduleTerms({
        booking: held,
        service: { price: "40.00", duration: 30 },
        actorRole: "provider",
        accepted,
      });

      expect(terms.changed).toBe(true);
      expect(terms.requiresAcceptance).toBe(false);
      expect(terms.repriced).toBe(false);
      expect(terms.applied).toEqual({ price: 30, duration: 60 });
    }
  });

  it("treats an unreadable current value as nothing to agree to", () => {
    // The service row was not joined, or carried something unusable. Demanding
    // acceptance of terms nobody can name would strand the booking.
    const terms = describeRescheduleTerms({
      booking: held,
      service: { price: undefined, duration: undefined },
      actorRole: "client",
    });

    expect(terms.changed).toBe(false);
    expect(terms.requiresAcceptance).toBe(false);
    expect(terms.applied).toEqual({ price: 30, duration: 60 });
  });

  it("summarises only what was actually agreed, with the currency code", () => {
    const both = describeRescheduleTerms({
      booking: held,
      service: { price: "40.00", duration: 30 },
      actorRole: "client",
      accepted: true,
    });

    const line = summariseAcceptedTerms(both, "GBP");
    expect(line).toContain("GBP 30");
    expect(line).toContain("GBP 40");
    expect(line).toContain("60 → 30 min");

    // Nothing agreed, nothing to record — so the caller can `||` it away rather
    // than writing an empty sentence into the audit trail.
    const none = describeRescheduleTerms({
      booking: held,
      service: unchanged,
      actorRole: "client",
      accepted: true,
    });
    expect(summariseAcceptedTerms(none, "GBP")).toBeNull();
  });
});
