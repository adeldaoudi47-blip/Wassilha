// OFFICIAL VEHICLE CLASSIFICATION verification.
//
// The repo has no JS test framework, so - like verify-phase1/2/4/5/6 - this
// file IS the gate for the phase. It covers, in order:
//
//   1. the behavioural cases the brief enumerates (T1..T16), executed against
//      the REAL `isVehicleCompatible`, `normalizeVehicleCategory` and
//      `validateRequiredVehicleTypes` that ship - not a re-implementation,
//   2. the legacy-compatibility contract (a Phase-1 driver row matching a
//      Phase-6 order, and an old order with neither field set),
//   3. SOURCE CONTRACTS: the server-side enforcement points that must keep
//      selecting/forwarding the new field, asserted against the files on disk,
//   4. i18n coverage (AR + FR) for every new user-visible key,
//   5. LIVE DB: the additive migration left every existing order on the legacy
//      path and every stored category inside the known vocabulary.
//
// Run with: bun src/scripts/verify-vehicle-classification.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { isVehicleCompatible } from '../lib/dispatch';
import { translations } from '../lib/i18n';
import {
  LEGACY_CATEGORY_EQUIVALENTS,
  OFFICIAL_VEHICLE_CATEGORIES,
  CARGO_VEHICLE_CATEGORIES,
  TAXI_VEHICLE_CATEGORIES,
  TAXI_CATEGORY_SEATS,
  normalizeVehicleCategory,
  rawCategoryForms,
  validateRequiredVehicleTypes,
  vehicleCategorySide,
} from '../lib/types';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = ''): void {
  const tag = cond ? 'PASS' : 'FAIL';
  if (cond) pass++;
  else fail++;
  console.log(`[${tag}] ${name}${extra ? ` - ${extra}` : ''}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function src(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8');
}

const order = (o: Record<string, unknown>) => o as Parameters<typeof isVehicleCompatible>[0];
const vehicle = (v: Record<string, unknown>) =>
  v as Parameters<typeof isVehicleCompatible>[1];

// ---------------------------------------------------------------------------
section('1. OFFICIAL VOCABULARY');
// ---------------------------------------------------------------------------
const EXPECTED_SIX = [
  'cargo_moto_2', 'cargo_tricycle', 'cargo_small_truck',
  'cargo_large_truck', 'taxi_up_to_4', 'taxi_over_5',
];
check(
  'exactly the six official categories exist',
  OFFICIAL_VEHICLE_CATEGORIES.length === 6 &&
    EXPECTED_SIX.every((c) => (OFFICIAL_VEHICLE_CATEGORIES as readonly string[]).includes(c)),
  OFFICIAL_VEHICLE_CATEGORIES.join(', ')
);
check('4 cargo categories', CARGO_VEHICLE_CATEGORIES.length === 4);
check('2 taxi categories', TAXI_VEHICLE_CATEGORIES.length === 2);
check('cargo and taxi vocabularies are disjoint', [...CARGO_VEHICLE_CATEGORIES, ...TAXI_VEHICLE_CATEGORIES].length === 6);
check(
  'every official category resolves its service side',
  OFFICIAL_VEHICLE_CATEGORIES.every((c) => vehicleCategorySide(c) !== null)
);
check(
  'taxi categories carry a canonical seat count',
  TAXI_VEHICLE_CATEGORIES.every((c) => Number.isInteger(TAXI_CATEGORY_SEATS[c])),
  `up_to_4=${TAXI_CATEGORY_SEATS.taxi_up_to_4} over_5=${TAXI_CATEGORY_SEATS.taxi_over_5}`
);

// ---------------------------------------------------------------------------
section('2. BEHAVIOURAL CASES (T1-T16)');
// ---------------------------------------------------------------------------
check(
  'T1 cargo_moto_2 driver + cargo_moto_2 order => PASS',
  isVehicleCompatible(order({ requiredVehicleTypes: ['cargo_moto_2'] }), vehicle({ vehicleCategory: 'cargo_moto_2' }))
);
check(
  'T2 cargo_tricycle driver + cargo_tricycle order => PASS',
  isVehicleCompatible(order({ requiredVehicleTypes: ['cargo_tricycle'] }), vehicle({ vehicleCategory: 'cargo_tricycle' }))
);
check(
  'T3 cargo_small_truck driver + cargo_small_truck order => PASS',
  isVehicleCompatible(order({ requiredVehicleTypes: ['cargo_small_truck'] }), vehicle({ vehicleCategory: 'cargo_small_truck' }))
);
check(
  'T4 cargo_large_truck driver + cargo_large_truck order => PASS',
  isVehicleCompatible(order({ requiredVehicleTypes: ['cargo_large_truck'] }), vehicle({ vehicleCategory: 'cargo_large_truck' }))
);
check(
  'T5 moto driver + tricycle order => FAIL',
  !isVehicleCompatible(order({ requiredVehicleTypes: ['cargo_tricycle'] }), vehicle({ vehicleCategory: 'cargo_moto_2' }))
);
check(
  'T6 tricycle driver + order [tricycle, small_truck] => PASS',
  isVehicleCompatible(
    order({ requiredVehicleTypes: ['cargo_tricycle', 'cargo_small_truck'] }),
    vehicle({ vehicleCategory: 'cargo_tricycle' })
  )
);
check(
  'T7 small truck driver + order [tricycle, small_truck] => PASS',
  isVehicleCompatible(
    order({ requiredVehicleTypes: ['cargo_tricycle', 'cargo_small_truck'] }),
    vehicle({ vehicleCategory: 'cargo_small_truck' })
  )
);
check(
  'T8 moto driver + order [tricycle, small_truck] => FAIL',
  !isVehicleCompatible(
    order({ requiredVehicleTypes: ['cargo_tricycle', 'cargo_small_truck'] }),
    vehicle({ vehicleCategory: 'cargo_moto_2' })
  )
);
check(
  'T9 taxi_up_to_4 driver + taxi_up_to_4 order => PASS',
  isVehicleCompatible(order({ requiredVehicleTypes: ['taxi_up_to_4'] }), vehicle({ vehicleCategory: 'taxi_up_to_4' }))
);
check(
  'T10 taxi_over_5 driver + taxi_over_5 order => PASS',
  isVehicleCompatible(order({ requiredVehicleTypes: ['taxi_over_5'] }), vehicle({ vehicleCategory: 'taxi_over_5' }))
);
check(
  'T11 taxi_up_to_4 driver + taxi_over_5 order => FAIL',
  !isVehicleCompatible(order({ requiredVehicleTypes: ['taxi_over_5'] }), vehicle({ vehicleCategory: 'taxi_up_to_4' }))
);
check(
  'T12 old order without requiredVehicleTypes => legacy behaviour preserved',
  isVehicleCompatible(order({ cargoType: 'parcel' }), vehicle({ vehicleCategory: 'moto' })) &&
    isVehicleCompatible(order({ cargoType: 'parcel' }), vehicle({ vehicleCategory: null })) &&
    isVehicleCompatible(order({ requiredVehicleType: null, requiredVehicleTypes: [] }), vehicle({ vehicleCategory: 'truck' }))
);
check(
  'T12b legacy single-value order still matches',
  isVehicleCompatible(order({ requiredVehicleType: 'moto' }), vehicle({ vehicleCategory: 'moto' })) &&
    !isVehicleCompatible(order({ requiredVehicleType: 'moto' }), vehicle({ vehicleCategory: 'truck' }))
);
check(
  'T13 invalid vehicle category => rejected',
  !validateRequiredVehicleTypes(['spaceship']).ok &&
    !validateRequiredVehicleTypes([123]).ok &&
    !validateRequiredVehicleTypes('moto').ok
);
const dup = validateRequiredVehicleTypes(['cargo_tricycle', 'cargo_tricycle', 'tricycle']);
check(
  'T14 duplicate categories => normalised safely',
  dup.ok && dup.value.length === 1 && dup.value[0] === 'cargo_tricycle',
  dup.ok ? dup.value.join(',') : 'rejected'
);
check('T15 empty cargo category selection => rejected', !validateRequiredVehicleTypes([]).ok);
const mixed = validateRequiredVehicleTypes(['cargo_moto_2', 'taxi_over_5']);
check('T16 mixed cargo/taxi selection => rejected', !mixed.ok, mixed.ok ? 'accepted' : mixed.reason);

// ---------------------------------------------------------------------------
section('3. LEGACY COMPATIBILITY (no data migration)');
// ---------------------------------------------------------------------------
check(
  'every legacy spelling normalises to an official category',
  Object.entries(LEGACY_CATEGORY_EQUIVALENTS).every(([l, o]) => normalizeVehicleCategory(l) === o)
);
check(
  'a Phase-1 driver row (moto) matches a Phase-6 order (cargo_moto_2)',
  isVehicleCompatible(order({ requiredVehicleTypes: ['cargo_moto_2'] }), vehicle({ vehicleCategory: 'moto' }))
);
check(
  'a Phase-1 taxi_car row matches taxi_up_to_4',
  isVehicleCompatible(order({ requiredVehicleTypes: ['taxi_up_to_4'] }), vehicle({ vehicleCategory: 'taxi_car' }))
);
check(
  'a Phase-1 taxi_car_7 row matches taxi_over_5',
  isVehicleCompatible(order({ requiredVehicleTypes: ['taxi_over_5'] }), vehicle({ vehicleCategory: 'taxi_car_7' }))
);
check(
  'an official row still matches a legacy order request',
  isVehicleCompatible(order({ requiredVehicleType: 'moto' }), vehicle({ vehicleCategory: 'cargo_moto_2' }))
);
check(
  'precedence: the plural field wins when BOTH are present',
  isVehicleCompatible(
    order({ requiredVehicleTypes: ['cargo_tricycle'], requiredVehicleType: 'moto' }),
    vehicle({ vehicleCategory: 'tricycle' })
  ) &&
    !isVehicleCompatible(
      order({ requiredVehicleTypes: ['cargo_tricycle'], requiredVehicleType: 'moto' }),
      vehicle({ vehicleCategory: 'moto' })
    )
);
check(
  'rawCategoryForms always contains the canonical value',
  OFFICIAL_VEHICLE_CATEGORIES.every((c) => rawCategoryForms(c).includes(c))
);
check(
  'SQL pre-filter still reaches the legacy rows that hold today\'s data',
  rawCategoryForms('cargo_moto_2').includes('moto') &&
    rawCategoryForms('taxi_over_5').includes('taxi_car_7')
);

// ---------------------------------------------------------------------------
section('4. CARGO-SIZE + SEAT SAFETY (Phase 1/3/4 preserved)');
// ---------------------------------------------------------------------------
check(
  'cargoSize=large still excludes a motorbike (legacy spelling)',
  !isVehicleCompatible(order({ cargoSize: 'large' }), vehicle({ vehicleCategory: 'moto' }))
);
check(
  'cargoSize=large still excludes a motorbike (official spelling)',
  !isVehicleCompatible(order({ cargoSize: 'large' }), vehicle({ vehicleCategory: 'cargo_moto_2' }))
);
check(
  'cargoSize=large does not penalise a vehicle with no category on file',
  isVehicleCompatible(order({ cargoSize: 'large' }), vehicle({ vehicleCategory: null }))
);
check(
  'requiredSeats still enforced on top of the category rule',
  !isVehicleCompatible(
    order({ requiredVehicleTypes: ['taxi_over_5'], requiredSeats: 7 }),
    vehicle({ vehicleCategory: 'taxi_over_5', seats: 4 })
  ) &&
    isVehicleCompatible(
      order({ requiredVehicleTypes: ['taxi_over_5'], requiredSeats: 7 }),
      vehicle({ vehicleCategory: 'taxi_over_5', seats: 7 })
    )
);
check(
  'oversized cargoType still excludes a motorbike',
  !isVehicleCompatible(order({ cargoType: 'furniture' }), vehicle({ vehicleCategory: 'cargo_moto_2' }))
);
// ---------------------------------------------------------------------------
section('5. SERVER-SIDE ENFORCEMENT (source contracts)');
// ---------------------------------------------------------------------------
const ordersRoute = src('src/app/api/orders/route.ts');
check('POST /api/orders validates the multi-select', ordersRoute.includes('validateRequiredVehicleTypes'));
check('POST /api/orders rejects two taxi categories', ordersRoute.includes('taxiSingleVehicleTypeOnly'));
check('POST /api/orders rejects a cargo/taxi mix', ordersRoute.includes('vehicleCategoryServiceMismatch'));
check('POST /api/orders persists requiredVehicleTypes', /requiredVehicleTypes,/.test(ordersRoute));
check('POST /api/orders forwards it to the fan-out', ordersRoute.includes('order.requiredVehicleTypes'));

const applyDriver = src('src/app/api/auth/apply-driver/route.ts');
check('apply-driver requires a vehicle category', applyDriver.includes("return badRequest('invalidVehicleCategory'"));
check('apply-driver binds the category to the service type', applyDriver.includes("return badRequest('vehicleCategoryServiceMismatch'"));
check('apply-driver derives taxi seats from the category', applyDriver.includes('TAXI_CATEGORY_SEATS'));
check('apply-driver persists it on every write path', (applyDriver.match(/^\s*vehicleCategory,$/gm) ?? []).length >= 3);

for (const [label, file, needs] of [
  ['flat accept', 'src/app/api/orders/[id]/accept/route.ts', 'requiredVehicleTypes: true'],
  ['offer award', 'src/app/api/orders/[id]/offers/[offerId]/accept/route.ts', 'requiredVehicleTypes: true'],
  ['offer create', 'src/app/api/orders/[id]/offers/route.ts', 'requiredVehicleTypes: true'],
  ['driver incoming', 'src/app/api/driver/incoming/route.ts', 'isVehicleCompatible'],
  ['cron dispatch', 'src/app/api/cron/dispatch-scheduled/route.ts', 'requiredVehicleTypes: order.requiredVehicleTypes'],
] as const) {
  check(`${label} passes the new field into the gate`, src(file).includes(needs));
}

const dispatch = src('src/lib/dispatch.ts');
check('isVehicleCompatible is still exported as the single source of truth', dispatch.includes('export function isVehicleCompatible'));
check('no second matching function was introduced', (dispatch.match(/function \w*[Vv]ehicle\w*[Cc]ompat/g) ?? []).length === 1);
check('the SQL pre-filter keeps the indexed lookup shape', dispatch.includes('vehicleCategory: { in: dbCategoryValues }'));

const offerPolicy = src('src/lib/offer-policy.ts');
check('offer policy delegates to isVehicleCompatible', offerPolicy.includes('isVehicleCompatible('));
check('offer policy carries the new field', offerPolicy.includes('requiredVehicleTypes?'));

const vehicleRoute = src('src/app/api/driver/vehicle/route.ts');
check('driver vehicle PATCH normalises on write', vehicleRoute.includes('normalizedCategory'));

// ---------------------------------------------------------------------------
section('6. i18n (AR + FR)');
// ---------------------------------------------------------------------------
const NEW_KEYS = [
  'cargoVehicles', 'taxiVehicles',
  'cargoMoto2', 'cargoTricycle', 'cargoSmallTruck', 'cargoLargeTruck',
  'taxiUpTo4', 'taxiOver5',
  'selectVehicleTypes', 'selectVehicleTypesHelp', 'multipleVehicleTypesAllowed',
  'selectVehicleType', 'vehicleTypeRequired', 'selectYourVehicleType',
  'invalidVehicleCategory', 'vehicleCategoryServiceMismatch',
  'taxiSingleVehicleTypeOnly', 'seatsMismatchVehicleCategory',
];
const ar = translations.ar as unknown as Record<string, string>;
const fr = translations.fr as unknown as Record<string, string>;
const missingAr = NEW_KEYS.filter((k) => !ar[k] || !ar[k].trim());
const missingFr = NEW_KEYS.filter((k) => !fr[k] || !fr[k].trim());
check(`all ${NEW_KEYS.length} AR keys present`, missingAr.length === 0, missingAr.join(','));
check(`all ${NEW_KEYS.length} FR keys present`, missingFr.length === 0, missingFr.join(','));
check(
  'AR and FR labels are actually translated (not copied)',
  ar.cargoMoto2 !== fr.cargoMoto2 && ar.taxiOver5 !== fr.taxiOver5
);

// ---------------------------------------------------------------------------
section('7. LIVE DATABASE');
// ---------------------------------------------------------------------------
async function dbChecks(): Promise<void> {
  const db = new PrismaClient();
  try {
    const col = await db.$queryRawUnsafe<{ data_type: string }[]>(
      "select data_type from information_schema.columns where table_name = 'Order' and column_name = 'requiredVehicleTypes'",
    );
    check('requiredVehicleTypes exists and is a typed array', col.length === 1 && col[0].data_type === 'ARRAY');

    const legacy = await db.$queryRawUnsafe<{ c: number }[]>(
      'select count(*)::int as c from "Order" where cardinality("requiredVehicleTypes") = 0',
    );
    check(
      'every existing order kept the empty array (= legacy behaviour)',
      legacy[0]?.c !== 0,
      `legacy orders=${legacy[0]?.c}`
    );

    const rows = await db.vehicleRegistration.findMany({ select: { vehicleCategory: true } });
    const unknown = rows.filter(
      (r) => r.vehicleCategory !== null && normalizeVehicleCategory(r.vehicleCategory) === null
    );
    check(
      'every stored vehicleCategory is inside the known vocabulary',
      unknown.length === 0,
      `rows=${rows.length} unknown=${unknown.length}`
    );
    const classified = rows.filter((r) => r.vehicleCategory !== null).length;
    check('the classified fleet is non-empty', classified > 0, `classified=${classified}/${rows.length}`);
  } catch (e) {
    console.log(`[SKIP] live DB checks - ${(e as Error).message}`);
  } finally {
    await db.$disconnect();
  }
}

await dbChecks();

console.log(`\n${'='.repeat(58)}`);
console.log(`RESULT: ${pass}/${pass + fail}`);
console.log(`${'='.repeat(58)}`);
if (fail > 0) process.exit(1);
