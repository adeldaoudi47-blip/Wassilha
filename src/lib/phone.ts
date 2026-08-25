// Unified Algerian mobile-phone normalization + validation.
//
// SINGLE SOURCE OF TRUTH shared by the web frontend (auth-flow) and the API
// routes (send-otp / verify-otp), so both sides always reach the same verdict
// on any input.
//
// Accepted raw formats (spaces / dashes / parentheses / dots / invisible
// keyboard marks are tolerated anywhere):
//   05XXXXXXXX | 06XXXXXXXX | 07XXXXXXXX
//   +2135XXXXXXXX | +2136XXXXXXXX | +2137XXXXXXXX
//   002135XXXXXXX..002137XXXXXXX | 2135XXXXXXX..2137XXXXXXX (12 digits)
//
// Canonical output: 05XXXXXXXX | 06XXXXXXXX | 07XXXXXXXX

/**
 * Characters silently ignored while parsing: every Unicode space variant
 * (incl. NBSP), directional/isolating marks injected by Arabic & mobile
 * keyboards, digits separators like dots, dashes and parentheses.
 * NOTE: '+' is intentionally preserved for the country-code branches.
 */
const NOISE_RE =
  /[\s\u00A0\u1680\u2000-\u200F\u2028\u2029\u202A-\u202E\u205F\u3000\u2066-\u2069().\-]/g;

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digit variants -> ASCII 0-9. */
function toAsciiDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Normalizes any accepted Algerian mobile representation to its canonical
 * local form (05XXXXXXXX | 06XXXXXXXX | 07XXXXXXXX).
 * Returns `null` when the input cannot be a valid Algerian mobile number
 * (wrong country code, wrong length, letters, empty, non-string, ...).
 */
export function normalizeAlgerianPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;

  let v = toAsciiDigits(input).replace(NOISE_RE, '');

  // International prefixes -> national leading zero.
  if (v.startsWith('+213')) v = '0' + v.slice(4);
  else if (v.startsWith('00213')) v = '0' + v.slice(5);
  else if (/^213\d{9}$/.test(v)) v = '0' + v.slice(3);

  return /^0[567]\d{8}$/.test(v) ? v : null;
}

/** Strict canonical pattern (the post-normalization shape only). */
export const ALGERIAN_PHONE_RE = /^0[567]\d{8}$/;

/** Convenience predicate built on the same normalizer. */
export function isValidAlgerianPhone(input: unknown): boolean {
  return normalizeAlgerianPhone(input) !== null;
}