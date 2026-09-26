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
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Read a file, or return null if it is absent.
 *
 * Returning null matters: this check runs as `prebuild`, and it is executed in
 * environments that legitimately do not contain every file. Vercel, for
 * instance, only uploads `public/` and the sources it needs — the whole
 * `android/` tree is in `.vercelignore`, so `build.gradle` simply does not
 * exist during a web deploy. Crashing there would break every production
 * deploy over a check that has nothing to verify there.
 */
function readIfPresent(...segments) {
  const p = path.join(root, ...segments);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const pkgVersion = String(pkg.version ?? '').trim();

const gradle = readIfPresent('android', 'app', 'build.gradle');
const gradleFallback = gradle?.match(/def\s+appVersionName\s*=\s*"([^"]+)"/)?.[1] ?? null;
const gradleUsesPkg =
  !!gradle &&
  /versionName\s+appVersionName/.test(gradle) &&
  gradle.includes('package.json');

const route = readIfPresent('src', 'app', 'api', 'version', 'route.ts');
const minVersion = route?.match(/minVersion:\s*'([^']+)'/)?.[1] ?? null;
const latestVersion = route?.match(/latestVersion:\s*'([^']+)'/)?.[1] ?? null;

const problems = [];

if (!/^\d+(\.\d+){0,2}$/.test(pkgVersion)) {
  problems.push(`package.json version is not a valid x.y.z: "${pkgVersion}"`);
}

// Only enforceable when the file is actually in the build context.
if (gradle) {
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
}

if (route) {
  if (!minVersion || !latestVersion) {
    problems.push('could not parse minVersion/latestVersion from api/version/route.ts');
  } else if (minVersion !== latestVersion) {
    problems.push(
      `minVersion (${minVersion}) != latestVersion (${latestVersion}) — a user ` +
        'on the newest build would still be forced to update'
    );
  }
}

const notPresent = (label) => `${label} (absent in this build context — skipped)`;

console.log(`  package.json   ${pkgVersion}`);
console.log(
  `  build.gradle   ${
    gradle ? `${gradleFallback}${gradleUsesPkg ? ' (from package.json)' : ' (HARDCODED)'}` : notPresent('—')
  }`
);
console.log(`  minVersion     ${minVersion ?? notPresent('—')}`);
console.log(`  latestVersion  ${latestVersion ?? notPresent('—')}`);

if (problems.length) {
  console.error('\n✗ Version check FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log('\n✓ All version sources agree.');
