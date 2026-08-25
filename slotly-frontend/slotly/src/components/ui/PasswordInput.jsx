/**
 * A password box with a show/hide toggle.
 *
 * A masked field that cannot be unmasked is a guess: the person typing has no
 * way to tell a typo from a correct entry, which matters most on exactly the
 * forms where a typo is expensive — sign-up, where the password is taken once
 * and a mistake locks the account, and reset, which has the same shape.
 *
 * The toggle is a `<button type="button">` so it cannot submit the form it sits
 * inside, and it is inside the input's own box rather than beside it so the
 * control still reads as one field.
 */
import { useId, useState } from "react";
import Icon from "./Icon";
import { inputClasses } from "../../lib/ui";

/**
 * @param {object} props Everything else is forwarded to the `<input>`, including
 *   the `id`, `aria-describedby` and `aria-invalid` that `Field` clones in.
 */
export default function PasswordInput({ className = "", ...rest }) {
  const [visible, setVisible] = useState(false);
  const describedBy = useId();

  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? "text" : "password"}
        className={`${inputClasses} pr-11 ${className}`}
      />

      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        // The state is in the label rather than in `aria-pressed`, because what
        // a screen-reader user needs is the action available now, not the
        // toggle's internal position.
        aria-label={visible ? "Hide password" : "Show password"}
        aria-describedby={describedBy}
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Icon name={visible ? "visibility_off" : "visibility"} size={18} />
      </button>

      <span id={describedBy} className="sr-only">
        Your password is {visible ? "visible" : "hidden"}.
      </span>
    </div>
  );
}
