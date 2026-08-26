/**
 * Where each of a day's appointments is drawn in the week and day views.
 *
 * A replacement for react-big-calendar's own `overlap` algorithm, passed in as
 * `dayLayoutAlgorithm`. RBC supports a custom function there, and its default
 * misplaces this app's appointments badly enough that a provider could not tell
 * from the calendar whether two of them clashed.
 *
 * ## What was wrong with the default
 *
 * **It groups by proximity, not by overlap.** `overlap.js` places an event beside
 * another if
 *
 * ```js
 * c.end > event.start || Math.abs(event.start - c.start) < minimumStartDifference
 * ```
 *
 * — note the second half of that `||`. Two events whose *starts* are close share a
 * container and a row even when their times do not intersect at all.
 * `minimumStartDifference` is `ceil(step * timeslots / 2)`, which for this
 * calendar's `step={30} timeslots={2}` is **30 minutes**. So an appointment from
 * 11:20 to 11:22 and another from 11:30 to 11:50 — ten minutes apart, not
 * touching — were split into half-width columns and drawn as though they clashed.
 * At Slotly's durations, where a service can be two minutes long, most pairs of
 * appointments in the same half hour hit this. The default then leans into it:
 * `get width()` returns `this._width * 1.7` so columns visibly bleed together, an
 * effect that only reads correctly when the events really do overlap.
 *
 * **And a short event has no readable height.** The height RBC computes for a
 * 2-minute appointment is 0.14% of the column — about 4px at this calendar's
 * 128px-per-hour density — which is not one line of text. Its own stylesheet
 * papers over that with `.rbc-day-slot .rbc-event { min-height: 20px }`, and that
 * is worse than leaving it: the rule grows the box *downward*, past the end time
 * the height was derived from, over whatever comes next, and it does so after
 * layout has run. Any promise the algorithm makes about events not colliding is
 * void the moment the browser overrides the height it returned. `index.css` zeroes
 * that rule; the floor lives here instead.
 *
 * ## The idea: one footprint, used for everything
 *
 * Every event gets a **layout footprint** — its real time range, widened at the
 * end to at least `MIN_EVENT_MINUTES` so the block is tall enough to read.
 *
 * That single figure drives all three decisions, which is what stops them
 * contradicting each other:
 *
 * - **Height** is the footprint's height, so every block clears one line of text.
 * - **Clustering** is by footprint intersection, so events go side by side only
 *   when the blocks that will actually be drawn need the room.
 * - **Columns** are assigned by footprint too, so two events sharing a column can
 *   never collide.
 *
 * Both invariants hold at once: no block is ever shorter than one readable line,
 * and no two blocks overlap by so much as a pixel. Nothing is occluded and nothing
 * is squashed, so no label is ever clipped by a neighbour.
 *
 * Positions and labels stay honest throughout. `top` is the true start time and
 * the label is the event's own start–end, untouched. Only the *bottom* edge of a
 * very short block sits lower than its end time, which is the one concession a
 * two-minute appointment on an hour-scale grid requires.
 *
 * ## The one case where side by side is not a real overlap
 *
 * Two short appointments closer together than `MIN_EVENT_MINUTES` — 10:00–10:02 and
 * 10:05–10:07, say — have footprints that intersect even though their times do not,
 * so they are drawn in two columns. That is deliberate, and it is the only way to
 * keep both labels readable: stacked, the second block would begin 6px below the
 * first and cover the text of the one above it. `MIN_EVENT_MINUTES` is the width of
 * the window in which this applies, which is the real reason it is 10 rather than
 * 15 — ten leaves the reported 11:20/11:30 pair, exactly ten minutes apart, in a
 * single full-width column.
 *
 * The contract is RBC's: given `{ events, slotMetrics, accessors }`, return one
 * `{ event, style: { top, height, width, xOffset } }` per event, all four numbers
 * percentages of the day column. See `TimeGridEvent`, which turns them into `top`,
 * `height`, `width` and `left`.
 */

/**
 * The smallest vertical space an event may occupy, in minutes of grid space.
 *
 * `index.css` gives `.rbc-timeslot-group` a 64px floor for a half hour, so the grid
 * runs at 128px an hour and ten minutes is **~21px** — one line of the time label,
 * its 2px of padding and its 1px border, with nothing to spare.
 *
 * Raising it makes short events easier to read and widens the window in which two
 * near-but-not-overlapping appointments are split into columns. Ten is the largest
 * value that still leaves a pair ten minutes apart in one column, which is the case
 * this file was written for.
 *
 * In minutes rather than pixels because minutes are the unit the layout thinks in,
 * and because the conversion below is against the column's own scale rather than an
 * assumed one — a calendar showing 8am–6pm scales differently from one showing the
 * whole day.
 */
export const MIN_EVENT_MINUTES = 10;

/**
 * Whether an appointment is shorter than the block it will be drawn in.
 *
 * Exported so the calendar can render those blocks differently, and exported
 * from *here* so there is one definition of "short". A renderer with its own
 * threshold would eventually disagree with the layout about which events were
 * inflated, and the disagreement would show as clipped text on exactly the
 * events that were hardest to notice.
 *
 * @param {Date} start The appointment's start.
 * @param {Date} end Its end.
 */
export function isCompactEvent(start, end) {
  return (end - start) / 60000 < MIN_EVENT_MINUTES;
}

/** Minutes in a day, used only if the events cannot supply a scale themselves. */
const MINUTES_PER_DAY = 1440;

export default function dayEventLayout({ events, slotMetrics, accessors }) {
  if (!events || events.length === 0) return [];

  // `getRange` hands back the two things needed together: `start`/`end` as
  // minutes from the top of the column, and `top`/`height` as percentages of it.
  const measured = events.map((event) => {
    const { start, end, top, height } = slotMetrics.getRange(
      accessors.start(event),
      accessors.end(event)
    );
    return { event, start, end, top, height };
  });

  const minHeight = MIN_EVENT_MINUTES * scaleOf(measured);

  for (const item of measured) {
    // Where this event's *block* ends, as against where the appointment does.
    // Everything below reads `footprint`, never `end`.
    item.footprint = Math.max(item.end, item.start + MIN_EVENT_MINUTES);
    item.blockHeight = Math.max(item.height, minHeight);
  }

  // Earliest first, and on a tie the taller block first — it is the one that
  // constrains the most columns, so placing it first keeps the greedy assignment
  // from splitting a cluster wider than it needs to be.
  measured.sort((a, b) => a.start - b.start || b.footprint - a.footprint);

  assignColumns(measured);

  return measured.map((item) => ({
    event: item.event,
    style: {
      // The true start. A block may be drawn taller than its appointment; it is
      // never drawn anywhere other than where the appointment begins.
      top: item.top,
      height: item.blockHeight,
      width: item.width,
      xOffset: item.xOffset,
    },
  }));
}

/**
 * Splits the day into clusters of events whose footprints intersect, and gives
 * each event its column, in place.
 *
 * Greedy by column within a cluster: each event takes the leftmost column whose
 * previous occupant's footprint has already ended. The number of columns used is
 * the cluster's peak concurrency, which is the narrowest its events can be drawn
 * without any block overlapping another.
 *
 * @param {Array} measured Sorted by start. Mutated with `column`, `width` and
 *   `xOffset`.
 */
function assignColumns(measured) {
  let cluster = [];
  let clusterEnd = -Infinity;

  const close = () => {
    if (cluster.length === 0) return;

    // `columns[i]` is the footprint end of the last event placed in column i.
    const columns = [];

    for (const item of cluster) {
      const free = columns.findIndex((end) => end <= item.start);
      if (free === -1) {
        item.column = columns.length;
        columns.push(item.footprint);
      } else {
        item.column = free;
        columns[free] = item.footprint;
      }
    }

    for (const item of cluster) {
      item.width = 100 / columns.length;
      item.xOffset = item.column * item.width;
    }

    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of measured) {
    // A new cluster whenever an event starts at or after every footprint before it
    // has ended. `>=` rather than `>`: a block starting exactly where the one above
    // it finishes sits below it, not beside it. That is what keeps back-to-back
    // appointments — and the reported 11:20/11:30 pair — full width.
    if (item.start >= clusterEnd) close();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.footprint);
  }

  close();
}

/**
 * How much of the column one minute is worth.
 *
 * Derived from the events rather than assumed, because `getRange`'s percentages are
 * relative to whatever `min`/`max` the calendar was given. Any event with a real
 * duration answers it, so only a day made up entirely of zero-length events needs
 * the fallback.
 */
function scaleOf(measured) {
  const sized = measured.find((item) => item.end > item.start && item.height > 0);
  return sized ? sized.height / (sized.end - sized.start) : 100 / MINUTES_PER_DAY;
}
