/* OTOMATİK KOPYA — kaynak: shared/core-util.js. Elle düzenleme, shared/ içindekini düzenle. */
/* core-util.js — tarih, sayı ve biçimlendirme yardımcıları.
   Web ve Android uygulaması bu dosyayı paylaşır (tools/sync-shared.js kopyalar). */

/* ---------------- tarih ---------------- */

const pad = (n) => String(n).padStart(2, '0');

/** Yerel saate göre YYYY-MM-DD. toISOString() UTC'ye kaydırdığı için kullanılmaz. */
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function keyToDate(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDay(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export const today = () => dayKey();
export const isValidKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k));

/** Pazartesi başlangıçlı hafta (Postgres date_trunc('week') ile aynı). */
export function weekStart(key = today()) {
  const d = keyToDate(key);
  const dow = (d.getDay() + 6) % 7;      // Pazartesi=0 … Pazar=6
  d.setDate(d.getDate() - dow);
  return dayKey(d);
}

export const monthStart = (key = today()) => `${key.slice(0, 7)}-01`;
export const yearStart = (key = today()) => `${key.slice(0, 4)}-01-01`;

/** iki gün arasındaki tam gün farkı (a - b) */
export function daysBetween(a, b) {
  const ms = keyToDate(a).getTime() - keyToDate(b).getTime();
  return Math.round(ms / 86400000);
}

/** başlangıçtan bitişe (dahil) gün anahtarları */
export function dayRange(fromKey, toKey) {
  const out = [];
  let k = fromKey;
  let guard = 0;
  while (k <= toKey && guard++ < 4000) {
    out.push(k);
    k = shiftDay(k, 1);
  }
  return out;
}

export function lastNDays(n, endKey = today()) {
  return dayRange(shiftDay(endKey, -(n - 1)), endKey);
}

/* ---------------- Türkçe biçimlendirme ---------------- */

const DAYS_LONG = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const DAYS_SHORT = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** 1=Pazartesi … 7=Pazar (veritabanıyla aynı düzen) */
export const WEEKDAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
export const weekdayName = (n) => WEEKDAY_NAMES[(Number(n) - 1 + 7) % 7];
/** Date.getDay() (0=Pazar) → 1..7 (1=Pazartesi) */
export const isoWeekday = (d) => ((d.getDay() + 6) % 7) + 1;

export const dayShort = (key) => DAYS_SHORT[keyToDate(key).getDay()];
export const dayLong = (key) => DAYS_LONG[keyToDate(key).getDay()];

export function prettyDay(key) {
  const d = keyToDate(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
}

export function prettyDayFull(key) {
  return `${prettyDay(key)}, ${dayLong(key)}`;
}

export function relativeDay(key) {
  const diff = daysBetween(key, today());
  if (diff === 0) return 'Bugün';
  if (diff === -1) return 'Dün';
  if (diff === -2) return 'Evvelsi gün';
  if (diff === 1) return 'Yarın';
  if (diff > -7 && diff < 0) return dayLong(key);
  return prettyDay(key);
}

export function prettyWeek(startKey) {
  const endKey = shiftDay(startKey, 6);
  const a = keyToDate(startKey);
  const b = keyToDate(endKey);
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]}`;
  }
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
}

export const prettyMonth = (key) => `${MONTHS[keyToDate(key).getMonth()]} ${keyToDate(key).getFullYear()}`;
export const monthShort = (key) => MONTHS_SHORT[keyToDate(key).getMonth()];

/** 1234567 → "1.234.567" */
export function nf(n, digits = 0) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('tr-TR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export const kg = (n) => (n == null ? '—' : `${nf(n, 1)} kg`);
export const km = (n) => (n == null ? '—' : `${nf(n, 1)} km`);

/** 95 → "1 sa 35 dk" */
export function dur(min) {
  if (min == null) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} sa ${r} dk` : `${h} sa`;
}

/** yüzde değişimi: +12 / -5 / 0 (önceki 0 ise null) */
export function pctChange(now, prev) {
  if (!prev || prev === 0 || now == null) return null;
  return Math.round(((now - prev) / prev) * 100);
}

export function signed(n, unit = '') {
  if (n == null) return '—';
  const s = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}${nf(Math.abs(n), Number.isInteger(n) ? 0 : 1)}${unit}`;
}

/* ---------------- sayı ayrıştırma (OCR/kullanıcı girdisi) ---------------- */

/**
 * "8.432" → 8432 · "6,1" → 6.1 · "1,234" → 1234 · "78.4" → 78.4
 * kind: 'int' (binlik ayırıcı beklenir) | 'float' (ondalık beklenir) | 'auto'
 */
export function parseNum(raw, kind = 'auto') {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s/g, '');
  s = s.replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;

  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let out;

  if (lastDot >= 0 && lastComma >= 0) {
    // ikisi de var: sondaki ondalık ayırıcıdır
    const decAt = Math.max(lastDot, lastComma);
    const intPart = s.slice(0, decAt).replace(/[.,]/g, '');
    const frac = s.slice(decAt + 1).replace(/[.,]/g, '');
    out = Number(`${intPart}.${frac}`);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const at = Math.max(lastDot, lastComma);
    const sep = s[at];
    const frac = s.slice(at + 1);
    const intPart = s.slice(0, at).replace(/[.,]/g, '');
    const looksThousand = frac.length === 3 && s.split(sep).length - 1 >= 1 && kind !== 'float';
    if (kind === 'float' && frac.length <= 2) {
      out = Number(`${intPart}.${frac}`);
    } else if (looksThousand) {
      out = Number(intPart + frac);
    } else if (frac.length <= 2) {
      out = Number(`${intPart}.${frac}`);
    } else {
      out = Number(intPart + frac);
    }
  } else {
    out = Number(s);
  }

  if (!Number.isFinite(out)) return null;
  if (kind === 'int') out = Math.round(out);
  return neg ? -out : out;
}

/** Türkçe/İngilizce harf katlaması — etiket eşleştirmede kullanılır. */
export function fold(s) {
  return String(s)
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u');
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
