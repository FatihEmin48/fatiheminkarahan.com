/* ai.js — isteğe bağlı yapay zekâ değerlendirmesi (Google Gemini, ücretsiz katman).
 *
 * Anahtar kullanıcının kendi cihazında saklanır, hiçbir sunucumuza gitmez.
 * Anahtar yoksa uygulama kural tabanlı değerlendirmeyi gösterir; AI zorunlu değildir.
 * Ücretsiz anahtar: https://aistudio.google.com/apikey
 */

const KEY_STORE = 'saglik-panel/ai-key';
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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

function humanizeAiError(status, body) {
  const msg = String(body?.error?.message || '');
  if (status === 400 && /API key not valid/i.test(msg)) return 'Anahtar geçersiz görünüyor.';
  if (status === 403) return 'Anahtar bu istek için yetkili değil.';
  if (status === 429) return 'Ücretsiz kotayı doldurdun; bir süre sonra tekrar dene.';
  if (status >= 500) return 'Servis şu an yanıt vermiyor, sonra dene.';
  return msg || `İstek başarısız (${status}).`;
}

/**
 * Metni modele gönderir, yanıtı döndürür.
 * @param {string} prompt
 * @param {{signal?:AbortSignal}} opts
 */
export async function askAi(prompt, { signal } = {}) {
  const key = getAiKey();
  if (!key) throw new Error('Yapay zekâ anahtarı ayarlanmamış');

  let lastErr = null;
  for (const model of MODELS) {
    try {
      const res = await fetch(`${BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        lastErr = new Error(humanizeAiError(res.status, data));
        // model bulunamadıysa bir sonrakini dene, diğer hatalarda dur
        if (res.status === 404) continue;
        throw lastErr;
      }
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      if (!text.trim()) throw new Error('Model boş yanıt verdi');
      return text.trim();
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') throw e;
    }
  }
  throw lastErr || new Error('Yapay zekâya ulaşılamadı');
}

/** Anahtarı kısa bir istekle sınar. */
export async function testAiKey(key) {
  const prev = getAiKey();
  try {
    setAiKey(key);
    const out = await askAi('Yalnızca "tamam" yaz.');
    return { ok: true, sample: out.slice(0, 40) };
  } catch (e) {
    if (prev) setAiKey(prev); else clearAiKey();
    return { ok: false, error: e.message };
  }
}
