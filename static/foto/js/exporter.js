// Dışa aktarım: ImageData → Blob → indirme / paylaşma / panoya kopyalama.

export const FORMATS = [
  { id: 'image/jpeg', label: 'JPEG', ext: 'jpg', quality: true },
  { id: 'image/png', label: 'PNG', ext: 'png', quality: false },
  { id: 'image/webp', label: 'WebP', ext: 'webp', quality: true },
];

export function imageDataToCanvas(imageData) {
  const c = document.createElement('canvas');
  c.width = imageData.width;
  c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return c;
}

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Görüntü kodlanamadı.'))),
      type,
      quality
    );
  });
}

/** JPEG'de saydam alanları beyaza yassılaştırır. */
export function flatten(canvas, background = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

export function buildFileName(base, ext, suffix = 'duzenlendi') {
  const clean = (base || 'foto')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .slice(0, 60);
  const d = new Date();
  const stamp =
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') +
    '-' +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0');
  return `${clean}-${suffix}-${stamp}.${ext}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function canShare(blob, filename) {
  if (!navigator.canShare || !navigator.share) return false;
  try {
    const file = new File([blob], filename, { type: blob.type });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareBlob(blob, filename, title = 'Foto Stüdyo') {
  const file = new File([blob], filename, { type: blob.type });
  await navigator.share({ files: [file], title });
}

export async function copyBlobToClipboard(blob) {
  if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Pano desteklenmiyor.');
  // Pano yalnızca PNG kabul eder
  let png = blob;
  if (blob.type !== 'image/png') {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    png = await canvasToBlob(c, 'image/png');
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}
