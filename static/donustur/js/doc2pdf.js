// Paragraf listesi → sayfalanmış PDF. Tüm belge kaynakları (DOCX, MD, HTML, TXT,
// CSV) önce paragraf listesine indirgendiği için yerleşim tek yerde yapılır.

import { PdfDoc, PAGE_SIZES, fitBox } from './pdfwrite.js';

const FONT_URLS = {
  R: 'fonts/Roboto-Regular.ttf',
  B: 'fonts/Roboto-Bold.ttf',
  I: 'fonts/Roboto-Italic.ttf',
};

const fontCache = {};

async function loadFont(key) {
  if (fontCache[key]) return fontCache[key];
  const url = new URL('../' + FONT_URLS[key], import.meta.url).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Yazı tipi yüklenemedi: ' + FONT_URLS[key]);
  fontCache[key] = new Uint8Array(await res.arrayBuffer());
  return fontCache[key];
}

export const STYLES = {
  h1: { size: 21, font: 'B', before: 14, after: 7 },
  h2: { size: 16.5, font: 'B', before: 12, after: 6 },
  h3: { size: 13.5, font: 'B', before: 10, after: 5 },
  h4: { size: 11.5, font: 'B', before: 8, after: 4 },
  p: { size: 10.5, font: 'R', before: 0, after: 6 },
  code: { size: 9, font: 'R', before: 0, after: 1.5, indent: 12, gray: true },
  table: { size: 10, font: 'R', before: 0, after: 3 },
};

export const DEFAULT_OPTS = {
  pageSize: 'a4',
  orientation: 'portrait',
  margin: 56,          // punto (~2 cm)
  lineHeight: 1.36,
  pageNumbers: true,
  title: '',
};

/**
 * paragraphs: [{ text, style, bold, italic, list, level, align }]
 * Dönüş: PDF baytları.
 */
export async function paragraphsToPdf(paragraphs, options = {}) {
  const opt = { ...DEFAULT_OPTS, ...options };
  const size = PAGE_SIZES[opt.pageSize] || PAGE_SIZES.a4;
  const landscape = opt.orientation === 'landscape';
  const pageW = landscape ? size.h : size.w;
  const pageH = landscape ? size.w : size.h;

  const doc = new PdfDoc({ title: opt.title });
  await doc.embedFont('R', await loadFont('R'));
  await doc.embedFont('B', await loadFont('B'));
  await doc.embedFont('I', await loadFont('I'));

  const margin = Math.max(18, opt.margin);
  const contentW = pageW - margin * 2;
  const bottom = margin + (opt.pageNumbers ? 16 : 0);

  let page = doc.addPage(pageW, pageH);
  let y = pageH - margin;
  const pageList = [page];

  const newPage = () => {
    page = doc.addPage(pageW, pageH);
    pageList.push(page);
    y = pageH - margin;
  };

  const ensure = (needed) => {
    if (y - needed < bottom) newPage();
  };

  for (const p of paragraphs) {
    const style = STYLES[p.style] || STYLES.p;
    const fontKey = p.bold && style.font === 'R' ? 'B' : p.italic && style.font === 'R' ? 'I' : style.font;
    const indent = (style.indent || 0) + (p.list ? 16 + (p.level || 0) * 14 : 0);
    const width = contentW - indent;
    const lineH = style.size * opt.lineHeight;

    if (!String(p.text).trim()) { y -= lineH * 0.5; continue; }

    y -= style.before;

    if (p.style === 'table') {
      const cells = String(p.text).split('\t');
      const colW = contentW / Math.max(1, cells.length);
      const wrapped = cells.map((c) => doc.wrap(fontKey, style.size, c, colW - 8));
      const rows = Math.max(...wrapped.map((w) => w.length), 1);
      ensure(rows * lineH + 4);
      doc.drawRect(page, margin, y + 2, contentW, 0.4, [210, 216, 226]);
      wrapped.forEach((cellLines, ci) => {
        cellLines.forEach((line, li) => {
          doc.drawText(page, fontKey, style.size, margin + ci * colW + 4, y - style.size - li * lineH, line);
        });
      });
      y -= rows * lineH + 4 + style.after;
      continue;
    }

    const lines = doc.wrap(fontKey, style.size, p.text, width);
    for (let i = 0; i < lines.length; i++) {
      ensure(lineH);
      const marker = p.list && i === 0 ? (p.list === 'ul' ? '•' : '–') : null;
      if (marker) {
        doc.drawText(page, fontKey, style.size, margin + indent - 12, y - style.size, marker);
      }
      let x = margin + indent;
      if (p.align === 'center') {
        x = margin + indent + (width - doc.measure(fontKey, style.size, lines[i])) / 2;
      } else if (p.align === 'right') {
        x = margin + indent + width - doc.measure(fontKey, style.size, lines[i]);
      }
      doc.drawText(page, fontKey, style.size, x, y - style.size, lines[i], {
        color: style.gray ? [70, 78, 92] : [26, 29, 35],
      });
      y -= lineH;
    }
    y -= style.after;
  }

  if (opt.pageNumbers && pageList.length > 1) {
    pageList.forEach((pg, i) => {
      const label = `${i + 1} / ${pageList.length}`;
      const w = doc.measure('R', 8.5, label);
      doc.drawText(pg, 'R', 8.5, (pageW - w) / 2, margin - 4, label, { color: [140, 148, 162] });
    });
  }

  return doc.build();
}

/* --------------------------------------------------------- görüntülerden PDF */

export const IMAGE_PDF_OPTS = {
  pageSize: 'a4',        // 'auto' = sayfa görüntü oranını alır
  orientation: 'auto',   // 'auto' | 'portrait' | 'landscape'
  margin: 0,
  mode: 'contain',
  quality: 0.92,
  lossless: false,
  background: '#ffffff',
};

/**
 * items: [{ blob, canvas?, width, height }] → tek PDF.
 * JPEG kaynaklar yeniden kodlanmadan gömülür (kayıpsız geçiş).
 */
export async function imagesToPdf(items, options = {}, onProgress = null) {
  const opt = { ...IMAGE_PDF_OPTS, ...options };
  const doc = new PdfDoc({ title: opt.title || 'Görseller' });

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let img;
    const srcBlob = it.blob;
    const isJpeg = srcBlob && (srcBlob.type === 'image/jpeg' || /\.jpe?g$/i.test(srcBlob.name || ''));

    if (isJpeg && !opt.recompress) {
      img = await doc.addJpeg(new Uint8Array(await srcBlob.arrayBuffer()));
    } else if (opt.lossless) {
      const ctx = it.canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, it.canvas.width, it.canvas.height).data;
      img = await doc.addRawImage(data, it.canvas.width, it.canvas.height);
    } else {
      const blob = await new Promise((res) => it.canvas.toBlob(res, 'image/jpeg', opt.quality));
      img = await doc.addJpeg(new Uint8Array(await blob.arrayBuffer()));
    }

    let pageW;
    let pageH;
    if (opt.pageSize === 'auto') {
      pageW = (img.width / 96) * 72;
      pageH = (img.height / 96) * 72;
      const cap = 14400;   // PDF'in izin verdiği en büyük sayfa kenarı
      const k = Math.min(1, cap / Math.max(pageW, pageH));
      pageW *= k; pageH *= k;
    } else {
      const size = PAGE_SIZES[opt.pageSize] || PAGE_SIZES.a4;
      const wantLandscape = opt.orientation === 'landscape' ||
        (opt.orientation === 'auto' && img.width > img.height);
      pageW = wantLandscape ? size.h : size.w;
      pageH = wantLandscape ? size.w : size.h;
    }

    const page = doc.addPage(pageW, pageH);
    const m = Math.max(0, opt.margin);
    if (opt.background && opt.background !== 'none' && m > 0) {
      const c = hexToRgb(opt.background);
      if (c) doc.drawRect(page, 0, 0, pageW, pageH, c);
    }
    const box = fitBox(img.width, img.height, pageW - m * 2, pageH - m * 2, opt.mode);
    doc.drawImage(page, img, m + box.x, m + box.y, box.w, box.h);
    onProgress?.(i + 1, items.length);
  }

  return doc.build();
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
