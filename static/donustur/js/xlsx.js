// XLSX okuma/yazma (temel seviye): hücre değerleri, paylaşılan dizgiler, çok sayfa.
// Formüller değer olarak okunur; biçimlendirme korunmaz.

import { readZip, createZip } from './zip.js';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function colToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return 0;
  let n = 0;
  for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function indexToCol(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* --------------------------------------------------------------------- okuma */

/** XLSX → [{ name, rows: string[][] }] */
export async function readXlsx(buffer) {
  const files = await readZip(buffer);
  const dec = new TextDecoder();
  const parse = (name) => {
    const b = files[name];
    if (!b) return null;
    const d = new DOMParser().parseFromString(dec.decode(b), 'application/xml');
    return d.querySelector('parsererror') ? null : d;
  };

  // Paylaşılan dizgiler
  const shared = [];
  const ss = parse('xl/sharedStrings.xml');
  if (ss) {
    for (const si of ss.getElementsByTagNameNS(NS_MAIN, 'si')) {
      let text = '';
      for (const t of si.getElementsByTagNameNS(NS_MAIN, 't')) text += t.textContent;
      shared.push(text);
    }
  }

  // Sayfa adları ve dosya yolları
  const wb = parse('xl/workbook.xml');
  const rels = parse('xl/_rels/workbook.xml.rels');
  const relMap = {};
  if (rels) {
    for (const r of rels.getElementsByTagName('Relationship')) {
      relMap[r.getAttribute('Id')] = r.getAttribute('Target').replace(/^\/?xl\//, '');
    }
  }
  const sheets = [];
  if (wb) {
    for (const s of wb.getElementsByTagNameNS(NS_MAIN, 'sheet')) {
      const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ||
        s.getAttribute('r:id');
      sheets.push({ name: s.getAttribute('name') || 'Sayfa', path: 'xl/' + (relMap[rid] || 'worksheets/sheet1.xml') });
    }
  }
  if (!sheets.length) sheets.push({ name: 'Sayfa1', path: 'xl/worksheets/sheet1.xml' });

  const out = [];
  for (const sheet of sheets) {
    const doc = parse(sheet.path);
    if (!doc) continue;
    const rows = [];
    for (const row of doc.getElementsByTagNameNS(NS_MAIN, 'row')) {
      const cells = [];
      for (const c of row.getElementsByTagNameNS(NS_MAIN, 'c')) {
        const idx = colToIndex(c.getAttribute('r'));
        const type = c.getAttribute('t');
        let value = '';
        if (type === 's') {
          const v = c.getElementsByTagNameNS(NS_MAIN, 'v')[0];
          value = v ? (shared[Number(v.textContent)] ?? '') : '';
        } else if (type === 'inlineStr') {
          value = [...c.getElementsByTagNameNS(NS_MAIN, 't')].map((t) => t.textContent).join('');
        } else {
          const v = c.getElementsByTagNameNS(NS_MAIN, 'v')[0];
          value = v ? v.textContent : '';
        }
        while (cells.length < idx) cells.push('');
        cells[idx] = value;
      }
      rows.push(cells);
    }
    // Sondaki boş sütunları kırp
    const width = Math.max(0, ...rows.map((r) => {
      let last = -1;
      r.forEach((v, i) => { if (String(v).trim() !== '') last = i; });
      return last + 1;
    }));
    out.push({ name: sheet.name, rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')) });
  }
  return out;
}

/* --------------------------------------------------------------------- yazma */

function esc(s) {
  return String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const isNumeric = (v) => typeof v === 'number' ||
  (typeof v === 'string' && v.trim() !== '' && /^-?\d+([.]\d+)?([eE][-+]?\d+)?$/.test(v.trim()));

/** [{ name, rows }] → .xlsx baytları */
export async function writeXlsx(sheets, { title = 'Tablo' } = {}) {
  const list = Array.isArray(sheets) && sheets[0]?.rows ? sheets : [{ name: 'Sayfa1', rows: sheets }];

  const sheetXml = list.map(({ rows }) => {
    const body = rows.map((cells, ri) => {
      const cs = cells.map((v, ci) => {
        const ref = indexToCol(ci) + (ri + 1);
        if (v === null || v === undefined || v === '') return '';
        if (isNumeric(v)) return `<c r="${ref}"><v>${Number(String(v).trim())}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cs}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS_MAIN}"><sheetData>${body}</sheetData></worksheet>`;
  });

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS_MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${list.map((s, i) =>
    `<sheet name="${esc(s.name || 'Sayfa' + (i + 1)).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  ).join('')}</sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${list.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('')}</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${list.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title>
<dc:creator>Dosya Dönüştürücü</dc:creator></cp:coreProperties>`;

  return createZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x })),
    { name: 'docProps/core.xml', data: core },
  ]);
}
