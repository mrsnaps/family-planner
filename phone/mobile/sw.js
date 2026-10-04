// Home screen version only: keeps the app working offline. Pages and code come from
// the network when there is one (so updates show up), and from the cache when there isn't.
const CACHE = 'family-planner-v1';
const SHELL = ['/', '/index.html', '/app.js', '/styles.css', '/icon.svg', '/manifest.webmanifest', '/mobile/mobile.js', '/mobile/ios.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(e.request)) || (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error()))
  );
});
