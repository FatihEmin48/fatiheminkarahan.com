/* sw.js — çevrimdışı kabuk. Veri her zaman localStorage'da; ağ yoksa uygulama yine açılır. */

const CACHE = 'saglik-panel-v1.0.0';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icon.svg',
  'js/app.js', 'js/charts.js', 'js/ocr-web.js', 'js/ai.js',
  'js/core/core-util.js', 'js/core/core-parse.js', 'js/core/core-analysis.js',
  'js/core/core-store.js', 'js/core/core-api.js', 'js/core/config.js',
  'js/core/core-coach.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;          // Supabase istekleri doğrudan ağa

  // Ağ öncelikli: çevrimiçiyken her zaman güncel dosya, çevrimdışında önbellek.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html'))),
  );
});
