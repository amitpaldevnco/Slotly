/**
 * Upload validation.
 *
 * The brief is explicit that the server must never trust the file extension or
 * the client-reported size, so neither is used as evidence here:
 *
 *   - Size is read with `fs.stat` on the file as it actually landed on disk.
 *     multer's `file.size` and the browser's Content-Length are both
 *     attacker-controlled; the bytes on disk are not.
 *
 *   - Type is decided by sniffing the file's magic bytes with `file-type`, which
 *     reads the actual header. A script renamed to `avatar.jpg` has an extension
 *     and a declared MIME type that say JPEG and a header that does not, and
 *     only the header is consulted.
 *
 * multer's own `fileFilter` and `limits` still run first (see uploadMiddleware),
 * but purely as a cheap early reject while the request streams — they check the
 * client's claims, so they cannot be the last word. These functions are.
 *
 * This module decides whether a file is *acceptable*. Where an acceptable file
 * then goes — object storage or local disk — is `services/imageStorage.js`, and
 * the two are kept apart so the storage backend can change without anyone
 * touching the security-critical half.
 *
 * Accepted formats and size cap (also stated in the README):
 *   profile photos  — JPEG, PNG            max 5 MB
 *   service covers  — JPEG, PNG, WebP      max 5 MB
 */
import fs from "fs/promises";
import { fileTypeFromFile } from "file-type";

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Sniffed MIME types allowed per upload kind, mapped to the extension we save. */
const ACCEPTED_TYPES = {
  avatar: { "image/jpeg": ".jpg", "image/png": ".png" },
  service: { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" },
};

const HUMAN_READABLE = {
  avatar: "JPG or PNG",
  service: "JPG, PNG or WebP",
};

/**
 * Validates an uploaded file by inspecting the bytes on disk.
 *
 * @param {{path: string}} file The multer file object; only `path` is trusted.
 * @param {"avatar"|"service"} kind Which allow-list to apply.
 * @returns {Promise<{valid: boolean, error?: string, mime?: string, extension?: string}>}
 *   On success, `extension` is the canonical extension for the sniffed type —
 *   use it when naming the stored file so what is on disk matches what it is.
 * @throws {Error} If `kind` is not a known upload kind — a programming error,
 *   not a user error, so it is not swallowed into a validation message.
 */
export async function validateUploadedImage(file, kind) {
  if (!file || !file.path) {
    return { valid: false, error: "No file uploaded" };
  }

  const allowed = ACCEPTED_TYPES[kind];
  if (!allowed) throw new Error(`Unknown upload kind: ${kind}`);

  let stats;
  try {
    stats = await fs.stat(file.path);
  } catch {
    return { valid: false, error: "Uploaded file could not be read" };
  }

  if (stats.size === 0) {
    return { valid: false, error: "Uploaded file is empty" };
  }
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File is larger than the 5MB limit (${(stats.size / 1024 / 1024).toFixed(2)}MB)`,
    };
  }

  // Reads only the leading bytes, not the whole file.
  const sniffed = await fileTypeFromFile(file.path);

  if (!sniffed || !allowed[sniffed.mime]) {
    return {
      valid: false,
      error: `That file is not a supported image. Accepted formats: ${HUMAN_READABLE[kind]}.`,
    };
  }

  return { valid: true, mime: sniffed.mime, extension: allowed[sniffed.mime] };
}

/**
 * Builds the stored filename for an upload.
 *
 * The extension comes from the sniffed type, never from the original filename,
 * and the original name is discarded entirely — the simplest way to rule out
 * path traversal and null-byte tricks, since none of the user's characters
 * survive into the path.
 *
 * @param {number} ownerId
 * @param {string} extension Canonical extension from validateUploadedImage. Pass
 *   an empty string for a backend that derives the format itself, as Cloudinary
 *   does from the bytes.
 * @returns {string} e.g. "7_1717171717171.jpg"
 */
export function buildStoredFileName(ownerId, extension) {
  return `${Number(ownerId)}_${Date.now()}${extension}`;
}

/** Removes a rejected upload from the temp location multer wrote it to. */
export async function discardUpload(file) {
  if (!file?.path) return;
  try {
    await fs.unlink(file.path);
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Could not discard upload:", err.message);
  }
}
