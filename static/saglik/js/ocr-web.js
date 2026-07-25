/* ocr-web.js — tarayıcı içinde metin tanıma (Tesseract.js, gerektiğinde yüklenir).
   Amaç: web panelinde galeriden seçilen ekran görüntüsünü Android'i beklemeden okumak.
   Android uygulamasında native ML Kit kullanılır (daha hızlı); bu dosya web için. */

const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js';

let loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Metin tanıma bileşeni indirilemedi'));
    document.head.appendChild(s);
  });
}

async function ensureTesseract() {
  if (window.Tesseract) return window.Tesseract;
  if (!loading) loading = loadScript(CDN).then(() => window.Tesseract);
  await loading;
  if (!window.Tesseract) throw new Error('Metin tanıma bileşeni yüklenemedi');
  return window.Tesseract;
}

/** Tanıma hızı ve doğruluğu için görseli küçült + kontrastı artır. */
export function prepareImage(file, { maxSide = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);

      // gri tonlama + hafif kontrast: koyu arayüz ekran görüntülerinde okumayı kolaylaştırır
      try {
        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          const v = g < 110 ? Math.max(0, g - 25) : Math.min(255, g + 25);
          px[i] = px[i + 1] = px[i + 2] = v;
        }
        ctx.putImageData(data, 0, 0);
      } catch (e) { /* canvas okunamazsa özgün görselle devam */ }

      c.toBlob((blob) => resolve({ blob: blob || file, width: w, height: h }), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Görsel açılamadı')); };
    img.src = url;
  });
}

/**
 * Görselden metin çıkarır.
 * @param {File|Blob} file
 * @param {(pct:number, durum:string)=>void} onProgress
 * @returns {Promise<string>}
 */
export async function recognizeImage(file, onProgress = () => {}) {
  onProgress(2, 'hazırlanıyor');
  const T = await ensureTesseract();
  onProgress(10, 'görsel hazırlanıyor');

  let input = file;
  try {
    const prepped = await prepareImage(file);
    input = prepped.blob;
  } catch (e) { /* özgün görselle devam */ }

  onProgress(18, 'dil verisi yükleniyor');
  const worker = await T.createWorker('tur+eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress(35 + Math.round((m.progress || 0) * 60), 'metin okunuyor');
      } else if (m.status && m.status.includes('loading')) {
        onProgress(22, 'dil verisi yükleniyor');
      }
    },
  });

  try {
    const { data } = await worker.recognize(input);
    onProgress(100, 'bitti');
    return String(data?.text || '');
  } finally {
    try { await worker.terminate(); } catch (e) { /* yoksay */ }
  }
}

export const isOcrSupported = () => typeof document !== 'undefined' && !!document.createElement('canvas').getContext;
