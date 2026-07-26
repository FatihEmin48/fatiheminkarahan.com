// Sıfırdan PDF üretici. Metin için TrueType gömme (Identity-H) kullanır; böylece
// Türkçe karakterler doğru çıkar ve metin PDF'te seçilebilir/aranabilir kalır.

import { deflateZlib } from './zip.js';
import { parseFont, encodeGlyphs } from './ttf.js';

const te = new TextEncoder();

export const PAGE_SIZES = {
  a4: { label: 'A4', w: 595.28, h: 841.89 },
  a3: { label: 'A3', w: 841.89, h: 1190.55 },
  a5: { label: 'A5', w: 419.53, h: 595.28 },
  letter: { label: 'Letter', w: 612, h: 792 },
  legal: { label: 'Legal', w: 612, h: 1008 },
};

function bytesOf(x) {
  return typeof x === 'string' ? te.encode(x) : x;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** PDF dizgisi: parantez ve ters bölü kaçışlanır. */
function pdfString(s) {
  return '(' + String(s).replace(/[\\()]/g, (c) => '\\' + c).replace(/[\r\n]/g, ' ') + ')';
}

function hex2(n) {
  return n.toString(16).padStart(4, '0').toUpperCase();
}

/* ------------------------------------------------------------------- JPEG bilgisi */

/** JPEG başlığından ölçü ve bileşen sayısı okur (DCTDecode ile doğrudan gömmek için). */
export function jpegInfo(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0..SOF15 (DHT/JPG/DAC hariç)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
        progressive: marker === 0xc2,
      };
    }
    i += 2 + len;
  }
  return null;
}

/* --------------------------------------------------------------------- belge */

export class PdfDoc {
  constructor(meta = {}) {
    this.objects = [null];          // 1 tabanlı; objects[i] = Uint8Array gövde
    this.pages = [];
    this.fonts = new Map();         // ad → { ref, font, used:Map(gid→cp) }
    this.meta = meta;
  }

  alloc() {
    this.objects.push(null);
    return this.objects.length - 1;
  }

  set(num, body) {
    this.objects[num] = bytesOf(body);
  }

  addObject(body) {
    const n = this.alloc();
    this.set(n, body);
    return n;
  }

  /** Ham akış nesnesi; dict ek anahtarları alır. */
  async addStream(data, dict = {}, { compress = true } = {}) {
    let payload = bytesOf(data);
    const d = { ...dict };
    if (compress && !d.Filter && payload.length > 128) {
      const z = await deflateZlib(payload);
      if (z && z.length < payload.length) {
        payload = z;
        d.Filter = '/FlateDecode';
      }
    }
    d.Length = payload.length;
    const head = '<<' + Object.entries(d).map(([k, v]) => `/${k} ${v}`).join(' ') + '>>\nstream\n';
    return this.addObject(concat([te.encode(head), payload, te.encode('\nendstream')]));
  }

  /* ------------------------------------------------------------------ fontlar */

  async embedFont(name, ttfBytes) {
    if (this.fonts.has(name)) return name;
    const font = parseFont(ttfBytes);
    this.fonts.set(name, { font, used: new Map(), ref: this.alloc() });
    return name;
  }

  font(name) {
    const f = this.fonts.get(name);
    if (!f) throw new Error(`Yazı tipi gömülmemiş: ${name}`);
    return f;
  }

  /** Metnin genişliği (punto cinsinden). */
  measure(fontName, size, text) {
    const { font } = this.font(fontName);
    let w = 0;
    for (const g of encodeGlyphs(font, text)) w += font.widthFor(g.gid);
    return (w * size) / 1000;
  }

  /** Verilen genişliğe göre sözcük sarması. */
  wrap(fontName, size, text, maxWidth) {
    const lines = [];
    for (const paragraph of String(text).split('\n')) {
      if (!paragraph.trim()) { lines.push(''); continue; }
      const words = paragraph.split(/\s+/).filter(Boolean);
      let line = '';
      for (const word of words) {
        const trial = line ? line + ' ' + word : word;
        if (this.measure(fontName, size, trial) <= maxWidth || !line) {
          // Tek başına sığmayan uzun sözcüğü karakterden böl
          if (!line && this.measure(fontName, size, word) > maxWidth) {
            let chunk = '';
            for (const ch of word) {
              if (this.measure(fontName, size, chunk + ch) > maxWidth && chunk) {
                lines.push(chunk);
                chunk = ch;
              } else chunk += ch;
            }
            line = chunk;
            continue;
          }
          line = trial;
        } else {
          lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /* ------------------------------------------------------------------ görüntü */

  /** JPEG baytlarını yeniden kodlamadan gömer. */
  async addJpeg(bytes) {
    const info = jpegInfo(bytes);
    if (!info) throw new Error('JPEG başlığı okunamadı.');
    const cs = info.components === 1 ? '/DeviceGray' : info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    const ref = await this.addStream(bytes, {
      Type: '/XObject',
      Subtype: '/Image',
      Width: info.width,
      Height: info.height,
      ColorSpace: cs,
      BitsPerComponent: 8,
      Filter: '/DCTDecode',
    }, { compress: false });
    return { ref, width: info.width, height: info.height };
  }

  /** Ham RGBA'yı kayıpsız (Flate) gömer; saydamlık varsa SMask ekler. */
  async addRawImage(rgba, width, height) {
    const n = width * height;
    const rgb = new Uint8Array(n * 3);
    let hasAlpha = false;
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = rgba[i * 4];
      rgb[i * 3 + 1] = rgba[i * 4 + 1];
      rgb[i * 3 + 2] = rgba[i * 4 + 2];
      if (rgba[i * 4 + 3] !== 255) hasAlpha = true;
    }
    const dict = {
      Type: '/XObject',
      Subtype: '/Image',
      Width: width,
      Height: height,
      ColorSpace: '/DeviceRGB',
      BitsPerComponent: 8,
    };
    if (hasAlpha) {
      const a = new Uint8Array(n);
      for (let i = 0; i < n; i++) a[i] = rgba[i * 4 + 3];
      const smask = await this.addStream(a, {
        Type: '/XObject',
        Subtype: '/Image',
        Width: width,
        Height: height,
        ColorSpace: '/DeviceGray',
        BitsPerComponent: 8,
      });
      dict.SMask = `${smask} 0 R`;
    }
    const ref = await this.addStream(rgb, dict);
    return { ref, width, height };
  }

  /* -------------------------------------------------------------------- sayfa */

  addPage(width, height) {
    const page = {
      width,
      height,
      ops: [],
      images: new Map(),
      usedFonts: new Set(),
      ref: this.alloc(),
    };
    this.pages.push(page);
    return page;
  }

  drawImage(page, img, x, y, w, h) {
    const alias = 'Im' + page.images.size;
    let name = null;
    for (const [k, v] of page.images) if (v === img.ref) name = k;
    if (!name) { name = alias; page.images.set(alias, img.ref); }
    page.ops.push(`q ${w.toFixed(3)} 0 0 ${h.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /${name} Do Q`);
  }

  drawRect(page, x, y, w, h, color = [0, 0, 0]) {
    page.ops.push(
      `q ${color.map((c) => (c / 255).toFixed(4)).join(' ')} rg ` +
      `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q`
    );
  }

  /** Tek satır metin. y, taban çizgisidir (sayfanın altından ölçülür). */
  drawText(page, fontName, size, x, y, text, opts = {}) {
    const f = this.font(fontName);
    page.usedFonts.add(fontName);
    const glyphs = encodeGlyphs(f.font, text);
    if (!glyphs.length) return 0;
    let hex = '';
    let width = 0;
    for (const g of glyphs) {
      f.used.set(g.gid, g.cp);
      hex += hex2(g.gid);
      width += f.font.widthFor(g.gid);
    }
    const color = opts.color || [0, 0, 0];
    const rg = color.map((c) => (c / 255).toFixed(4)).join(' ');
    page.ops.push(
      `BT ${rg} rg /${fontName} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td <${hex}> Tj ET`
    );
    return (width * size) / 1000;
  }

  /* ------------------------------------------------------------------- derleme */

  async buildFontObjects() {
    for (const [name, entry] of this.fonts) {
      const { font, used } = entry;
      if (!used.size) used.set(0, 32);
      const gids = [...used.keys()].sort((a, b) => a - b);

      const fileRef = await this.addStream(font.bytes, { Length1: font.bytes.length });
      const descRef = this.addObject(
        `<</Type/FontDescriptor/FontName/${name}/Flags ${font.flags}` +
        `/FontBBox[${font.bbox.join(' ')}]/ItalicAngle ${font.italicAngle}` +
        `/Ascent ${font.ascent}/Descent ${font.descent}/CapHeight ${font.capHeight}` +
        `/StemV ${font.stemV}/FontFile2 ${fileRef} 0 R>>`
      );

      // Genişlik dizisi: ardışık glifleri tek grupta topla
      let w = '';
      let i = 0;
      while (i < gids.length) {
        let j = i;
        while (j + 1 < gids.length && gids[j + 1] === gids[j] + 1) j++;
        w += `${gids[i]} [${gids.slice(i, j + 1).map((g) => font.widthFor(g)).join(' ')}] `;
        i = j + 1;
      }

      const cidRef = this.addObject(
        `<</Type/Font/Subtype/CIDFontType2/BaseFont/${name}` +
        `/CIDSystemInfo<</Registry(Adobe)/Ordering(Identity)/Supplement 0>>` +
        `/FontDescriptor ${descRef} 0 R/DW 1000/W [${w.trim()}]/CIDToGIDMap/Identity>>`
      );

      // ToUnicode: kopyala-yapıştır ve arama için
      const lines = gids
        .filter((g) => used.get(g))
        .map((g) => {
          const cp = used.get(g);
          const utf16 = cp > 0xffff
            ? (() => {
                const v = cp - 0x10000;
                return hex2(0xd800 + (v >> 10)) + hex2(0xdc00 + (v & 0x3ff));
              })()
            : hex2(cp);
          return `<${hex2(g)}> <${utf16}>`;
        });
      let cmap =
        '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
        '/CIDSystemInfo <</Registry (Adobe) /Ordering (UCS) /Supplement 0>> def\n' +
        '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
      for (let k = 0; k < lines.length; k += 100) {
        const chunk = lines.slice(k, k + 100);
        cmap += `${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar\n`;
      }
      cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
      const toUni = await this.addStream(cmap, {});

      this.set(entry.ref,
        `<</Type/Font/Subtype/Type0/BaseFont/${name}/Encoding/Identity-H` +
        `/DescendantFonts[${cidRef} 0 R]/ToUnicode ${toUni} 0 R>>`
      );
    }
  }

  async build() {
    await this.buildFontObjects();

    const pagesRef = this.alloc();
    for (const page of this.pages) {
      const content = await this.addStream(page.ops.join('\n'), {});
      const fontRes = [...page.usedFonts]
        .map((n) => `/${n} ${this.font(n).ref} 0 R`).join(' ');
      const xobj = [...page.images].map(([alias, ref]) => `/${alias} ${ref} 0 R`).join(' ');
      const res =
        '<<' +
        (fontRes ? `/Font<<${fontRes}>>` : '') +
        (xobj ? `/XObject<<${xobj}>>` : '') +
        '/ProcSet[/PDF/Text/ImageB/ImageC/ImageI]>>';
      this.set(page.ref,
        `<</Type/Page/Parent ${pagesRef} 0 R` +
        `/MediaBox[0 0 ${page.width.toFixed(2)} ${page.height.toFixed(2)}]` +
        `/Resources ${res}/Contents ${content} 0 R>>`
      );
    }
    this.set(pagesRef,
      `<</Type/Pages/Kids[${this.pages.map((p) => `${p.ref} 0 R`).join(' ')}]/Count ${this.pages.length}>>`
    );
    const catalogRef = this.addObject(`<</Type/Catalog/Pages ${pagesRef} 0 R>>`);

    const now = new Date();
    const stamp = 'D:' +
      now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const infoRef = this.addObject(
      `<</Producer ${pdfString('Dosya Dönüştürücü')}` +
      (this.meta.title ? `/Title ${pdfString(this.meta.title)}` : '') +
      (this.meta.author ? `/Author ${pdfString(this.meta.author)}` : '') +
      `/CreationDate (${stamp})>>`
    );

    // Gövdeyi diz ve çapraz başvuru tablosunu kur
    const parts = [te.encode('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')];
    let offset = parts[0].length;
    const offsets = new Array(this.objects.length).fill(0);

    for (let i = 1; i < this.objects.length; i++) {
      const body = this.objects[i];
      if (!body) continue;
      offsets[i] = offset;
      const head = te.encode(`${i} 0 obj\n`);
      const tail = te.encode('\nendobj\n');
      parts.push(head, body, tail);
      offset += head.length + body.length + tail.length;
    }

    const xrefStart = offset;
    let xref = `xref\n0 ${this.objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.objects.length; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    xref += `trailer\n<</Size ${this.objects.length}/Root ${catalogRef} 0 R/Info ${infoRef} 0 R>>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`;
    parts.push(te.encode(xref));

    return concat(parts);
  }
}

/* ------------------------------------------------------- yardımcı yerleşimler */

/** Görüntüyü sayfaya oranını koruyarak yerleştirir. */
export function fitBox(imgW, imgH, boxW, boxH, mode = 'contain') {
  const k = mode === 'cover'
    ? Math.max(boxW / imgW, boxH / imgH)
    : Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * k;
  const h = imgH * k;
  return { w, h, x: (boxW - w) / 2, y: (boxH - h) / 2 };
}
