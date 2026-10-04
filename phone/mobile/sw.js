// Home screen version only: keeps the app working offline. Pages and code come from
// the network when there is one (so updates show up), and from the cache when there isn't.
// Also shows the reminders the household account sends (Web Push, Settings > Notifications).
const CACHE = 'family-planner-v1';
const SHELL = ['/', '/index.html', '/privacy.html', '/app.js', '/styles.css', '/icon.svg', '/manifest.webmanifest', '/mobile/mobile.js', '/mobile/ios.css'];

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

// A reminder from infra/lambda/index.js: { title, body, tag }. The tag is the reminder's id,
// so a reminder sent again replaces the old one instead of piling up.
self.addEventListener('push', (e) => {
  let msg = {};
  try {
    msg = e.data ? e.data.json() : {};
  } catch {
    msg = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(self.registration.showNotification(msg.title || 'Family Planner', {
    body: msg.body || '',
    tag: msg.tag || undefined,
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    data: { url: '/' },
  }));
});

// Tapping a reminder opens the app (or brings it to the front if it's already open).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = open.find((c) => new URL(c.url).origin === location.origin);
    if (app) return app.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || '/');
  })());
});
