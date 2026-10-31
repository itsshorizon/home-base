// Home Base service worker: precache everything so the app works with no internet.
// Release checklist: CACHE_NAME here, BUILD_ID in js/app.js and version.json must all match.
const CACHE_NAME = 'hb-0.2.0';
const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'version.json',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/categories.js',
  'js/runway.js',
  'js/format.js',
  'js/ai.js',
  'js/off.js',
  'js/image.js',
  'js/queue.js',
  'js/scanner.js',
  'js/sheet.js',
  'js/views/dashboard.js',
  'js/views/inventory.js',
  'js/views/add.js',
  'js/views/itemform.js',
  'js/views/review.js',
  'js/views/household.js',
  'js/views/settings.js',
  'js/views/more.js',
  'js/views/placeholder.js',
  'data/staples.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/fonts/inter-latin-wght-normal.woff2',
  'vendor/html5-qrcode-2.3.8.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hb-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch third-party requests

  // version.json: network first so update checks see the truth, cache when offline
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('version.json', copy));
        }
        return res;
      }).catch(() => caches.match('version.json')),
    );
    return;
  }

  // page loads: always the cached app shell
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html').then((hit) => hit || fetch(req)));
    return;
  }

  // everything else: cache first, then network (and remember it)
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
