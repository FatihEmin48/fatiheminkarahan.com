/* ai.js — yapay zekâ değerlendirmesi ve soru-cevap.
 *
 * Üç kademe, sırayla denenir:
 *   1) SUNUCU (önerilen): Supabase Edge Function "ai". İçinde ÇOK SAĞLAYICILI
 *      zincir var — Gemini → Groq → Cerebras → OpenRouter → … biri tükenince
 *      sıradaki devreye girer. Kullanıcı hiçbir anahtar girmez.
 *   2) CİHAZ: kullanıcı kendi ücretsiz anahtarını girdiyse doğrudan oraya gider.
 *      Anahtarın hangi servise ait olduğu baştaki ekinden anlaşılır.
 *   3) İkisi de olmazsa çağıran taraf kurallara dayalı (yerel) değerlendirmeye düşer.
 *
 * Zincirin sonu: sunucudaki bütün sağlayıcılar tükenir ve cihaz anahtarı da yoksa
 * kullanıcıya "geliştirici ile iletişime geç" denir — sessizce çuvallanmaz.
 */

import { CONFIG } from './core/config.js';
import { api } from './core/core-api.js';

const KEY_STORE = 'saglik-panel/ai-key';

/** Sunucu "hepsi tükendi" dedikten sonra ne kadar süre tekrar denenmez. */
const TUKENDI_BEKLE = 10 * 60 * 1000;

/* ---------------- cihazdaki anahtar (isteğe bağlı) ---------------- */

/**
 * Cihaza girilen anahtarın hangi servise ait olduğu baştaki ekinden anlaşılır.
 * Sıra önemli: `sk-or-` (OpenRouter), `sk-` (OpenAI) kalıbından ÖNCE gelmeli.
 */
const DEVICE_PROVIDERS = [
  {
    id: 'gemini', label: 'Gemini', kind: 'gemini', test: /^AIza/,
    models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'],
    search: true,
  },
  {
    id: 'groq', label: 'Groq', kind: 'openai', test: /^gsk_/,
    base: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  {
    id: 'openrouter', label: 'OpenRouter', kind: 'openai', test: /^sk-or-/,
    base: 'https://openrouter.ai/api/v1',
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
  },
  {
    id: 'cerebras', label: 'Cerebras', kind: 'openai', test: /^csk-/,
    base: 'https://api.cerebras.ai/v1',
    models: ['llama-3.3-70b', 'llama3.1-8b'],
  },
  {
    id: 'github', label: 'GitHub Models', kind: 'openai', test: /^(ghp_|github_pat_)/,
    base: 'https://models.github.ai/inference',
    models: ['openai/gpt-4o-mini', 'meta/Llama-3.3-70B-Instruct'],
  },
  {
    id: 'openai', label: 'OpenAI', kind: 'openai', test: /^sk-/,
    base: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini'],
  },
];

/** Anahtarın hangi servise ait olduğunu söyler; tanınmazsa Gemini varsayar. */
export function detectProvider(key) {
  const k = String(key || '').trim();
  return DEVICE_PROVIDERS.find((p) => p.test.test(k)) || DEVICE_PROVIDERS[0];
}

export function getAiKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
}

export function setAiKey(key) {
  const k = String(key || '').trim();
  if (!k) throw new Error('Anahtar boş');
  localStorage.setItem(KEY_STORE, k);
  return k;
}

export function clearAiKey() {
  try { localStorage.removeItem(KEY_STORE); } catch (e) { /* yoksay */ }
}

export const hasAiKey = () => !!getAiKey();

/** Cihazdaki anahtarın servis adı — ayarlar ekranında gösterilir. */
export const aiKeyLabel = () => (hasAiKey() ? detectProvider(getAiKey()).label : '');

/* ---------------- sunucu durumu ---------------- */

let serverDown = false;    // fonksiyon yayınlanmamış ya da hiç anahtar tanımlı değil
let allOutAt = 0;          // sunucudaki bütün sağlayıcılar en son ne zaman tükendi

/** Sunucu yolu kurulu görünüyor mu? (bulut ayarlı + giriş yapılmış) */
export const hasAiServer = () => !!(CONFIG.url && api.isLoggedIn());

/** Sunucudaki bütün sağlayıcılar tükendi mi? (bekleme süresi dolmadıysa) */
export const aiAllOut = () => !!allOutAt && (Date.now() - allOutAt) < TUKENDI_BEKLE;

/**
 * Sunucu yolu şu an denenmeye değer mi?
 * Bir kez 404 aldıysak ya da az önce bütün sağlayıcılar tükendiyse boşuna
 * gidip her istekte anlamsız hata göstermeyelim.
 */
export const aiServerReady = () => hasAiServer() && !serverDown && !aiAllOut();

/**
 * Herhangi bir yolla yapay zekâ kullanılabilir mi?
 * "Hepsi tükendi" durumunda bile cihaz anahtarı varsa hâlâ kullanılabilir.
 */
export const aiAvailable = () => aiServerReady() || hasAiKey();

/** Sunucu tarafının yayınlanmadığı anlaşıldı mı? (arayüz mesajı için) */
export const aiServerMissing = () => hasAiServer() && serverDown;

const SETUP_HINT = 'Sunucu tarafı henüz yayınlanmamış. Ayarlar → Değerlendirme '
  + 'bölümünden kendi ücretsiz anahtarını ekleyerek hemen kullanabilirsin.';

/**
 * Zincirin sonu geldiğinde gösterilecek adres.
 * Sunucu kendi adresini yollarsa o kullanılır; bu yalnızca yedeği.
 * (Edge Function'ın da kendi kopyası var — ayrı yayınlanan dosya olduğu için.)
 */
export const AI_CONTACT = 'fatiheminkarahan.com';

/** Zincirin sonu. Tek yerde durur ki mesaj her ekranda aynı olsun. */
function tukendiHatasi(contact) {
  const adres = contact || AI_CONTACT;
  const e = new Error('Şu an bütün yapay zekâ sağlayıcıları yanıt veremiyor. '
    + 'Değerlendirmeyi cihazında yazdım. Sorun sürerse geliştirici ile iletişime geç: '
    + adres);
  e.code = 'tumu-tukendi';
  e.contact = adres;
  return e;
}

/* ---------------- sunucu yolu ---------------- */

async function askServer({ mode, question, summary, search }) {
  const token = await api.ensureToken();
  const res = await fetch(`${CONFIG.url}/functions/v1/ai`, {
    method: 'POST',
    headers: {
      apikey: CONFIG.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode, question, summary, search }),
  });

  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }

  // Fonksiyon yok (404) ya da sunucuda hiç anahtar tanımlı değil (501 + kod).
  // Sayacın kurulu olmaması da 501 verir ama kodsuz gelir; onu aşağıda olduğu
  // gibi gösteriyoruz — kurulum eksiğini "sunucu yok" diye yutmayalım.
  if (res.status === 404 || data?.code === 'saglayici-yok') {
    serverDown = true;
    const e = new Error('sunucu-yok');
    e.code = 'sunucu-yok';
    throw e;
  }

  // Zincirin tamamı tükendi
  if (data?.code === 'tum-saglayicilar-tukendi') {
    allOutAt = Date.now();
    const e = tukendiHatasi(data.contact);
    e.tried = data.tried || [];
    throw e;
  }

  if (!res.ok) throw new Error(data?.error || `Sunucu hatası (${res.status})`);

  allOutAt = 0;                                     // çalıştı, bayrağı temizle
  return {
    text: String(data.text || '').trim(),
    sources: data.sources || [],
    remaining: data.remaining,
    provider: data.provider || '',
    model: data.model || '',
  };
}

/** Sunucuda hangi sağlayıcıların kurulu olduğunu sorar (model çağırmaz, hak harcamaz). */
export async function aiStatus() {
  if (!hasAiServer()) return null;
  const token = await api.ensureToken();
  const res = await fetch(`${CONFIG.url}/functions/v1/ai`, {
    method: 'POST',
    headers: {
      apikey: CONFIG.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode: 'status' }),
  });
  if (res.status === 404) { serverDown = true; return null; }
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

/* ---------------- cihaz yolu ---------------- */

/**
 * Sunucu hatasını okunur Türkçeye çevirir.
 * `.olu` işaretli hatalarda anahtarın kendisi sorunludur — o anahtarla başka
 * model denemenin anlamı yoktur.
 */
function aiHatasi(status, body) {
  const ham = String(body?.error?.message || body?.message || '');
  const yap = (mesaj, olu = false) => Object.assign(new Error(mesaj), { olu });

  if (status === 400 && /api key not valid|invalid api key/i.test(ham)) {
    return yap('Anahtar geçersiz görünüyor.', true);
  }
  if (status === 401) return yap('Anahtar kabul edilmedi.', true);
  if (status === 403) return yap('Anahtar bu istek için yetkili değil.', true);
  if (status === 402) return yap('Bu anahtar ödeme gerektiriyor.', true);
  if (status === 429) return yap('Ücretsiz kotayı doldurdun; bir süre sonra tekrar dene.', true);
  if (status >= 500) return yap('Servis şu an yanıt vermiyor, sonra dene.');
  return yap(ham || `İstek başarısız (${status}).`);
}

async function deviceGemini(key, model, prompt, search) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 900 },
  };
  if (search) body.tools = [{ google_search: {} }];

  const base = 'https://generativelanguage.googleapis.com/v1beta/models';
  const res = await fetch(`${base}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    // Arama aracı desteklenmiyorsa araçsız bir kez daha dene.
    if (search && res.status === 400) return await deviceGemini(key, model, prompt, false);
    throw aiHatasi(res.status, data);
  }

  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  const sources = chunks.map((c) => c.web).filter(Boolean).slice(0, 5)
    .map((w) => ({ title: w.title || w.uri, uri: w.uri }));

  if (!text) throw new Error('Model boş yanıt verdi');
  return { text, sources };
}

/** Groq, OpenRouter, Cerebras, GitHub Models, OpenAI… hepsi aynı arayüzü konuşur. */
async function deviceOpenAI(p, key, model, prompt) {
  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 900,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw aiHatasi(res.status, data);

  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('Model boş yanıt verdi');
  return { text, sources: [] };
}

async function askDevice(prompt, { search = false } = {}) {
  const key = getAiKey();
  if (!key) throw new Error('Yapay zekâ anahtarı yok');

  const p = detectProvider(key);
  let lastErr = null;

  for (const model of p.models) {
    try {
      return p.kind === 'gemini'
        ? { ...await deviceGemini(key, model, prompt, search && !!p.search), provider: p.label }
        : { ...await deviceOpenAI(p, key, model, prompt), provider: p.label };
    } catch (e) {
      lastErr = e;
      if (e.olu) break;              // anahtarın kendisi sorunlu: diğer modeller boşuna
    }
  }
  throw lastErr || new Error('Yapay zekâya ulaşılamadı');
}

/* ---------------- dışa açık ---------------- */

/**
 * Değerlendirme ya da soru-cevap ister.
 * @param {{mode:'assess'|'ask', question?:string, summary:object, search?:boolean,
 *          devicePrompt:string}} opts
 *   devicePrompt: sunucu yoksa cihaz yolunda kullanılacak hazır istem
 * @returns {Promise<{text:string, sources:Array, via:'sunucu'|'cihaz',
 *                    provider?:string, remaining?:number}>}
 */
export async function ask({ mode = 'assess', question = '', summary = {}, search = false, devicePrompt = '' }) {
  let sunucuHatasi = null;

  if (aiServerReady()) {
    try {
      const out = await askServer({ mode, question, summary, search });
      return { ...out, via: 'sunucu' };
    } catch (e) {
      sunucuHatasi = e;
      // Cihaz anahtarı yoksa düşülecek yer yok: nedeni açıkça söyle.
      if (!hasAiKey()) throw e.code === 'sunucu-yok' ? new Error(SETUP_HINT) : e;
      // Anahtar varsa sessizce cihaz yoluna düş
    }
  } else if (aiAllOut() && !hasAiKey()) {
    throw tukendiHatasi();
  }

  if (!hasAiKey()) throw sunucuHatasi || new Error(SETUP_HINT);

  try {
    const out = await askDevice(devicePrompt || question, { search });
    return { ...out, via: 'cihaz' };
  } catch (e) {
    // Hem sunucu zinciri hem cihaz anahtarı bitti — tek ve net mesaj ver.
    if (sunucuHatasi?.code === 'tumu-tukendi' || aiAllOut()) {
      const son = tukendiHatasi(sunucuHatasi?.contact);
      son.message += ` (Cihaz anahtarın da yanıt vermedi: ${e.message})`;
      throw son;
    }
    throw e;
  }
}
