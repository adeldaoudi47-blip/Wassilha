// Fail loudly if the app version is inconsistent across its three sources.
//
//   node scripts/check-versions.mjs
//
// The version drives the force-update gate, so a mismatch is a production
// incident, not a cosmetic drift:
//
//   package.json      -> NEXT_PUBLIC_APP_VERSION (baked into the web bundle by
//                        next.config.ts; what the client reports as "my" version)
//   build.gradle      -> versionName baked into the APK (what the running app
//                        reports to the server via App.getInfo())
//   route.ts          -> minVersion (what the server demands)
//
// If the APK is older than minVersion, a user installs the update, relaunches,
// and is shown the force-update modal again — a loop they cannot exit. That is
// the exact failure this guards against.
//
// `build.gradle` now derives versionName from package.json, so it is no longer
// an independent source; what is verified here is that the literal FALLBACK in
// that file still agrees, because it is what ships if package.json is ever
// unreadable at build time.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const pkgVersion = String(pkg.version ?? '').trim();

const gradle = readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
const gradleFallback = gradle.match(/def\s+appVersionName\s*=\s*"([^"]+)"/)?.[1] ?? null;
const gradleUsesPkg =
  /versionName\s+appVersionName/.test(gradle) && gradle.includes('package.json');

const route = readFileSync(
  path.join(root, 'src', 'app', 'api', 'version', 'route.ts'),
  'utf8'
);
const minVersion = route.match(/minVersion:\s*'([^']+)'/)?.[1] ?? null;
const latestVersion = route.match(/latestVersion:\s*'([^']+)'/)?.[1] ?? null;

const problems = [];

if (!/^\d+(\.\d+){0,2}$/.test(pkgVersion)) {
  problems.push(`package.json version is not a valid x.y.z: "${pkgVersion}"`);
}
if (!gradleUsesPkg) {
  problems.push(
    'build.gradle no longer derives versionName from package.json — the ' +
      'APK and the web bundle can drift apart again'
  );
}
if (!gradleFallback) {
  problems.push('could not find the versionName fallback literal in build.gradle');
}
if (minVersion && gradleFallback && minVersion !== gradleFallback) {
  problems.push(
    `minVersion (${minVersion}) != build.gradle fallback (${gradleFallback})`
  );
}
if (minVersion && latestVersion && minVersion !== latestVersion) {
  problems.push(
    `minVersion (${minVersion}) != latestVersion (${latestVersion}) — a user ` +
      'on the newest build would still be forced to update'
  );
}

console.log(`  package.json   ${pkgVersion}`);
console.log(`  build.gradle   ${gradleFallback}${gradleUsesPkg ? ' (from package.json)' : ' (HARDCODED)'}`);
console.log(`  minVersion     ${minVersion ?? 'NOT FOUND'}`);
console.log(`  latestVersion  ${latestVersion ?? 'NOT FOUND'}`);

if (problems.length) {
  console.error('\n✗ Version check FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log('\n✓ All version sources agree.');
