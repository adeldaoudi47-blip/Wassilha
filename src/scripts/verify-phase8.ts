// Phase 8 — Security & Production Hardening verifier.
//
// Covers three findings from the Post-7B product audit:
//   1. HIGH   — OTP returned to the caller as `devOtp` (account takeover).
//   2. MEDIUM — /api/craft/upload validated the file EXTENSION only.
//   3. MEDIUM — only 7 of 82 API routes were rate limited.
//
// The upload section EXECUTES the real shipped helper rather than asserting on
// source text, so it cannot pass while the code is actually broken.
import {
  validateImageUpload,
  extensionOf,
  buildImageKey,
  MAX_IMAGE_BYTES,
  ALLOWED_IMAGE_MIME,
  ALLOWED_IMAGE_EXT,
} from '../lib/image-upload';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = () => join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function listRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRoutes(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

async function src(file: string): Promise<string> {
  return await readFile(join(repoRoot(), file), 'utf8');
}

const files: Record<string, string> = {
  sendOtp: 'src/app/api/auth/send-otp/route.ts',
  forgotRequest: 'src/app/api/auth/forgot-password/request/route.ts',
  craftUpload: 'src/app/api/craft/upload/route.ts',
  orderImage: 'src/app/api/uploads/order-image/route.ts',
  otpLib: 'src/lib/otp.ts',
  imageLib: 'src/lib/image-upload.ts',
};

let pass = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log("[PASS] " + name);
  } else {
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log("[FAIL] " + name + (detail ? " — " + detail : ""));
  }
}

// ---------------------------------------------------------------------------
// 1. OTP — production leakage
// ---------------------------------------------------------------------------
async function sectionOtpLeak() {
  const otpLib = await src(files.otpLib);

  const routes: [string, string][] = [
    ['send-otp', files.sendOtp],
    ['forgot-password/request', files.forgotRequest],
  ];

  for (const [label, file] of routes) {
    const body = await src(file);
    check(
      `${label}: devOtp assigned only inside a demo-mode guard`,
      /if \(isOtpDemoMode\(\)( \|\| isOtpPreviewDemo\(\))?\) \{[\s\S]{0,200}body\.devOtp\s*=/.test(body)
    );
    // Strip comments first: a comment may NAME devOtp without ever assigning it.
    const codeOnly = body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // Then remove the demo-mode guard block (up to its first closing brace).
    const withoutGuard = codeOnly.replace(
      /if \(isOtpDemoMode\(\)( \|\| isOtpPreviewDemo\(\))?\) \{[\s\S]{0,300}?\}/,
      ""
    );
    check(
      `${label}: code outside the guard never assigns devOtp`,
      !/devOtp/.test(withoutGuard)
    );
    check(
      `${label}: does not log the code`,
      !/console\.(log|warn|error|info)\([^)]*\bcode\b/.test(body)
    );
    check(
      `${label}: does not echo raw exception detail to the client`,
      !/detail:\s*String\(e\)/.test(body)
    );
    check(`${label}: calls the shared deliverOtp()`, /deliverOtp\(phone, code\)/.test(body));
  }

  check('otp.ts: demo mode requires OTP_DEMO_MODE=true', /OTP_DEMO_MODE === 'true'/.test(otpLib));
  check(
    'otp.ts: demo mode blocked in production (NODE_ENV guard)',
    /NODE_ENV !== 'production'/.test(otpLib)
  );
  check(
    'otp.ts: a missing provider alone cannot enable demo mode',
    !/!\s*process\.env\.(BREVO_API_KEY|TEXTBEE_API_KEY|SMS_PROVIDER)/.test(otpLib)
  );
  check(
    'otp.ts: preview demo requires VERCEL_ENV === "preview"',
    /function isOtpPreviewDemo\(\)[\s\S]{0,200}VERCEL_ENV === 'preview'/.test(otpLib)
  );
  check(
    'otp.ts: preview demo is never enabled by an absent flag',
    !/VERCEL_ENV\s*!==/.test(otpLib)
  );
  check('otp.ts: deliverOtp never returns a code field', !/return \{[^}]*\bcode\b/.test(otpLib));
  check(
    'otp.ts: provider failure does NOT fall back to returning the code',
    !/catch[\s\S]{0,600}devOtp/.test(otpLib)
  );
  const catchBlock = otpLib.slice(otpLib.indexOf('catch'));
  check(
    'otp.ts: provider failure log excludes the code',
    !/console\.(error|log)\([\s\S]{0,300}\bcode\b/.test(catchBlock)
  );
}

// ---------------------------------------------------------------------------
// 2. Upload validation — executes the shipped helper
// ---------------------------------------------------------------------------
function fakeFile(name: string, type: string, size: number): File {
  const blob = new Blob([new Uint8Array(Math.min(size, 64))], { type });
  const f = new File([blob], name, { type });
  // defineProperty avoids allocating multi-MB buffers just to satisfy .size.
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function sectionUpload() {
  const accepted: [string, string, string][] = [
    ['photo.jpg', 'image/jpeg', 'jpg'],
    ['photo.jpeg', 'image/jpeg', 'jpg'],
    ['photo.png', 'image/png', 'png'],
    ['photo.webp', 'image/webp', 'webp'],
    ['photo.gif', 'image/gif', 'gif'],
  ];
  for (const [name, mime, ext] of accepted) {
    const r = validateImageUpload(fakeFile(name, mime, 2048));
    check('upload accepts ' + name, r.ok && r.ext === ext, JSON.stringify(r));
  }

  const cases: [string, string, number, string][] = [
    ['payload.svg', 'image/svg+xml', 2048, 'unsupportedType'],
    ['payload.html', 'text/html', 2048, 'unsupportedType'],
    ['payload.svg', 'image/jpeg', 2048, 'unsupportedType'],
    ['evil.js', 'application/javascript', 2048, 'unsupportedType'],
    ['photo.exe', 'image/jpeg', 2048, 'unsupportedType'],
    ['empty.jpg', 'image/jpeg', 0, 'emptyFile'],
    ['huge.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1, 'fileTooLarge'],
    ['noext', 'image/jpeg', 2048, 'unsupportedType'],
  ];
  for (const [name, mime, size, expected] of cases) {
    const r = validateImageUpload(fakeFile(name, mime, size));
    check(
      'upload rejects ' + name + ' (' + mime + ', ' + size + 'B)',
      !r.ok && r.error === expected,
      'got ' + JSON.stringify(r)
    );
  }

  check('upload rejects a null value', !validateImageUpload(null).ok);
  check('upload rejects a string value', !validateImageUpload('nope').ok);

  // A double extension with a matching raster MIME is ACCEPTED, but the original
  // filename is discarded — the stored key is built from the validated ext only.
  const doubleExt = validateImageUpload(fakeFile('evil.js.jpg', 'image/jpeg', 2048));
  check('upload accepts evil.js.jpg with a safe normalized ext', doubleExt.ok && doubleExt.ext === 'jpg');
  check(
    'buildImageKey never embeds the original filename',
    !buildImageKey('test-ns', 'test-id', 'jpg').includes('evil')
  );

  check('SVG is not in the MIME allow-list', !ALLOWED_IMAGE_MIME.has('image/svg+xml'));
  check(
    'MIME allow-list is raster-only',
    [...ALLOWED_IMAGE_MIME].every((m) => m.startsWith('image/') && m !== 'image/svg+xml')
  );

  check('extensionOf strips path traversal', extensionOf('../../etc/passwd.jpg') === 'jpg');
  check(
    'extensionOf a traversal-only name contains no path characters',
    !/[./\\]/.test(extensionOf('../../../etc/passwd'))
  );
  check(
    'extensionOf a traversal-only name fails the allow-list',
    !ALLOWED_IMAGE_EXT.has(extensionOf('../../../etc/passwd'))
  );
  check('extensionOf is case-insensitive', extensionOf('A.JPG') === 'jpg');
  check('extensionOf rejects a trailing dot', extensionOf('photo.') === '');

  const key = buildImageKey('craft/products', 'abc', 'png');
  check('buildImageKey keeps the namespace', key.startsWith('craft/products/'));
  check('buildImageKey never embeds the original filename', !key.includes('photo'));
  check(
    'buildImageKey is unguessable (fresh uuid per call)',
    buildImageKey('craft/products', 'abc', 'png') !== key
  );
  check('buildImageKey uses the normalised extension', key.endsWith('.png'));
}

// ---------------------------------------------------------------------------
// 3. Both upload routes share the validator
// ---------------------------------------------------------------------------
async function sectionSharedUpload() {
  const routes: [string, string][] = [
    ['craft/upload', files.craftUpload],
    ['uploads/order-image', files.orderImage],
  ];
  for (const [label, file] of routes) {
    const body = await src(file);
    check(label + ': calls the shared validateImageUpload()', /validateImageUpload\(/.test(body));
    check(label + ': calls the shared buildImageKey()', /buildImageKey\(/.test(body));
    check(
      label + ': no local MIME/extension allow-list remains',
      !/ALLOWED_MIME|ALLOWED_EXT|MAX_BYTES/.test(body)
    );
    check(label + ': does not echo raw exception detail', !/detail:\s*String\(e\)/.test(body));
    check(label + ': is rate limited', /rateLimit\(/.test(body));
    check(label + ': IP bucket uses clientIp(req)', /clientIp\(req\)/.test(body));
  }

  const orderImage = await src(files.orderImage);
  check(
    'order-image key stays namespaced under the caller id',
    /buildImageKey\('orders',\s*session\.id/.test(orderImage)
  );
}

// ---------------------------------------------------------------------------
// 4. Rate limiting coverage
// ---------------------------------------------------------------------------
async function sectionRateLimiting() {
  const protectedRoutes: [string, string][] = [
    ['order create', 'src/app/api/orders/route.ts'],
    ['offer create', 'src/app/api/orders/[id]/offers/route.ts'],
    ['offer counter', 'src/app/api/orders/[id]/offers/[offerId]/counter/route.ts'],
    ['offer accept', 'src/app/api/orders/[id]/offers/[offerId]/accept/route.ts'],
    ['offer reject', 'src/app/api/orders/[id]/offers/[offerId]/reject/route.ts'],
    ['craft order create', 'src/app/api/craft/orders/route.ts'],
    ['craft product create', 'src/app/api/craft/products/route.ts'],
    ['craft upload', files.craftUpload],
    ['order image upload', files.orderImage],
    ['send-otp', files.sendOtp],
    ['verify-otp', 'src/app/api/auth/verify-otp/route.ts'],
    ['forgot-password request', files.forgotRequest],
    ['forgot-password reset', 'src/app/api/auth/forgot-password/reset/route.ts'],
    ['apply-driver', 'src/app/api/auth/apply-driver/route.ts'],
  ];

  for (const [label, file] of protectedRoutes) {
    const body = await src(file);
    check(label + ': rate limited', /rateLimit\(/.test(body));
  }

  const sessionBucketed = [
    'src/app/api/orders/route.ts',
    'src/app/api/craft/orders/route.ts',
    'src/app/api/craft/products/route.ts',
  ];
  for (const file of sessionBucketed) {
    const body = await src(file);
    check(
      file.replace('src/app/api/', '') + ': bucket key derived server-side',
      /rateLimit\(\s*`[a-z]+:\$\{(?:gate\.)?session\.id\}`/.test(body)
    );
  }

  // The limit must come AFTER the auth gate so an unauthenticated caller is
  // rejected with 401 and cannot burn a real user's bucket.
  const orders = await src('src/app/api/orders/route.ts');
  check(
    'order create: rate limit sits after the session gate',
    orders.indexOf("error: 'unauthorized'") < orders.indexOf('const rl = await rateLimit')
  );
  const craftProducts = await src('src/app/api/craft/products/route.ts');
  check(
    'craft product: rate limit sits after the artisan gate',
    craftProducts.indexOf('requireActiveArtisan()') <
      craftProducts.indexOf('const rl = await rateLimit')
  );
}

// ---------------------------------------------------------------------------
// 5. Money / order security regression (must be untouched by this phase)
// ---------------------------------------------------------------------------
async function sectionMoneySecurity() {
  const craftOrders = await src('src/app/api/craft/orders/route.ts');
  const offers = await src('src/app/api/orders/[id]/offers/route.ts');
  const dispatch = await src('src/lib/dispatch.ts');

  check('craft order: unit price still computed server-side', /unitPriceFor/.test(craftOrders));
  check('craft order: delivery still bridged server-side', /createCraftDeliveryOrder/.test(craftOrders));
  check(
    'craft order: totalPrice not taken from the client body',
    !/totalPrice:\s*(?:body|parsed\.data)\b/.test(craftOrders)
  );
  check('offer create: driverId never taken from the body', !/driverId:\s*body\./.test(offers));
  check('offer create: price range still validated', /invalidPrice/.test(offers));
  check(
    'isVehicleCompatible is still the single matcher',
    (dispatch.match(/export function isVehicleCompatible/g) ?? []).length === 1
  );
}

// ---------------------------------------------------------------------------
// 6. No leaky or duplicated implementation across the API surface
// ---------------------------------------------------------------------------
async function sectionNoDuplication() {
  const routes = listRoutes(join(repoRoot(), 'src', 'app', 'api'));
  check('route files discovered (' + routes.length + ' > 50)', routes.length > 50);

  let demoLeaks = 0;
  let otpInHeaders = 0;
  let localUploadLists = 0;
  for (const f of routes) {
    const body = await readFile(f, 'utf8');
    if (/devOtp/.test(body) && !/isOtpDemoMode/.test(body)) demoLeaks++;
    if (/headers:\s*\{[^}]*code/i.test(body)) otpInHeaders++;
    if (/ALLOWED_MIME|isSvgAllowed/.test(body)) localUploadLists++;
  }
  check('no route returns devOtp outside a demo-mode guard', demoLeaks === 0, demoLeaks + ' route(s)');
  check('no route places an OTP in a response header', otpInHeaders === 0);
  check('no upload allow-list is duplicated inside a route', localUploadLists === 0);

  const imageLib = await src(files.imageLib);
  check(
    'shared validator still enforces the 5MB cap',
    imageLib.includes('MAX_IMAGE_BYTES = 5 * 1024 * 1024')
  );
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('=== PHASE 8 - SECURITY & PRODUCTION HARDENING ===\n');
  console.log('--- 1. OTP production leakage ---');
  await sectionOtpLeak();
  console.log('\n--- 2. Upload validation (executes the shipped helper) ---');
  sectionUpload();
  console.log('\n--- 3. Shared upload validation ---');
  await sectionSharedUpload();
  console.log('\n--- 4. Rate limiting ---');
  await sectionRateLimiting();
  console.log('\n--- 5. Money / order security regression ---');
  await sectionMoneySecurity();
  console.log('\n--- 6. No leaky or duplicated implementations ---');
  await sectionNoDuplication();

  console.log('\nRESULT: ' + pass + ' passed, ' + failures.length + ' failed');
  if (failures.length) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log('  - ' + f);
  }
  process.exit(failures.length ? 1 : 0);
}

main();

