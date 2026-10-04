// Offline support: the app shell is cached, and API reads fall back to the last
// copy when there's no connection. Writes always need the server.
const SHELL = 'fp-shell-v3';
const DATA = 'fp-data-v1';
const FILES = ['/', '/index.html', '/privacy.html', '/app.js', '/styles.css', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    // Network first, so data is always fresh when online.
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) caches.open(DATA).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || new Response(
      JSON.stringify({ error: "You're offline and this hasn't been loaded before." }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    ))));
    return;
  }
  // App shell: network first too (so updates show straight away), cache when offline.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) caches.open(SHELL).then((c) => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html'))));
});
