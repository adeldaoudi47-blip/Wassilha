// Post-deploy production smoke test.
//   node scripts/verify-deploy.mjs
// Checks the live site's contract: manifest, icons, 404 boundary, head tags,
// version endpoint, and that the APK is still downloadable at full size.
const BASE = process.env.BASE_URL ?? 'https://wassilha.vercel.app';

const get = async (path) => {
  const r = await fetch(BASE + path, { redirect: 'follow' });
  return { status: r.status, type: r.headers.get('content-type') ?? '', r };
};

const results = [];
const check = (label, ok, detail) => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const man = await get('/manifest.webmanifest');
const m = await man.r.json();
check('manifest served', man.status === 200 && man.type.includes('manifest'), `${man.status} ${man.type}`);
check('manifest display=standalone', m.display === 'standalone', m.display);
check('manifest has maskable icon', m.icons.some((i) => i.purpose === 'maskable'), `${m.icons.length} icons`);
check('manifest start_url', m.start_url === '/', m.start_url);

for (const p of ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png']) {
  const r = await fetch(BASE + p, { method: 'HEAD' });
  check(`icon ${p}`, r.status === 200 && r.headers.get('content-type') === 'image/png',
    `${r.status} ${r.headers.get('content-length')}b`);
}

const nf = await get('/this-route-does-not-exist-xyz');
const nfHtml = await nf.r.text();
check('404 status', nf.status === 404, String(nf.status));
check('404 is branded (arabic text)', nfHtml.includes('الصفحة غير موجودة'));
check('404 has recovery links', nfHtml.includes('href="/"') && nfHtml.includes('/craft'));

const home = await get('/');
const homeHtml = await home.r.text();
check('home 200', home.status === 200, String(home.status));
check('home links manifest', homeHtml.includes('rel="manifest"'));
check('home has apple-touch-icon', homeHtml.includes('apple-touch-icon'));
check('home has theme-color', homeHtml.includes('name="theme-color"'));
check('home has no SW kill-switch', !homeHtml.includes('serviceWorker.getRegistrations'));

// The service worker is deliberately gone; a 404 proves it is really removed
// rather than merely unreferenced.
const sw = await get('/sw.js');
check('sw.js removed', sw.status === 404, String(sw.status));

const ver = await get('/api/version');
const v = await ver.r.json();
check('api/version served', ver.status === 200, JSON.stringify(v));
check('versions agree (no forced-update loop)', v.minVersion === v.latestVersion,
  `${v.minVersion} / ${v.latestVersion}`);

const apk = await get('/wassilha.apk');
const buf = Buffer.from(await apk.r.arrayBuffer());
// Every APK is a ZIP: the first two bytes must be "PK".
const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
check('apk downloadable', apk.status === 200 && isZip && buf.length > 1_000_000,
  `${apk.status} ${buf.length} bytes, ${apk.type}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.error('FAILED: ' + failed.map((f) => f.label).join(', '));
  process.exit(1);
}
