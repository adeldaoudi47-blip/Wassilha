// Regenerate the PWA icon set from the single 1600x1600 master.
//
// The manifest icons in public/ are committed binaries, which means they go
// stale silently: change the brand, forget this script, and Android keeps
// showing the old mark on the home screen while the app shows the new one.
//
//   node scripts/generate-icons.mjs
//
// Requires `sharp`, which is already a production dependency (Next.js uses it
// for image optimisation), so this adds no new install.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src', 'app', 'icon.png');
const OUT = path.join(root, 'public');

/** Brand green — kept in sync with `theme_color` in app/manifest.ts. */
const BRAND = '#0E6B5E';

/**
 * Android crops a maskable icon to whatever shape the launcher uses, and only
 * the inner 80% is guaranteed visible. A full-bleed logo loses its corners, so
 * the mark is inset onto a solid brand square.
 */
const MASKABLE_INSET_RATIO = 0.62;

const outputs = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

await mkdir(OUT, { recursive: true });

for (const { file, size, maskable } of outputs) {
  const dest = path.join(OUT, file);

  if (!maskable) {
    await sharp(SRC).resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toFile(dest);
  } else {
    const inner = Math.round(size * MASKABLE_INSET_RATIO);
    const pad = Math.round((size - inner) / 2);
    const logo = await sharp(SRC).resize(inner, inner, { fit: 'cover' })
      .png()
      .toBuffer();

    await sharp({
      create: { width: size, height: size, channels: 4, background: BRAND },
    })
      .composite([{ input: logo, top: pad, left: pad, blend: 'over' }])
      .png({ compressionLevel: 9 })
      .toFile(dest);
  }

  console.log(`${file.padEnd(24)} ${size}x${size}${maskable ? ' (maskable)' : ''}`);
}
