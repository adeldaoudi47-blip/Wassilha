import { NextResponse } from 'next/server';

// GET /api/version?current=1.0.0
// ---------------------------------------------------------------------------
// In-app force update. The native app calls this on every cold start, *before*
// the user is signed in, so this route is intentionally public (no session).
//
// The deployed web build always is the newest version, but the *installed*
// Capacitor app is whatever the user last downloaded, and it loads the remote
// site in a WebView. That decoupling means we can ship a web fix instantly
// while the installed shell is still old — so the only reliable way to block
// an outdated native client is a server-driven version check.
//
// Configuration (all optional; env overrides fall back to the shipped
// package.json version so the endpoint is correct out of the box):
//   LATEST_APP_VERSION       newest downloadable version (default: this build)
//   APK_URL                  where the update APK lives (default: /wassilha.apk)
//   FORCE_UPDATE_MIN_VERSION anything strictly older than this is force-blocked
//                            (default: LATEST_APP_VERSION — i.e. every release
//                            is mandatory until proven otherwise)

const DEFAULT_APK_URL = 'https://wassilha.vercel.app/wassilha.apk';

/**
 * Compare two dotted numeric versions, with an optional leading "v".
 * Returns a negative number if `a` is older than `b`, 0 if equal, positive
 * if newer. Non-numeric suffixes (e.g. `-rc.1`, `+build.5`) are ignored:
 * this app ships plain `x.y.z` releases and comparing the numeric core keeps
 * the check robust if a suffix ever appears.
 */
function compareVersions(a: string, b: string): number {
  const norm = (v: string) =>
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const current = (url.searchParams.get('current') ?? '').trim();

  // The version this exact deployment was built with. Falls back to the
  // "unknown" sentinel when the injected env var is missing — never to a low
  // version, which would make the server tell a healthy client it is too old
  // and force-update everyone.
  const thisBuild = process.env.NEXT_PUBLIC_APP_VERSION || '999.999.999';

  const latestVersion = (process.env.LATEST_APP_VERSION ?? thisBuild).trim();
  const apkUrl = (process.env.APK_URL ?? DEFAULT_APK_URL).trim();
  const minVersion = (process.env.FORCE_UPDATE_MIN_VERSION ?? latestVersion).trim();

  // A client that reports no version cannot be compared; never block it
  // (better to show the app than to brick a device we can't reason about).
  const isUpdateAvailable = current
    ? compareVersions(current, latestVersion) < 0
    : false;

  const isForceUpdate = current
    ? compareVersions(current, minVersion) < 0
    : false;

  // Cache-Control is deliberately absent: the newest version must be served
  // immediately. A stale CDN-cached "no update needed" response would keep an
  // outdated (possibly broken) client live for hours after a fix ships.
  return NextResponse.json(
    {
      latestVersion,
      minVersion,
      apkUrl,
      // True when the store has something newer than what the caller runs.
      // A soft update prompt can key off this (we only implement the hard
      // gate for now; `forceUpdate` is the field the client blocks on).
      updateAvailable: isUpdateAvailable,
      // True only when the caller is *older than the minimum* — strictly
      // below minVersion. A user on the exact minVersion is allowed in,
      // which is what makes an emergency rollback possible (ship 1.1.1 with
      // minVersion=1.0.0 to let 1.0.x users in while 1.1.x is broken).
      forceUpdate: isForceUpdate,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
