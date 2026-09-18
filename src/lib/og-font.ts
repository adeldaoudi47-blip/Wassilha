// HIRFA Phase 2A — Arabic-capable font loader for next/og ImageResponse.
//
// `next/og`'s default font has no Arabic glyphs, so every Arabic string would
// render as tofu boxes. Cairo (SIL Open Font License) is bundled locally in
// `public/fonts/` so OG generation has NO runtime network dependency: it works
// on Vercel AND in the self-hosted standalone build, offline.
//
// Read once per process and memoised (the TTF is ~90KB).
import fs from 'node:fs';
import path from 'node:path';

type FontDef = { name: string; data: Buffer; weight: 400 | 700 | 900; style: 'normal' };

let cached: FontDef[] | null = null;
let loadError: Error | null = null;

function readFont(rel: string): Buffer {
  // process.cwd() is the app root in both `next dev` and the standalone server
  // (the build copies `public/` next to the standalone server entry).
  const file = path.join(process.cwd(), 'public', rel);
  return fs.readFileSync(file);
}

export function loadCairoFonts(): FontDef[] {
  if (cached) return cached;
  if (loadError) throw loadError;
  try {
    cached = [
      { name: 'Cairo', data: readFont('fonts/cairo-bold.ttf'), weight: 700, style: 'normal' },
      { name: 'Cairo', data: readFont('fonts/cairo-black.ttf'), weight: 900, style: 'normal' },
    ];
    return cached;
  } catch (e) {
    loadError = e as Error;
    throw loadError;
  }
}
