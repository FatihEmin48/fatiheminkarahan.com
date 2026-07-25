/* ocr-web.js — tarayıcı içinde metin tanıma (Tesseract.js, gerektiğinde yüklenir).
   Web panelinde galeriden seçilen görseli Android'i beklemeden okur.
   (Android uygulamasında native ML Kit kullanılır; orası bu dosyaya uğramaz.)

   Önemli iki ayrıntı:
   - Tesseract açık zeminde koyu yazı bekler. Apple Fitness ekranları siyah zeminlidir,
     bu yüzden koyu görseller ters çevrilir (invert) — aksi hâlde değerlerin çoğu okunmaz.
   - Tartı fotoğrafı yan çekilmiş olabilir; okunamazsa görsel döndürülüp yeniden denenir. */

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

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Görsel açılamadı')); };
    img.src = url;
  });
}

/**
 * Görseli tanımaya hazırlar: ölçekle, döndür, gri tonla, gerekirse ters çevir.
 * @param {HTMLImageElement} img
 * @param {{maxSide?:number, rotate?:0|90|180|270}} opts
 * @returns {Promise<Blob>}
 */
export function prepareCanvas(img, { maxSide = 1400, rotate = 0 } = {}) {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const swap = rotate === 90 || rotate === 270;
  const c = document.createElement('canvas');
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  ctx.save();
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();

  try {
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;

    // ortalama parlaklık: koyu ekran görüntülerinde yazı açık renktir → ters çevir
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
    const mean = sum / (px.length / 4);
    const invert = mean < 120;

    for (let i = 0; i < px.length; i += 4) {
      // Koyu arayüzlerde yazı renkli olabilir (pembe/yeşil/mavi halka değerleri).
      // Parlaklık formülü pembeyi orta griye düşürüp okunmaz yapıyor; en yüksek kanal
      // renkli yazıyı da parlak tutar.
      let g = invert
        ? Math.max(px[i], px[i + 1], px[i + 2])
        : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (invert) g = 255 - g;
      // kontrastı aç: orta griyi merkez alarak gerdir
      g = Math.max(0, Math.min(255, (g - 128) * 1.6 + 128));
      px[i] = px[i + 1] = px[i + 2] = g;
    }
    ctx.putImageData(data, 0, 0);
  } catch (e) { /* okunamazsa dokunulmamış hâliyle devam */ }

  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

let workerPromise = null;

async function getWorker(onProgress) {
  const T = await ensureTesseract();
  if (!workerPromise) {
    workerPromise = T.createWorker('tur+eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress(35 + Math.round((m.progress || 0) * 60), 'metin okunuyor');
        } else if (m.status && /load|initial/i.test(m.status)) {
          onProgress(20, 'dil verisi yükleniyor');
        }
      },
    }).then(async (w) => {
      // Ekran görüntüsü/tartı ekranı: dağınık yerleşim → seyrek metin kipi daha iyi
      try { await w.setParameters({ tessedit_pageseg_mode: '11' }); } catch (e) { /* */ }
      return w;
    });
  }
  return workerPromise;
}

/**
 * Görselden metin çıkarır.
 * @param {File|Blob} file
 * @param {(pct:number, durum:string)=>void} onProgress
 * @param {{rotate?:number, maxSide?:number}} opts
 */
export async function recognizeImage(file, onProgress = () => {}, opts = {}) {
  onProgress(4, 'hazırlanıyor');
  const img = await loadImage(file);
  onProgress(10, 'görsel hazırlanıyor');
  const blob = await prepareCanvas(img, opts);
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(blob || file);
  onProgress(100, 'bitti');
  return String(data?.text || '');
}

/**
 * Tartı fotoğrafı: yan çekilmiş olabilir. Sırayla 0°, 90°, 270°, 180° dener,
 * ilk anlamlı sonuçta durur.
 * @param {(text:string)=>any} extract metinden değer çıkaran işlev (null → başarısız)
 * @returns {Promise<{value:any, text:string, rotate:number}>}
 */
export async function recognizeRotations(file, extract, onProgress = () => {}) {
  const angles = [0, 90, 270, 180];
  let lastText = '';
  for (let i = 0; i < angles.length; i++) {
    const rotate = angles[i];
    const label = rotate ? `${rotate}° döndürülüp okunuyor` : 'metin okunuyor';
    const text = await recognizeImage(file, (pct, durum) => {
      onProgress(Math.round((i * 100 + pct) / angles.length), rotate ? label : durum);
    }, { rotate, maxSide: 1100 });
    lastText = text;
    const value = extract(text);
    if (value != null) return { value, text, rotate };
  }
  return { value: null, text: lastText, rotate: null };
}

/**
 * Görselin bir bölgesini kırpıp büyüterek okur (tartı ekranı gibi küçük alanlar için).
 * @param {File|Blob} file
 * @param {{x:number,y:number}} rel 0-1 aralığında dokunulan nokta
 * @param {(text:string)=>any} extract
 */
export async function recognizeArea(file, rel, extract, onProgress = () => {}) {
  const img = await loadImage(file);
  const bw = Math.round(img.width * 0.55);
  const bh = Math.round(img.height * 0.28);
  const cx = Math.round(img.width * Math.min(1, Math.max(0, rel.x)));
  const cy = Math.round(img.height * Math.min(1, Math.max(0, rel.y)));
  const sx = Math.max(0, Math.min(img.width - bw, cx - bw / 2));
  const sy = Math.max(0, Math.min(img.height - bh, cy - bh / 2));

  const scale = 2.2;
  const c = document.createElement('canvas');
  c.width = Math.round(bw * scale);
  c.height = Math.round(bh * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, bw, bh, 0, 0, c.width, c.height);
  const cropped = await new Promise((r) => c.toBlob(r, 'image/png'));

  const angles = [0, 90, 270, 180];
  let lastText = '';
  for (let i = 0; i < angles.length; i++) {
    const rotate = angles[i];
    const text = await recognizeImage(cropped, (pct, durum) => {
      onProgress(Math.round((i * 100 + pct) / angles.length),
        rotate ? `${rotate}° döndürülüp okunuyor` : durum);
    }, { rotate, maxSide: 1200 });
    lastText = text;
    const value = extract(text);
    if (value != null) return { value, text, rotate };
  }
  return { value: null, text: lastText, rotate: null };
}

/** Bellekteki işçiyi kapat (sayfa kapanırken). */
export async function releaseOcr() {
  if (!workerPromise) return;
  try { (await workerPromise).terminate(); } catch (e) { /* */ }
  workerPromise = null;
}
