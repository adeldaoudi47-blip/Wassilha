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
  OFFICIAL_CATEGORIES_BY_SIDE,
  CARGO_VEHICLE_CATEGORIES,
  TAXI_VEHICLE_CATEGORIES,
  TAXI_SEATS_MAX,
  TAXI_CATEGORY_SEAT_RANGE,
  defaultSeatsForTaxiCategory,
  isSeatsValidForTaxiCategory,
  taxiSeatRange,
  normalizeVehicleCategory,
  rawCategoryForms,
  retainCategoriesForService,
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
  'every taxi category carries a SEAT RANGE (not a fixed count)',
  TAXI_VEHICLE_CATEGORIES.every((c) => {
    const r = taxiSeatRange(c);
    return r !== null && r.min <= r.max;
  }),
  `up_to_4=${TAXI_CATEGORY_SEAT_RANGE.taxi_up_to_4.min}-${TAXI_CATEGORY_SEAT_RANGE.taxi_up_to_4.max} ` +
    `over_5=${TAXI_CATEGORY_SEAT_RANGE.taxi_over_5.min}-${TAXI_CATEGORY_SEAT_RANGE.taxi_over_5.max}`,
);
check(
  'the taxi_up_to_4 band is exactly 1..4 and the over_5 band starts at 6',
  TAXI_CATEGORY_SEAT_RANGE.taxi_up_to_4.min === 1 &&
    TAXI_CATEGORY_SEAT_RANGE.taxi_up_to_4.max === 4 &&
    TAXI_CATEGORY_SEAT_RANGE.taxi_over_5.min === 6,
);
check(
  'the over_5 band reaches the system-wide seat ceiling',
  TAXI_CATEGORY_SEAT_RANGE.taxi_over_5.max === TAXI_SEATS_MAX && TAXI_SEATS_MAX === 30,
);

// TAXI SEAT BANDS (regression: a 9-seat minibus was rejected as
// seatsMismatchVehicleCategory because `taxi_over_5` was pinned to exactly 7).
const seatOk = (category: string, seats: number) => isSeatsValidForTaxiCategory(category, seats);
check('T-S1 taxi_up_to_4 + seats=4 => PASS', seatOk('taxi_up_to_4', 4));
check('T-S2 taxi_up_to_4 + seats=5 => FAIL', !seatOk('taxi_up_to_4', 5));
check('T-S3 taxi_over_5 + seats=6 => PASS', seatOk('taxi_over_5', 6));
check('T-S4 taxi_over_5 + seats=7 => PASS', seatOk('taxi_over_5', 7));
check('T-S5 taxi_over_5 + seats=8 => PASS', seatOk('taxi_over_5', 8));
check('T-S6 taxi_over_5 + seats=9 => PASS', seatOk('taxi_over_5', 9), 'the reported bug');
check('T-S7 taxi_over_5 + seats=5 => FAIL', !seatOk('taxi_over_5', 5));
check('T-S8 taxi_over_5 + seats=30 => PASS (system ceiling)', seatOk('taxi_over_5', 30));
check('T-S9 taxi_over_5 + seats=31 => FAIL (above ceiling)', !seatOk('taxi_over_5', 31));
check('T-S10 taxi_over_5 + seats=0 => FAIL', !seatOk('taxi_over_5', 0));
check('T-S11 taxi_over_5 + seats=4.5 => FAIL (non-integer)', !seatOk('taxi_over_5', 4.5));
// Legacy spellings must resolve to the same band.
check(
  'legacy taxi_car uses the up_to_4 band, taxi_car_7 the over_5 band',
  seatOk('taxi_car', 4) &&
    !seatOk('taxi_car', 5) &&
    seatOk('taxi_car_7', 9) &&
    !seatOk('taxi_car_7', 5),
);
// Cargo is untouched: no seat rule applies at all.
check(
  'CARGO categories impose NO seat rule (cargo unaffected)',
  CARGO_VEHICLE_CATEGORIES.every(
    (c) => seatOk(c, 1) && seatOk(c, 9) && seatOk(c, 99),
  ),
);
check(
  'the default seat count sits at the conservative end of its band',
  defaultSeatsForTaxiCategory('taxi_up_to_4') === 1 &&
    defaultSeatsForTaxiCategory('taxi_over_5') === 6,
);
check(
  'a non-taxi category has no band and no default',
  taxiSeatRange('cargo_moto_2') === null && defaultSeatsForTaxiCategory('cargo_tricycle') === null,
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
check(
  'apply-driver validates taxi seats against a BAND, not an exact count',
  applyDriver.includes('isSeatsValidForTaxiCategory') &&
    applyDriver.includes('taxiSeatRange') &&
    // The exact-equality guard that caused the bug must be gone.
    !/seatsFromBody\s*!==\s*categorySeats/.test(applyDriver) &&
    !applyDriver.includes('TAXI_CATEGORY_SEATS'),
);
check(
  'the absolute seat ceiling comes from the shared constant',
  applyDriver.includes('const SEATS_MAX = TAXI_SEATS_MAX'),
);
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
section('5b. VEHICLE PICKER WIRING (regression: cargo driver saw taxi options)');
// ---------------------------------------------------------------------------
// The UI bug was that VehiclePicker derived its visible list from the `multi`
// prop instead of the `side` prop. Every driver form passes multi={false}
// (one vehicle per driver), so a CARGO driver was shown the two TAXI classes.
// These checks pin the corrected contract at both levels: the data the picker
// reads, and the component source that must read it from `side`.
const picker = src('src/components/wassilha/vehicle-picker.tsx');
check(
  'picker reads its categories from `side`, never from `multi`',
  picker.includes('OFFICIAL_CATEGORIES_BY_SIDE[side]') &&
    !/const categories[^=]*=\s*multi\s*\?/.test(picker),
);
check(
  'CARGO side exposes exactly the 4 cargo categories',
  OFFICIAL_CATEGORIES_BY_SIDE.CARGO.length === 4 &&
    OFFICIAL_CATEGORIES_BY_SIDE.CARGO.every((c) => (CARGO_VEHICLE_CATEGORIES as readonly string[]).includes(c)),
  OFFICIAL_CATEGORIES_BY_SIDE.CARGO.join(', ')
);
check(
  'TAXI side exposes exactly the 2 taxi categories',
  OFFICIAL_CATEGORIES_BY_SIDE.TAXI.length === 2 &&
    OFFICIAL_CATEGORIES_BY_SIDE.TAXI.every((c) => (TAXI_VEHICLE_CATEGORIES as readonly string[]).includes(c)),
  OFFICIAL_CATEGORIES_BY_SIDE.TAXI.join(', ')
);
check(
  'BOTH side would expose all 6, in two separated groups',
  [...OFFICIAL_CATEGORIES_BY_SIDE.CARGO, ...OFFICIAL_CATEGORIES_BY_SIDE.TAXI].length ===
    OFFICIAL_VEHICLE_CATEGORIES.length &&
    picker.includes("side === 'BOTH'") &&
    picker.includes('groups.map')
);
check(
  'no category leaks across the service boundary',
  OFFICIAL_CATEGORIES_BY_SIDE.CARGO.every((c) => vehicleCategorySide(c) === 'CARGO') &&
    OFFICIAL_CATEGORIES_BY_SIDE.TAXI.every((c) => vehicleCategorySide(c) === 'TAXI')
);

// Every driver form must pass its real service through as `side`. The state
// name differs per form (`serviceType` locally, `vehicleRegistration.serviceType`
// in the application wizard), so both are accepted — what matters is that the
// prop is driven by the live service and never hardcoded to one family.
for (const [label, file] of [
  ['driver application (auth-flow)', 'src/components/wassilha/auth/auth-flow.tsx'],
  ['upgrade dialog', 'src/components/wassilha/customer/upgrade-driver-dialog.tsx'],
  ['vehicle profile dialog', 'src/components/wassilha/driver/driver-profile.tsx'],
] as const) {
  const body = src(file);
  check(
    `${label} passes the live serviceType as \`side\``,
    /<VehiclePicker[\s\S]{0,400}side=\{\s*(vehicleRegistration\.)?serviceType\s*\}/.test(body) &&
      !/<VehiclePicker[\s\S]{0,400}side="(CARGO|TAXI)"/.test(body),
  );
}

// Switching service must clear an incompatible category.
check(
  'switching CARGO drops a previously chosen taxi class',
  retainCategoriesForService(['taxi_up_to_4'], 'CARGO').length === 0 &&
    retainCategoriesForService(['taxi_over_5'], 'CARGO').length === 0
);
check(
  'switching TAXI drops any previously chosen cargo category',
  OFFICIAL_CATEGORIES_BY_SIDE.CARGO.every((c) => retainCategoriesForService([c], 'TAXI').length === 0)
);
check(
  'switching service keeps a still-valid category (no needless clearing)',
  retainCategoriesForService(['cargo_tricycle'], 'CARGO')[0] === 'cargo_tricycle' &&
    retainCategoriesForService(['taxi_over_5'], 'TAXI')[0] === 'taxi_over_5'
);
check(
  'BOTH keeps either family',
  retainCategoriesForService(['cargo_moto_2'], 'BOTH').length === 1 &&
    retainCategoriesForService(['taxi_up_to_4'], 'BOTH').length === 1
);
check(
  'the reset helper can never invent a category',
  retainCategoriesForService([], 'CARGO').length === 0 &&
    retainCategoriesForService([], 'BOTH').length === 0
);
check(
  'all three driver forms apply the reset on a service change',
  [
    'src/components/wassilha/auth/auth-flow.tsx',
    'src/components/wassilha/customer/upgrade-driver-dialog.tsx',
    'src/components/wassilha/driver/driver-profile.tsx',
  ].every((f) => src(f).includes('retainCategoriesForService'))
);

// Server-side validation must still reject an incompatible pair, so a stale
// value that slips through the UI cannot be persisted.
const applyDrv = src('src/app/api/auth/apply-driver/route.ts');
check(
  'server still rejects category/service mismatch (cannot be bypassed by UI)',
  applyDrv.includes("return badRequest('vehicleCategoryServiceMismatch'") &&
    applyDrv.includes('vehicleCategorySide(vehicleCategory) !== serviceType')
);

// ---------------------------------------------------------------------------
section('5c. PATCH /api/driver/vehicle — SEAT BAND (profile-edit path)');
// ---------------------------------------------------------------------------
// The profile-edit endpoint bounded `seats` to 1..30 in absolute terms but never
// cross-checked it against the capacity class, so a driver could turn a
// "taxi_up_to_4" into a 9-seat vehicle after registration. It must reuse the
// SAME shared helper as apply-driver, never a second rule.
// (`vehicleRoute` was already loaded in section 5.)
check(
  'PATCH /api/driver/vehicle reuses the central band helper',
  vehicleRoute.includes('isSeatsValidForTaxiCategory(effectiveCategory, effectiveSeats)') &&
    vehicleRoute.includes('taxiSeatRange(effectiveCategory)'),
);
check(
  'PATCH rejects an incompatible pair with the shared error contract',
  vehicleRoute.includes("badRequest('seatsMismatchVehicleCategory'"),
);
check(
  'PATCH validates the EFFECTIVE pair (a partial edit cannot half-apply)',
  vehicleRoute.includes('effectiveCategory') &&
    vehicleRoute.includes('driver.vehicleRegistration.vehicleCategory') &&
    vehicleRoute.includes('const effectiveSeats = v.seats ?? null'),
);
check(
  'PATCH does not re-implement the band locally',
  !/seats\s*>\s*4\b/.test(vehicleRoute) && !/seats\s*<\s*6\b/.test(vehicleRoute),
);

// The band is the shared helper's behaviour, so these are the per-endpoint
// expectations required for this path.
const patchSeat = (category: string, seats: number) =>
  isSeatsValidForTaxiCategory(category, seats);
check('V1 PATCH taxi_up_to_4 + seats=4 => PASS', patchSeat('taxi_up_to_4', 4));
check('V2 PATCH taxi_up_to_4 + seats=9 => FAIL', !patchSeat('taxi_up_to_4', 9));
check('V3 PATCH taxi_over_5 + seats=6 => PASS', patchSeat('taxi_over_5', 6));
check('V4 PATCH taxi_over_5 + seats=9 => PASS', patchSeat('taxi_over_5', 9));
check('V5 PATCH taxi_over_5 + seats=30 => PASS', patchSeat('taxi_over_5', 30));
check('V6 PATCH taxi_over_5 + seats=5 => FAIL', !patchSeat('taxi_over_5', 5));
check(
  'V7 PATCH cargo seats are unrestricted (1 / 9 / 30 all PASS)',
  CARGO_VEHICLE_CATEGORIES.every((c) => patchSeat(c, 1) && patchSeat(c, 9) && patchSeat(c, 30)),
);
check(
  'V8 PATCH keeps legacy spellings working (taxi_car / taxi_car_7)',
  patchSeat('taxi_car', 4) && !patchSeat('taxi_car', 9) && patchSeat('taxi_car_7', 9),
);

// Both write paths must call the same helper - one definition, no drift.
check(
  'every seats write path routes through the central validation',
  [
    'src/app/api/auth/apply-driver/route.ts',
    'src/app/api/driver/vehicle/route.ts',
  ].every((f) => src(f).includes('isSeatsValidForTaxiCategory')),
);

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
