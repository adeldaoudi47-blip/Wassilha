// One-off: confirm the bundled Cairo TTFs actually cover the Arabic block
// (U+0600–U+06FF). If the glyph set were Latin-only, every Arabic string in
// the OG images would render as tofu boxes.
//
// Run with: npx tsx src/scripts/verify-og-font.ts
import fs from 'node:fs';
import path from 'node:path';

function readUInt16(buf: Buffer, offset: number): number {
  return buf.readUInt16BE(offset);
}
function readUInt32(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}

/** Minimal TrueType cmap parser (formats 4 and 12). */
function coveredCodePoints(file: string): Set<number> {
  const buf = fs.readFileSync(file);
  const numTables = readUInt16(buf, 4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = buf.toString('ascii', rec, rec + 4);
    if (tag === 'cmap') {
      cmapOffset = readUInt32(buf, rec + 8);
      break;
    }
  }
  if (cmapOffset < 0) throw new Error(`no cmap table in ${file}`);
  const subtables = readUInt16(buf, cmapOffset + 2);
  const cps = new Set<number>();
  for (let i = 0; i < subtables; i++) {
    const rec = cmapOffset + 4 + i * 8;
    // The format lives AT the subtable data, not in the directory record.
    const dataOffset = cmapOffset + readUInt32(buf, rec + 4);
    const format = readUInt16(buf, dataOffset);
    if (format === 4) {
      const segCount = readUInt16(buf, dataOffset + 6) / 2;
      const endCodeStart = dataOffset + 14;
      const startCodeStart = endCodeStart + segCount * 2 + 2;
      for (let s = 0; s < segCount; s++) {
        const end = readUInt16(buf, endCodeStart + s * 2);
        const start = readUInt16(buf, startCodeStart + s * 2);
        if (start === 0xffff && end === 0xffff) continue;
        for (let c = start; c <= end; c++) cps.add(c);
      }
    } else if (format === 12) {
      const nGroups = readUInt32(buf, dataOffset + 12);
      for (let g = 0; g < nGroups; g++) {
        const start = readUInt32(buf, dataOffset + 16 + g * 12);
        const end = readUInt32(buf, dataOffset + 16 + g * 12 + 4);
        for (let c = start; c <= end; c++) cps.add(c);
      }
    }
  }
  return cps;
}

function main() {
  const fonts = ['fonts/cairo-bold.ttf', 'fonts/cairo-black.ttf'];
  let ok = true;
  for (const rel of fonts) {
    const file = path.join(process.cwd(), 'public', rel);
    if (!fs.existsSync(file)) {
      console.log(`[FAIL] ${rel}: file missing`);
      ok = false;
      continue;
    }
    const cps = coveredCodePoints(file);
    const arabicSamples = [0x0623, 0x0644, 0x0643, 0x064a, 0x0643]; // أ ل ك ي ك
    const hasArabic = arabicSamples.every((c) => cps.has(c));
    const arabicInRange = [...cps].filter((c) => c >= 0x0600 && c <= 0x06ff).length;
    console.log(
      `[${hasArabic ? 'PASS' : 'FAIL'}] ${rel}: ${cps.size} code points, ${arabicInRange} in the Arabic block U+0600–U+06FF`
    );
    ok = ok && hasArabic;
  }
  console.log(ok ? '\nCAIRO COVERS ARABIC — OG text will render real glyphs' : '\nARABIC NOT COVERED');
  process.exit(ok ? 0 : 1);
}

main();
