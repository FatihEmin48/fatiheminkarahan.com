// Servis çalışanı: uygulama kabuğu kurulumda önbelleğe alınır; ağır satıcı dosyaları
// (pdf.js worker'ı, CMap'ler, yazı tipleri) ilk kullanıldıklarında önbelleğe eklenir.

const VERSION = 'donusturucu-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './js/app.js',
  './js/registry.js',
  './js/detect.js',
  './js/zip.js',
  './js/ttf.js',
  './js/pdfwrite.js',
  './js/pdfread.js',
  './js/doc2pdf.js',
  './js/docx.js',
  './js/xlsx.js',
  './js/office.js',
  './js/textconv.js',
  './js/imgconv.js',
  './fonts/Roboto-Regular.ttf',
  './fonts/Roboto-Bold.ttf',
  './fonts/Roboto-Italic.ttf',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
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

  // Satıcı dosyaları büyük ve değişmez: önce önbellek
  if (url.pathname.includes('/vendor/') || url.pathname.includes('/fonts/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

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
