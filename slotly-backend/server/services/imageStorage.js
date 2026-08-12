/**
 * Where a validated image actually goes once it has passed inspection.
 *
 * This module is deliberately the *only* thing in the codebase that knows
 * whether an image ends up on the local filesystem or in object storage.
 * `utils/fileValidation.js` decides whether a file is acceptable; this decides
 * where an acceptable file lives. Keeping those two jobs apart is what let the
 * storage backend change without touching a single line of validation.
 *
 * ## Why there are two backends rather than one
 *
 * Disk storage is what the brief permits and what this app shipped with, and it
 * is still the right answer for local development: it needs no account, no
 * network and no credentials, so `git clone && npm install && npm run dev` keeps
 * working for anyone.
 *
 * It is the wrong answer on the deployed host. Render's free tier gives a
 * container an ephemeral filesystem — it is rebuilt from the image every time
 * the service restarts, and a free service restarts whenever it wakes from its
 * idle sleep, not merely when it is redeployed. So an avatar uploaded at 10:00
 * was genuinely gone by 10:30, which reads to a user as "the app lost my photo".
 * The bytes were never corrupted; the disk they were on stopped existing.
 *
 * Object storage fixes that properly, because the file stops living on the web
 * server at all.
 *
 * ## How the backend is chosen
 *
 * By whether Cloudinary credentials are present in the environment — never by a
 * NODE_ENV check. A missing credential is the honest signal that object storage
 * was not configured, and it means a developer who has not set one up gets disk
 * rather than a crash, while production gets Cloudinary the moment the three
 * variables are set. `describeBackend()` reports which one is live so the boot
 * log says so out loud instead of leaving it to be discovered later.
 */
import fs from "fs/promises";
import path from "path";
import { v2 as cloudinary } from "cloudinary";
import { buildStoredFileName } from "../utils/fileValidation.js";

/**
 * True when all three Cloudinary variables are set.
 *
 * All three, not any: a partial configuration is a mistake, and silently
 * falling back to disk because only two were pasted in would hide it until the
 * first image disappeared.
 */
export const usingCloudinary = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

if (usingCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true, // https URLs only; a mixed-content image is a broken image.
  });
}

/** Folder names inside the Cloudinary account, mirroring the disk layout. */
const REMOTE_FOLDER = {
  avatar: "slotly/avatars",
  service: "slotly/services",
};

/** Sub-directory of `uploads/` each kind is written to on disk. */
const LOCAL_FOLDER = {
  avatar: "avatars",
  service: "services",
};

/**
 * Stores an already-validated upload and returns the URL to persist.
 *
 * The file must have passed `validateUploadedImage` first — this function does
 * no checking of its own by design, so there is exactly one place where the
 * "is this really a JPEG?" question is answered.
 *
 * @param {object} args
 * @param {{path: string}} args.file The multer file. Only `path` is used.
 * @param {"avatar"|"service"} args.kind Which allow-list it was validated under.
 * @param {string} args.extension Canonical extension from validateUploadedImage
 *   — the sniffed one, never the client's.
 * @param {number} args.ownerId User id, used to name the stored object.
 * @returns {Promise<string>} The value to write to `avatar_url` / `cover_image`.
 *   An absolute `https://` URL on Cloudinary, or an app-relative
 *   `/uploads/<kind>/<name>` path on disk. Both are understood by the frontend's
 *   `imageUrl()` helper, which passes absolute URLs through untouched.
 * @throws {Error} If the upload or the rename fails. Callers treat this as a
 *   500 rather than a validation error, because the file was already judged
 *   acceptable — a failure here is the server's fault, not the user's.
 */
export async function storeImage({ file, kind, extension, ownerId }) {
  if (usingCloudinary) {
    // `public_id` carries no extension: Cloudinary derives the format from the
    // bytes, exactly as our own validation did, and appends it to the URL. The
    // timestamp in the name makes each upload a distinct object rather than
    // overwriting the previous one, so a half-finished replacement can never
    // leave a user with no image at all.
    const result = await cloudinary.uploader.upload(file.path, {
      folder: REMOTE_FOLDER[kind],
      public_id: buildStoredFileName(ownerId, ""),
      resource_type: "image",
      overwrite: false,
    });

    // The bytes are safely remote now, so the temporary copy multer wrote is
    // just litter. A failure to remove it must not fail the request — the
    // upload itself succeeded.
    await fs.unlink(file.path).catch(() => {});

    return result.secure_url;
  }

  const fileName = buildStoredFileName(ownerId, extension);
  await fs.rename(file.path, path.join(path.dirname(file.path), fileName));

  return `/uploads/${LOCAL_FOLDER[kind]}/${fileName}`;
}

/**
 * Removes a previously stored image, ignoring "already gone".
 *
 * Handles both backends, because a database populated before the switch to
 * Cloudinary still holds `/uploads/...` paths and those rows must stay
 * deletable. Anything that is neither — an OAuth provider's avatar URL on
 * googleusercontent.com, say — is left alone: the app did not put it there and
 * has no business removing it.
 *
 * @param {string|null|undefined} storedUrl A value from `avatar_url` or
 *   `cover_image`.
 * @returns {Promise<void>} Always resolves. Deleting an old image is
 *   housekeeping, and a failure here must never fail the request that replaced
 *   it — the new image is already in place by the time this is called.
 */
export async function deleteImage(storedUrl) {
  if (!storedUrl || typeof storedUrl !== "string") return;

  if (storedUrl.startsWith("/uploads/")) {
    await deleteLocalFile(storedUrl);
    return;
  }

  if (!usingCloudinary) return;

  const publicId = cloudinaryPublicIdFrom(storedUrl);
  if (!publicId) return;

  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch (err) {
    console.error("Could not delete remote image:", err.message);
  }
}

/**
 * Recovers the `public_id` Cloudinary needs for a delete from the URL we stored.
 *
 * A Cloudinary URL looks like:
 *   https://res.cloudinary.com/<cloud>/image/upload/v1712345678/slotly/avatars/7_1712345678.jpg
 *
 * The id is everything after the version segment, minus the extension —
 * `slotly/avatars/7_1712345678`. Parsing it back out of the URL avoids storing a
 * second column that could drift out of step with the first.
 *
 * @returns {string|null} null for any URL that is not one of ours, which is the
 *   safe answer: it means nothing gets deleted.
 */
function cloudinaryPublicIdFrom(url) {
  const match = /\/image\/upload\/(?:v\d+\/)?(.+)$/.exec(url);
  if (!match) return null;

  const withoutExtension = match[1].replace(/\.[a-z0-9]+$/i, "");
  // Only ever touch objects this app created. A URL pointing somewhere else in
  // the same Cloudinary account is not ours to delete.
  return withoutExtension.startsWith("slotly/") ? withoutExtension : null;
}

/**
 * Deletes a file under the app's own uploads directory.
 *
 * The path is resolved before it is compared, so a corrupted or hostile
 * database value like "/uploads/../../etc/passwd" normalises to somewhere
 * outside `uploadsRoot` and is rejected here rather than acted on.
 */
async function deleteLocalFile(storedPath) {
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const absolute = path.resolve(process.cwd(), `.${storedPath}`);

  if (!absolute.startsWith(uploadsRoot + path.sep)) return;

  try {
    await fs.unlink(absolute);
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Could not delete stored file:", err.message);
  }
}

/**
 * One line describing the live backend, for the boot log.
 *
 * Worth printing on every start: "why did my image disappear?" is much easier
 * to answer when the deploy log already says which storage the process chose.
 *
 * @returns {string}
 */
export function describeBackend() {
  return usingCloudinary
    ? `Image storage: Cloudinary (cloud "${process.env.CLOUDINARY_CLOUD_NAME}") — uploads persist across restarts.`
    : "Image storage: local disk under uploads/ — fine locally, but files are lost whenever the host restarts the container.";
}
