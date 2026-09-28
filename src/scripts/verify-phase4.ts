// PHASE 4 verification (Dedicated Cargo Wizard & Negotiation Engine).
import { PrismaClient } from '@prisma/client';
import { canDriverOfferOnOrder, isAllowedCargoImageUrl, type OfferOrderFacts, type OfferDriverFacts } from '../lib/offer-policy';
import { isVehicleCompatible } from '../lib/dispatch';
import { CARGO_SIZES, CARGO_SIZE_WEIGHT } from '../lib/types';
import { translations } from '../lib/i18n';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = ''): void {
  const tag = cond ? 'PASS' : 'FAIL';
  if (cond) pass++;
  else fail++;
  console.log(`[${tag}] ${name}${extra ? ` - ${extra}` : ''}`);
}

// 1. isVehicleCompatible() with Phase 4 cargoSize rule
check('large cargo + moto => INCOMPATIBLE (rule 4)',
  isVehicleCompatible({ cargoSize: 'large' }, { vehicleCategory: 'moto' }) === false);
check('large cargo + truck => compatible',
  isVehicleCompatible({ cargoSize: 'large' }, { vehicleCategory: 'truck' }) === true);
check('large cargo + tricycle => compatible',
  isVehicleCompatible({ cargoSize: 'large' }, { vehicleCategory: 'tricycle' }) === true);
check('large cargo + no category => compatible (legacy lenient)',
  isVehicleCompatible({ cargoSize: 'large' }, { vehicleCategory: null }) === true);
check('small cargo + moto => compatible',
  isVehicleCompatible({ cargoSize: 'small' }, { vehicleCategory: 'moto' }) === true);
check('medium cargo + moto => compatible',
  isVehicleCompatible({ cargoSize: 'medium' }, { vehicleCategory: 'moto' }) === true);

// 2. isAllowedCargoImageUrl() URL allowlist validator
check('valid vercel blob storage host => allowed',
  isAllowedCargoImageUrl('https://public.blob.vercel-storage.com/cargo-123.jpg') === true);
check('valid subdomain blob storage host => allowed',
  isAllowedCargoImageUrl('https://abc.public.blob.vercel-storage.com/order-456.png') === true);
check('http (not https) => denied',
  isAllowedCargoImageUrl('http://public.blob.vercel-storage.com/test.jpg') === false);
check('external malicious domain => denied',
  isAllowedCargoImageUrl('https://evil.com/image.jpg') === false);
check('javascript: scheme => denied',
  isAllowedCargoImageUrl('javascript:alert(1)') === false);
check('data: URI => denied',
  isAllowedCargoImageUrl('data:image/png;base64,xxxx') === false);
check('invalid URL string => denied',
  isAllowedCargoImageUrl('not a url') === false);

// 3. canDriverOfferOnOrder() policy gate truth table
const baseOrder: OfferOrderFacts = {
  status: 'searching',
  customerId: 'cust-1',
  driverId: null,
  cargoType: 'parcel',
  isNegotiable: true,
  cargoSize: 'small',
  requiredVehicleType: null,
  requiredSeats: null,
};

const baseDriver: OfferDriverFacts = {
  id: 'driver-1',
  isVerified: true,
  applicationStatus: 'active',
  serviceType: 'CARGO',
  vehicleCategory: 'moto',
  seats: 1,
};

check('valid driver & order => OK',
  canDriverOfferOnOrder(baseOrder, baseDriver).ok === true);

check('order not searching => orderNotSearchable',
  (() => {
    const res = canDriverOfferOnOrder({ ...baseOrder, status: 'accepted' }, baseDriver);
    return !res.ok && res.reason === 'orderNotSearchable';
  })());

check('order not negotiable => orderNotNegotiable',
  (() => {
    const res = canDriverOfferOnOrder({ ...baseOrder, isNegotiable: false }, baseDriver);
    return !res.ok && res.reason === 'orderNotNegotiable';
  })());

check('customer offering on own order => ownOrder',
  (() => {
    const res = canDriverOfferOnOrder({ ...baseOrder, customerId: 'driver-1' }, baseDriver);
    return !res.ok && res.reason === 'ownOrder';
  })());

check('order already assigned => alreadyAssigned',
  (() => {
    const res = canDriverOfferOnOrder({ ...baseOrder, driverId: 'other-driver' }, baseDriver);
    return !res.ok && res.reason === 'alreadyAssigned';
  })());

check('driver not verified => notVerified',
  (() => {
    const res = canDriverOfferOnOrder(baseOrder, { ...baseDriver, isVerified: false });
    return !res.ok && res.reason === 'notVerified';
  })());

check('driver pending status => driverNotActive',
  (() => {
    const res = canDriverOfferOnOrder(baseOrder, { ...baseDriver, applicationStatus: 'pending' });
    return !res.ok && res.reason === 'driverNotActive';
  })());

check('TAXI specialist driver offering on CARGO order => serviceTypeMismatch',
  (() => {
    const res = canDriverOfferOnOrder(baseOrder, { ...baseDriver, serviceType: 'TAXI' });
    return !res.ok && res.reason === 'serviceTypeMismatch';
  })());

check('BOTH service driver offering on CARGO order => OK',
  canDriverOfferOnOrder(baseOrder, { ...baseDriver, serviceType: 'BOTH' }).ok === true);

check('moto driver offering on large cargo order => vehicleNotCompatible',
  (() => {
    const res = canDriverOfferOnOrder({ ...baseOrder, cargoSize: 'large' }, baseDriver);
    return !res.ok && res.reason === 'vehicleNotCompatible';
  })());

check('truck driver offering on large cargo order => OK',
  canDriverOfferOnOrder(
    { ...baseOrder, cargoSize: 'large' },
    { ...baseDriver, vehicleCategory: 'truck' },
  ).ok === true);

// 4. Cargo sizes & weight mapping
check('CARGO_SIZES includes small, medium, large',
  CARGO_SIZES.includes('small') &&
  CARGO_SIZES.includes('medium') &&
  CARGO_SIZES.includes('large'));

check('CARGO_SIZE_WEIGHT values: small=20, medium=100, large=400',
  CARGO_SIZE_WEIGHT.small === 20 &&
  CARGO_SIZE_WEIGHT.medium === 100 &&
  CARGO_SIZE_WEIGHT.large === 400);

// 5. Phase 4 i18n keys check
const ar = translations.ar as unknown as Record<string, string>;
const fr = translations.fr as unknown as Record<string, string>;

const phase4Keys = [
  'cargoFlowTitle',
  'cargoSizeLabel',
  'cargoSizeSmall',
  'cargoSizeMedium',
  'cargoSizeLarge',
  'cargoSizeSmallHint',
  'cargoSizeMediumHint',
  'cargoSizeLargeHint',
  'cargoLargeNotForMoto',
  'cargoPhotoTitle',
  'cargoPhotoHelp',
  'cargoPhotoAdd',
  'cargoPhotoRemove',
  'cargoPhotoUploading',
  'cargoDescPlaceholder',
  'offerTimelineTitle',
  'offerEventDriverOffer',
  'offerEventCustomerCounter',
  'offerEventAccepted',
  'offerEventRejected',
  'finalAgreedPrice',
  'acceptCustomerPrice',
];

for (const key of phase4Keys) {
  check(`ar translation exists: ${key}`, typeof ar[key] === 'string' && ar[key].length > 0);
  check(`fr translation exists: ${key}`, typeof fr[key] === 'string' && fr[key].length > 0);
}

// 6. DB schema validation (Prisma Order & OfferEvent models)
const db = new PrismaClient();

async function main(): Promise<void> {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (e) {
    const reason = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.log(`[SKIP] database checks - DATABASE_URL unreachable: ${reason}`);
    await db.$disconnect().catch(() => undefined);
    console.log(`\nPHASE 4 RESULT: ${pass} passed, ${fail} failed (logic only)`);
    process.exit(fail > 0 ? 1 : 0);
  }

  try {
    await db.order.findFirst({
      select: {
        id: true,
        cargoSize: true,
        cargoImageUrl: true,
      },
    });
    check('Order table has cargoSize & cargoImageUrl columns', true);
  } catch (err) {
    check('Order table has cargoSize & cargoImageUrl columns', false, String(err));
  }

  try {
    const eventCount = await db.offerEvent.count();
    check('OfferEvent table exists and accessible', typeof eventCount === 'number');
  } catch (err) {
    check('OfferEvent table exists and accessible', false, String(err));
  }

  await db.$disconnect().catch(() => undefined);
  console.log(`\nPHASE 4 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    process.exit(1);
  }
}

void main();
