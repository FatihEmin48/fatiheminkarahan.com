// pdf.js sarmalayıcısı: PDF → sayfa görüntüsü, PDF → metin, sayfa bilgisi.
// pdf.js yerel `vendor/` klasöründen yüklenir; internet gerekmez.

let pdfjs = null;

async function lib() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

const ASSET = (p) => new URL(`../vendor/${p}`, import.meta.url).href;

export async function openPdf(data) {
  const p = await lib();
  const task = p.getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    cMapUrl: ASSET('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: ASSET('standard_fonts/'),
    wasmUrl: ASSET('wasm/'),
    isEvalSupported: false,
  });
  try {
    return await task.promise;
  } catch (e) {
    // pdf.js hataları teknik; kullanıcıya ne yapacağını söyleyen bir karşılığa çevir
    const name = e?.name || '';
    if (name === 'PasswordException') {
      throw new Error('Bu PDF parola korumalı. Parolayı kaldırıp tekrar dene.');
    }
    if (name === 'InvalidPDFException') {
      throw new Error('Dosya geçerli bir PDF değil ya da bozulmuş.');
    }
    throw new Error('PDF açılamadı: ' + (e?.message || name || 'bilinmeyen hata'));
  }
}

/**
 * Belgeyi kapatır. pdf.js 6'da PDFDocumentProxy.destroy() kaldırıldı; kapatma
 * yükleme görevi üzerinden yapılıyor.
 */
async function closeDoc(doc) {
  try {
    if (typeof doc.destroy === 'function') await doc.destroy();
    else if (doc.loadingTask?.destroy) await doc.loadingTask.destroy();
    else doc.cleanup?.();
  } catch { /* kapatma hatası sonucu etkilemez */ }
}

export async function pdfInfo(data) {
  const doc = await openPdf(data);
  const meta = await doc.getMetadata().catch(() => null);
  const first = await doc.getPage(1);
  const vp = first.getViewport({ scale: 1 });
  const info = {
    pages: doc.numPages,
    width: Math.round(vp.width),
    height: Math.round(vp.height),
    title: meta?.info?.Title || '',
    author: meta?.info?.Author || '',
    encrypted: !!meta?.info?.IsEncrypted,
  };
  await closeDoc(doc);
  return info;
}

/**
 * Sayfaları tuvale çizer. scale: 1 = 72 DPI. onPage(i, total) ilerleme bildirir.
 * Dönüş: [{ index, canvas }]
 */
export async function renderPages(data, { dpi = 150, pages = null, onPage = null } = {}) {
  const doc = await openPdf(data);
  const scale = dpi / 72;
  const list = pages && pages.length ? pages : Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const out = [];
  for (let k = 0; k < list.length; k++) {
    const n = list[k];
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
    page.cleanup();
    out.push({ index: n, canvas });
    onPage?.(k + 1, list.length);
  }
  await closeDoc(doc);
  return out;
}

/**
 * Metin çıkarır. Satırlar y konumuna, paragraflar satır aralığına göre toparlanır.
 * Dönüş: [{ index, paragraphs: string[] }]
 */
export async function extractText(data, { onPage = null } = {}) {
  const doc = await openPdf(data);
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();

    const rows = [];
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5] * 2) / 2;
      const x = item.transform[4];
      const h = Math.abs(item.transform[3]) || 10;
      let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(1.5, h * 0.35));
      if (!row) { row = { y, h, items: [] }; rows.push(row); }
      row.items.push({ x, str: item.str, w: item.width || 0 });
    }
    rows.sort((a, b) => b.y - a.y);
    const lines = rows.map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      let s = '';
      let prevEnd = null;
      for (const it of r.items) {
        if (prevEnd !== null && it.x - prevEnd > Math.max(1.2, r.h * 0.22) && !/\s$/.test(s)) s += ' ';
        s += it.str;
        prevEnd = it.x + it.w;
      }
      return { text: s.replace(/\s+/g, ' ').trim(), y: r.y, h: r.h };
    }).filter((l) => l.text);

    // Satır aralığı belirgin biçimde artınca yeni paragraf
    const paragraphs = [];
    let buf = '';
    for (let i = 0; i < lines.length; i++) {
      const cur = lines[i];
      const prev = lines[i - 1];
      const gap = prev ? prev.y - cur.y : 0;
      const newPara = !prev || gap > cur.h * 1.6 || /[.!?:;»”"']$/.test(prev.text) && gap > cur.h * 1.25;
      if (newPara && buf) { paragraphs.push(buf.trim()); buf = ''; }
      buf += (buf ? ' ' : '') + cur.text;
    }
    if (buf.trim()) paragraphs.push(buf.trim());

    out.push({ index: n, paragraphs });
    page.cleanup();
    onPage?.(n, doc.numPages);
  }
  await closeDoc(doc);
  return out;
}

/** Gömülü görselleri değil, sayfa kopyalarını içeren yeni bir PDF için sayfa sayısı. */
export async function pageCount(data) {
  const doc = await openPdf(data);
  const n = doc.numPages;
  await closeDoc(doc);
  return n;
}
