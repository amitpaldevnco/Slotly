// A person's photo, or their initial when there is not one.

import { useState } from "react";
import { imageUrl } from "../../api/client";

const SIZES = {
  xs: "h-6 w-6 text-[0.625rem]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-lg sm:h-20 sm:w-20 sm:text-xl",
  // The profile page's own portrait. A separate step rather than a `className`
  // override on `xl`, because two competing `h-*` utilities are resolved by
  // their order in the compiled stylesheet, not by the class attribute.
  "2xl": "h-28 w-28 text-2xl sm:h-32 sm:w-32 sm:text-3xl",
};


export default function Avatar({ src, name, size = "md", ring = false, className = "" }) {
  const [failed, setFailed] = useState(false);
  const resolved = imageUrl(src);

  const shell = `shrink-0 overflow-hidden rounded-full ${SIZES[size] || SIZES.md} ${
    ring ? "ring-2 ring-brand ring-offset-2 ring-offset-surface" : ""
  } ${className}`;

  if (!resolved || failed) {
    return (
      <span
        aria-hidden="true"
        className={`${shell} flex items-center justify-center bg-brand-soft font-semibold text-brand`}
      >
        {name?.charAt(0).toUpperCase() || "?"}
      </span>
    );
  }

  return (
    <img
      src={resolved}
      // Empty alt on purpose. Every avatar in the app sits next to the person's
      // name in text, so describing it as well is a duplicate announcement.
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${shell} object-cover`}
    />
  );
}
