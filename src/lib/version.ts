/**
 * In-app force update — client side.
 *
 * `/api/version` is the single source of truth for "what's the newest
 * build". The installed Capacitor shell reports its own compile-time version
 * (NEXT_PUBLIC_APP_VERSION, baked in by `next build` + `cap sync`) and the
 * server decides whether it is too old to be allowed in.
 *
 * Why the check matters here specifically: this app is a Capacitor WebView
 * pointing at the live production URL, so the JS the user executes is always
 * current even when the *installed shell* is months old. A broken pairing
 * (old shell + new server contract) can therefore persist forever unless the
 * old shell is hard-blocked by the server, not by the bundle.
 */

/**
 * Shape of the GET /api/version response.
 *
 * Deliberately fact-only: `latestVersion` / `minVersion` / `apkUrl`. There is
 * NO `forceUpdate` boolean here — the route ships facts, not a verdict, and the
 * caller decides by comparing its own installed version against `minVersion`
 * (see shouldForceUpdate below). A server-computed gate flag would have to be
 * right for every possible client version and would drift out of sync with
 * this local comparison, so it was removed.
 */
export type VersionCheckResponse = {
  latestVersion: string;
  minVersion: string;
  apkUrl: string;
};

/**
 * The version this client was built with. Filled in by Next at build time via
 * `next.config.ts`, which reads `package.json` and exposes it as
 * NEXT_PUBLIC_APP_VERSION — so the string here and the value the server
 * reports come from the same file and cannot drift apart.
 *
 * The fallback is the "unknown build" sentinel. It must NOT default to
 * something low like '0.0.0': if the env var ever fails to reach the bundle,
 * a low fallback would make the client report an ancient version and /api
 * /version would force-update 100% of users. An unknown version fails open
 * (no gate), matching the server's own failure mode in next.config.ts.
 */
export const UNKNOWN_VERSION = '999.999.999';
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || UNKNOWN_VERSION;

/**
 * Compare two `x.y.z` versions. Negative when `a` is older than `b`, 0 when
 * equal, positive when newer. Mirrors the server-side comparator so the
 * client and the API can never disagree about ordering.
 *
 * Tolerant of a leading "v" and of pre-release/build metadata (`1.2.3-rc.1`
 * compares as `1.2.3`), which keeps the helper usable if we ever tag a
 * pre-release. It is NOT a full semver implementation — a `1.2.3-alpha` is
 * treated as equal to `1.2.3`, which is the right call for a gate that only
 * cares about released majors/minors/patches.
 */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string): number[] =>
    v
      .trim()
      .toLowerCase()
      .replace(/^v/, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);

  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/**
 * True when the running app is older than the server's minimum.
 *
 * `installedVersion` is the version reported by the *native shell* (Capacitor
 * `App.getInfo().version`, i.e. the APK's versionName).
 *
 * When that value is missing we are in the one case that matters most: the
 * shell predates `@capacitor/app` entirely (the v1.0 APK ships without the
 * plugin, so `App.getInfo()` rejects outright) or the bridge hit an OEM quirk.
 * We deliberately do NOT fall back to APP_VERSION here — this app loads the
 * remote production URL in its WebView, so the web bundle is always the newest
 * build and APP_VERSION would read as current even on a months-old APK. Using
 * it would make the gate silently never fire for the exact outdated installs
 * it exists to block. Instead an unreadable native version is treated as the
 * oldest possible build ('0.0.0') so the server gets the chance to gate it.
 *
 * Defensive about the *server*, not about the version: a fetch error, non-ok
 * status, malformed JSON, or empty response fields still resolves to `false`,
 * so a broken or unreachable version endpoint can never lock every user out of
 * the app. The worst case of a failed check is "no update gate", never
 * "unusable app".
 */
export async function shouldForceUpdate(installedVersion?: string): Promise<{
  forceUpdate: boolean;
  latestVersion?: string;
  apkUrl?: string;
}> {
  try {
    // No readable native version => assume the oldest build, NOT the (always
    // current) web bundle. See the docblock above: this ordering is the whole
    // reason the gate works against pre-plugin APKs.
    const current = (installedVersion ?? '').trim() || '0.0.0';

    // DIAGNOSTIC: logs the version the native shell actually reported (or the
    // '0.0.0' fallback when the plugin is absent/hung). A native version that
    // silently resolves to '0.0.0' here is the #1 known reason the gate never
    // appears on an outdated install.
    console.info('[ForceUpdate] shouldForceUpdate enter', { installedVersion, current });

    // A present-but-unparseable version means we cannot reason about this
    // client. Fail open rather than blocking a device we don't understand.
    if (!/^\d+(\.\d+){0,2}/.test(current)) {
      console.info('[ForceUpdate] version unparseable → fail open', { current });
      return { forceUpdate: false };
    }

    // `cache: 'no-store'` on top of the server's own no-store header: a
    // service worker (or the browser cache) returning a stale copy is the one
    // thing that could defeat a rollout.
    console.info('[ForceUpdate] fetching /api/version', { current });
    const res = await fetch(
      `/api/version?current=${encodeURIComponent(current)}`,
      { cache: 'no-store' }
    );
    if (!res.ok) {
      // The endpoint is fully static now, so a non-ok here means a network or
      // edge failure, not a server-side bug.
      console.info('[ForceUpdate] /api/version not ok → fail open', { status: res.status });
      return { forceUpdate: false };
    }
    const data = (await res.json()) as Partial<VersionCheckResponse>;

    // DIAGNOSTIC: the raw body as received. If this ever prints `{}` or a body
    // missing minVersion, the build output — not the client — is the defect.
    console.info('[ForceUpdate] /api/version response', { data });

    // Guard the exact fields the gate keys off, so a partial/typed-wrong body
    // still degrades to "let the user in".
    const latestVersion =
      typeof data.latestVersion === 'string' ? data.latestVersion.trim() : '';
    const minVersion =
      typeof data.minVersion === 'string' ? data.minVersion.trim() : '';
    const apkUrl = typeof data.apkUrl === 'string' ? data.apkUrl.trim() : '';

    if (!latestVersion || !minVersion) {
      console.info('[ForceUpdate] empty server fields → fail open', { latestVersion, minVersion });
      return { forceUpdate: false };
    }

    const forceUpdate = compareVersions(current, minVersion) < 0;

    // DIAGNOSTIC: the decision itself. This is the single most useful line —
    // it separates "the client computed false" (bad version plumbing) from
    // "the client computed true and the view still did not open" (React bug).
    console.info('[ForceUpdate] decision', {
      current,
      minVersion,
      latestVersion,
      forceUpdate,
    });

    return { forceUpdate, latestVersion, apkUrl: apkUrl || undefined };
  } catch (error) {
    // Network down, DNS, app in airplane mode, or a JSON parse blow-up —
    // none of these should brick the device.
    // DIAGNOSTIC: an offline device is a realistic cause of "no gate", so the
    // error is logged rather than swallowed.
    console.error('[ForceUpdate] check threw → fail open', error);
    return { forceUpdate: false };
  }
}
