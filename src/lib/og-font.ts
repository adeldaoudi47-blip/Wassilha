// HIRFA Phase 2A — Arabic-capable font loader for next/og ImageResponse.
//
// `next/og`'s default font has no Arabic glyphs, so every Arabic string would
// render as tofu boxes. Cairo (SIL Open Font License) is bundled locally in
// `public/fonts/` so OG generation has NO external font CDN dependency: it
// works on Vercel AND in the self-hosted standalone build, offline.
//
// WHY `fetch` AND NOT `node:fs` (this is the "Failed to load dynamic font" fix):
// the previous version read the TTF with `fs.readFileSync(path.join(cwd,
// 'public', rel))`. That works locally and in `next start`, but Vercel ships
// serverless functions through **output-file tracing**: only files reachable
// from *statically analysable* imports are bundled. A `path.join` with a
// runtime-built relative path is NOT statically analysable, so the `.ttf` is
// simply absent from the deployed function, Satori is handed an unreadable
// buffer, and every OG render throws "Failed to load dynamic font" (the catch
// then silently redirects to the avatar, so the bug looked like a styling
// issue).
//
// `new URL('/fonts/cairo-bold.ttf', base)` + `fetch()` fixes it: the URL is
// absolute and resolved at RUNTIME against the serving origin, so the font is
// read over HTTP from our own `/fonts/*` route. Vercel serves `public/` as
// static assets, so this is same-origin, free, cached by the CDN, and needs no
// tracing at all.
//
// A `node:fs` path is kept as a FALLBACK for the self-hosted standalone build
// (where reading the file directly is cheaper than an HTTP round-trip), so the
// change is safe in both environments rather than trading one for the other.

import { SITE_URL } from './site';

type FontDef = {
  name: string;
  // ImageResponse accepts ArrayBuffer; that is what fetch().arrayBuffer() gives.
  data: ArrayBuffer;
  weight: 400 | 700 | 900;
  style: 'normal';
};

const FONT_FILES: Array<{ weight: 400 | 700 | 900; file: string }> = [
  { weight: 400, file: 'cairo-bold.ttf' },
  { weight: 700, file: 'cairo-bold.ttf' },
  { weight: 900, file: 'cairo-black.ttf' },
];

// Memoised on the PROMISE, not the resolved value: a cold-start render fires
// several OG routes concurrently and must not issue duplicate reads.
let cached: Promise<FontDef[]> | null = null;

async function readViaHttp(base: string, file: string): Promise<ArrayBuffer> {
  const res = await fetch(new URL(`/fonts/${file}`, base), { cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for /fonts/${file}`);
  return res.arrayBuffer();
}

async function readViaFs(file: string): Promise<ArrayBuffer> {
  // Lazily required so this module stays loadable in runtimes without node:fs.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const p = path.join(process.cwd(), 'public', 'fonts', file);
  // Copy into a standalone ArrayBuffer: the Buffer view Satori receives must
  // not be a view into a pooled Node Buffer, or it can be recycled mid-render.
  const buf = fs.readFileSync(p);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function loadOnce(origin: string): Promise<FontDef[]> {
  const fonts: FontDef[] = [];
  for (const { weight, file } of FONT_FILES) {
    let data: ArrayBuffer;
    try {
      data = await readViaHttp(origin, file);
    } catch {
      // Self-hosted / tracing-free environments: fall back to the filesystem.
      data = await readViaFs(file);
    }
    fonts.push({ name: 'Cairo', data, weight, style: 'normal' });
  }
  return fonts;
}

/**
 * Load the Cairo faces. `origin` should be the URL of the current request so a
 * preview deployment reads its own fonts rather than production's.
 */
export function loadCairoFonts(origin: string = SITE_URL): Promise<FontDef[]> {
  if (!cached) cached = loadOnce(origin);
  return cached;
}
