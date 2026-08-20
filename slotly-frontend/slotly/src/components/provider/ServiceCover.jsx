/**
 * A service's cover image, with the fallback every caller needs.
 *
 * A cover image is optional on `services`, and the ones that exist are loaded
 * from wherever they were stored — Cloudinary in a deployed environment, local
 * disk in development, and rows written before that switch still hold
 * `/uploads/...` paths. So there are three outcomes to draw, not one: an image,
 * no image at all, and an image whose URL no longer resolves.
 *
 * The third is not hypothetical. Render's free tier rebuilds a container's
 * filesystem whenever the service wakes from sleep, so a locally stored cover
 * uploaded before a restart is simply gone, and its row still points at it.
 * Without the `onError` fallback the page renders a broken-image icon, which
 * looks like the app is failing rather than like a service without a picture.
 *
 * All three land on the same footprint, so a list of services keeps its
 * alignment whether or not any of them has a cover.
 *
 * ## Why this is one component and not a copy in each list
 *
 * The fallback used to live privately inside `ServiceCard`, so the provider's
 * own services page had it and every other place a service appeared had nothing
 * — the public profile drew no image at all. Sharing it means a new list gets
 * the missing and broken cases right by construction instead of by remembering.
 *
 * `className` carries the size and shape rather than a `size` prop: the callers
 * want genuinely different footprints (a 48px square tile in the management
 * grid, a landscape thumbnail on the public page), and enumerating those as
 * named variants would invent vocabulary for something Tailwind already says
 * plainly.
 *
 * The border is on the fallback only, and not on a real cover. A photograph
 * supplies its own edge, and the reference design draws none; the placeholder is
 * a flat tinted rectangle that needs one or it reads as a gap in the layout
 * rather than a deliberate stand-in. A caller that wants a border on the image
 * too can pass one in `className`.
 */

import { useState } from "react";
import { imageUrl } from "../../api/client";
import Icon from "../ui/Icon";

/**
 * @param {object} props
 * @param {string|null|undefined} props.coverImage The value stored on the
 *   service — an absolute URL, an `/uploads/...` path, or null. Resolved here
 *   with `imageUrl` rather than by the caller, matching `Avatar`.
 * @param {string} [props.name] The service's name. Used only as a `title`
 *   tooltip; see the note on `alt` below.
 * @param {string} [props.className] Size, shape and any spacing. Must include
 *   its own dimensions — there is no default footprint. Add a border here if the
 *   image itself should carry one; the fallback always has its own.
 * @param {number} [props.iconSize] Pixel size of the fallback glyph, so it can
 *   be scaled to whatever `className` sets.
 */
export default function ServiceCover({ coverImage, name, className = "", iconSize = 24 }) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(coverImage);

  const shared = `shrink-0 ${className}`;

  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className={`flex items-center justify-center border border-outline-variant/50 bg-surface-container-low text-primary ${shared}`}
      >
        <Icon name="category" size={iconSize} />
      </span>
    );
  }

  return (
    <img
      src={src}
      // Deliberately empty, not the service name. Every place this renders puts
      // the name in text immediately beside it, so naming the image would make a
      // screen reader announce the same service twice. An empty alt marks it as
      // decorative, which is what a cover photo next to its own title is.
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`object-cover ${shared}`}
      title={name}
    />
  );
}
