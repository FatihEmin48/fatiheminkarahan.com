/* social.js — arkadaşlar ve sıralama.
 *
 * Sunucu tarafı (db/schema-social.sql) kurulu değilse her çağrı `KURULU_DEGIL`
 * hatası verir; arayüz bunu yakalayıp ne yapılması gerektiğini söyler.
 * Sessizce boş liste göstermek, yapay zekâ özelliğinde olduğu gibi, sorunu
 * saklıyor ve kullanıcıyı yanıltıyor.
 */

import { api } from './core/core-api.js';

export const NOT_INSTALLED = 'KURULU_DEGIL';

export const PERIODS = [
  { id: 'week', label: 'Hafta' },
  { id: 'month', label: 'Ay' },
  { id: 'year', label: 'Yıl' },
];

/** Sunucu tarafının eksik olduğunu anlatan hatalar tek yerde ayıklanır. */
function wrap(e) {
  const msg = String(e?.message || e || '');
  const code = e?.status || e?.code;
  if (code === 404 || /could not find the function|does not exist|schema cache/i.test(msg)) {
    const err = new Error(NOT_INSTALLED);
    err.cause = e;
    return err;
  }
  return e instanceof Error ? e : new Error(msg);
}

async function call(fn, args = {}) {
  try {
    return await api.rpc(fn, args);
  } catch (e) {
    throw wrap(e);
  }
}

export const isNotInstalled = (e) => String(e?.message) === NOT_INSTALLED;

/* ------------------------------------------------------------- arkadaşlar */

/** Arkadaş kodu ya da kullanıcı adıyla arar. Bulamazsa null. */
export async function findUser(query) {
  const q = String(query || '').trim();
  if (q.length < 2) throw new Error('En az 2 karakter yaz.');
  const rows = await call('sp_find_user', { p_q: q });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

const REQUEST_MESSAGE = {
  'gonderildi': 'İstek gönderildi.',
  'kabul-edildi': 'Karşı taraf da seni eklemişti — artık arkadaşsınız.',
  'zaten-arkadas': 'Zaten arkadaşsınız.',
  'zaten-gonderildi': 'İstek zaten gönderilmiş, yanıt bekleniyor.',
};

export async function sendRequest(userId) {
  const result = await call('sp_friend_request', { p_target: userId });
  const key = typeof result === 'string' ? result : result?.[0] || '';
  return { code: key, message: REQUEST_MESSAGE[key] || 'İstek işlendi.' };
}

export async function respondRequest(friendshipId, accept) {
  return call('sp_friend_respond', { p_id: friendshipId, p_accept: !!accept });
}

export async function removeFriend(userId) {
  return call('sp_friend_remove', { p_other: userId });
}

/** { arkadaslar, gelen, giden } — her biri dönem toplamıyla. */
export async function friends(period = 'week', ref = todayIso()) {
  const rows = await call('sp_friends', { p_period: period, p_ref: ref });
  const out = { arkadaslar: [], gelen: [], giden: [] };
  for (const r of rows || []) {
    const item = {
      friendshipId: r.friendship_id,
      userId: r.user_id,
      username: r.username,
      name: r.name,
      total: Number(r.total || 0),
      days: Number(r.days || 0),
    };
    if (r.yon === 'arkadas') out.arkadaslar.push(item);
    else if (r.yon === 'gelen') out.gelen.push(item);
    else out.giden.push(item);
  }
  out.arkadaslar.sort((a, b) => b.total - a.total);
  return out;
}

/** Arkadaşın günlük aktivitesi (yalnız aktivite; kilo paylaşılmaz). */
export async function friendActivity(userId, from, to) {
  const rows = await call('sp_friend_activity', {
    p_friend: userId, p_from: from, p_to: to,
  });
  return (rows || []).map((r) => ({
    day: r.day,
    steps: Number(r.steps || 0),
    distanceKm: Number(r.distance_km || 0),
    activeKcal: Number(r.active_kcal || 0),
    exerciseMin: Number(r.exercise_min || 0),
  }));
}

/* --------------------------------------------------------------- sıralama */

export async function leaderboard(period = 'week', ref = todayIso()) {
  const rows = await call('sp_leaderboard', { p_period: period, p_ref: ref });
  return (rows || []).map((r) => ({
    rank: Number(r.sira),
    userId: r.user_id,
    name: r.name,
    total: Number(r.total || 0),
    days: Number(r.days || 0),
    isMe: !!r.is_me,
  }));
}

export async function joinLeaderboard(displayName) {
  const name = String(displayName || '').trim();
  if (name.length < 2 || name.length > 24) {
    throw new Error('Görünecek ad 2–24 karakter olmalı.');
  }
  return call('sp_leaderboard_join', { p_name: name });
}

export async function leaveLeaderboard() {
  return call('sp_leaderboard_leave');
}

/* ------------------------------------------------------------- yardımcılar */

export function todayIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Dönemin ilk günü — sunucudaki date_trunc ile aynı kural (hafta pazartesi). */
export function periodStart(period, ref = new Date()) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (period === 'week') {
    const dow = (d.getDay() + 6) % 7;           // 0 = pazartesi
    d.setDate(d.getDate() - dow);
  } else if (period === 'month') {
    d.setDate(1);
  } else {
    d.setMonth(0, 1);
  }
  return todayIso(d);
}

export function periodLabel(period) {
  return PERIODS.find((p) => p.id === period)?.label || 'Hafta';
}

/** Karşılaştırma metni: "3.400 adım öndesin" gibi. */
export function compareText(mine, theirs) {
  const diff = mine - theirs;
  const n = Math.abs(diff).toLocaleString('tr-TR');
  if (diff > 0) return `${n} adım öndesin`;
  if (diff < 0) return `${n} adım geridesin`;
  return 'Berabersiniz';
}
