// Dosya türü tespiti: önce sihirli baytlar, sonra uzantı. Tarayıcının verdiği
// MIME'e güvenilmez (Windows'ta sık sık boş ya da yanlış gelir).

const EXT_KIND = {
  png: ['image', 'png'], jpg: ['image', 'jpeg'], jpeg: ['image', 'jpeg'],
  webp: ['image', 'webp'], gif: ['image', 'gif'], bmp: ['image', 'bmp'],
  avif: ['image', 'avif'], ico: ['image', 'ico'], tif: ['image', 'tiff'],
  tiff: ['image', 'tiff'], svg: ['image', 'svg'], heic: ['image', 'heic'], heif: ['image', 'heic'],
  pdf: ['pdf', 'pdf'],
  docx: ['docx', 'docx'], doc: ['doc', 'doc'], rtf: ['text', 'rtf'],
  odt: ['odt', 'odt'], ods: ['ods', 'ods'], odp: ['odp', 'odp'],
  fodt: ['text', 'xml'], ott: ['odt', 'odt'], ots: ['ods', 'ods'], otp: ['odp', 'odp'],
  xlsx: ['xlsx', 'xlsx'], xls: ['xls', 'xls'], xlsm: ['xlsx', 'xlsx'],
  pptx: ['pptx', 'pptx'], ppt: ['ppt', 'ppt'],
  txt: ['text', 'txt'], log: ['text', 'txt'], md: ['text', 'md'], markdown: ['text', 'md'],
  csv: ['text', 'csv'], tsv: ['text', 'csv'], json: ['text', 'json'],
  html: ['text', 'html'], htm: ['text', 'html'], xml: ['text', 'xml'],
  js: ['text', 'code'], ts: ['text', 'code'], css: ['text', 'code'], py: ['text', 'code'],
  yml: ['text', 'code'], yaml: ['text', 'code'], ini: ['text', 'code'], sql: ['text', 'code'],
  zip: ['zip', 'zip'],
};

export const KIND_LABEL = {
  image: 'Görsel', pdf: 'PDF',
  docx: 'Word (DOCX)', doc: 'Word (eski .doc)',
  xlsx: 'Excel (XLSX)', xls: 'Excel (eski .xls)',
  pptx: 'PowerPoint (PPTX)', ppt: 'PowerPoint (eski .ppt)',
  odt: 'LibreOffice Writer', ods: 'LibreOffice Calc', odp: 'LibreOffice Impress',
  text: 'Metin', zip: 'ZIP', unknown: 'Bilinmiyor',
};

function startsWith(bytes, sig, offset = 0) {
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

export function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function baseName(name) {
  return String(name || 'dosya').replace(/\.[^.]+$/, '') || 'dosya';
}

/** Dosyanın ilk baytlarından ve adından türü belirler. */
export async function detect(file) {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const ext = extOf(file.name);

  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return kind('image', 'png', file, ext);
  if (startsWith(head, [0xff, 0xd8, 0xff])) return kind('image', 'jpeg', file, ext);
  if (startsWith(head, ascii('GIF8'))) return kind('image', 'gif', file, ext);
  if (startsWith(head, [0x42, 0x4d])) return kind('image', 'bmp', file, ext);
  if (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) return kind('image', 'webp', file, ext);
  if (startsWith(head, ascii('ftyp'), 4)) {
    const brand = String.fromCharCode(...head.slice(8, 12));
    if (brand.startsWith('avif') || brand.startsWith('avis')) return kind('image', 'avif', file, ext);
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('mif1')) return kind('image', 'heic', file, ext);
  }
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) {
    return kind('image', 'tiff', file, ext);
  }
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return kind('pdf', 'pdf', file, ext);
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) {
    // Eski OLE kapsayıcı: .doc / .xls / .ppt
    const k = ext === 'xls' ? 'xls' : ext === 'ppt' ? 'ppt' : 'doc';
    return kind(k, k, file, ext);
  }
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) {
    const text = new TextDecoder('latin1').decode(head);
    // OpenDocument: ilk girdi sıkıştırılmamış "mimetype" olur
    if (text.includes('opendocument.text')) return kind('odt', 'odt', file, ext);
    if (text.includes('opendocument.spreadsheet')) return kind('ods', 'ods', file, ext);
    if (text.includes('opendocument.presentation')) return kind('odp', 'odp', file, ext);
    if (text.includes('word/')) return kind('docx', 'docx', file, ext);
    if (text.includes('xl/')) return kind('xlsx', 'xlsx', file, ext);
    if (text.includes('ppt/')) return kind('pptx', 'pptx', file, ext);
    const byExt = EXT_KIND[ext];
    if (byExt && ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(byExt[0])) {
      return kind(byExt[0], byExt[1], file, ext);
    }
    return kind('zip', 'zip', file, ext);
  }

  // Metin mi? İlk bloğu UTF-8 olarak çözmeyi dene
  if (head.length && looksLikeText(head)) {
    const sample = new TextDecoder('utf-8', { fatal: false }).decode(head).trim();
    if (sample.startsWith('<?xml') && sample.includes('<svg')) return kind('image', 'svg', file, ext);
    if (/^<svg[\s>]/i.test(sample)) return kind('image', 'svg', file, ext);
    if (/^<(!doctype html|html)/i.test(sample)) return kind('text', 'html', file, ext);
    if (sample.startsWith('{') || sample.startsWith('[')) return kind('text', 'json', file, ext);
    if (sample.startsWith('{\\rtf')) return kind('text', 'rtf', file, ext);
    if (sample.startsWith('<?xml')) return kind('text', 'xml', file, ext);
    const byExt = EXT_KIND[ext];
    if (byExt && byExt[0] === 'text') return kind('text', byExt[1], file, ext);
    return kind('text', 'txt', file, ext);
  }

  const byExt = EXT_KIND[ext];
  if (byExt) return kind(byExt[0], byExt[1], file, ext);
  return kind('unknown', 'unknown', file, ext);
}

function looksLikeText(bytes) {
  let control = 0;
  const n = Math.min(bytes.length, 1024);
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control / n < 0.02;
}

function kind(k, sub, file, ext) {
  return { kind: k, sub, ext, name: file.name || 'dosya', size: file.size, file };
}

export function humanSize(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
