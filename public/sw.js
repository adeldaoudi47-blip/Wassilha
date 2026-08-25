// WASSILHA — Service Worker kill-switch.
//
// An earlier PWA-era build of this app registered a service worker that keeps
// serving stale bundles from Cache Storage, breaking auth flows for returning
// visitors (old HTML -> old JS -> re-registers the SW -> loop).
//
// Whenever ANY client tries to register /sw.js, it now gets THIS file instead:
//   1. install: activate immediately
//   2. activate: unregister ourselves, delete every cache, then reload all
//      open clients so they fetch fresh content straight from the network.
// Result: the rogue worker and its caches are wiped on first contact, and no
// service worker remains registered afterwards.
const CACHE_PREFIX = 'wassilha-';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete every cache this origin ever created (old PWA runtime caches).
      if (self.caches && self.caches.keys) {
        const keys = await self.caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) || true)
            .map((k) => self.caches.delete(k))
        );
      }

      // Unregister ourselves — after this, NO service worker is registered.
      await self.registration.unregister();

      // Reload every open client so it drops the stale bundle immediately.
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        if (client.navigate) client.navigate(client.url);
      }
    })()
  );
});
