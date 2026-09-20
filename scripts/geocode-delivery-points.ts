/**
 * scripts/geocode-delivery-points.ts
 * ----------------------------------
 * C1 — populate VERIFIED coordinates for the 41 delivery areas and the
 * ~65 delivery landmarks of El Guerrara, so the customer flow can compute
 * real per-km pricing instead of a flat city-centre fare.
 *
 * Data source: OpenStreetMap Nominatim. We NEVER invent coordinates:
 * anything Nominatim cannot resolve — or that resolves implausibly far
 * from the verified town centre — is skipped and listed in the summary so
 * an admin can enter it by hand.
 *
 * Usage:
 *     npx tsx scripts/geocode-delivery-points.ts
 *   (or: bun scripts/geocode-delivery-points.ts)
 *
 * It overwrites src/lib/area-coords.generated.ts, which the app imports at
 * build time; the picker falls back to GUERRARA_CENTER for any id that is
 * still absent, so an incomplete run degrades gracefully to flat pricing
 * rather than to wrong positions.
 *
 * Nominatim usage policy requires identification and ≤ 1 request/second;
 * both are honoured below.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { deliveryAreas, deliveryPoints } from '../src/lib/delivery-data';
import { GUERRARA_CENTER, haversineKm } from '../src/lib/wassilha-data';

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'WassilhaGeocoder/1.0 (El Guerrara delivery app)';
const RATE_LIMIT_MS = 1100; // Nominatim policy: max 1 request per second
const MAX_RADIUS_KM = 30; // reject results outside the commune of Guerrara

const outPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'lib',
  'area-coords.generated.ts',
);

type Coord = { lat: number; lng: number };
type NominatimRow = {
  lat: string;
  lon: string;
  display_name: string;
  addresstype?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geocode(query: string): Promise<(Coord & { label: string }) | null> {
  const url = `${NOMINATIM_SEARCH}?${new URLSearchParams({
    q: query,
    format: 'json',
    limit: '5',
    'accept-language': 'ar',
  }).toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch {
    console.error(`  ✖ network error for "${query}"`);
    return null;
  }
  if (!res.ok) {
    console.error(`  ✖ HTTP ${res.status} for "${query}"`);
    return null;
  }

  const rows = (await res.json()) as NominatimRow[];
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // Prefer a result inside the commune; only fall back to the raw first
  // hit if none of them are (the radius check below still rejects it).
  const inTown = rows.filter(
    (r) => haversineKm(GUERRARA_CENTER, { lat: Number(r.lat), lng: Number(r.lon) }) <= MAX_RADIUS_KM,
  );
  const best = (inTown.length ? inTown : rows)[0];
  return { lat: Number(best.lat), lng: Number(best.lon), label: best.display_name };
}

async function geocodeWithFallback(queries: string[]): Promise<(Coord & { label: string }) | null> {
  for (const q of queries) {
    const hit = await geocode(q);
    if (hit) return hit;
    await sleep(RATE_LIMIT_MS);
  }
  return null;
}

async function main(): Promise<void> {
  const areaCoords: Record<string, Coord> = {};
  const pointCoords: Record<string, Coord> = {};
  const missedAreas: string[] = [];
  const missedPoints: string[] = [];

  console.log(
    `\n📍 Geocoding ${deliveryAreas.length} areas + ${deliveryPoints.length} points (≈1 req/s)…\n`,
  );

  // ---- areas ----
  for (const [nameAr, nameFr, slug] of deliveryAreas) {
    console.log(`• area ${slug}`);
    const hit = await geocodeWithFallback([
      `${nameFr}, El Guerrara, Ghardaïa, Algeria`,
      `${nameAr}, القرارة, غرداية, الجزائر`,
    ]);
    if (hit && haversineKm(GUERRARA_CENTER, hit) <= MAX_RADIUS_KM) {
      areaCoords[slug] = { lat: hit.lat, lng: hit.lng };
      console.log(`   → ${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}  ← ${hit.label.slice(0, 70)}`);
    } else if (hit) {
      console.log(`   ✖ rejected: ${haversineKm(GUERRARA_CENTER, hit).toFixed(1)} km from centre`);
      missedAreas.push(slug);
    } else {
      console.log('   ✖ not found');
      missedAreas.push(slug);
    }
    await sleep(RATE_LIMIT_MS);
  }

  // ---- points ----
  for (const [areaSlug, nameAr, nameFr] of deliveryPoints) {
    const id = `${areaSlug}--${nameAr}`;
    console.log(`• point ${nameAr}`);
    const hit = await geocodeWithFallback([
      `${nameFr}, ${areaSlug}, El Guerrara, Ghardaïa, Algeria`,
      `${nameAr}, القرارة, غرداية, الجزائر`,
    ]);
    if (hit && haversineKm(GUERRARA_CENTER, hit) <= MAX_RADIUS_KM) {
      pointCoords[id] = { lat: hit.lat, lng: hit.lng };
      console.log(`   → ${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}`);
    } else {
      console.log(hit ? '   ✖ rejected: too far from centre' : '   ✖ not found');
      missedPoints.push(nameAr);
    }
    await sleep(RATE_LIMIT_MS);
  }

  // ---- write the generated module ----
  const header = [
    '// C1 (real pricing) — GENERATED FILE. Do not edit by hand.',
    '//',
    '// Per-area and per-delivery-point coordinates, keyed by area slug and',
    '// by the picker point id ("<areaSlug>--<nameAr>"). Regenerate with:',
    '//',
    '//     npx tsx scripts/geocode-delivery-points.ts',
    '//',
    '// Source: OpenStreetMap Nominatim. Nothing is invented: ids that could',
    '// not be resolved (or resolved implausibly far from the verified town',
    '// centre) are omitted, and the picker falls back to GUERRARA_CENTER',
    '// for them. See the script stdout for the list to enter manually.',
    '',
  ].join('\n');

  const body = `${header}export const AREA_COORDS: Readonly<Record<string, { lat: number; lng: number }>> = ${JSON.stringify(
    areaCoords,
    null,
    2,
  )};

export const POINT_COORDS: Readonly<Record<string, { lat: number; lng: number }>> = ${JSON.stringify(
    pointCoords,
    null,
    2,
  )};
`;

  writeFileSync(outPath, body, 'utf8');

  console.log(
    `\n✅ Wrote ${Object.keys(areaCoords).length}/${deliveryAreas.length} areas and ` +
      `${Object.keys(pointCoords).length}/${deliveryPoints.length} points\n   → ${outPath}`,
  );
  if (missedAreas.length) {
    console.log(`⚠️ areas needing manual entry (${missedAreas.length}): ${missedAreas.join('، ')}`);
  }
  if (missedPoints.length) {
    console.log(`⚠️ points needing manual entry (${missedPoints.length}): ${missedPoints.join('، ')}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

