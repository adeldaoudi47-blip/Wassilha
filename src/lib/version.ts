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

/** Shape of the GET /api/version response. */
export type VersionCheckResponse = {
  latestVersion: string;
  minVersion: string;
  apkUrl: string;
  updateAvailable: boolean;
  forceUpdate: boolean;
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
 * `App.getInfo().version`, i.e. the APK's versionName). It takes priority over
 * APP_VERSION because this app loads the remote production URL in its WebView:
 * the web bundle is therefore always the newest, so the bundle version can
 * never identify an outdated installation. Only the installed native version
 * can. APP_VERSION is kept as a last-resort fallback for the (currently
 * unused) bundled-webDir configuration and for web-only test harnesses.
 *
 * Defensive by design: every failure path (fetch error, non-ok, malformed
 * JSON, empty fields, unparseable version) resolves to `false`, so a broken
 * or unreachable version endpoint can never lock every user out of the app.
 * The worst case of a failed check is "no update gate", never "unusable app".
 */
export async function shouldForceUpdate(installedVersion?: string): Promise<{
  forceUpdate: boolean;
  latestVersion?: string;
  apkUrl?: string;
}> {
  try {
    // Prefer the native shell's version; fall back to the baked-in bundle
    // version when the caller is a plain browser/test harness.
    const current = installedVersion && installedVersion.trim()
      ? installedVersion.trim()
      : APP_VERSION;

    // An unparseable current version means we cannot reason about this client.
    // Fail open rather than blocking a device we don't understand.
    if (!/^\d+(\.\d+){0,2}/.test(current)) return { forceUpdate: false };

    // `cache: 'no-store'` on top of the server's own no-store header: a
    // service worker (or the browser cache) returning a stale copy is the one
    // thing that could defeat a rollout.
    const res = await fetch(
      `/api/version?current=${encodeURIComponent(current)}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return { forceUpdate: false };
    const data = (await res.json()) as Partial<VersionCheckResponse>;

    // Guard the exact fields the gate keys off, so a partial/typed-wrong body
    // still degrades to "let the user in".
    const latestVersion =
      typeof data.latestVersion === 'string' ? data.latestVersion.trim() : '';
    const minVersion =
      typeof data.minVersion === 'string' ? data.minVersion.trim() : '';
    const apkUrl = typeof data.apkUrl === 'string' ? data.apkUrl.trim() : '';

    if (!latestVersion || !minVersion) return { forceUpdate: false };

    const forceUpdate = compareVersions(current, minVersion) < 0;
    return { forceUpdate, latestVersion, apkUrl: apkUrl || undefined };
  } catch {
    // Network down, DNS, app in airplane mode, or a JSON parse blow-up —
    // none of these should brick the device.
    return { forceUpdate: false };
  }
}
