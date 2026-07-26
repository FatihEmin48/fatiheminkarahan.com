// Dönüşüm kayıt defteri. Her kayıt hangi girdiyi kabul ettiğini, hangi seçenekleri
// gösterdiğini ve dönüşümü nasıl yapacağını bildirir; arayüz bunun dışında bir şey bilmez.

import * as img from './imgconv.js';
import * as pdfr from './pdfread.js';
import * as d2p from './doc2pdf.js';
import * as docx from './docx.js';
import * as tc from './textconv.js';
import * as xl from './xlsx.js';
import * as office from './office.js';
import { createZip } from './zip.js';
import { baseName } from './detect.js';

/* ------------------------------------------------------------------ seçenekler */

export const OPTION_SPECS = {
  quality: { type: 'range', label: 'Kalite', min: 40, max: 100, def: 92, unit: '%' },
  maxSide: {
    type: 'select', label: 'En büyük kenar', def: '0',
    choices: [['0', 'Orijinal'], ['4096', '4096 px'], ['2560', '2560 px'], ['2048', '2048 px'],
      ['1600', '1600 px'], ['1080', '1080 px'], ['800', '800 px']],
  },
  pageSize: {
    type: 'select', label: 'Sayfa boyutu', def: 'a4',
    choices: [['a4', 'A4'], ['letter', 'Letter'], ['a3', 'A3'], ['a5', 'A5'], ['legal', 'Legal'], ['auto', 'Görsele göre']],
  },
  docPageSize: {
    type: 'select', label: 'Sayfa boyutu', def: 'a4',
    choices: [['a4', 'A4'], ['letter', 'Letter'], ['a3', 'A3'], ['a5', 'A5'], ['legal', 'Legal']],
  },
  orientation: {
    type: 'select', label: 'Yön', def: 'auto',
    choices: [['auto', 'Otomatik'], ['portrait', 'Dikey'], ['landscape', 'Yatay']],
  },
  docOrientation: {
    type: 'select', label: 'Yön', def: 'portrait',
    choices: [['portrait', 'Dikey'], ['landscape', 'Yatay']],
  },
  margin: { type: 'range', label: 'Kenar boşluğu', min: 0, max: 96, def: 0, unit: 'pt' },
  docMargin: { type: 'range', label: 'Kenar boşluğu', min: 18, max: 110, def: 56, unit: 'pt' },
  fitMode: {
    type: 'select', label: 'Yerleşim', def: 'contain',
    choices: [['contain', 'Sayfaya sığdır'], ['cover', 'Sayfayı doldur']],
  },
  merge: { type: 'check', label: 'Hepsini tek PDF yap', def: true },
  dpi: {
    type: 'select', label: 'Çözünürlük', def: '150',
    choices: [['72', '72 DPI (ekran)'], ['150', '150 DPI'], ['200', '200 DPI'], ['300', '300 DPI (baskı)'], ['600', '600 DPI']],
  },
  delimiter: {
    type: 'select', label: 'Ayırıcı', def: 'auto',
    choices: [['auto', 'Otomatik'], [',', 'Virgül ,'], [';', 'Noktalı virgül ;'], ['\t', 'Sekme'], ['|', 'Boru |']],
  },
  pageNumbers: { type: 'check', label: 'Sayfa numarası ekle', def: true },
  keepLines: { type: 'check', label: 'Satır düzenini koru', def: false },
  headers: { type: 'check', label: 'İlk satır başlık', def: true },
  lossless: { type: 'check', label: 'Kayıpsız (dosya büyür)', def: false },
};

/* -------------------------------------------------------------------- yardımcı */

const blobOf = (data, type) => new Blob([data], { type });

async function readText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  // BOM'lu UTF-16 dosyaları da doğru okunsun
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // Çözülemeyen bayt oranı yüksekse Windows-1254 (Türkçe) dene
  const bad = (utf8.match(/�/g) || []).length;
  if (bad > utf8.length * 0.002) {
    try { return new TextDecoder('windows-1254').decode(buf); } catch { /* yoksa UTF-8 kalsın */ }
  }
  return utf8;
}

export const SCANNED_HINT =
  'Bu PDF taranmış görünüyor: içinde seçilebilir metin yok, sayfalar görüntü olarak duruyor. '
  + 'Metne çeviremem — "PNG" ya da "JPEG" seçeneğiyle sayfaları görüntü olarak alabilirsin.';

/**
 * Boş çıktı üretmek yerine nedenini söyle. Taranmış PDF'lerde eskiden 0 baytlık
 * dosya ve boş bir Word belgesi üretiliyordu.
 */
function assertText(paragraphs, kind) {
  const chars = paragraphs.reduce((n, p) => n + String(p.text || '').trim().length, 0);
  if (chars >= 8) return paragraphs;
  if (kind === 'pdf') throw new Error(SCANNED_HINT);
  if (kind === 'docx') throw new Error('Bu belgede metin bulunamadı (boş görünüyor).');
  throw new Error('Dosya boş, dönüştürülecek bir şey yok.');
}

async function paragraphsOf(item, { requireText = true } = {}) {
  const { kind, sub, file } = item;
  const done = (list) => (requireText ? assertText(list, kind) : list);

  if (kind === 'docx') return done(await docx.readDocx(await file.arrayBuffer()));
  if (kind === 'odt') return done(await office.readOdt(await file.arrayBuffer()));
  if (kind === 'odp') return done(await office.readOdp(await file.arrayBuffer()));
  if (kind === 'pptx') return done(await office.readPptx(await file.arrayBuffer()));
  if (kind === 'ods' || kind === 'xlsx') {
    const sheets = kind === 'ods'
      ? await office.readOds(await file.arrayBuffer())
      : await xl.readXlsx(await file.arrayBuffer());
    const list = [];
    for (const s of sheets) {
      if (sheets.length > 1) list.push({ text: s.name, style: 'h2' });
      for (const row of s.rows) list.push({ text: row.join('\t'), style: 'table' });
    }
    return done(list);
  }
  if (sub === 'rtf') return done(office.readRtf(await readText(file)));
  if (kind === 'pdf') {
    const pages = await pdfr.extractText(new Uint8Array(await file.arrayBuffer()));
    const out = [];
    pages.forEach((pg, i) => {
      if (i > 0) out.push({ text: '', style: 'p' });
      for (const p of pg.paragraphs) out.push({ text: p, style: 'p' });
    });
    return done(out);
  }
  const text = await readText(file);
  if (sub === 'md') return done(tc.markdownToParagraphs(text));
  if (sub === 'html') return done(tc.htmlToParagraphs(text));
  if (sub === 'json') return done(tc.textToLines(pretty(text)));
  if (sub === 'csv') {
    const rows = tc.parseCsv(text);
    return done(rows.map((r) => ({ text: r.join('\t'), style: 'table' })));
  }
  if (sub === 'code' || sub === 'xml') return done(tc.textToLines(text));
  return done(tc.textToParagraphs(text));
}

function pretty(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

/** Tablo kaynağını ({ name, rows }[]) biçimden bağımsız okur. */
async function sheetsOf(item) {
  const buf = await item.file.arrayBuffer();
  const sheets = item.kind === 'ods' ? await office.readOds(buf) : await xl.readXlsx(buf);
  if (!sheets.length || !sheets.some((s) => s.rows.length)) {
    throw new Error('Bu dosyada okunabilir tablo bulunamadı.');
  }
  return sheets;
}

async function zipResults(results, name) {
  const entries = await Promise.all(results.map(async (r) => ({
    name: r.name,
    data: new Uint8Array(await r.blob.arrayBuffer()),
    store: /\.(jpg|jpeg|png|webp|pdf|docx|xlsx|zip)$/i.test(r.name),
  })));
  return [{ name, blob: blobOf(await createZip(entries), 'application/zip') }];
}

async function pdfLib() {
  return import('../vendor/pdf-lib.esm.min.js');
}

/* ------------------------------------------------------------------- kayıtlar */

export const CONVERTERS = [
  /* ---------------------------------------------------------------- görseller */
  ...img.IMAGE_TARGETS.map((t) => ({
    id: 'img2' + t.ext,
    label: t.label,
    group: 'Görsel',
    accepts: ['image'],
    options: [...(t.quality ? ['quality'] : []), 'maxSide'],
    async run(items, opt, progress) {
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const r = await img.convertImage(items[i].file, t.mime, {
          quality: Number(opt.quality ?? 92) / 100,
          maxSide: Number(opt.maxSide || 0),
        });
        out.push({ name: baseName(items[i].name) + '.' + t.ext, blob: r.blob });
        progress?.(i + 1, items.length);
      }
      return out;
    },
  })),

  {
    id: 'img2pdf',
    label: 'PDF',
    group: 'Belge',
    accepts: ['image'],
    options: ['merge', 'pageSize', 'orientation', 'fitMode', 'margin', 'quality', 'lossless'],
    note: 'JPEG kaynaklar yeniden kodlanmadan gömülür.',
    async run(items, opt, progress) {
      const prepared = [];
      for (let i = 0; i < items.length; i++) {
        const dec = await img.decodeImage(items[i].file);
        const maxSide = Number(opt.maxSide || 0);
        const canvas = img.toCanvas(dec.source, dec.width, dec.height, {
          maxSide,
          background: opt.lossless ? null : '#ffffff',
        });
        dec.close?.();
        prepared.push({ blob: items[i].file, canvas, name: items[i].name });
        progress?.(i + 1, items.length * 2);
      }
      const common = {
        pageSize: opt.pageSize,
        orientation: opt.orientation,
        margin: Number(opt.margin || 0),
        mode: opt.fitMode,
        quality: Number(opt.quality ?? 92) / 100,
        lossless: !!opt.lossless,
        recompress: Number(opt.maxSide || 0) > 0,
      };
      if (opt.merge !== false && prepared.length > 1) {
        const bytes = await d2p.imagesToPdf(prepared, { ...common, title: 'Görseller' },
          (n, t) => progress?.(items.length + n, items.length + t));
        return [{ name: 'gorseller.pdf', blob: blobOf(bytes, 'application/pdf') }];
      }
      const out = [];
      for (let i = 0; i < prepared.length; i++) {
        const bytes = await d2p.imagesToPdf([prepared[i]], common);
        out.push({ name: baseName(prepared[i].name) + '.pdf', blob: blobOf(bytes, 'application/pdf') });
        progress?.(items.length + i + 1, items.length * 2);
      }
      return out;
    },
  },

  /* --------------------------------------------------------------------- PDF */
  ...[
    { ext: 'png', mime: 'image/png', label: 'PNG' },
    { ext: 'jpg', mime: 'image/jpeg', label: 'JPEG' },
  ].map((t) => ({
    id: 'pdf2' + t.ext,
    label: t.label,
    group: 'Görsel',
    accepts: ['pdf'],
    options: ['dpi', ...(t.ext === 'jpg' ? ['quality'] : [])],
    note: 'Çok sayfalı PDF için sonuç ZIP olarak verilir.',
    async run(items, opt, progress) {
      const out = [];
      for (const item of items) {
        const data = new Uint8Array(await item.file.arrayBuffer());
        const pages = await pdfr.renderPages(data, {
          dpi: Number(opt.dpi || 150),
          onPage: (n, total) => progress?.(n, total),
        });
        const base = baseName(item.name);
        for (const pg of pages) {
          const blob = await img.canvasToBlob(pg.canvas, t.mime,
            t.ext === 'jpg' ? Number(opt.quality ?? 92) / 100 : undefined);
          const nm = pages.length > 1
            ? `${base}-sayfa-${String(pg.index).padStart(2, '0')}.${t.ext}`
            : `${base}.${t.ext}`;
          out.push({ name: nm, blob });
        }
      }
      if (out.length > 1) return zipResults(out, baseName(items[0].name) + '-sayfalar.zip');
      return out;
    },
  })),

  {
    id: 'pdf2txt',
    label: 'Metin (TXT)',
    group: 'Metin',
    accepts: ['pdf'],
    options: [],
    note: 'Taranmış (görüntü) PDF\'lerde metin çıkmaz — o dosyalar için PNG\'ye çevir.',
    async run(items, opt, progress) {
      const out = [];
      for (const item of items) {
        const pages = await pdfr.extractText(new Uint8Array(await item.file.arrayBuffer()), {
          onPage: (n, t) => progress?.(n, t),
        });
        const text = pages.map((p) => p.paragraphs.join('\n\n')).join('\n\n').trim();
        if (text.length < 8) throw new Error(SCANNED_HINT);
        out.push({ name: baseName(item.name) + '.txt', blob: blobOf(text, 'text/plain;charset=utf-8') });
      }
      return out;
    },
  },

  {
    id: 'pdf2docx',
    label: 'Word (DOCX)',
    group: 'Belge',
    accepts: ['pdf'],
    options: [],
    note: 'Metin akışı aktarılır; sütun/konum düzeni birebir korunmaz.',
    async run(items, opt, progress) {
      const out = [];
      for (const item of items) {
        const paragraphs = await paragraphsOf(item);
        const bytes = await docx.writeDocx(paragraphs, { title: baseName(item.name) });
        out.push({
          name: baseName(item.name) + '.docx',
          blob: blobOf(bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        });
        progress?.(out.length, items.length);
      }
      return out;
    },
  },

  {
    id: 'pdfmerge',
    label: 'PDF birleştir',
    group: 'PDF araçları',
    accepts: ['pdf'],
    minFiles: 2,
    options: [],
    note: 'Sayfalar olduğu gibi kopyalanır; kalite kaybı olmaz.',
    async run(items, opt, progress) {
      const { PDFDocument } = await pdfLib();
      const merged = await PDFDocument.create();
      for (let i = 0; i < items.length; i++) {
        const src = await PDFDocument.load(await items[i].file.arrayBuffer(), { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
        progress?.(i + 1, items.length);
      }
      const bytes = await merged.save();
      return [{ name: 'birlestirilmis.pdf', blob: blobOf(bytes, 'application/pdf') }];
    },
  },

  {
    id: 'pdfsplit',
    label: 'Sayfalara böl',
    group: 'PDF araçları',
    accepts: ['pdf'],
    options: [],
    note: 'Her sayfa ayrı PDF olur, sonuç ZIP olarak iner.',
    async run(items, opt, progress) {
      const { PDFDocument } = await pdfLib();
      const out = [];
      for (const item of items) {
        const src = await PDFDocument.load(await item.file.arrayBuffer(), { ignoreEncryption: true });
        const n = src.getPageCount();
        const base = baseName(item.name);
        for (let i = 0; i < n; i++) {
          const one = await PDFDocument.create();
          const [page] = await one.copyPages(src, [i]);
          one.addPage(page);
          out.push({
            name: `${base}-sayfa-${String(i + 1).padStart(2, '0')}.pdf`,
            blob: blobOf(await one.save(), 'application/pdf'),
          });
          progress?.(i + 1, n);
        }
      }
      if (out.length > 1) return zipResults(out, baseName(items[0].name) + '-sayfalar.zip');
      return out;
    },
  },

  {
    id: 'pdfshrink',
    label: 'PDF küçült',
    group: 'PDF araçları',
    accepts: ['pdf'],
    options: ['dpi', 'quality'],
    note: 'Sayfalar seçilen çözünürlükte görüntüye çevrilip yeniden paketlenir; metin seçilebilirliği kaybolur.',
    async run(items, opt, progress) {
      const out = [];
      for (const item of items) {
        const data = new Uint8Array(await item.file.arrayBuffer());
        const pages = await pdfr.renderPages(data, {
          dpi: Number(opt.dpi || 150),
          onPage: (n, t) => progress?.(n, t * 2),
        });
        const bytes = await d2p.imagesToPdf(
          pages.map((p) => ({ canvas: p.canvas })),
          { pageSize: 'auto', margin: 0, quality: Number(opt.quality ?? 80) / 100, title: baseName(item.name) },
          (n, t) => progress?.(pages.length + n, pages.length + t)
        );
        out.push({ name: baseName(item.name) + '-kucuk.pdf', blob: blobOf(bytes, 'application/pdf') });
      }
      return out;
    },
  },

  /* -------------------------------------------------------------------- DOCX */
  {
    id: 'docx2pdf',
    label: 'PDF',
    group: 'Belge',
    accepts: ['docx', 'odt', 'odp', 'pptx', 'text', 'pdf'],
    options: ['docPageSize', 'docOrientation', 'docMargin', 'pageNumbers'],
    async run(items, opt, progress) {
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const paragraphs = await paragraphsOf(items[i]);
        const bytes = await d2p.paragraphsToPdf(paragraphs, {
          pageSize: opt.docPageSize || 'a4',
          orientation: opt.docOrientation || 'portrait',
          margin: Number(opt.docMargin ?? 56),
          pageNumbers: opt.pageNumbers !== false,
          title: baseName(items[i].name),
        });
        out.push({ name: baseName(items[i].name) + '.pdf', blob: blobOf(bytes, 'application/pdf') });
        progress?.(i + 1, items.length);
      }
      return out;
    },
  },

  {
    id: 'doc2docx',
    label: 'Word (DOCX)',
    group: 'Belge',
    accepts: ['text', 'odt', 'odp', 'pptx', 'pdf'],
    options: [],
    async run(items, opt, progress) {
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const paragraphs = await paragraphsOf(items[i]);
        const bytes = await docx.writeDocx(paragraphs, { title: baseName(items[i].name) });
        out.push({
          name: baseName(items[i].name) + '.docx',
          blob: blobOf(bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        });
        progress?.(i + 1, items.length);
      }
      return out;
    },
  },

  {
    id: 'any2txt',
    label: 'Metin (TXT)',
    group: 'Metin',
    accepts: ['docx', 'odt', 'odp', 'pptx', 'text'],
    options: [],
    async run(items) {
      const out = [];
      for (const item of items) {
        const paragraphs = await paragraphsOf(item);
        out.push({
          name: baseName(item.name) + '.txt',
          blob: blobOf(tc.paragraphsToPlain(paragraphs), 'text/plain;charset=utf-8'),
        });
      }
      return out;
    },
  },

  {
    id: 'any2md',
    label: 'Markdown',
    group: 'Metin',
    accepts: ['docx', 'odt', 'odp', 'pptx', 'text', 'pdf'],
    options: [],
    async run(items) {
      const out = [];
      for (const item of items) {
        const paragraphs = await paragraphsOf(item);
        out.push({
          name: baseName(item.name) + '.md',
          blob: blobOf(docx.paragraphsToMarkdown(paragraphs), 'text/markdown;charset=utf-8'),
        });
      }
      return out;
    },
  },

  {
    id: 'any2html',
    label: 'HTML',
    group: 'Metin',
    accepts: ['docx', 'odt', 'odp', 'pptx', 'text', 'pdf'],
    options: [],
    async run(items) {
      const out = [];
      for (const item of items) {
        const paragraphs = await paragraphsOf(item);
        out.push({
          name: baseName(item.name) + '.html',
          blob: blobOf(docx.paragraphsToHtml(paragraphs, baseName(item.name)), 'text/html;charset=utf-8'),
        });
      }
      return out;
    },
  },

  /* ------------------------------------------------------------- tablo/veri */
  {
    id: 'csv2json',
    label: 'JSON',
    group: 'Veri',
    accepts: ['text'],
    subs: ['csv'],
    options: ['delimiter', 'headers'],
    async run(items, opt) {
      const out = [];
      for (const item of items) {
        const text = await readText(item.file);
        const data = tc.csvToJson(text, {
          delimiter: opt.delimiter === 'auto' ? null : opt.delimiter,
          headers: opt.headers !== false,
        });
        out.push({
          name: baseName(item.name) + '.json',
          blob: blobOf(JSON.stringify(data, null, 2), 'application/json;charset=utf-8'),
        });
      }
      return out;
    },
  },

  {
    id: 'json2csv',
    label: 'CSV',
    group: 'Veri',
    accepts: ['text'],
    subs: ['json'],
    options: ['delimiter'],
    async run(items, opt) {
      const out = [];
      for (const item of items) {
        const text = await readText(item.file);
        const csv = tc.jsonToCsv(JSON.parse(text), opt.delimiter === 'auto' ? ',' : opt.delimiter);
        out.push({ name: baseName(item.name) + '.csv', blob: blobOf('﻿' + csv, 'text/csv;charset=utf-8') });
      }
      return out;
    },
  },

  {
    id: 'tab2xlsx',
    label: 'Excel (XLSX)',
    group: 'Veri',
    accepts: ['text'],
    subs: ['csv', 'json'],
    options: ['delimiter'],
    async run(items, opt) {
      const out = [];
      for (const item of items) {
        const text = await readText(item.file);
        let rows;
        if (item.sub === 'json') {
          const csv = tc.jsonToCsv(JSON.parse(text), ',');
          rows = tc.parseCsv(csv, ',');
        } else {
          rows = tc.parseCsv(text, opt.delimiter === 'auto' ? null : opt.delimiter);
        }
        const bytes = await xl.writeXlsx([{ name: baseName(item.name).slice(0, 31), rows }],
          { title: baseName(item.name) });
        out.push({
          name: baseName(item.name) + '.xlsx',
          blob: blobOf(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        });
      }
      return out;
    },
  },

  {
    id: 'xlsx2csv',
    label: 'CSV',
    group: 'Veri',
    accepts: ['xlsx', 'ods'],
    options: ['delimiter'],
    note: 'Her sayfa ayrı CSV olur.',
    async run(items, opt) {
      const out = [];
      for (const item of items) {
        const sheets = await sheetsOf(item);
        for (const s of sheets) {
          const csv = tc.toCsv(s.rows, opt.delimiter === 'auto' ? ',' : opt.delimiter);
          const nm = sheets.length > 1
            ? `${baseName(item.name)}-${s.name}.csv`
            : `${baseName(item.name)}.csv`;
          out.push({ name: nm.replace(/[\\/:*?"<>|]/g, '-'), blob: blobOf('﻿' + csv, 'text/csv;charset=utf-8') });
        }
      }
      if (out.length > 1) return zipResults(out, baseName(items[0].name) + '-sayfalar.zip');
      return out;
    },
  },

  {
    id: 'xlsx2json',
    label: 'JSON',
    group: 'Veri',
    accepts: ['xlsx', 'ods'],
    options: ['headers'],
    async run(items, opt) {
      const out = [];
      for (const item of items) {
        const sheets = await sheetsOf(item);
        const data = {};
        for (const s of sheets) {
          data[s.name] = opt.headers !== false
            ? tc.csvToJson(tc.toCsv(s.rows, ','), { delimiter: ',', headers: true })
            : s.rows;
        }
        const payload = sheets.length === 1 ? data[sheets[0].name] : data;
        out.push({
          name: baseName(item.name) + '.json',
          blob: blobOf(JSON.stringify(payload, null, 2), 'application/json;charset=utf-8'),
        });
      }
      return out;
    },
  },

  {
    id: 'xlsx2pdf',
    label: 'PDF',
    group: 'Belge',
    accepts: ['xlsx', 'ods'],
    options: ['docPageSize', 'docOrientation', 'docMargin', 'pageNumbers'],
    async run(items, opt) {
      const out = [];
      for (const item of items) {
        const sheets = await sheetsOf(item);
        const paragraphs = [];
        for (const s of sheets) {
          if (sheets.length > 1) paragraphs.push({ text: s.name, style: 'h2' });
          for (const row of s.rows) paragraphs.push({ text: row.join('\t'), style: 'table' });
        }
        const bytes = await d2p.paragraphsToPdf(paragraphs, {
          pageSize: opt.docPageSize || 'a4',
          orientation: opt.docOrientation || 'landscape',
          margin: Number(opt.docMargin ?? 40),
          pageNumbers: opt.pageNumbers !== false,
          title: baseName(item.name),
        });
        out.push({ name: baseName(item.name) + '.pdf', blob: blobOf(bytes, 'application/pdf') });
      }
      return out;
    },
  },

  /* ------------------------------------------------------------------- ZIP */
  {
    id: 'zipall',
    label: 'ZIP arşivi',
    group: 'Paketle',
    accepts: ['image', 'pdf', 'docx', 'text', 'xlsx', 'zip', 'doc', 'xls', 'ppt',
      'pptx', 'odt', 'ods', 'odp', 'unknown'],
    minFiles: 1,
    options: [],
    async run(items, opt, progress) {
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        entries.push({
          name: items[i].name,
          data: new Uint8Array(await items[i].file.arrayBuffer()),
          store: /\.(jpg|jpeg|png|webp|pdf|docx|xlsx|zip|mp4|mp3)$/i.test(items[i].name),
        });
        progress?.(i + 1, items.length);
      }
      const bytes = await createZip(entries);
      return [{ name: 'dosyalar.zip', blob: blobOf(bytes, 'application/zip') }];
    },
  },
];

export const CONVERTER_BY_ID = Object.fromEntries(CONVERTERS.map((c) => [c.id, c]));

/** Kuyruktaki dosyalara uygulanabilecek dönüşümler. */
export function targetsFor(items) {
  if (!items.length) return [];
  const kinds = [...new Set(items.map((i) => i.kind))];
  const subs = [...new Set(items.map((i) => i.sub))];
  return CONVERTERS.filter((c) => {
    if (kinds.some((k) => !c.accepts.includes(k))) return false;
    if (c.subs && subs.some((s) => !c.subs.includes(s))) return false;
    if (c.minFiles && items.length < c.minFiles) return false;
    return true;
  });
}

/** Desteklenmeyen türler için açıklama. */
export const UNSUPPORTED_NOTE = {
  doc: 'Eski .doc biçimi tarayıcıda açılamıyor. Word\'de "Farklı kaydet → .docx" deyip tekrar dene.',
  xls: 'Eski .xls biçimi tarayıcıda açılamıyor. Excel\'de "Farklı kaydet → .xlsx" deyip tekrar dene.',
  ppt: 'Eski .ppt biçimi tarayıcıda açılamıyor. PowerPoint\'te "Farklı kaydet → .pptx" deyip tekrar dene.',
  unknown: 'Bu dosyanın türü tanınmadı; yalnızca ZIP olarak paketlenebilir.',
};
