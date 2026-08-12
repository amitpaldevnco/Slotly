//The pill showing a booking's status.
import { statusStyle } from "../../lib/ui";

export default function StatusBadge({ status, dot = false, className = "" }) {
  const { label, className: variant, dot: dotClass } = statusStyle(status);

  return (
    <span className={`${variant} ${className}`}>
      {dot && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />}
      {label}
    </span>
  );
}
