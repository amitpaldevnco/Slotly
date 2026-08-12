// Two switch controls, and the rule for which to use.

import Icon from "./Icon";


export function SegmentedControl({
  options,
  value,
  onChange,
  panelId,
  label,
  fill = false,
  className = "",
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-canvas p-0.5 ${
        fill ? "w-full" : ""
      } ${className}`}
    >
      {options.map((option) => {
        const active = option.id === value;

        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            id={`tab-${option.id}`}
            aria-selected={active}
            aria-controls={panelId}
            onClick={() => onChange(option.id)}
            className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[0.3125rem] px-3 text-[0.8125rem] font-medium transition ${
              fill ? "flex-1" : ""
            } ${
              active
                ? "bg-surface text-ink shadow-raise"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            {option.icon && <Icon name={option.icon} size={14} />}
            {option.label}
            {/* Only once that tab has actually loaded. A count of 0 shown before
                the request has run is a claim we cannot yet make. */}
            {option.count != null && (
              <span className={`tabular-nums ${active ? "text-ink-3" : "text-ink-3/80"}`}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}


export function FilterTabs({ options, value, onChange, panelId, label, className = "" }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-0.5 ${className}`}
    >
      {options.map((option) => {
        const active = option.id === value;

        return (
          <button
            key={option.id ?? "__default"}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId}
            onClick={() => onChange(option.id)}
            className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-medium transition ${
              active
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-ink-2 hover:border-ink-3/40 hover:text-ink"
            }`}
          >
            <span className="max-w-[14rem] truncate">{option.label}</span>
            {option.dot && (
              <span
                aria-hidden="true"
                title="Has its own hours"
                className={`h-1.5 w-1.5 rounded-full ${active ? "bg-white/80" : "bg-brand"}`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
