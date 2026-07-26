// DOCX (Office Open XML) okuma ve yazma. DOCX bir ZIP olduğu için zip.js yeter;
// eski ikili .doc biçimi tarayıcıda açılamaz — kullanıcıya bu açıkça söylenir.

import { readZip, createZip } from './zip.js';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/* --------------------------------------------------------------------- okuma */

/** DOCX → [{ text, style, bold, italic, list, level }] */
export async function readDocx(buffer) {
  const files = await readZip(buffer);
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('Bu bir DOCX değil (word/document.xml bulunamadı).');
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('DOCX içeriği okunamadı.');

  const numbering = await readNumbering(files);
  const out = [];
  const paragraphs = doc.getElementsByTagNameNS(NS_W, 'p');

  for (const p of paragraphs) {
    const pPr = p.getElementsByTagNameNS(NS_W, 'pPr')[0];
    const styleEl = pPr?.getElementsByTagNameNS(NS_W, 'pStyle')[0];
    const styleId = styleEl?.getAttributeNS(NS_W, 'val') || '';
    const numPr = pPr?.getElementsByTagNameNS(NS_W, 'numPr')[0];
    const ilvl = numPr?.getElementsByTagNameNS(NS_W, 'ilvl')[0]?.getAttributeNS(NS_W, 'val');
    const numId = numPr?.getElementsByTagNameNS(NS_W, 'numId')[0]?.getAttributeNS(NS_W, 'val');
    const jc = pPr?.getElementsByTagNameNS(NS_W, 'jc')[0]?.getAttributeNS(NS_W, 'val') || '';

    let text = '';
    let bold = false;
    let italic = false;
    for (const r of p.getElementsByTagNameNS(NS_W, 'r')) {
      const rPr = r.getElementsByTagNameNS(NS_W, 'rPr')[0];
      if (rPr?.getElementsByTagNameNS(NS_W, 'b').length) bold = true;
      if (rPr?.getElementsByTagNameNS(NS_W, 'i').length) italic = true;
      for (const node of r.childNodes) {
        if (node.localName === 't') text += node.textContent;
        else if (node.localName === 'tab') text += '\t';
        else if (node.localName === 'br') text += '\n';
      }
    }

    const heading = /^Heading(\d)/i.exec(styleId) || /^Baslik(\d)/i.exec(styleId);
    out.push({
      text,
      style: heading ? 'h' + heading[1] : (styleId === 'Title' ? 'h1' : 'p'),
      bold,
      italic,
      align: jc,
      list: numId ? (numbering[numId] === 'decimal' ? 'ol' : 'ul') : null,
      level: ilvl ? Number(ilvl) : 0,
    });
  }

  // Tablolar: satırları sekmeyle ayrılmış paragraf olarak ekle
  for (const tbl of doc.getElementsByTagNameNS(NS_W, 'tbl')) {
    for (const tr of tbl.getElementsByTagNameNS(NS_W, 'tr')) {
      const cells = [...tr.getElementsByTagNameNS(NS_W, 'tc')].map((tc) =>
        [...tc.getElementsByTagNameNS(NS_W, 't')].map((t) => t.textContent).join('').trim()
      );
      if (cells.some(Boolean)) out.push({ text: cells.join('\t'), style: 'table', bold: false, italic: false, level: 0, list: null });
    }
  }

  return out;
}

async function readNumbering(files) {
  const map = {};
  const xml = files['word/numbering.xml'];
  if (!xml) return map;
  try {
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
    const abstractFmt = {};
    for (const a of doc.getElementsByTagNameNS(NS_W, 'abstractNum')) {
      const id = a.getAttributeNS(NS_W, 'abstractNumId');
      const fmt = a.getElementsByTagNameNS(NS_W, 'numFmt')[0]?.getAttributeNS(NS_W, 'val');
      abstractFmt[id] = fmt === 'bullet' ? 'bullet' : 'decimal';
    }
    for (const n of doc.getElementsByTagNameNS(NS_W, 'num')) {
      const id = n.getAttributeNS(NS_W, 'numId');
      const aid = n.getElementsByTagNameNS(NS_W, 'abstractNumId')[0]?.getAttributeNS(NS_W, 'val');
      map[id] = abstractFmt[aid] || 'bullet';
    }
  } catch { /* numaralandırma isteğe bağlı */ }
  return map;
}

/* --------------------------------------------------------------------- yazma */

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0'da yasak olan denetim karakterleri (sekme/satır sonu hariç) atılır
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

const HEADING_SIZE = { h1: 32, h2: 26, h3: 22, h4: 20 };

function paragraphXml(p) {
  const style = p.style || 'p';
  const isHeading = /^h[1-6]$/.test(style);
  const sz = HEADING_SIZE[style];
  const runs = String(p.text ?? '')
    .split('\n')
    .map((line, i) =>
      (i ? '<w:r><w:br/></w:r>' : '') +
      `<w:r><w:rPr>${p.bold || isHeading ? '<w:b/>' : ''}${p.italic ? '<w:i/>' : ''}` +
      (sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : '') +
      (style === 'code' ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '') +
      `</w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`
    ).join('');

  const pPr =
    '<w:pPr>' +
    (isHeading ? `<w:pStyle w:val="Heading${style[1]}"/>` : '') +
    (p.list ? `<w:numPr><w:ilvl w:val="${p.level || 0}"/><w:numId w:val="${p.list === 'ol' ? 2 : 1}"/></w:numPr>` : '') +
    (p.align ? `<w:jc w:val="${p.align}"/>` : '') +
    '<w:spacing w:after="120"/>' +
    '</w:pPr>';

  return `<w:p>${pPr}${runs}</w:p>`;
}

/** [{text, style, bold, italic, list, level}] → .docx baytları */
export async function writeDocx(paragraphs, { title = 'Belge' } = {}) {
  const body = paragraphs.map(paragraphXml).join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS_W}"><w:body>${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

  const headingStyles = [1, 2, 3, 4].map((n) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/>` +
    `<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${n - 1}"/>` +
    `<w:spacing w:before="${260 - n * 40}" w:after="120"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${HEADING_SIZE['h' + n] || 20}"/></w:rPr></w:style>`
  ).join('');

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS_W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${headingStyles}
</w:styles>`;

  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${NS_W}">
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title><dc:creator>Dosya Dönüştürücü</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`;

  return createZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/numbering.xml', data: numbering },
    { name: 'docProps/core.xml', data: core },
  ]);
}

/* ---------------------------------------------------------------- dönüşümler */

export function paragraphsToText(paragraphs) {
  return paragraphs.map((p) => {
    const prefix = p.list === 'ul' ? '• ' : p.list === 'ol' ? '- ' : '';
    const indent = '  '.repeat(p.level || 0);
    return indent + prefix + p.text;
  }).join('\n');
}

export function paragraphsToMarkdown(paragraphs) {
  const out = [];
  for (const p of paragraphs) {
    const t = p.text.trim();
    if (!t) { out.push(''); continue; }
    const m = /^h([1-6])$/.exec(p.style || '');
    if (m) out.push('#'.repeat(Number(m[1])) + ' ' + t);
    else if (p.list === 'ul') out.push('  '.repeat(p.level || 0) + '- ' + t);
    else if (p.list === 'ol') out.push('  '.repeat(p.level || 0) + '1. ' + t);
    else if (p.style === 'table') out.push('| ' + t.split('\t').join(' | ') + ' |');
    else if (p.bold) out.push('**' + t + '**');
    else out.push(t);
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n');
}

export function paragraphsToHtml(paragraphs, title = 'Belge') {
  const body = [];
  let listOpen = null;
  const close = () => { if (listOpen) { body.push(`</${listOpen}>`); listOpen = null; } };

  for (const p of paragraphs) {
    const t = esc(p.text).replace(/\t/g, '</td><td>');
    if (p.list) {
      const tag = p.list;
      if (listOpen !== tag) { close(); body.push(`<${tag}>`); listOpen = tag; }
      body.push(`<li>${esc(p.text)}</li>`);
      continue;
    }
    close();
    if (!p.text.trim()) continue;
    if (/^h[1-6]$/.test(p.style || '')) body.push(`<${p.style}>${esc(p.text)}</${p.style}>`);
    else if (p.style === 'table') body.push(`<table><tr><td>${t}</td></tr></table>`);
    else body.push(`<p>${p.bold ? '<strong>' : ''}${esc(p.text)}${p.bold ? '</strong>' : ''}</p>`);
  }
  close();

  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{max-width:44rem;margin:2.5rem auto;padding:0 1.2rem;font:16px/1.65 -apple-system,"Segoe UI",Roboto,sans-serif;color:#1a1d23}
h1,h2,h3,h4{line-height:1.25;margin:1.6em 0 .5em}table{border-collapse:collapse;margin:1em 0}
td{border:1px solid #d0d5dd;padding:.4em .7em}</style></head>
<body>
${body.join('\n')}
</body></html>`;
}
