// Home Base service worker: precache everything so the app works with no internet.
// Release checklist: CACHE_NAME here, BUILD_ID in js/app.js and version.json must all match.
const CACHE_NAME = 'hb-0.3.1';
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
  'js/weakspots.js',
  'js/guides.js',
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
  'js/views/guides.js',
  'js/views/guide.js',
  'js/views/weakspots.js',
  'data/staples.json',
  // GUIDES:START
  'data/guides/index.json',
  'data/guides/water-hidden-sources.json',
  'data/guides/water-how-much.json',
  'data/guides/water-boil.json',
  'data/guides/water-bleach.json',
  'data/guides/water-filters.json',
  'data/guides/water-tablets.json',
  'data/guides/water-source-choice.json',
  'data/guides/food-canned-safety.json',
  'data/guides/food-cooking-no-power.json',
  'data/guides/food-outage-safety.json',
  'data/guides/stove-butane.json',
  'data/guides/co-safety.json',
  'data/guides/stove-propane.json',
  'data/guides/power-phone-battery.json',
  'data/guides/generator-safety.json',
  'data/guides/sanitation-toilet.json',
  'data/guides/sanitation-hygiene.json',
  'data/guides/hazard-boil-advisory.json',
  'data/guides/hazard-evacuation.json',
  'data/guides/hazard-extreme-heat.json',
  'data/guides/hazard-hurricane.json',
  'data/guides/hazard-nuclear.json',
  'data/guides/hazard-power-outage.json',
  'data/guides/hazard-tornado.json',
  'data/guides/hazard-winter-storm.json',
  'data/guides/t1d-emergency-supply.json',
  'data/guides/t1d-pump-failure.json',
  'data/guides/t1d-insulin-storage.json',
  'data/guides/t1d-hypo.json',
  'data/guides/t1d-sick-days-ketones.json',
  'data/guides/t1d-go-kit.json',
  'data/guides/t1d-glucagon.json',
  'data/guides/t1d-cgm-failure.json',
  'data/guides/firstaid-fractures-sprains.json',
  'data/guides/firstaid-burns.json',
  'data/guides/firstaid-choking.json',
  'data/guides/firstaid-wounds.json',
  'data/guides/firstaid-dehydration.json',
  'data/guides/firstaid-cpr.json',
  'data/guides/firstaid-heat-illness.json',
  'data/guides/firstaid-kit-checklist.json',
  'data/guides/firstaid-cold.json',
  'data/guides/firstaid-otc-meds.json',
  'data/guides/firstaid-allergic.json',
  'data/guides/firstaid-bleeding.json',
  'data/guides/firstaid-shock.json',
  // GUIDES:END
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
