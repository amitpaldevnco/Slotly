// Form field primitives.

import Icon from "./Icon";
import {
  labelClasses,
  hintClasses,
  fieldErrorClasses,
  inputClasses,
  selectClasses,
  textareaClasses,
} from "../../lib/ui";


export default function Field({
  id,
  label,
  hint,
  error,
  optional = false,
  action,
  children,
  className = "",
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={className}>
      {label && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <label htmlFor={id} className={labelClasses}>
            {label}
            {optional && <span className="ml-1 font-normal text-ink-3">(optional)</span>}
          </label>
          {action}
        </div>
      )}

      {/* The control is cloned so the field can attach the ids it just minted.
          Doing it here rather than at each call site is the whole point: it is
          the accessible wiring that gets dropped when it is manual. */}
      {typeof children === "function"
        ? children({ id, "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? true : undefined })
        : children}

      {hint && (
        <p id={hintId} className={hintClasses}>
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} className={fieldErrorClasses}>
          <Icon name="alert" size={13} className="mt-px" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

// A text input, sized and focused like every other control. 
export function Input({ className = "", ...rest }) {
  return <input className={`${inputClasses} ${className}`} {...rest} />;
}

// A textarea. `resize-y` by default — a fixed-height text box is a trap.
export function Textarea({ className = "", ...rest }) {
  return <textarea className={`${textareaClasses} ${className}`} {...rest} />;
}

/**
 * A select with the app's own chevron.
 *
 * The native arrow differs in shape and weight on every OS, so it is suppressed
 * and redrawn. `pointer-events-none` on the icon keeps the whole control
 * clickable, which is what a hand-drawn chevron usually breaks.
 *
 * `wrapperClassName` exists because the chevron is positioned against this
 * wrapper, not against the `<select>`. Inside a flex row the wrapper is the flex
 * item, so unless the caller can size *it* the two can end up different widths —
 * and the chevron then floats away from the control it belongs to and over
 * whatever sits next to it. Callers that put a Select in a flex layout should
 * size the wrapper here rather than only the select.
 */
export function Select({ className = "", wrapperClassName = "", children, ...rest }) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <select className={`${selectClasses} ${className}`} {...rest}>
        {children}
      </select>
      <Icon
        name="chevronDown"
        size={15}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
      />
    </div>
  );
}

/**
 * A live character counter for the label's action slot.
 *
 * Silent until the field is three-quarters full, then it appears. A counter that
 * is always on turns every textarea into a test; one that appears when the limit
 * is actually in reach is information.
 */
export function CharCount({ value, max }) {
  const length = String(value ?? "").length;
  if (length < max * 0.75) return null;

  return (
    <span className={`text-xs tabular-nums ${length >= max ? "text-danger" : "text-ink-3"}`}>
      {length}/{max}
    </span>
  );
}

/**
 * The design's switch: a 36×20 track with a 16px knob.
 *
 * A `<button role="switch">` rather than a checkbox, which is what the reference
 * uses and what lets the track and knob be drawn without fighting the platform's
 * own control. `aria-checked` carries the state to assistive technology, and the
 * label is passed in rather than assumed, because several of these sit in a grid
 * where the visible text is a separate cell.
 */
export function Toggle({ checked, onChange, label, disabled = false, className = "" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-outline-variant"
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/**
 * A radio group rendered as selectable cards.
 *
 * Used for the two-or-three-way choices that carry an explanation — client vs
 * provider, block time vs open extra hours. A native radio with a paragraph
 * beside it gives a 16px target for a decision that changes the rest of the
 * form; the whole card being the label gives the decision the weight it has.
 *
 * @param {Array<{value: string, title: string, hint?: string, icon?: string}>} props.options
 */
export function CardRadioGroup({ name, value, onChange, options, legend, columns = 2 }) {
  const cols = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];

  return (
    <fieldset>
      {legend && <legend className={labelClasses}>{legend}</legend>}

      <div className={`grid gap-2 ${cols}`}>
        {options.map((option) => {
          const selected = value === option.value;

          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition ${
                selected
                  ? "border-brand bg-brand-soft ring-2 ring-brand/10"
                  : "border-line bg-surface hover:border-line-strong hover:bg-subtle"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {option.icon && <Icon name={option.icon} size={16} className="text-ink-2" />}
                  {option.title}
                </span>
                {option.hint && (
                  <span className="mt-1 block text-xs leading-relaxed text-ink-3">
                    {option.hint}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
