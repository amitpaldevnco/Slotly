/**
 * Slot generation engine.
 *
 * This module turns a provider's stored availability *rules* into concrete
 * bookable *slots* on real calendar dates. It is deliberately pure: it touches
 * no database, no clock and no request object, so every branch in it — and
 * especially the daylight-saving branches — can be tested directly.
 *
 * The pipeline, in order:
 *
 *   weekly rules  ──┐
 *                   ├─► expand onto local dates ─► union ─► subtract blocks
 *   'open' excs   ──┘                                          ▲
 *                                                              │
 *   'block' excs ──────────────────────────────────────────────┘
 *
 *   ─► clip to requested range ─► step through each window ─► drop slots that
 *      collide with existing bookings or fall in the past
 *
 * ## How timezones are handled
 *
 * Rules are wall-clock ("09:00") plus a weekday. They only become instants once
 * paired with a calendar date *and* the provider's IANA zone. That pairing is
 * done with `DateTime.fromObject({ year, month, day, hour, minute }, { zone })`
 * rather than by adding a duration to midnight. That distinction matters: adding
 * "9 hours" to local midnight gives the wrong instant on a day when the clock
 * jumps, whereas constructing the wall-clock reading directly asks Luxon "what
 * instant was 09:00 in this zone on this date?", which is the question the
 * provider actually means.
 *
 * ## Daylight-saving policy (documented in the README too)
 *
 * - A window keeps its *wall-clock* boundaries across a DST change. A provider
 *   available Mondays 09:00–17:00 is available 09:00–17:00 local before and
 *   after the clocks move, never 08:00 or 10:00.
 * - Because the boundaries are wall-clock, the window's *absolute* length
 *   changes on a transition day: on a spring-forward day whose gap falls inside
 *   the window it holds one hour less real time and therefore yields fewer
 *   slots; on a fall-back day it holds one hour more and yields one more slot.
 *   That is the correct reading of "I work 9 to 5" and the engine does not
 *   special-case it.
 * - If a boundary itself lands in a spring-forward gap (a 02:30 start in a zone
 *   that jumps 02:00→03:00), Luxon resolves it forward to the first instant that
 *   exists. If a boundary is ambiguous on a fall-back day (a 01:30 start that
 *   happens twice), Luxon resolves it to the *first* occurrence. Both are
 *   Luxon's documented defaults and both fail safe: the window never silently
 *   disappears.
 */
import { DateTime } from "luxon";

/** Widest date range the engine will expand in one call, in days. */
export const MAX_RANGE_DAYS = 62;

/** One minute in milliseconds — the unit every interval in this module uses. */
const MINUTE_MS = 60_000;

/** Grid spacing used when a service does not specify its own. */
export const DEFAULT_SLOT_INTERVAL = 30;

/**
 * Minimum number of full calendar days, in the provider's timezone, that must
 * stand between "now" and a client-bookable slot's calendar date.
 *
 * This is a business rule, not a technical one: a slot ten minutes from now is
 * a perfectly real future instant and would pass `hasInstantPassed()`, but
 * same-day bookings are not offered at all — a provider needs at least until
 * the start of their next day to prepare, however early in the current day
 * "now" happens to be.
 */
export const MIN_BOOKING_NOTICE_DAYS = 1;

/**
 * Resolves a wall-clock minute-of-day on a given local date to a real instant.
 *
 * @param {{year:number,month:number,day:number}} date Local calendar date.
 * @param {number} minuteOfDay 0–1440. 1440 means midnight ending the day.
 * @param {string} zone IANA timezone name, e.g. "Europe/London".
 * @returns {DateTime} A Luxon DateTime in `zone`.
 * @throws {Error} If `zone` is not a zone Luxon can resolve.
 */
export function wallClockToInstant(date, minuteOfDay, zone) {
  // 1440 is not a valid `hour`, so express "end of day" as 00:00 the next day.
  // Luxon's calendar-aware plus({ days: 1 }) is correct here precisely because
  // we want the next *date*, not "24 hours later" — those differ across a DST
  // transition.
  if (minuteOfDay >= 1440) {
    const nextDay = DateTime.fromObject(
      { year: date.year, month: date.month, day: date.day, hour: 0, minute: 0 },
      { zone }
    ).plus({ days: 1 });
    if (!nextDay.isValid) throw new Error(`Invalid timezone or date: ${zone}`);
    return nextDay;
  }

  const instant = DateTime.fromObject(
    {
      year: date.year,
      month: date.month,
      day: date.day,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
    },
    { zone }
  );

  if (!instant.isValid) throw new Error(`Invalid timezone or date: ${zone}`);
  return instant;
}

/**
 * Lists every local calendar date touched by a UTC range, one day of padding on
 * each side.
 *
 * The padding costs two extra iterations and removes a whole class of off-by-one
 * bugs: a client in Auckland asking for "today" spans a UTC range whose edges
 * land on the previous and next local date in a provider's zone.
 *
 * @param {Date|DateTime} rangeStart Inclusive start instant.
 * @param {Date|DateTime} rangeEnd Exclusive end instant.
 * @param {string} zone IANA zone the dates should be read in.
 * @returns {Array<{year:number,month:number,day:number}>} Ascending, no gaps.
 */
export function localDatesInRange(rangeStart, rangeEnd, zone) {
  const start = toDateTime(rangeStart).setZone(zone).startOf("day").minus({ days: 1 });
  const end = toDateTime(rangeEnd).setZone(zone).startOf("day").plus({ days: 1 });

  const dates = [];
  for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
    dates.push({ year: cursor.year, month: cursor.month, day: cursor.day });
  }
  return dates;
}

/**
 * Expands weekly rules and 'open' exceptions onto real dates.
 *
 * @param {object} args
 * @param {Array<{weekday:number,start_minute:number,end_minute:number}>} args.rules
 * @param {Array<object>} args.exceptions Rows from availability_exceptions.
 * @param {string} args.timezone Provider's IANA zone.
 * @param {Date} args.rangeStart Inclusive.
 * @param {Date} args.rangeEnd Exclusive.
 * @returns {Array<{start:number,end:number}>} Epoch-millisecond intervals,
 *   merged so none overlap, ascending by start.
 */
export function expandOpenWindows({ rules, exceptions, timezone, rangeStart, rangeEnd }) {
  const dates = localDatesInRange(rangeStart, rangeEnd, timezone);
  const windows = [];

  const openExceptions = exceptions.filter((e) => e.kind === "open");

  for (const date of dates) {
    // Luxon numbers weekdays 1 (Monday) – 7 (Sunday); the schema and the UI use
    // the JavaScript convention 0 (Sunday) – 6 (Saturday). `% 7` maps Luxon's 7
    // to 0 and leaves 1–6 untouched, which is exactly the translation needed.
    const jsWeekday = wallClockToInstant(date, 0, timezone).weekday % 7;

    for (const rule of rules) {
      if (rule.weekday !== jsWeekday) continue;
      windows.push(intervalFor(date, rule.start_minute, rule.end_minute, timezone));
    }

    for (const exception of openExceptions) {
      if (!dateWithinException(date, exception)) continue;
      windows.push(intervalFor(date, exception.start_minute, exception.end_minute, timezone));
    }
  }

  return mergeIntervals(windows);
}

/**
 * Expands 'block' exceptions onto real dates.
 *
 * A block with NULL minutes covers the provider's entire local day — from local
 * midnight to the next local midnight, which on a DST day is 23 or 25 hours, not
 * a fixed 24.
 *
 * @returns {Array<{start:number,end:number}>} Merged epoch-millisecond intervals.
 */
export function expandBlockedWindows({ exceptions, timezone, rangeStart, rangeEnd }) {
  const dates = localDatesInRange(rangeStart, rangeEnd, timezone);
  const blockExceptions = exceptions.filter((e) => e.kind === "block");
  const blocks = [];

  for (const date of dates) {
    for (const exception of blockExceptions) {
      if (!dateWithinException(date, exception)) continue;

      const startMinute = exception.start_minute ?? 0;
      const endMinute = exception.end_minute ?? 1440;
      blocks.push(intervalFor(date, startMinute, endMinute, timezone));
    }
  }

  return mergeIntervals(blocks);
}

/**
 * Computes the provider's genuinely open time in a range.
 *
 * @returns {Array<{start:number,end:number}>} Merged, block-subtracted, clipped
 *   to the requested range.
 */
export function computeAvailableWindows({ rules, exceptions, timezone, rangeStart, rangeEnd }) {
  const open = expandOpenWindows({ rules, exceptions, timezone, rangeStart, rangeEnd });
  const blocked = expandBlockedWindows({ exceptions, timezone, rangeStart, rangeEnd });

  const rangeInterval = {
    start: toDateTime(rangeStart).toMillis(),
    end: toDateTime(rangeEnd).toMillis(),
  };

  return subtractIntervals(open, blocked)
    .map((w) => ({
      start: Math.max(w.start, rangeInterval.start),
      end: Math.min(w.end, rangeInterval.end),
    }))
    .filter((w) => w.end > w.start);
}

/**
 * True when an instant has already happened, judged against `now`.
 *
 * This is the single comparison every "is this still bookable?" check in the
 * app is built on — it is what stands between a real slot and the bug where a
 * provider's already-passed morning still shows up as available to a client on
 * the other side of the world.
 *
 * ## Why this has to compare real instants, never wall-clock values
 *
 * The bug this function exists to prevent looks like this:
 *
 * ```js
 * // WRONG — do not do this
 * const slotTime = new Date(year, month, day, ruleHour, ruleMinute);
 * if (slotTime > new Date()) { ... } // "still in the future"?
 * ```
 *
 * `new Date(year, month, day, hour, minute)` is always interpreted in the
 * *runtime's* local timezone — never in whatever zone those numbers were meant
 * to represent. If the server runs in UTC and the provider is in
 * `America/New_York`, a provider's "09:00" built that way silently becomes
 * 09:00 UTC (04:00 or 05:00 in New York), and the two clocks disagree. A slot
 * that has genuinely already happened for the provider can then compare as
 * "future" — which is precisely how a stale 9 AM or 10 AM slot keeps
 * generating after it is 3 PM for that provider.
 *
 * The fix is to never let a wall-clock number reach a comparison on its own.
 * Every instant here — the candidate slot and `now` — is a real point on the
 * UTC timeline before it is ever compared, and is only *read back* in
 * `timezone` afterwards, for clarity, not for correctness: Luxon's `DateTime`
 * comparison operators (`<=`, `>=`) reduce to `valueOf()`, which is the epoch
 * millisecond count, so two instants compare identically no matter which zone
 * they are expressed in at the moment of comparison. Converting both sides into
 * the provider's zone first does not change the answer — it makes the
 * *intent* ("past, for the provider") impossible to accidentally rewrite as a
 * wall-clock string comparison later.
 *
 * @param {Date|string|number} instant A real UTC instant — a generated slot's
 *   start, a requested booking time, anything already resolved to a moment in
 *   time (never a bare "HH:MM" string).
 * @param {string} timezone IANA zone to render both sides in before comparing.
 *   Any zone gives the same boolean; the provider's zone is used throughout
 *   this app because the provider is who "past" is defined relative to.
 * @param {Date} [now] Instant to treat as "the present". Injectable so tests
 *   never depend on the wall clock the test happens to run on.
 * @returns {boolean} True when `instant` is at or before `now` — already
 *   happened, or happening this instant, and therefore not bookable.
 */
export function hasInstantPassed(instant, timezone, now = new Date()) {
  const instantInZone = toDateTime(instant).setZone(timezone);
  const nowInZone = toDateTime(now).setZone(timezone);
  return instantInZone <= nowInZone;
}

/**
 * The earliest instant a client may book, given the minimum notice policy.
 *
 * This is deliberately a **calendar-date** floor, not a rolling "24 hours from
 * now" window — the two sound similar but behave very differently near a day
 * boundary, and the rule specifically wants the calendar-date behaviour:
 *
 *   - At 00:05 on the provider's 7th, the floor is 00:00 on the 8th — 23h55m
 *     away.
 *   - At 23:55 on the same 7th, the floor is *still* 00:00 on the 8th — 5
 *     minutes away.
 *
 * In both cases "today" is entirely off the table; how much of today remains
 * is irrelevant. A rolling window (`now + 24h`) would instead let the 23:55
 * caller book as early as 23:55 the next day, which is a different rule than
 * the one described. Anchoring on `now`'s local *date* — via `startOf("day")`
 * — and adding whole days is what makes it a date floor rather than a moving
 * point in time.
 *
 * @param {Date} now Instant to treat as "the present".
 * @param {string} timezone Provider's IANA zone — whose calendar date counts,
 *   since the provider is who this notice period protects.
 * @param {number} [noticeDays] Days of notice required. Defaults to
 *   MIN_BOOKING_NOTICE_DAYS.
 * @returns {DateTime} Local midnight, `noticeDays` days after `now`'s date in
 *   `timezone` — a real instant, not a wall-clock string.
 */
export function earliestBookableInstant(now, timezone, noticeDays = MIN_BOOKING_NOTICE_DAYS) {
  return toDateTime(now).setZone(timezone).startOf("day").plus({ days: noticeDays });
}

/**
 * The full public entry point: available windows minus existing bookings,
 * stepped into bookable slots for one specific service.
 *
 * A slot is offered only when the appointment *and both buffers* fit entirely
 * inside one open window — the brief's rule. So within a window running
 * [W0, W1], the earliest legal appointment start is W0 + bufferBefore and the
 * latest is W1 - bufferAfter - duration.
 *
 * Candidate starts sit on a grid of `slot_interval` minutes anchored at the
 * window's own start, rather than being spaced by the appointment's length. That
 * is why a 60-minute service on a 30-minute interval offers 09:00, 09:30, 10:00
 * and so on: the candidates overlap each other, and booking one removes its
 * neighbours automatically through the `busy` filter. Spacing them by length
 * instead would be tidier arithmetic and worse for the client, who would be
 * shown 09:05, 10:15, 11:25 as soon as the service had a five-minute buffer.
 *
 * @param {object} args
 * @param {Array} args.rules availability_rules rows.
 * @param {Array} args.exceptions availability_exceptions rows.
 * @param {string} args.timezone Provider's IANA zone.
 * @param {{duration:number,buffer_before:number,buffer_after:number,slot_interval?:number}} args.service
 * @param {Date} args.rangeStart Inclusive.
 * @param {Date} args.rangeEnd Exclusive.
 * @param {Array<{blocked_from:Date,blocked_to:Date}>} [args.busy] Spans already
 *   taken by non-cancelled bookings. Only spans overlapping the range need be
 *   passed; anything else is ignored anyway.
 * @param {Date} [args.now] Instant to treat as "the present". Injectable so
 *   tests are not at the mercy of the wall clock.
 * @param {number} [args.stepMinutes] Overrides the service's slot_interval.
 * @param {number} [args.minNoticeDays] Overrides MIN_BOOKING_NOTICE_DAYS — the
 *   number of full calendar days, in the provider's timezone, required between
 *   `now` and a bookable slot. Same-day slots are never offered even when
 *   `noticeDays` is small and hours remain in the current day; see
 *   `earliestBookableInstant()`.
 * @returns {Array<{startsAt:string,endsAt:string,blockedFrom:string,blockedTo:string}>}
 *   ISO-8601 UTC strings, ascending. Empty array if nothing is bookable.
 * @throws {Error} If the range exceeds MAX_RANGE_DAYS or the timezone is invalid.
 */
export function generateSlots({
  rules,
  exceptions,
  timezone,
  service,
  rangeStart,
  rangeEnd,
  busy = [],
  now = new Date(),
  stepMinutes,
  minNoticeDays = MIN_BOOKING_NOTICE_DAYS,
}) {
  const rangeStartMs = toDateTime(rangeStart).toMillis();
  const rangeEndMs = toDateTime(rangeEnd).toMillis();

  if (rangeEndMs <= rangeStartMs) return [];
  if (rangeEndMs - rangeStartMs > MAX_RANGE_DAYS * 86_400_000) {
    throw new Error(`Date range exceeds the ${MAX_RANGE_DAYS}-day maximum`);
  }

  const duration = Number(service.duration);
  const bufferBefore = Number(service.buffer_before) || 0;
  const bufferAfter = Number(service.buffer_after) || 0;

  const step = Math.max(1, Number(stepMinutes) || Number(service.slot_interval) || DEFAULT_SLOT_INTERVAL);

  const windows = computeAvailableWindows({ rules, exceptions, timezone, rangeStart, rangeEnd });

  // Normalise the busy spans once, up front, so the inner loop compares plain
  // numbers instead of re-parsing dates for every candidate slot.
  const busySpans = busy
    .map((b) => ({
      start: toDateTime(b.blocked_from).toMillis(),
      end: toDateTime(b.blocked_to).toMillis(),
    }))
    .sort((a, b) => a.start - b.start);

  const minute = MINUTE_MS;
  const slots = [];

  // Computed once per call, not once per candidate slot: neither `now` nor
  // `timezone` changes as the loop walks the grid, so there is nothing to gain
  // by recomputing this inside it — and computing it here keeps the loop body
  // reading as two independent, named gates rather than inline arithmetic.
  const earliestBookableMs = earliestBookableInstant(now, timezone, minNoticeDays).toMillis();

  for (const window of windows) {
    // Candidate starts come from the shared helper rather than being computed
    // inline, so the provider-facing "these settings produce no slots" warning
    // in `diagnoseSlotFeasibility()` can never drift from what actually gets
    // generated here. See `candidateStartsInWindow()` for the arithmetic.
    for (const startMs of candidateStartsInWindow(window, {
      duration,
      bufferBefore,
      bufferAfter,
      step,
    })) {
      // Two independent gates, both must pass:
      //
      //  1. The slot has not already happened for the provider. See
      //     hasInstantPassed() for exactly why this can never become a
      //     wall-clock comparison.
      //  2. It clears the minimum booking notice — an entire calendar day, in
      //     the provider's timezone, regardless of how much of "today" is
      //     still ahead. See earliestBookableInstant(). This gate is strictly
      //     stronger than (1) whenever minNoticeDays >= 1 (the floor is always
      //     later than `now`), but both are kept and named separately so the
      //     policy stays correct even if minNoticeDays is ever reduced to 0.
      //
      // `startMs` is already a real UTC instant (it came from
      // wallClockToInstant().toMillis() when the window was built), so both
      // checks are true instant-vs-instant compares, never clock-face
      // arithmetic.
      if (hasInstantPassed(startMs, timezone, now)) continue;
      if (startMs < earliestBookableMs) continue;

      const blockedFrom = startMs - bufferBefore * minute;
      const blockedTo = startMs + (duration + bufferAfter) * minute;

      if (overlapsAny(blockedFrom, blockedTo, busySpans)) continue;

      slots.push({
        startsAt: new Date(startMs).toISOString(),
        endsAt: new Date(startMs + duration * minute).toISOString(),
        blockedFrom: new Date(blockedFrom).toISOString(),
        blockedTo: new Date(blockedTo).toISOString(),
      });
    }
  }

  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Every legal appointment start inside one open window, on the service's grid.
 *
 * This is the *only* place the "which starts are offered?" arithmetic lives.
 * `generateSlots()` walks it to build real slots, and `diagnoseSlotFeasibility()`
 * walks it to decide whether a provider's settings can yield anything at all —
 * so a warning shown in the provider UI and an empty slot list shown to a client
 * are always two readings of the same calculation, never two implementations
 * that can disagree.
 *
 * Three constraints combine:
 *
 *   1. The appointment *and both buffers* must fit entirely inside the window,
 *      so the legal band of starts is
 *      `[window.start + bufferBefore, window.end - bufferAfter - duration]`.
 *   2. Candidate starts sit on a `step`-minute grid **anchored at the window's
 *      own start**, which is what keeps offered times round (09:00, 09:30, …)
 *      instead of drifting to 09:05, 10:15 as soon as a buffer is non-zero.
 *   3. A start is offered only where the band and the grid agree.
 *
 * Constraint 3 is why a window can be long enough for the appointment and still
 * offer nothing: a 09:00–10:00 window with a 30-minute service, 10-minute
 * buffers and a 30-minute grid has a legal band of 09:10–09:20 and a grid of
 * 09:00 / 09:30, which never intersect. That is a real configuration mistake
 * rather than a bug, and it is exactly what the diagnosis below exists to catch
 * *before* a provider saves it.
 *
 * @param {{start:number,end:number}} window Epoch-millisecond open window.
 * @param {{duration:number,bufferBefore:number,bufferAfter:number,step:number}} config
 *   Minutes. `step` must already be resolved (>= 1).
 * @returns {number[]} Ascending epoch-millisecond starts. Empty when nothing fits.
 */
export function candidateStartsInWindow(window, { duration, bufferBefore, bufferAfter, step }) {
  const earliestStart = window.start + bufferBefore * MINUTE_MS;
  const latestStart = window.end - (bufferAfter + duration) * MINUTE_MS;

  // Skipping whole grid steps — rather than simply starting at `earliestStart` —
  // is what keeps the offered times round: with a 5-minute buffer-before, 09:00
  // does not fit and the first offered start is 09:30, not 09:05.
  const stepsToSkip = Math.ceil((earliestStart - window.start) / (step * MINUTE_MS));
  const firstStart = window.start + Math.max(0, stepsToSkip) * step * MINUTE_MS;

  const starts = [];
  for (let startMs = firstStart; startMs <= latestStart; startMs += step * MINUTE_MS) {
    starts.push(startMs);
  }
  return starts;
}

/**
 * The shortest open window, in minutes, that yields at least one slot.
 *
 * Inverts `candidateStartsInWindow()`. A start is offered when the first grid
 * position at or after `bufferBefore` still leaves room for the appointment and
 * its trailing buffer, i.e. when
 *
 *   ceil(bufferBefore / step) * step + duration + bufferAfter <= windowMinutes
 *
 * The `ceil(...) * step` term is the part providers find surprising: with a
 * 10-minute leading buffer on a 30-minute grid, the first usable start is 30
 * minutes into the window, not 10 — the other 20 minutes are unreachable because
 * no grid position lands in them.
 *
 * @param {{duration:number,bufferBefore:number,bufferAfter:number,step:number}} config Minutes.
 * @returns {number} Minutes of open time needed for one slot.
 */
export function minimumWindowMinutes({ duration, bufferBefore, bufferAfter, step }) {
  return Math.ceil(bufferBefore / step) * step + duration + bufferAfter;
}

/**
 * Decides whether a service's settings can produce any slot at all, and — when
 * they cannot — works out what would actually fix it.
 *
 * This powers the provider-side warning. It deliberately answers a question
 * about the *recurring weekly configuration*, not about any particular date:
 * bookings, one-off blocks, the minimum-notice rule and "is it in the past" are
 * all left out, because none of them are things the provider can fix by editing
 * the settings in front of them. A day that is empty only because it is fully
 * booked is not a misconfiguration and must not be reported as one.
 *
 * Windows are evaluated in wall-clock minutes rather than as instants. On a DST
 * transition day a window's real length differs by an hour, but the provider is
 * editing "Mondays, 09:00–10:00", and warning them about a configuration that
 * works on 51 Mondays a year would be noise.
 *
 * @param {object} args
 * @param {Array<{weekday:number,start_minute:number,end_minute:number}>} args.rules
 *   The weekly pattern being validated — saved rows, or a draft the provider has
 *   not committed yet.
 * @param {{duration:number,buffer_before:number,buffer_after:number,slot_interval?:number}} args.service
 * @param {number} [args.stepMinutes] Overrides the service's slot_interval.
 * @returns {{
 *   bookable: boolean,
 *   totalSlotsPerWeek: number,
 *   config: {duration:number,bufferBefore:number,bufferAfter:number,slotInterval:number},
 *   minimumWindowMinutes: number,
 *   days: Array<{weekday:number,windows:Array<object>,slotCount:number}>,
 *   problemDays: Array<object>,
 *   remedies: Array<{kind:string,value:number,summary:string}>
 * }}
 */
export function diagnoseSlotFeasibility({ rules, service, stepMinutes }) {
  const duration = Number(service.duration);
  const bufferBefore = Number(service.buffer_before) || 0;
  const bufferAfter = Number(service.buffer_after) || 0;
  const step = Math.max(
    1,
    Number(stepMinutes) || Number(service.slot_interval) || DEFAULT_SLOT_INTERVAL
  );

  const config = { duration, bufferBefore, bufferAfter, slotInterval: step };
  const required = minimumWindowMinutes({ duration, bufferBefore, bufferAfter, step });

  // Merge each weekday's rules first: 09:00–12:00 and 12:00–17:00 are two rows
  // but one continuous window, and a service longer than either half fits only
  // in the merged one. This mirrors mergeIntervals() in minute space.
  const days = [];
  let totalSlotsPerWeek = 0;

  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const dayRules = rules
      .filter((r) => Number(r.weekday) === weekday)
      .map((r) => ({ start: Number(r.start_minute), end: Number(r.end_minute) }));

    if (dayRules.length === 0) continue;

    const merged = mergeIntervals(dayRules);
    const windows = merged.map((w) => {
      // candidateStartsInWindow works in milliseconds; minutes-from-midnight
      // scaled by MINUTE_MS is the same arithmetic on the same units, so the
      // count here is exactly the count generateSlots() would produce.
      const starts = candidateStartsInWindow(
        { start: w.start * MINUTE_MS, end: w.end * MINUTE_MS },
        { duration, bufferBefore, bufferAfter, step }
      );

      return {
        startTime: formatMinutesOfDay(w.start),
        endTime: formatMinutesOfDay(w.end),
        lengthMinutes: w.end - w.start,
        slotCount: starts.length,
        firstSlotTime: starts.length ? formatMinutesOfDay(starts[0] / MINUTE_MS) : null,
        // What the window would need to be to yield one slot, expressed as the
        // end time the provider would have to move to — far more actionable
        // than "you need 70 minutes".
        suggestedEndTime: starts.length ? null : formatMinutesOfDay(w.start + required),
      };
    });

    const slotCount = windows.reduce((sum, w) => sum + w.slotCount, 0);
    totalSlotsPerWeek += slotCount;
    days.push({ weekday, windows, slotCount });
  }

  const problemDays = days.filter((d) => d.slotCount === 0);

  return {
    bookable: totalSlotsPerWeek > 0,
    totalSlotsPerWeek,
    config,
    minimumWindowMinutes: required,
    days,
    problemDays,
    remedies: problemDays.length === 0 ? [] : suggestRemedies({ problemDays, config }),
  };
}

/**
 * Works out which concrete setting changes would actually produce slots.
 *
 * Every suggestion is *verified* against `minimumWindowMinutes()` rather than
 * guessed, so the UI never tells a provider to "try a shorter buffer" when a
 * shorter buffer would not help. Order matters — the first entry is the one the
 * UI presents as the recommendation, and it is deliberately "make the day
 * longer": that is the only remedy that leaves the service's duration and its
 * buffers untouched, and buffers exist to protect the provider's real calendar,
 * not to be traded away to make a warning disappear.
 *
 * @param {{problemDays:Array<object>, config:object}} args
 * @returns {Array<{kind:string,value:number,summary:string}>}
 */
function suggestRemedies({ problemDays, config }) {
  const { duration, bufferBefore, bufferAfter, slotInterval } = config;
  const remedies = [];

  // The tightest window among the broken days decides what a fix has to clear.
  const shortest = problemDays
    .flatMap((d) => d.windows)
    .reduce((min, w) => (w.lengthMinutes < min.lengthMinutes ? w : min));

  const required = minimumWindowMinutes({ duration, bufferBefore, bufferAfter, step: slotInterval });
  const extraMinutes = required - shortest.lengthMinutes;

  if (extraMinutes > 0) {
    remedies.push({
      kind: "extend-availability",
      value: extraMinutes,
      summary: `Add ${formatDuration(extraMinutes)} to that day — ending at ${shortest.suggestedEndTime} instead would fit.`,
    });
  } else {
    // The window is already long enough in raw minutes; only the grid is in the
    // way. Say so plainly rather than suggesting a longer day that is not the
    // actual constraint.
    remedies.push({
      kind: "extend-availability",
      value: slotInterval,
      summary: `Add ${formatDuration(slotInterval)} to that day so a start time lands inside it.`,
    });
  }

  // A shorter interval is often the smallest real fix, but only offer values
  // that genuinely work — and among those, the *largest*. Several intervals
  // usually qualify, and the smallest of them would scatter a provider's day
  // across far more start times than the problem requires; the largest is the
  // one that changes the least about how their calendar reads.
  const workingInterval = [60, 45, 30, 20, 15, 10, 5]
    .filter((candidate) => candidate < slotInterval)
    .find(
      (candidate) =>
        minimumWindowMinutes({ duration, bufferBefore, bufferAfter, step: candidate }) <=
        shortest.lengthMinutes
    );

  if (workingInterval) {
    remedies.push({
      kind: "slot-interval",
      value: workingInterval,
      summary: `Change the slot interval to ${workingInterval} minutes so start times land inside your available time.`,
    });
  }

  // Trimming the leading buffer is the buffer change that helps most, because
  // it is the one the grid rounds up. Only suggest it when it actually resolves
  // the day, and never suggest removing protection that is doing no harm.
  if (bufferBefore > 0) {
    const trimmed = [15, 10, 5, 0].find(
      (candidate) =>
        candidate < bufferBefore &&
        minimumWindowMinutes({ duration, bufferBefore: candidate, bufferAfter, step: slotInterval }) <=
          shortest.lengthMinutes
    );
    if (trimmed !== undefined) {
      remedies.push({
        kind: "buffer-before",
        value: trimmed,
        summary:
          trimmed === 0
            ? "Remove the buffer before appointments for this service."
            : `Reduce the buffer before appointments to ${trimmed} minutes.`,
      });
    }
  }

  const shorterDuration = shortest.lengthMinutes - Math.ceil(bufferBefore / slotInterval) * slotInterval - bufferAfter;
  if (shorterDuration > 0 && shorterDuration < duration) {
    remedies.push({
      kind: "duration",
      value: shorterDuration,
      summary: `Shorten this service to ${formatDuration(shorterDuration)}.`,
    });
  }

  return remedies;
}

/** Renders minutes-from-midnight as a 12-hour clock reading for provider-facing copy. */
function formatMinutesOfDay(totalMinutes) {
  const minutes = Math.round(totalMinutes);
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 && hour24 < 24 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** Renders a minute count the way a person would say it: "1 hr 10 min". */
function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * Computes the span a booking occupies on the provider's calendar, buffers
 * included. Used both when inserting a booking and when rescheduling one.
 *
 * @param {Date|string} startsAt Appointment start instant.
 * @param {{duration:number,buffer_before:number,buffer_after:number}} service
 * @returns {{startsAt:Date,endsAt:Date,blockedFrom:Date,blockedTo:Date}}
 */
export function computeBookingSpan(startsAt, service) {
  const start = toDateTime(startsAt);
  const duration = Number(service.duration);
  const bufferBefore = Number(service.buffer_before) || 0;
  const bufferAfter = Number(service.buffer_after) || 0;

  return {
    startsAt: start.toJSDate(),
    endsAt: start.plus({ minutes: duration }).toJSDate(),
    blockedFrom: start.minus({ minutes: bufferBefore }).toJSDate(),
    blockedTo: start.plus({ minutes: duration + bufferAfter }).toJSDate(),
  };
}

/**
 * Checks that a requested start is genuinely one of the provider's open times.
 *
 * The database guarantees a slot is not double-booked; this guarantees it was a
 * legal slot in the first place, so a client cannot hand-craft a request for
 * 03:00 on a Sunday and have it accepted.
 *
 * @returns {boolean} True when the whole occupied span sits inside one open window.
 */
export function isWithinAvailability({ rules, exceptions, timezone, service, startsAt }) {
  const span = computeBookingSpan(startsAt, service);
  const blockedFrom = span.blockedFrom.getTime();
  const blockedTo = span.blockedTo.getTime();

  // Expand a day either side of the span so a window is never clipped by the
  // range boundary and wrongly judged too short to contain the booking.
  const windows = computeAvailableWindows({
    rules,
    exceptions,
    timezone,
    rangeStart: new Date(blockedFrom - 86_400_000),
    rangeEnd: new Date(blockedTo + 86_400_000),
  });

  return windows.some((w) => w.start <= blockedFrom && w.end >= blockedTo);
}

// ---------------------------------------------------------------------------
// Interval helpers. Everything below works on { start, end } pairs of epoch
// milliseconds, treated as half-open [start, end): two intervals that merely
// touch do not overlap, so back-to-back appointments are legal.
// ---------------------------------------------------------------------------

/** Merges overlapping and touching intervals into a minimal ascending set. */
export function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];

  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    // `<=` rather than `<`: two windows that merely touch (09:00–12:00 and
    // 12:00–17:00) should become one continuous 09:00–17:00 window, otherwise a
    // service longer than either half would never fit anywhere.
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * Removes every part of `blocks` from `base`.
 *
 * A block landing in the middle of a window splits it into two, which is why
 * this cannot be a simple filter — a lunch-hour block on a 09:00–17:00 day has
 * to produce 09:00–12:00 and 13:00–17:00.
 *
 * @param {Array<{start:number,end:number}>} base Assumed merged.
 * @param {Array<{start:number,end:number}>} blocks Assumed merged.
 * @returns {Array<{start:number,end:number}>} Ascending, non-empty intervals.
 */
export function subtractIntervals(base, blocks) {
  if (blocks.length === 0) return base;

  const result = [];

  for (const window of base) {
    let remaining = [{ ...window }];

    for (const block of blocks) {
      const next = [];
      for (const piece of remaining) {
        if (block.end <= piece.start || block.start >= piece.end) {
          next.push(piece); // No intersection — piece survives untouched.
          continue;
        }
        if (block.start > piece.start) next.push({ start: piece.start, end: block.start });
        if (block.end < piece.end) next.push({ start: block.end, end: piece.end });
      }
      remaining = next;
      if (remaining.length === 0) break;
    }

    result.push(...remaining);
  }

  return result.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
}

/** True when [start, end) intersects any interval in the ascending list. */
function overlapsAny(start, end, sortedIntervals) {
  for (const interval of sortedIntervals) {
    // The list is sorted by start, so once an interval begins at or after our
    // end, no later one can overlap either — stop instead of scanning on.
    if (interval.start >= end) return false;
    if (interval.end > start) return true;
  }
  return false;
}

/** Builds an epoch-millisecond interval from a local date and a minute window. */
function intervalFor(date, startMinute, endMinute, timezone) {
  return {
    start: wallClockToInstant(date, startMinute, timezone).toMillis(),
    end: wallClockToInstant(date, endMinute, timezone).toMillis(),
  };
}

/** True when a local calendar date falls inside an exception's inclusive range. */
function dateWithinException(date, exception) {
  // Compare as YYYY-MM-DD strings: the exception's dates are calendar dates with
  // no zone, so comparing them as instants would reintroduce the very ambiguity
  // storing them as DATE was meant to avoid.
  const iso = `${pad4(date.year)}-${pad2(date.month)}-${pad2(date.day)}`;
  return iso >= toIsoDate(exception.start_date) && iso <= toIsoDate(exception.end_date);
}

/**
 * Normalises a DATE column to "YYYY-MM-DD".
 *
 * node-postgres hands DATE back as a JavaScript Date at local midnight, so
 * `toISOString()` would shift it a day for anyone east or west of UTC. Reading
 * the local calendar fields avoids that entirely.
 */
function toIsoDate(value) {
  if (typeof value === "string") return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  return `${pad4(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Accepts anything date-shaped and returns a Luxon DateTime in UTC. */
function toDateTime(value) {
  if (value instanceof DateTime) return value;
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone: "utc" });
  if (typeof value === "number") return DateTime.fromMillis(value, { zone: "utc" });
  return DateTime.fromISO(String(value), { zone: "utc" });
}

const pad2 = (n) => String(n).padStart(2, "0");
const pad4 = (n) => String(n).padStart(4, "0");
