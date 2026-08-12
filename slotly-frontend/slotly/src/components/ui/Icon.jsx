// The app's icon set.


/** Shared by every path: same cap, same join, same weight. */
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const PATHS = {
  //Navigation & structure 
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" {...STROKE} />
      <path d="M3 9.5h18M8 3v3M16 3v3" {...STROKE} />
    </>
  ),
  calendarCheck: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" {...STROKE} />
      <path d="M3 9.5h18M8 3v3M16 3v3M9 14.5l2 2 4-4" {...STROKE} />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" {...STROKE} />
      <path d="M12 7.5V12l3 2" {...STROKE} />
    </>
  ),
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" {...STROKE} />,
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" {...STROKE} />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" {...STROKE} />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" {...STROKE} />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" {...STROKE} />
    </>
  ),
  menu: <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" {...STROKE} />,
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" {...STROKE} />
      <circle cx="16" cy="7" r="2.25" {...STROKE} />
      <circle cx="8" cy="17" r="2.25" {...STROKE} />
    </>
  ),

  // People 
  user: (
    <>
      <circle cx="12" cy="8" r="3.75" {...STROKE} />
      <path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" {...STROKE} />
    </>
  ),
  users: (
    <>
      <circle cx="9.5" cy="8.5" r="3.25" {...STROKE} />
      <path d="M3 19.5c1-3 3.4-4.75 6.5-4.75s5.5 1.75 6.5 4.75M16.5 5.6a3.25 3.25 0 0 1 0 6.3M18 14.9c2 .6 3.4 2 4 4.6" {...STROKE} />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7.5" width="18" height="13" rx="2.5" {...STROKE} />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12.5h18" {...STROKE} />
    </>
  ),

  // Actions 
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" {...STROKE} />
      <path d="M15.8 15.8L20.5 20.5" {...STROKE} />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" {...STROKE} />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" {...STROKE} />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...STROKE} />,
  pencil: (
    <>
      <path d="M4.5 19.5h3l10-10a2.12 2.12 0 0 0-3-3l-10 10v3Z" {...STROKE} />
      <path d="M14 6l4 4" {...STROKE} />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7" {...STROKE} />
      <path d="M6.5 7l.8 12.1A1.5 1.5 0 0 0 8.8 20.5h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" {...STROKE} />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" {...STROKE} />
      <path d="M20 4.5V10h-5.5" {...STROKE} />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 4.5H18A2 2 0 0 1 20 6.5v11a2 2 0 0 1-2 2h-3.5" {...STROKE} />
      <path d="M10 8l-4 4 4 4M6 12h9" {...STROKE} />
    </>
  ),

  // Direction
  chevronLeft: <path d="M14.5 5.5L8 12l6.5 6.5" {...STROKE} />,
  chevronRight: <path d="M9.5 5.5L16 12l-6.5 6.5" {...STROKE} />,
  chevronDown: <path d="M5.5 9l6.5 6.5L18.5 9" {...STROKE} />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" {...STROKE} />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" {...STROKE} />,
  external: (
    <>
      <path d="M14 4.5h5.5V10" {...STROKE} />
      <path d="M19.5 4.5L11 13M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V8A1.5 1.5 0 0 1 6 6.5h4.5" {...STROKE} />
    </>
  ),

  // Meaning 
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" {...STROKE} />
      <path d="M12 11v5.5M12 7.75h.01" {...STROKE} />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5l8.5 15H3.5l8.5-15Z" {...STROKE} />
      <path d="M12 10v4M12 17h.01" {...STROKE} />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" {...STROKE} />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.3 3.5 8.5S14.3 18.1 12 20.5c-2.3-2.4-3.5-5.3-3.5-8.5S9.7 5.9 12 3.5Z" {...STROKE} />
    </>
  ),
  message: (
    <path
      d="M20.5 12.5c0 4-3.8 7-8.5 7-.9 0-1.8-.1-2.6-.3l-5.4 1.8 1.5-4.2A6.6 6.6 0 0 1 3.5 12.5c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z"
      {...STROKE}
    />
  ),
  star: (
    <path
      d="M12 4l2.4 5.1 5.6.7-4.1 3.9 1 5.6L12 16.6 7.1 19.3l1-5.6L4 9.8l5.6-.7L12 4Z"
      {...STROKE}
    />
  ),
  tag: (
    <>
      <path d="M4.5 11.2V5.5A1 1 0 0 1 5.5 4.5h5.7a1 1 0 0 1 .7.3l7.4 7.4a1 1 0 0 1 0 1.4l-5.7 5.7a1 1 0 0 1-1.4 0L4.8 11.9a1 1 0 0 1-.3-.7Z" {...STROKE} />
      <path d="M8.5 8.5h.01" {...STROKE} />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" {...STROKE} />
      <path d="M6.5 6.5l11 11" {...STROKE} />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13.5h4l1.5 2.5h6l1.5-2.5h4" {...STROKE} />
      <path d="M3.5 13.5 6 5.5a1.5 1.5 0 0 1 1.4-1h9.2a1.5 1.5 0 0 1 1.4 1l2.5 8v4a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-4Z" {...STROKE} />
    </>
  ),
  spark: (
    <path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9L12 3.5Z" {...STROKE} />
  ),
};

/** Every glyph available, for reference and for the `name` prop. */
export const iconNames = Object.keys(PATHS);


export default function Icon({ name, size = 16, className = "", ...rest }) {
  const path = PATHS[name];

  // A typo in a name should not blank out a button's whole label, so an unknown
  // icon renders nothing and leaves the text beside it intact.
  if (!path) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {path}
    </svg>
  );
}
