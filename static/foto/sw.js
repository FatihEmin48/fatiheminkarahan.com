// Foto Stüdyo servis çalışanı — kabuk dosyalarını önbelleğe alır, çevrimdışı açılır.
// Sürüm değişince eski önbellek temizlenir.

const VERSION = 'foto-studyo-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './js/app.js',
  './js/gl.js',
  './js/shaders.js',
  './js/mat3.js',
  './js/adjustments.js',
  './js/presets.js',
  './js/curves.js',
  './js/curveEditor.js',
  './js/crop.js',
  './js/histogram.js',
  './js/overlay.js',
  './js/store.js',
  './js/exporter.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Kabuk: önce ağ, olmazsa önbellek (geliştirme sırasında tazelik için)
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
