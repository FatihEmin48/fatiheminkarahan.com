// ZIP okuma/yazma — tarayıcının Compression Streams API'siyle, kütüphanesiz.
// DOCX/XLSX/PPTX birer ZIP olduğu için belge dönüşümlerinin de temeli budur.

const te = new TextEncoder();
const td = new TextDecoder();

/* ------------------------------------------------------------------ sıkıştırma */

async function streamThrough(bytes, stream) {
  const rs = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(rs).arrayBuffer());
}

export async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  return streamThrough(bytes, new CompressionStream('deflate-raw'));
}

export async function inflateRaw(bytes) {
  return streamThrough(bytes, new DecompressionStream('deflate-raw'));
}

export async function deflateZlib(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  return streamThrough(bytes, new CompressionStream('deflate'));
}

/* ------------------------------------------------------------------------ CRC */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* --------------------------------------------------------------------- yazma */

class ByteWriter {
  constructor() {
    this.parts = [];
    this.length = 0;
  }
  push(u8) {
    this.parts.push(u8);
    this.length += u8.length;
  }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); this.push(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.push(b); }
  bytes() {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

function dosTime(date = new Date()) {
  const t = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const d = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { t, d };
}

/**
 * ZIP arşivi üretir. entries: [{ name, data: Uint8Array|string, store?: boolean }]
 * `store` true ise sıkıştırılmaz (zaten sıkışık dosyalar için).
 */
export async function createZip(entries, { compress = true } = {}) {
  const w = new ByteWriter();
  const central = [];
  const { t, d } = dosTime();

  for (const e of entries) {
    const nameBytes = te.encode(e.name);
    const raw = typeof e.data === 'string' ? te.encode(e.data) : e.data;
    const crc = crc32(raw);
    let data = raw;
    let method = 0;
    if (compress && !e.store && raw.length > 64) {
      const def = await deflateRaw(raw);
      if (def && def.length < raw.length) { data = def; method = 8; }
    }
    const offset = w.length;

    w.u32(0x04034b50);
    w.u16(20); w.u16(0x0800); w.u16(method);   // 0x0800: ad UTF-8
    w.u16(t); w.u16(d);
    w.u32(crc); w.u32(data.length); w.u32(raw.length);
    w.u16(nameBytes.length); w.u16(0);
    w.push(nameBytes);
    w.push(data);

    central.push({ nameBytes, method, crc, csize: data.length, usize: raw.length, offset });
  }

  const cdStart = w.length;
  for (const c of central) {
    w.u32(0x02014b50);
    w.u16(20); w.u16(20); w.u16(0x0800); w.u16(c.method);
    w.u16(t); w.u16(d);
    w.u32(c.crc); w.u32(c.csize); w.u32(c.usize);
    w.u16(c.nameBytes.length); w.u16(0); w.u16(0);
    w.u16(0); w.u16(0); w.u32(0);
    w.u32(c.offset);
    w.push(c.nameBytes);
  }
  const cdSize = w.length - cdStart;

  w.u32(0x06054b50);
  w.u16(0); w.u16(0);
  w.u16(central.length); w.u16(central.length);
  w.u32(cdSize); w.u32(cdStart);
  w.u16(0);

  return w.bytes();
}

/* --------------------------------------------------------------------- okuma */

/** ZIP içeriğini { ad → Uint8Array } olarak çıkarır. */
export async function readZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Merkezi dizin sonunu geriden ara
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Geçerli bir ZIP/Office dosyası değil.');

  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const out = {};

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const csize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOffset = dv.getUint32(ptr + 42, true);
    const name = td.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    // Yerel başlıktan gerçek veri başlangıcı
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + csize);

    if (name.endsWith('/')) continue;
    out[name] = method === 8 ? await inflateRaw(raw) : raw.slice();
  }
  return out;
}

export function zipTextEntry(files, name) {
  const b = files[name];
  return b ? td.decode(b) : null;
}
