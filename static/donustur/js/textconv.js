// Metin tabanlı biçimler: CSV, JSON, Markdown, HTML, düz metin.
// Hepsi paragraf listesine ({text, style, list, level}) indirgenir; PDF ve DOCX
// üreticileri o listeyi kullanır, böylece her kaynak aynı yerleşimden geçer.

/* ----------------------------------------------------------------------- CSV */

/** Ayırıcıyı ilk satırdan tahmin eder. */
export function sniffDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = [',', ';', '\t', '|'].map((d) => ({
    d,
    n: (line.match(new RegExp(d === '\t' ? '\t' : '\\' + d, 'g')) || []).length,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

/** RFC 4180 uyumlu CSV ayrıştırma (tırnaklı alanlar, gömülü satır sonları). */
export function parseCsv(text, delimiter = null) {
  const d = delimiter || sniffDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const s = text.replace(/^﻿/, '');

  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === d) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '');
}

export function toCsv(rows, delimiter = ',') {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /["\n\r]|[,;\t|]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(esc).join(delimiter)).join('\r\n');
}

/** CSV → JSON dizisi (ilk satır başlık kabul edilir). */
export function csvToJson(text, { delimiter = null, headers = true } = {}) {
  const rows = parseCsv(text, delimiter);
  if (!rows.length) return [];
  if (!headers) return rows;
  const head = rows[0].map((h, i) => (h || `sutun${i + 1}`).trim());
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = coerce(r[i] ?? ''); });
    return o;
  });
}

function coerce(v) {
  const s = String(v).trim();
  if (s === '') return '';
  if (/^-?\d+$/.test(s) && Math.abs(Number(s)) <= Number.MAX_SAFE_INTEGER) return Number(s);
  if (/^-?\d*[.,]\d+$/.test(s)) {
    const n = Number(s.replace(',', '.'));
    if (!Number.isNaN(n)) return n;
  }
  if (s === 'true' || s === 'false') return s === 'true';
  return s;
}

/** JSON → CSV. Nesne dizisi bekler; iç içe değerler JSON metnine çevrilir. */
export function jsonToCsv(data, delimiter = ',') {
  let arr = data;
  if (!Array.isArray(arr)) {
    const firstArray = Object.values(data || {}).find((v) => Array.isArray(v));
    arr = firstArray || [data];
  }
  if (!arr.length) return '';
  if (typeof arr[0] !== 'object' || arr[0] === null) {
    return toCsv([['deger'], ...arr.map((v) => [v])], delimiter);
  }
  const keys = [];
  for (const row of arr) for (const k of Object.keys(row || {})) if (!keys.includes(k)) keys.push(k);
  const rows = [keys];
  for (const row of arr) {
    rows.push(keys.map((k) => {
      const v = row?.[k];
      if (v === null || v === undefined) return '';
      return typeof v === 'object' ? JSON.stringify(v) : v;
    }));
  }
  return toCsv(rows, delimiter);
}

/* ------------------------------------------------------------------ Markdown */

/** Markdown → paragraf listesi (başlık, liste, kod, alıntı, tablo satırı). */
export function markdownToParagraphs(md) {
  const out = [];
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  let inCode = false;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) { out.push({ text: raw, style: 'code' }); continue; }
    if (!line.trim()) { continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push({ text: stripInline(h[2]), style: 'h' + Math.min(4, h[1].length) }); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push({ text: '─'.repeat(24), style: 'p' }); continue; }

    const ul = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (ul) { out.push({ text: stripInline(ul[2]), style: 'p', list: 'ul', level: Math.floor(ul[1].length / 2) }); continue; }
    const ol = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (ol) { out.push({ text: stripInline(ol[2]), style: 'p', list: 'ol', level: Math.floor(ol[1].length / 2) }); continue; }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) { out.push({ text: '“' + stripInline(quote[1]) + '”', style: 'p', italic: true }); continue; }

    if (/^\|.*\|$/.test(line)) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;   // hizalama satırı
      const cells = line.slice(1, -1).split('|').map((c) => stripInline(c.trim()));
      out.push({ text: cells.join('\t'), style: 'table' });
      continue;
    }

    // Ardışık düz satırlar tek paragrafta birleşir
    const prev = out[out.length - 1];
    if (prev && prev.style === 'p' && !prev.list && !/^\s/.test(raw) && prev._flow) {
      prev.text += ' ' + stripInline(line);
    } else {
      out.push({ text: stripInline(line), style: 'p', _flow: true });
    }
  }
  return out.map(({ _flow, ...p }) => p);
}

function stripInline(s) {
  return String(s)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~(.*?)~~/g, '$1');
}

/* ---------------------------------------------------------------------- HTML */

/** HTML → paragraf listesi. Tarayıcının kendi ayrıştırıcısı kullanılır. */
export function htmlToParagraphs(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, svg').forEach((el) => el.remove());
  const out = [];

  const walk = (node, level = 0, list = null) => {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        out.push({ text: text(el), style: 'h' + Math.min(4, Number(tag[1])) });
      } else if (tag === 'p' || tag === 'blockquote') {
        const t = text(el);
        if (t) out.push({ text: t, style: 'p', italic: tag === 'blockquote' });
      } else if (tag === 'ul' || tag === 'ol') {
        for (const li of el.children) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          out.push({ text: text(li), style: 'p', list: tag, level });
          walk(li, level + 1, tag);
        }
      } else if (tag === 'pre') {
        for (const line of text(el).split('\n')) out.push({ text: line, style: 'code' });
      } else if (tag === 'table') {
        for (const tr of el.querySelectorAll('tr')) {
          const cells = [...tr.children].map((td) => text(td));
          if (cells.some(Boolean)) out.push({ text: cells.join('\t'), style: 'table' });
        }
      } else if (tag === 'br' || tag === 'hr') {
        out.push({ text: '', style: 'p' });
      } else if (el.children.length) {
        walk(el, level, list);
      } else {
        const t = text(el);
        if (t) out.push({ text: t, style: 'p' });
      }
    }
  };

  const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  walk(doc.body);
  if (!out.length) {
    const t = (doc.body.textContent || '').trim();
    if (t) for (const line of t.split(/\n{2,}/)) out.push({ text: line.trim(), style: 'p' });
  }
  return out;
}

export function htmlTitle(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.title || '').trim();
}

/* --------------------------------------------------------------------- düz */

export function textToParagraphs(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => ({ text: block.replace(/\n/g, ' ').trim(), style: 'p' }))
    .filter((p) => p.text);
}

/** Satır yapısını koruyan sürüm — kod/log dosyaları için. */
export function textToLines(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => ({ text: l, style: 'code' }));
}

export function paragraphsToPlain(paragraphs) {
  return paragraphs.map((p) => {
    const prefix = p.list === 'ul' ? '• ' : p.list === 'ol' ? '- ' : '';
    return '  '.repeat(p.level || 0) + prefix + p.text;
  }).join('\n');
}

/** Tablo satırlarını (style:'table') hizalı metne çevirir. */
export function tableParagraphsToRows(paragraphs) {
  return paragraphs.filter((p) => p.style === 'table').map((p) => p.text.split('\t'));
}
