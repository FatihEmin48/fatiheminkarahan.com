// TrueType/OpenType ayrıştırma — PDF'e gömme için gereken kadarı:
// cmap (unicode → glif), hmtx (genişlikler), head/hhea/OS2/post (tanımlayıcı değerler).

export function parseFont(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const tag = dv.getUint32(0);
  if (tag !== 0x00010000 && tag !== 0x74727565 && tag !== 0x4f54544f) {
    throw new Error('Desteklenmeyen yazı tipi biçimi.');
  }
  const numTables = dv.getUint16(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const name = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    tables[name] = { offset: dv.getUint32(o + 8), length: dv.getUint32(o + 12) };
  }
  const need = (n) => {
    if (!tables[n]) throw new Error(`Yazı tipinde ${n} tablosu yok.`);
    return tables[n].offset;
  };

  // head
  const head = need('head');
  const unitsPerEm = dv.getUint16(head + 18) || 1000;
  const xMin = dv.getInt16(head + 36);
  const yMin = dv.getInt16(head + 38);
  const xMax = dv.getInt16(head + 40);
  const yMax = dv.getInt16(head + 42);
  const macStyle = dv.getUint16(head + 44);

  // hhea
  const hhea = need('hhea');
  const ascender = dv.getInt16(hhea + 4);
  const descender = dv.getInt16(hhea + 6);
  const numberOfHMetrics = dv.getUint16(hhea + 34);

  // maxp
  const maxp = need('maxp');
  const numGlyphs = dv.getUint16(maxp + 4);

  // hmtx
  const hmtx = need('hmtx');
  const advances = new Uint16Array(numGlyphs);
  let last = 0;
  for (let i = 0; i < numGlyphs; i++) {
    if (i < numberOfHMetrics) last = dv.getUint16(hmtx + i * 4);
    advances[i] = last;
  }

  // OS/2 (isteğe bağlı)
  let capHeight = Math.round(ascender * 0.7);
  let weightClass = 400;
  if (tables['OS/2']) {
    const os2 = tables['OS/2'].offset;
    weightClass = dv.getUint16(os2 + 4);
    const version = dv.getUint16(os2);
    if (version >= 2 && os2 + 90 <= bytes.length) {
      const ch = dv.getInt16(os2 + 88);
      if (ch > 0) capHeight = ch;
    }
  }

  // post
  let italicAngle = 0;
  if (tables.post) {
    const p = tables.post.offset;
    italicAngle = dv.getInt32(p + 4) / 65536;
  }

  // cmap: format 12 varsa onu, yoksa format 4
  const cmapOff = need('cmap');
  const nSub = dv.getUint16(cmapOff + 2);
  let best = null;
  for (let i = 0; i < nSub; i++) {
    const rec = cmapOff + 4 + i * 8;
    const platform = dv.getUint16(rec);
    const encoding = dv.getUint16(rec + 2);
    const off = cmapOff + dv.getUint32(rec + 4);
    const format = dv.getUint16(off);
    const score =
      format === 12 && platform === 3 && encoding === 10 ? 5 :
      format === 4 && platform === 3 && encoding === 1 ? 4 :
      format === 12 ? 3 : format === 4 ? 2 : format === 6 ? 1 : 0;
    if (score > 0 && (!best || score > best.score)) best = { off, format, score };
  }
  if (!best) throw new Error('Yazı tipinde kullanılabilir cmap yok.');

  const map = new Map();
  if (best.format === 4) {
    const o = best.off;
    const segX2 = dv.getUint16(o + 6);
    const seg = segX2 / 2;
    const endO = o + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    for (let s = 0; s < seg; s++) {
      const end = dv.getUint16(endO + s * 2);
      const start = dv.getUint16(startO + s * 2);
      const delta = dv.getInt16(deltaO + s * 2);
      const rangeOffset = dv.getUint16(rangeO + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let g;
        if (rangeOffset === 0) {
          g = (c + delta) & 0xffff;
        } else {
          const gi = rangeO + s * 2 + rangeOffset + (c - start) * 2;
          if (gi + 1 >= bytes.length) continue;
          g = dv.getUint16(gi);
          if (g !== 0) g = (g + delta) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else if (best.format === 12) {
    const o = best.off;
    const nGroups = dv.getUint32(o + 12);
    for (let i = 0; i < nGroups; i++) {
      const g = o + 16 + i * 12;
      const start = dv.getUint32(g);
      const end = dv.getUint32(g + 4);
      const startGid = dv.getUint32(g + 8);
      for (let c = start; c <= end && c - start < 0x10000; c++) {
        map.set(c, startGid + (c - start));
      }
    }
  }

  const scale = 1000 / unitsPerEm;
  const flags =
    (italicAngle !== 0 || macStyle & 2 ? 64 : 0) |  // Italic
    4 |                                             // Symbolic kapalı → Nonsymbolic(32) tercih
    32;

  return {
    bytes,
    unitsPerEm,
    numGlyphs,
    italicAngle,
    weightClass,
    bold: !!(macStyle & 1),
    flags: 32,
    bbox: [Math.round(xMin * scale), Math.round(yMin * scale), Math.round(xMax * scale), Math.round(yMax * scale)],
    ascent: Math.round(ascender * scale),
    descent: Math.round(descender * scale),
    capHeight: Math.round(capHeight * scale),
    stemV: Math.round(10 + (weightClass - 400) / 65),
    /** Kod noktası → glif kimliği (yoksa 0) */
    gidFor(cp) { return map.get(cp) || 0; },
    /** Glif genişliği, 1000 birim/em cinsinden */
    widthFor(gid) { return Math.round((advances[gid] || 0) * scale); },
    has(cp) { return map.has(cp); },
  };
}

/** Metni glif kimliklerine çevirir; eşleşmeyen karakterler atlanır. */
export function encodeGlyphs(font, text) {
  const gids = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    let gid = font.gidFor(cp);
    if (!gid) {
      // Yakın karşılık: yaygın tipografik karakterleri sadeleştir
      const alt = FALLBACK[ch];
      if (alt) {
        for (const a of alt) {
          const g = font.gidFor(a.codePointAt(0));
          if (g) gids.push({ gid: g, cp: a.codePointAt(0) });
        }
        continue;
      }
      gid = font.gidFor(0x003f); // '?'
      if (!gid) continue;
    }
    gids.push({ gid, cp });
  }
  return gids;
}

const FALLBACK = {
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '…': '...', ' ': ' ',
  '•': '-', '→': '->', '­': '',
};
