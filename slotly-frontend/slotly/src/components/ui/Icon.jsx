/**
 * The app's icon set: Material Symbols Outlined, which is what the design uses.
 *
 * Call sites may pass either a Material Symbols ligature directly
 * (`<Icon name="event_available" />`) or one of the short names the app already
 * used before the switch (`<Icon name="calendarCheck" />`). The alias table
 * below maps the second onto the first, so the change of icon set did not
 * require touching sixty components — and new code can simply use the name
 * printed in the design's HTML.
 *
 * `size` is the rendered box in pixels. Material Symbols is a variable font
 * whose glyphs are drawn on a 24px grid, so the font size *is* the icon size and
 * `opsz` is matched to it to keep stroke weight optically even at small sizes.
 */

/**
 * Short name → Material Symbols ligature.
 *
 * Only names that differ are listed; anything not here is passed through
 * unchanged, which is what lets design markup be transcribed verbatim.
 */
const ALIASES = {
  // Navigation and structure
  calendar: "calendar_today",
  calendarCheck: "event_available",
  eventAvailable: "event_available",
  clock: "schedule",
  list: "list",
  grid: "grid_view",
  dashboard: "dashboard",
  menu: "menu",
  sliders: "tune",
  settings: "settings",

  // People
  user: "person",
  users: "group",
  briefcase: "work",

  // Actions
  search: "search",
  plus: "add",
  check: "check",
  close: "close",
  pencil: "edit",
  trash: "delete",
  refresh: "refresh",
  logout: "logout",
  send: "send",
  paperclip: "attach_file",
  upload: "upload",
  camera: "photo_camera",
  image: "image",
  editCalendar: "edit_calendar",

  // Direction
  chevronLeft: "chevron_left",
  chevronRight: "chevron_right",
  chevronDown: "expand_more",
  chevronUp: "expand_less",
  arrowLeft: "arrow_back",
  arrowRight: "arrow_forward",
  arrowUpRight: "north_east",
  external: "open_in_new",
  moreHorizontal: "more_horiz",

  // Meaning
  info: "info",
  alert: "warning",
  globe: "public",
  message: "chat",
  star: "star",
  tag: "category",
  ban: "block",
  inbox: "inbox",
  spark: "auto_awesome",
  bell: "notifications",
  checkCircle: "check_circle",
  shield: "verified_user",
  help: "help",
  phone: "call",
  mail: "mail",
  mapPin: "location_on",
  payments: "payments",
};

/** Every alias available, for reference and for the `name` prop. */
export const iconNames = Object.keys(ALIASES);

export default function Icon({
  name,
  size = 20,
  /** Material Symbols' FILL axis. The design uses it for an active nav glyph. */
  fill = false,
  className = "",
  ...rest
}) {
  if (!name) return null;

  const ligature = ALIASES[name] || name;

  return (
    <span
      aria-hidden="true"
      data-fill={fill ? "1" : "0"}
      style={{
        fontSize: `${size}px`,
        width: `${size}px`,
        height: `${size}px`,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`,
      }}
      className={`material-symbols-outlined ${className}`}
      {...rest}
    >
      {ligature}
    </span>
  );
}
