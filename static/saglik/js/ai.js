/* ai.js — yapay zekâ değerlendirmesi ve soru-cevap.
 *
 * İki yol var, sırayla denenir:
 *   1) SUNUCU (önerilen): Supabase Edge Function "ai". Anahtar sunucuda durur,
 *      kullanıcı hiçbir şey girmez. Kişi başı günlük sınır uygulanır.
 *   2) CİHAZ: kullanıcı kendi ücretsiz anahtarını girmişse doğrudan Gemini'ye gider.
 * İkisi de yoksa çağıran taraf kurallara dayalı (yerel) değerlendirmeye düşer.
 */

import { CONFIG } from './core/config.js';
import { api } from './core/core-api.js';

const KEY_STORE = 'saglik-panel/ai-key';
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/* ---------------- cihazdaki anahtar (isteğe bağlı) ---------------- */

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

/** Sunucu yolu kullanılabilir mi? (bulut ayarlı + giriş yapılmış) */
export const hasAiServer = () => !!(CONFIG.url && api.isLoggedIn());

/** Herhangi bir yolla yapay zekâ kullanılabilir mi? */
export const aiAvailable = () => hasAiServer() || hasAiKey();

let serverDown = false;   // fonksiyon yayınlanmamışsa boşuna denemeyelim
export const aiServerReady = () => hasAiServer() && !serverDown;

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

  if (res.status === 404 || res.status === 501) {
    serverDown = true;                       // fonksiyon yok ya da anahtar tanımsız
    throw new Error('sunucu-yok');
  }
  if (!res.ok) throw new Error(data?.error || `Sunucu hatası (${res.status})`);
  return { text: String(data.text || '').trim(), sources: data.sources || [], remaining: data.remaining };
}

/* ---------------- cihaz yolu ---------------- */

function humanizeAiError(status, body) {
  const msg = String(body?.error?.message || '');
  if (status === 400 && /API key not valid/i.test(msg)) return 'Anahtar geçersiz görünüyor.';
  if (status === 403) return 'Anahtar bu istek için yetkili değil.';
  if (status === 429) return 'Ücretsiz kotayı doldurdun; bir süre sonra tekrar dene.';
  if (status >= 500) return 'Servis şu an yanıt vermiyor, sonra dene.';
  return msg || `İstek başarısız (${status}).`;
}

async function askDevice(prompt, { search = false } = {}) {
  const key = getAiKey();
  if (!key) throw new Error('Yapay zekâ anahtarı yok');

  let lastErr = null;
  for (const model of MODELS) {
    for (const withTools of search ? [true, false] : [false]) {
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 900 },
      };
      if (withTools) body.tools = [{ google_search: {} }];

      let res;
      try {
        res = await fetch(`${BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        lastErr = new Error('İnternet bağlantısı yok gibi');
        continue;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) { lastErr = new Error(humanizeAiError(res.status, data)); continue; }

      const cand = data?.candidates?.[0];
      const text = cand?.content?.parts?.map((p) => p.text || '').join('') || '';
      const chunks = cand?.groundingMetadata?.groundingChunks || [];
      const sources = chunks.map((c) => c.web).filter(Boolean).slice(0, 5)
        .map((w) => ({ title: w.title || w.uri, uri: w.uri }));
      if (text.trim()) return { text: text.trim(), sources };
      lastErr = new Error('Model boş yanıt verdi');
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
 * @returns {Promise<{text:string, sources:Array, via:'sunucu'|'cihaz', remaining?:number}>}
 */
export async function ask({ mode = 'assess', question = '', summary = {}, search = false, devicePrompt = '' }) {
  if (aiServerReady()) {
    try {
      const out = await askServer({ mode, question, summary, search });
      return { ...out, via: 'sunucu' };
    } catch (e) {
      if (e.message !== 'sunucu-yok' && !hasAiKey()) throw e;   // gerçek hata: bildir
      // sunucu yoksa cihaz anahtarına düş
    }
  }
  const out = await askDevice(devicePrompt || question, { search });
  return { ...out, via: 'cihaz' };
}
