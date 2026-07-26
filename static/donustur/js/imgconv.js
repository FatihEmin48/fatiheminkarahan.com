// Görüntü çözme/kodlama. Tarayıcının kendi çözücüleri kullanılır: PNG, JPEG, WebP,
// GIF, BMP, AVIF, ICO ve (ayrı yoldan) SVG.

export const IMAGE_TARGETS = [
  { mime: 'image/png', ext: 'png', label: 'PNG', quality: false, alpha: true },
  { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG', quality: true, alpha: false },
  { mime: 'image/webp', ext: 'webp', label: 'WebP', quality: true, alpha: true },
];

let webpOk = null;
export function supportsWebp() {
  if (webpOk === null) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    webpOk = c.toDataURL('image/webp').startsWith('data:image/webp');
  }
  return webpOk;
}

/** Blob'u çizilebilir bir kaynağa çevirir (ImageBitmap ya da HTMLImageElement). */
export async function decodeImage(blob) {
  if (blob.type === 'image/svg+xml' || /\.svg$/i.test(blob.name || '')) {
    return decodeSvg(blob);
  }
  try {
    const bmp = await createImageBitmap(blob);
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.() };
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'sync';
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('Görsel çözülemedi.'));
        img.src = url;
      });
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }
}

/** SVG'yi belirtilen genişlikte rasterleştirir (vektör olduğu için ölçü serbesttir). */
async function decodeSvg(blob, targetWidth = 2000) {
  const text = await blob.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  let w = parseFloat(svg.getAttribute('width')) || 0;
  let h = parseFloat(svg.getAttribute('height')) || 0;
  if (!w || !h) {
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    if (vb.length === 4) { w = vb[2]; h = vb[3]; }
  }
  if (!w || !h) { w = 1000; h = 1000; }
  const k = Math.min(4, Math.max(1, targetWidth / w));
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('SVG çözülemedi.'));
    img.src = url;
  });
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return { source: c, width: c.width, height: c.height, close: () => {} };
}

/** Kaynağı tuvale çizer; saydamlığı kaldırmak gerekirse arka plan doldurur. */
export function toCanvas(source, width, height, { maxSide = 0, background = null } = {}) {
  let w = width;
  let h = height;
  if (maxSide > 0 && Math.max(w, h) > maxSide) {
    const k = maxSide / Math.max(w, h);
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

export function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Görüntü kodlanamadı: ' + mime))),
      mime,
      quality
    );
  });
}

/** Tam dönüşüm: blob → hedef biçimde blob. */
export async function convertImage(blob, target, opts = {}) {
  const { quality = 0.92, maxSide = 0, background = '#ffffff' } = opts;
  const dec = await decodeImage(blob);
  try {
    const t = IMAGE_TARGETS.find((x) => x.mime === target) || IMAGE_TARGETS[0];
    const canvas = toCanvas(dec.source, dec.width, dec.height, {
      maxSide,
      background: t.alpha ? null : background,
    });
    const out = await canvasToBlob(canvas, t.mime, t.quality ? quality : undefined);
    return { blob: out, width: canvas.width, height: canvas.height };
  } finally {
    dec.close?.();
  }
}

export async function imageSize(blob) {
  const dec = await decodeImage(blob);
  const size = { width: dec.width, height: dec.height };
  dec.close?.();
  return size;
}
