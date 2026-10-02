// ---------------------------------------------------------------------------
// PHASE 8 — SHARED IMAGE-UPLOAD VALIDATION.
//
// `/api/craft/upload` and `/api/uploads/order-image` had drifted: Phase 5
// hardened the order-image route with a MIME allow-list (closing a stored-XSS
// vector where `payload.svg` renamed to `.jpg` was served from the public CDN),
// but the craft uploader only checked the file EXTENSION. A seller could
// therefore upload an SVG / HTML / script and have it stored and publicly served.
//
// This module is the single implementation both routes now call, so the two
// cannot drift again. It is deliberately small and pure — no I/O, no Prisma —
// so it is unit-testable without a database or a Blob store.
// ---------------------------------------------------------------------------

/** 5 MB, matching the cap both routes already enforced. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Raster formats only. `image/svg+xml` is deliberately ABSENT: SVG is an XML
 * document that can carry <script>, and blobs are served from a public host.
 * `gif` is kept for backward compatibility (sellers may already have uploaded
 * animated product images) but is now MIME-validated like the rest.
 */
export const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const ALLOWED_IMAGE_EXT = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
]);

export type UploadRejection =
  | 'missingFile'
  | 'emptyFile'
  | 'fileTooLarge'
  | 'unsupportedType'
  | 'extensionMimeMismatch';

export type UploadValidation =
  | { ok: true; ext: string }
  | { ok: false; error: UploadRejection };

/** Lowercased, stripped-to-alphanumeric extension, or '' when there is none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return '';
  return name
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Validate an uploaded image. Order matters only for the error the caller sees;
 * every rejection is a 400 and none of them reaches the Blob store.
 */
export function validateImageUpload(file: unknown): UploadValidation {
  if (!(file instanceof File)) {
    return { ok: false, error: 'missingFile' };
  }
  // An empty part is a broken client, not a photo: reject before it becomes a
  // zero-byte blob no card can render.
  if (file.size === 0) {
    return { ok: false, error: 'emptyFile' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'fileTooLarge' };
  }
  const ext = extensionOf(file.name || '');
  // The browser-reported MIME type must be one of the raster formats. This is
  // the check the craft uploader was missing entirely.
  if (!ALLOWED_IMAGE_MIME.has(file.type)) {
    return { ok: false, error: 'unsupportedType' };
  }
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    return { ok: false, error: 'unsupportedType' };
  }
  // Either check alone is defeatable on its own: an attacker controls both the
  // filename and the Content-Type header, so the two must describe the SAME
  // raster format.
  const mimeExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[
    file.type
  ];
  const normalisedExt = ext === 'jpeg' ? 'jpg' : ext;
  if (mimeExt !== normalisedExt) {
    return { ok: false, error: 'extensionMimeMismatch' };
  }
  return { ok: true, ext: normalisedExt };
}

/**
 * Build a Blob key. The caller supplies the random component (`crypto.randomUUID()`)
 * rather than relying on Vercel's `addRandomSuffix`, which both upload routes
 * disable — so the key is already unguessable and collision-free without it.
 *
 * `originalName` is deliberately NOT part of the key: a user-supplied filename
 * is the classic path to key traversal and extension smuggling, and nothing
 * needs the original name once the ext has been validated.
 */
export function buildImageKey(namespace: string, id: string, ext: string): string {
  return `${namespace}/${id}/${crypto.randomUUID()}.${ext}`;
}