/**
 * multer configuration for the two kinds of image upload the app accepts.
 *
 * This layer is the *cheap early reject*, not the security boundary. Everything
 * it can see — the declared MIME type, the Content-Length — comes from the
 * client, so it is used only to stop obviously wrong requests before they finish
 * streaming. The real check happens after the bytes are on disk, in
 * `utils/fileValidation.js`, which sniffs the file header.
 *
 * Two details matter here:
 *
 *   - Files land under a generated random name, never `file.originalname`. An
 *     original name is attacker-controlled and can contain `../`; feeding it to
 *     multer's `filename` callback would let a request choose where on disk to
 *     write. The controller renames the file to its final name only after
 *     validation passes.
 *
 *   - `limits.fileSize` makes multer abort a stream that exceeds the cap instead
 *     of buffering an unbounded upload to disk first.
 */
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { MAX_FILE_SIZE_BYTES } from "../utils/fileValidation.js";

/** MIME types worth letting through to the real check. Claims, not evidence. */
const CLAIMED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function ensureDirectory(...segments) {
  const dir = path.join(process.cwd(), "uploads", ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const avatarsDir = ensureDirectory("avatars");
const servicesDir = ensureDirectory("services");

/**
 * Builds a multer instance writing to `destination` under random temp names.
 *
 * @param {string} destination Absolute directory path.
 */
function createUploader(destination) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, destination),
    // A random name with no extension: nothing the client sent reaches the
    // filesystem, and the absent extension means the file is not servable even
    // if it somehow lingers before validation renames or deletes it.
    filename: (req, file, cb) => cb(null, `tmp_${crypto.randomUUID()}`),
  });

  return multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
      if (CLAIMED_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
      // Reject by passing `false`, not an Error: the controller then sees no
      // `req.file` and returns a field-level validation message, which reads
      // better than a 500 from the global error handler.
      cb(null, false);
    },
  });
}

/** Profile photos. Final type allow-list is applied in fileValidation. */
export const upload = createUploader(avatarsDir);

/** Service cover images. */
export const uploadServiceImage = createUploader(servicesDir);
