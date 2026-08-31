/**
 * The wording of the after-the-fact booking messages.
 *
 * These are the only place a person is told "your appointment has moved", because
 * Slotly has no notifications table, no push and no email — so the assertions
 * worth having are about the *facts* surviving into the message: which
 * appointment, when, and where. A message that drops the venue is the bug this
 * file exists to catch, and the reschedule case is the one the requirement calls
 * out by name.
 */
import { describe, it, expect } from "vitest";
import { bookingNoticeBody, formatVenueLine, formatWhen } from "./bookingNotice";

const IN_PERSON = {
  deliveryType: "in_person",
  location: { address: "Unit 4, 118 Great Portland Street\nLondon W1W 6PP", country: "GB" },
};

const VIRTUAL_WITH_LINK = {
  deliveryType: "virtual",
  location: { meetingLink: "https://meet.example.test/room/abc" },
};

const VIRTUAL_NO_LINK = { deliveryType: "virtual", location: null };

describe("formatWhen", () => {
  it("states the moment rather than referring to it", () => {
    // Not "in 3 days": these messages may be read tomorrow, and a relative
    // phrase is the one thing a reader cannot act on.
    const when = formatWhen("2026-09-03T09:00:00.000Z", "Europe/London");

    expect(when).toBe("Thu 3 Sep at 10:00 AM");
  });

  it("renders in the reader's own zone, not the provider's", () => {
    const instant = "2026-09-03T09:00:00.000Z";

    expect(formatWhen(instant, "America/New_York")).toBe("Thu 3 Sep at 5:00 AM");
    expect(formatWhen(instant, "Asia/Kolkata")).toBe("Thu 3 Sep at 2:30 PM");
  });

  it("returns null rather than 'Invalid DateTime' when something is missing", () => {
    for (const [instant, zone] of [
      [null, "Europe/London"],
      ["2026-09-03T09:00:00.000Z", null],
      ["not-a-date", "Europe/London"],
      [undefined, undefined],
    ]) {
      expect(formatWhen(instant, zone)).toBeNull();
    }
  });
});

describe("formatVenueLine", () => {
  it("names the address on one line for an in-person appointment", () => {
    // Flattened because providers write an address across several lines, as they
    // would on an envelope, and a toast is not the place for four of them.
    const line = formatVenueLine(IN_PERSON);

    expect(line).toBe(
      "Where to meet: Unit 4, 118 Great Portland Street, London W1W 6PP"
    );
    expect(line).not.toContain("\n");
  });

  it("says a virtual appointment is virtual instead of going quiet", () => {
    expect(formatVenueLine(VIRTUAL_NO_LINK)).toBe(
      "Where to attend: Virtual meeting with the provider"
    );
  });

  it("includes the meeting link when there is one", () => {
    expect(formatVenueLine(VIRTUAL_WITH_LINK)).toContain("https://meet.example.test/room/abc");
  });

  it("returns null for an in-person appointment with no address on file", () => {
    // A real gap rather than something to invent wording for, so the caller drops
    // the line instead of printing a heading with nothing after it.
    expect(formatVenueLine({ deliveryType: "in_person", location: null })).toBeNull();
  });
});

describe("bookingNoticeBody", () => {
  const booking = (service) => ({
    startsAt: "2026-09-03T09:00:00.000Z",
    service: { name: "Initial Assessment", ...service },
  });

  it("carries the appointment, the time and the venue", () => {
    // The three facts the requirement asks a reschedule message to include; the
    // service name and time are the first line, the venue the second.
    const body = bookingNoticeBody({
      booking: booking(IN_PERSON),
      viewerZone: "America/New_York",
    });

    expect(body).toBe(
      "Initial Assessment — Thu 3 Sep at 5:00 AM\n" +
        "Where to meet: Unit 4, 118 Great Portland Street, London W1W 6PP"
    );
  });

  it("carries the meeting link for a virtual appointment", () => {
    const body = bookingNoticeBody({
      booking: booking(VIRTUAL_WITH_LINK),
      viewerZone: "Europe/London",
    });

    expect(body).toContain("Initial Assessment — Thu 3 Sep at 10:00 AM");
    expect(body).toContain("Where to attend");
    expect(body).toContain("https://meet.example.test/room/abc");
  });

  it("still names the venue when a virtual appointment has no link", () => {
    const body = bookingNoticeBody({
      booking: booking(VIRTUAL_NO_LINK),
      viewerZone: "Europe/London",
    });

    expect(body).toContain("Virtual meeting with the provider");
  });

  it("drops the parts it has no data for rather than leaving holes", () => {
    // A payload from an older server, or a booking whose provider has no address:
    // a shorter message, not one with "undefined" in it.
    const partial = bookingNoticeBody({
      booking: { startsAt: null, service: { name: "Just A Name" } },
      viewerZone: "Europe/London",
    });

    expect(partial).toBe("Just A Name");

    const noZone = bookingNoticeBody({ booking: booking(IN_PERSON), viewerZone: null });
    expect(noZone).toContain("Initial Assessment");
    expect(noZone).not.toContain("undefined");
    expect(noZone).not.toContain("Invalid");
  });

  it("returns an empty string for no booking, so callers can fall back", () => {
    expect(bookingNoticeBody({ booking: null, viewerZone: "Europe/London" })).toBe("");
  });
});
