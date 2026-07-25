/* config.js — bulut (Supabase) yapılandırması.
 *
 * BUILT_IN alanları dolu: uygulama kutudan çıktığı gibi buluta bağlıdır.
 * Kullanıcı yalnızca e-posta + şifre ile kayıt olur/giriş yapar; Supabase hesabı
 * açması gerekmez. Tüm kullanıcılar aynı projede durur, satır düzeyi güvenlik (RLS)
 * sayesinde kimse başkasının verisini göremez.
 *
 * (Gelişmiş) Başka bir projeye bağlanmak istersen uygulama içindeki
 * "Kendi Supabase projene bağlan" ekranından cihaza özel değer girebilirsin;
 * o değer BUILT_IN'i ezer.
 *
 * Değerler: Supabase paneli → Project Settings → API
 *    url     = "Project URL"           (ör. https://abcd1234.supabase.co)
 *    anonKey = "anon public" anahtarı  (istemcide durması güvenlidir; RLS koruyor)
 *
 * İkisi de boşsa uygulama "yalnız bu cihaz" kipinde çalışır: her şey yerel,
 * bulut eşitlemesi / kısayol / görsel yükleme kapalı.
 */

const BUILT_IN = {
  url: 'https://cklqqngyvizgjseflwlw.supabase.co',
  anonKey: 'sb_publishable_9Qzug1O29zgT-p4FAAMb9A_fm3z-zoi',
};

const OVERRIDE_KEY = 'saglik-panel/cloud';

function readOverride() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}

const ov = readOverride();
const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

export const CONFIG = {
  url: clean(ov.url || BUILT_IN.url),
  anonKey: String(ov.anonKey || BUILT_IN.anonKey || '').trim(),
  bucket: 'saglik-yuklemeler',

  /** Kısayol kurulum sayfasında gösterilen uygulama adresi. */
  webUrl: 'https://fatiheminkarahan.com/saglik/',

  /** iPhone kısayolunun adı — paneldeki "veri çek" tuşu bunu çağırır. */
  shortcutName: 'Sağlık Gönder',
};

/** Uygulama içinden bulut bilgilerini kaydet (sayfa yenilenince geçerli olur). */
export function setCloudConfig({ url, anonKey }) {
  const rec = { url: clean(url), anonKey: String(anonKey || '').trim() };
  if (!rec.url || !rec.anonKey) throw new Error('Adres ve anahtar gerekli');
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(rec));
  CONFIG.url = rec.url;
  CONFIG.anonKey = rec.anonKey;
  return rec;
}

export function clearCloudConfig() {
  localStorage.removeItem(OVERRIDE_KEY);
  CONFIG.url = clean(BUILT_IN.url);
  CONFIG.anonKey = String(BUILT_IN.anonKey || '');
}

/** Bulut bu cihazda uygulama içinden mi ayarlandı? */
export const isCloudFromDevice = () => !!(ov.url && ov.anonKey);

export const isCloudEnabled = () => !!(CONFIG.url && CONFIG.anonKey);

/**
 * Girilen bilgileri sınar. Dönen değer:
 *  'ok'          → anahtar geçerli, şema kurulu
 *  'no-schema'   → anahtar geçerli ama sp_ tabloları yok (schema.sql çalıştırılmamış)
 *  'bad-key'     → anahtar/adres yanlış
 *  'unreachable' → adrese ulaşılamadı
 */
export async function testCloudConfig(url, anonKey) {
  const base = clean(url);
  const key = String(anonKey || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) return 'bad-url';
  if (key.length < 40) return 'bad-key';
  try {
    const res = await fetch(`${base}/rest/v1/sp_profiles?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.status === 200) return 'ok';
    if (res.status === 404) return 'no-schema';
    if (res.status === 401 || res.status === 403) {
      // RLS satır döndürmese de 200 gelir; 401/403 anahtar sorunudur
      return 'bad-key';
    }
    const body = await res.text();
    return /relation .* does not exist|not find the table/i.test(body) ? 'no-schema' : 'bad-key';
  } catch (e) {
    return 'unreachable';
  }
}
