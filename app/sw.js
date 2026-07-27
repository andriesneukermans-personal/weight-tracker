// App-shell cache, stale-while-revalidate. Cross-origin requests
// (api.github.com) are never intercepted: sync always hits the network.
const CACHE = 'wt-shell-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/logic.js',
  './js/chart.js',
  './js/store.js',
  './js/github.js',
  './js/sync.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;
  const refresh = fetch(e.request).then((res) => {
    if (!res.ok) return res;
    const copy = res.clone();
    return caches.open(CACHE).then((c) => c.put(e.request, copy)).then(() => res);
  });
  // Keep the worker alive until the background revalidation and cache
  // write finish; without this the browser may terminate the SW right
  // after responding from cache, dropping the revalidate half of SWR.
  e.waitUntil(refresh.catch(() => {}));
  e.respondWith(
    caches.match(e.request).then((hit) => hit || refresh.catch(() => hit))
  );
});
