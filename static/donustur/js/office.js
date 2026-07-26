// LibreOffice/OpenDocument (.odt .ods .odp) ve PowerPoint (.pptx) okuma.
// Hepsi ZIP + XML olduğu için zip.js yeterli; ek kütüphane yok.
// Çıktı, projedeki ortak paragraf yapısıdır: { text, style, bold, list, level }

import { readZip } from './zip.js';

const NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const NS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const NS_DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function parseXml(bytes, what) {
  if (!bytes) throw new Error(`Beklenen parça bulunamadı: ${what}`);
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${what} okunamadı (bozuk XML).`);
  return doc;
}

/** Bir OpenDocument metin düğümünün düz karşılığı (sekme/boşluk düğümleri dahil). */
function odfText(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) { out += child.nodeValue; continue; }
    if (child.nodeType !== 1) continue;
    const ln = child.localName;
    if (ln === 's') {
      const n = Number(child.getAttributeNS(NS_TEXT, 'c') || 1);
      out += ' '.repeat(Math.min(40, n));
    } else if (ln === 'tab') out += '\t';
    else if (ln === 'line-break') out += '\n';
    else out += odfText(child);
  }
  return out;
}

/* ------------------------------------------------------------------- ODT */

const NS_STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';

/**
 * Stil adı → başlık seviyesi. ODT'de başlıklar her zaman `text:h` olmaz:
 * LibreOffice çoğu zaman `Heading_20_1`'den türeyen otomatik bir stille
 * (P1, P2 …) sıradan `text:p` yazar. Bu yüzden stil kalıtımı çözülmeli.
 */
function buildHeadingMap(docs) {
  const parent = new Map();
  for (const doc of docs) {
    if (!doc) continue;
    for (const st of doc.getElementsByTagNameNS(NS_STYLE, 'style')) {
      const name = st.getAttributeNS(NS_STYLE, 'name');
      const par = st.getAttributeNS(NS_STYLE, 'parent-style-name');
      if (name) parent.set(name, par || null);
    }
  }
  const levelOf = (name) => {
    let cur = name;
    for (let i = 0; cur && i < 12; i++) {
      const m = /^Heading[_ ]?(?:20[_ ])?(\d)/.exec(cur) || /^Baslik[_ ]?(?:20[_ ])?(\d)/i.exec(cur);
      if (m) return Math.min(4, Number(m[1]));
      if (/^(Title|Baslik|Başlık)$/i.test(cur)) return 1;
      if (/^Subtitle$/i.test(cur)) return 2;
      cur = parent.get(cur);
    }
    return 0;
  };
  const cache = new Map();
  return (name) => {
    if (!name) return 0;
    if (!cache.has(name)) cache.set(name, levelOf(name));
    return cache.get(name);
  };
}

/** LibreOffice Writer (.odt) → paragraf listesi */
export async function readOdt(buffer) {
  const files = await readZip(buffer);
  const doc = parseXml(files['content.xml'], 'content.xml');
  let styles = null;
  try { styles = files['styles.xml'] ? parseXml(files['styles.xml'], 'styles.xml') : null; } catch { /* isteğe bağlı */ }
  const headingLevel = buildHeadingMap([doc, styles]);
  const out = [];

  // Liste öğelerini, kapsayan text:list derinliğiyle birlikte topla
  const listDepth = new Map();
  for (const list of doc.getElementsByTagNameNS(NS_TEXT, 'list')) {
    let depth = 0;
    for (let n = list.parentNode; n; n = n.parentNode) {
      if (n.localName === 'list' && n.namespaceURI === NS_TEXT) depth++;
    }
    for (const p of list.getElementsByTagNameNS(NS_TEXT, 'p')) listDepth.set(p, depth);
  }

  const body = doc.getElementsByTagNameNS(NS_TEXT, 'p');
  const heads = doc.getElementsByTagNameNS(NS_TEXT, 'h');
  const nodes = [...body, ...heads].sort((a, b) =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);

  for (const node of nodes) {
    const text = odfText(node).replace(/ /g, ' ').trimEnd();
    const inList = listDepth.has(node);
    // Başlık ya doğrudan text:h'dir ya da stili Heading_20_N'den türer
    let lvl = 0;
    if (node.localName === 'h') {
      lvl = Math.min(4, Number(node.getAttributeNS(NS_TEXT, 'outline-level') || 1) || 1);
    } else if (!inList) {
      lvl = headingLevel(node.getAttributeNS(NS_TEXT, 'style-name'));
    }
    if (!text.trim() && !lvl) { out.push({ text: '', style: 'p' }); continue; }
    out.push({
      text,
      style: lvl ? 'h' + lvl : 'p',
      list: inList ? 'ul' : null,
      level: listDepth.get(node) || 0,
    });
  }

  // Tablolar
  for (const tbl of doc.getElementsByTagNameNS(NS_TABLE, 'table')) {
    for (const row of tbl.getElementsByTagNameNS(NS_TABLE, 'table-row')) {
      const cells = [...row.getElementsByTagNameNS(NS_TABLE, 'table-cell')]
        .map((c) => odfText(c).replace(/\s+/g, ' ').trim());
      if (cells.some(Boolean)) out.push({ text: cells.join('\t'), style: 'table' });
    }
  }

  return out;
}

/* ------------------------------------------------------------------- ODS */

/** LibreOffice Calc (.ods) → [{ name, rows }] */
export async function readOds(buffer) {
  const files = await readZip(buffer);
  const doc = parseXml(files['content.xml'], 'content.xml');
  const sheets = [];

  for (const table of doc.getElementsByTagNameNS(NS_TABLE, 'table')) {
    const name = table.getAttributeNS(NS_TABLE, 'name') || 'Sayfa';
    const rows = [];
    for (const row of table.getElementsByTagNameNS(NS_TABLE, 'table-row')) {
      const repeatRow = Number(row.getAttributeNS(NS_TABLE, 'number-rows-repeated') || 1);
      const cells = [];
      for (const cell of row.getElementsByTagNameNS(NS_TABLE, 'table-cell')) {
        const repeat = Math.min(1000, Number(cell.getAttributeNS(NS_TABLE, 'number-columns-repeated') || 1));
        // Sayısal hücrelerde biçimlenmiş metin yerine ham değeri al
        const valueType = cell.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'value-type');
        const raw = cell.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'value');
        const text = valueType === 'float' && raw !== null ? raw : odfText(cell).trim();
        for (let i = 0; i < repeat; i++) cells.push(text);
      }
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      // Tekrar eden boş satırlar dosya sonunu doldurur; yalnız doluları al
      for (let i = 0; i < Math.min(repeatRow, cells.length ? repeatRow : 1); i++) {
        if (!cells.length && rows.length === 0) continue;
        rows.push([...cells]);
        if (!cells.length) break;
      }
    }
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    const width = Math.max(0, ...rows.map((r) => r.length));
    sheets.push({ name, rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')) });
  }
  return sheets.filter((s) => s.rows.length);
}

/* ------------------------------------------------------------------- ODP */

/** LibreOffice Impress (.odp) → paragraf listesi (her slayt bir başlık altında) */
export async function readOdp(buffer) {
  const files = await readZip(buffer);
  const doc = parseXml(files['content.xml'], 'content.xml');
  const out = [];
  const pages = doc.getElementsByTagNameNS(NS_DRAW, 'page');

  [...pages].forEach((page, i) => {
    out.push({ text: `Slayt ${i + 1}`, style: 'h2' });
    for (const frame of page.getElementsByTagNameNS(NS_DRAW, 'frame')) {
      for (const p of frame.getElementsByTagNameNS(NS_TEXT, 'p')) {
        const t = odfText(p).replace(/\s+/g, ' ').trim();
        if (t) out.push({ text: t, style: 'p' });
      }
    }
    out.push({ text: '', style: 'p' });
  });
  return out;
}

/* ------------------------------------------------------------------ PPTX */

/** PowerPoint (.pptx) → paragraf listesi (her slayt bir başlık altında) */
export async function readPptx(buffer) {
  const files = await readZip(buffer);
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(/slide(\d+)/.exec(a)[1]);
      const nb = Number(/slide(\d+)/.exec(b)[1]);
      return na - nb;
    });
  if (!slides.length) throw new Error('Bu bir PPTX değil (slayt bulunamadı).');

  const out = [];
  slides.forEach((name, i) => {
    const doc = parseXml(files[name], name);
    out.push({ text: `Slayt ${i + 1}`, style: 'h2' });
    // Her a:p bir paragraf, içindeki a:t parçaları birleşir
    for (const p of doc.getElementsByTagNameNS(NS_A, 'p')) {
      const t = [...p.getElementsByTagNameNS(NS_A, 't')].map((n) => n.textContent).join('').trim();
      if (t) out.push({ text: t, style: 'p' });
    }
    // Konuşmacı notları
    const notesName = name.replace('slides/slide', 'notesSlides/notesSlide');
    if (files[notesName]) {
      const nd = parseXml(files[notesName], notesName);
      const notes = [...nd.getElementsByTagNameNS(NS_A, 't')].map((n) => n.textContent).join(' ').trim();
      if (notes && !/^\d+$/.test(notes)) out.push({ text: 'Not: ' + notes, style: 'p', italic: true });
    }
    out.push({ text: '', style: 'p' });
  });
  return out;
}

/* -------------------------------------------------------------------- RTF */

/** Basit RTF metin çıkarma: kontrol sözcükleri atılır, kaçışlar çözülür. */
export function readRtf(text) {
  let s = String(text);
  s = s.replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\u(-?\d+)\s?\??/g, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)));
  // Gömülü tablolar/başlık grupları: içeriğiyle birlikte at
  s = s.replace(/\{\\\*[^{}]*(\{[^{}]*\})*[^{}]*\}/g, '');
  s = s.replace(/\\par[d]?\b/g, '\n');
  s = s.replace(/\\tab\b/g, '\t');
  s = s.replace(/\\line\b/g, '\n');
  s = s.replace(/\\[a-z]+-?\d*\s?/gi, '');
  s = s.replace(/[{}]/g, '');
  return s.replace(/\n{3,}/g, '\n\n').trim()
    .split(/\n{2,}/)
    .map((block) => ({ text: block.replace(/\n/g, ' ').trim(), style: 'p' }))
    .filter((p) => p.text);
}
