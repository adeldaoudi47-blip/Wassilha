import { NextResponse } from 'next/server';

// GET /api/version
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
// This route is DELIBERATELY static and hardcoded. It used to derive its
// answer from package.json (read at request time) plus env overrides, but every
// one of those inputs is a runtime failure mode on a route whose entire job is
// to always answer: a failed read, a missing env var, or a standalone-bundling
// quirk could each turn this into a 500 — and the client fails open on a 500,
// which is exactly how the force-update gate silently never fired. With the
// values inlined below there is no runtime input that can fail.
//
// NOT `export const dynamic = 'force-static'`: that makes Next emit the route
// as a prerendered static asset, which Vercel does NOT serve at /api/version
// (it 404s), while a normal dynamic route handler — like every other route in
// this app — is deployed as a Lambda and always answers. The body is still
// effectively immutable because it is composed entirely of literals.
//
// TRADING AWAY THE EMERGENCY ROLLBACK: the previous version read
// FORCE_UPDATE_MIN_VERSION, so a broken release could be let back in without a
// redeploy. Hardcoding removes that lever — changing MIN_VERSION now needs a
// code change plus a full redeploy. That is the accepted cost of "this endpoint
// can never 500".
//
// The CLIENT decides. This response carries only facts (what is newest, the
// minimum allowed, where the APK lives); it never says whether a given caller
// is gated. `shouldForceUpdate()` in src/lib/version.ts compares the caller's
// own installed version against minVersion and computes that locally. Sending
// a pre-computed boolean would be a footgun: it would have to be correct for
// every possible `current`, and any client that ever trusted it over its own
// comparison would gate the wrong users.

export async function GET() {
  // `no-store` is mandatory: a browser, service worker, or CDN edge holding an
  // old copy could keep an outdated answer alive after a redeploy, and the
  // newest version must always be served fresh. `max-age=0` is belt-and-braces
  // for caches that ignore `no-store`.
  return NextResponse.json(
    {
      latestVersion: '1.1.0',
      minVersion: '1.1.0',
      apkUrl: 'https://wassilha.vercel.app/wassilha.apk',
    },
    { headers: { 'cache-control': 'no-store, max-age=0' } }
  );
}
