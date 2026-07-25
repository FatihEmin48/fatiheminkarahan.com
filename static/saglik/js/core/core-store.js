/* OTOMATİK KOPYA — kaynak: shared/core-store.js. Elle düzenleme, shared/ içindekini düzenle. */
/* core-store.js — çevrimdışı öncelikli yerel depo + Supabase eşitlemesi.
   Kural: yerelde "kirli" (henüz gönderilmemiş) kayıt sunucudan gelene yenilmez. */

import { dayKey, today, shiftDay, isValidKey } from './core-util.js';

const KEY = 'saglik-panel/v1';
const SCHEMA = 1;

export const DEFAULT_PROFILE = {
  username: '',
  reminder_time: '21:00',
  weigh_day: 1,
  weigh_time: '08:00',
  height_cm: null,
  target_weight: null,
  step_goal: 8000,
  kcal_goal: 500,
  exercise_goal: 30,
  ingest_token: null,
};

function fresh() {
  return {
    schema: SCHEMA,
    createdAt: new Date().toISOString(),
    onboarded: false,
    theme: 'dark',
    profile: { ...DEFAULT_PROFILE },
    days: {},        // 'YYYY-MM-DD' → {steps, distance_km, active_kcal, exercise_min, stand_hours, note, source}
    weights: {},     // 'YYYY-MM-DD' → {kg, body_fat, note, source, photo_path}
    dirty: { days: {}, weights: {}, profile: false },
    lastSync: null,
    lastPromptDay: null,   // günlük soru en son hangi gün gösterildi
  };
}

export let state = fresh();

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function emit(reason = '') {
  for (const fn of listeners) { try { fn(reason); } catch (e) { console.error(e); } }
}

const ACT_FIELDS = ['steps', 'distance_km', 'active_kcal', 'exercise_min', 'stand_hours',
  'resting_kcal', 'note', 'source'];
const W_FIELDS = ['kg', 'body_fat', 'muscle_kg', 'note', 'source', 'photo_path'];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

function migrate(raw) {
  const base = fresh();
  if (!raw || typeof raw !== 'object') return base;
  const s = {
    ...base,
    ...raw,
    profile: { ...base.profile, ...(raw.profile || {}) },
    days: raw.days && typeof raw.days === 'object' ? raw.days : {},
    weights: raw.weights && typeof raw.weights === 'object' ? raw.weights : {},
    dirty: {
      days: raw.dirty?.days || {},
      weights: raw.dirty?.weights || {},
      profile: !!raw.dirty?.profile,
    },
  };
  s.schema = SCHEMA;
  for (const k of Object.keys(s.days)) if (!isValidKey(k)) delete s.days[k];
  for (const k of Object.keys(s.weights)) if (!isValidKey(k)) delete s.weights[k];
  return s;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? migrate(JSON.parse(raw)) : fresh();
  } catch (e) {
    console.warn('yerel veri okunamadı', e);
    state = fresh();
  }
  return state;
}

let timer = null;
export function save({ now = false } = {}) {
  if (now) { clearTimeout(timer); timer = null; write(); return; }
  if (timer) return;
  timer = setTimeout(() => { timer = null; write(); }, 200);
}

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {
    console.warn('yerel veri yazılamadı', e);
  }
}

export function commit(reason = '') { save(); emit(reason); }

/* ---------------- okuma ---------------- */

export const getDay = (key = today()) => state.days[key] || null;
export const getWeight = (key) => state.weights[key] || null;
export const profile = () => state.profile;

export function hasDayData(key = today()) {
  const d = state.days[key];
  if (!d) return false;
  return ['steps', 'distance_km', 'active_kcal', 'exercise_min', 'stand_hours']
    .some((f) => d[f] != null);
}

/* ---------------- yazma ---------------- */

export function setDay(key, patch, { source = 'manual', dirty = true } = {}) {
  if (!isValidKey(key)) return null;
  const cur = state.days[key] || {};
  const next = { ...cur, ...pick(patch, ACT_FIELDS) };
  if (patch.source === undefined) next.source = source;
  next.updated_at = new Date().toISOString();
  state.days[key] = next;
  if (dirty) state.dirty.days[key] = true;
  commit('day:' + key);
  return next;
}

export function clearDayField(key, field) {
  const rec = state.days[key];
  if (!rec) return;
  rec[field] = null;
  state.dirty.days[key] = true;
  commit('day:' + key);
}

export function setWeight(key, patch, { source = 'manual', dirty = true } = {}) {
  if (!isValidKey(key)) return null;
  const cur = state.weights[key] || {};
  const next = { ...cur, ...pick(patch, W_FIELDS) };
  if (patch.source === undefined) next.source = source;
  next.updated_at = new Date().toISOString();
  state.weights[key] = next;
  if (dirty) state.dirty.weights[key] = true;
  commit('weight:' + key);
  return next;
}

export function removeWeight(key) {
  if (!state.weights[key]) return;
  delete state.weights[key];
  delete state.dirty.weights[key];
  commit('weight-remove');
}

/* ---------------- ölçüm çakışması (aynı güne ikinci görsel) ----------------
   Adım, mesafe, kalori, egzersiz ve ayakta saati gün içinde yalnız ARTAR.
   Bu yüzden yeni okunan değer kayıtlıdan büyükse sessizce güncellenir;
   küçükse büyük olasılıkla yanlış (ör. dünün) ekran görüntüsü yüklenmiştir →
   karar kullanıcıya bırakılır. */

export const CUMULATIVE_FIELDS = ['steps', 'distance_km', 'active_kcal', 'exercise_min', 'stand_hours'];

export const FIELD_LABELS = {
  steps: 'Adım',
  distance_km: 'Mesafe',
  active_kcal: 'Kalori',
  exercise_min: 'Egzersiz',
  stand_hours: 'Ayakta',
};

const numOf = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** Ölçüm hatası/yuvarlama payı: %0,5'ten küçük düşüşler çakışma sayılmaz. */
const TOLERANCE = 0.995;

/**
 * Yeni ölçümü kayıtlıyla karşılaştırır.
 * @returns null (çakışma yok) | {day, lower:[{field,label,old,next}], higher:[...], incoming}
 */
export function measureConflict(key, incoming) {
  const cur = state.days[key];
  if (!cur) return null;
  const lower = [];
  const higher = [];
  for (const f of CUMULATIVE_FIELDS) {
    const a = numOf(cur[f]);
    const b = numOf(incoming[f]);
    if (a == null || b == null) continue;
    const row = { field: f, label: FIELD_LABELS[f] || f, old: a, next: b };
    if (b < a * TOLERANCE) lower.push(row);
    else if (b > a) higher.push(row);
  }
  return lower.length ? { day: key, lower, higher, incoming: { ...incoming } } : null;
}

/**
 * Ölçümü uygular. Düşen değer varsa uygulamaz, çakışmayı döndürür.
 * mode: 'replace' (gelen değerler) | 'max' (her alanın büyüğü) | 'keep' (kayıtlı kalsın)
 */
export function applyMeasurement(key, incoming, { source = 'screenshot', mode = null } = {}) {
  if (mode === 'keep') return { applied: false, kept: true };

  if (mode === 'max') {
    const cur = state.days[key] || {};
    const merged = { ...incoming };
    for (const f of CUMULATIVE_FIELDS) {
      const a = numOf(cur[f]);
      const b = numOf(incoming[f]);
      if (a != null && b != null) merged[f] = Math.max(a, b);
      else if (a != null && b == null) delete merged[f];
    }
    setDay(key, merged, { source });
    return { applied: true, mode: 'max' };
  }

  const conflict = mode === 'replace' ? null : measureConflict(key, incoming);
  if (conflict) return { applied: false, conflict };

  setDay(key, incoming, { source });
  return { applied: true };
}

export function setProfile(patch, { dirty = true } = {}) {
  state.profile = { ...state.profile, ...patch };
  if (dirty) state.dirty.profile = true;
  commit('profile');
  return state.profile;
}

export function setTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  commit('theme');
}

export function markOnboarded() {
  state.onboarded = true;
  save({ now: true });
}

export function markPrompted(key = today()) {
  state.lastPromptDay = key;
  save();
}

export const dirtyCount = () =>
  Object.keys(state.dirty.days).length
  + Object.keys(state.dirty.weights).length
  + (state.dirty.profile ? 1 : 0);

/* ---------------- eşitleme ---------------- */

/** Yerel kirli kayıtları sunucuya gönder. */
export async function push(api) {
  if (!api?.isLoggedIn()) return { pushed: 0, skipped: true };
  const uid = api.userId;
  let pushed = 0;

  const dayKeys = Object.keys(state.dirty.days);
  if (dayKeys.length) {
    const rows = dayKeys.map((k) => ({
      user_id: uid,
      day: k,
      ...pick(state.days[k] || {}, ACT_FIELDS),
    }));
    await api.upsert('sp_daily_activity', rows, { onConflict: 'user_id,day' });
    for (const k of dayKeys) delete state.dirty.days[k];
    pushed += rows.length;
  }

  const wKeys = Object.keys(state.dirty.weights);
  if (wKeys.length) {
    const rows = wKeys.map((k) => ({
      user_id: uid,
      day: k,
      ...pick(state.weights[k] || {}, W_FIELDS),
    })).filter((r) => r.kg != null);
    if (rows.length) await api.upsert('sp_weight_entries', rows, { onConflict: 'user_id,day' });
    for (const k of wKeys) delete state.dirty.weights[k];
    pushed += rows.length;
  }

  if (state.dirty.profile) {
    const p = state.profile;
    await api.saveProfile({
      username: p.username || undefined,
      reminder_time: p.reminder_time,
      weigh_day: p.weigh_day,
      weigh_time: p.weigh_time,
      height_cm: p.height_cm,
      target_weight: p.target_weight,
      step_goal: p.step_goal,
      kcal_goal: p.kcal_goal,
      exercise_goal: p.exercise_goal,
    });
    state.dirty.profile = false;
    pushed++;
  }

  save({ now: true });
  return { pushed };
}

/** Sunucudaki kayıtları çek; kirli olmayan yerel kayıtların üzerine yaz. */
export async function pull(api, { days = 400 } = {}) {
  if (!api?.isLoggedIn()) return { pulled: 0, skipped: true };
  const from = shiftDay(today(), -days);
  let pulled = 0;

  const acts = await api.select('sp_daily_activity',
    `select=*&day=gte.${from}&order=day.desc&limit=1000`);
  for (const row of acts || []) {
    if (state.dirty.days[row.day]) continue;
    state.days[row.day] = pick(row, [...ACT_FIELDS, 'updated_at']);
    pulled++;
  }

  const weights = await api.select('sp_weight_entries',
    `select=*&order=day.desc&limit=1000`);
  for (const row of weights || []) {
    if (state.dirty.weights[row.day]) continue;
    state.weights[row.day] = pick(row, [...W_FIELDS, 'updated_at']);
    pulled++;
  }

  const prof = await api.ensureProfile(state.profile.username || null);
  if (prof && !state.dirty.profile) {
    state.profile = {
      ...state.profile,
      username: prof.username,
      reminder_time: (prof.reminder_time || '21:00').slice(0, 5),
      weigh_day: prof.weigh_day,
      weigh_time: (prof.weigh_time || '08:00').slice(0, 5),
      height_cm: prof.height_cm,
      target_weight: prof.target_weight == null ? null : Number(prof.target_weight),
      step_goal: prof.step_goal,
      kcal_goal: prof.kcal_goal,
      exercise_goal: prof.exercise_goal,
      ingest_token: prof.ingest_token,
    };
  }

  state.lastSync = new Date().toISOString();
  save({ now: true });
  emit('sync');
  return { pulled };
}

export async function sync(api, opts = {}) {
  const p = await push(api);
  const q = await pull(api, opts);
  return { ...p, ...q };
}

/* ---------------- dışa aktarma ---------------- */

export function exportJSON() {
  return JSON.stringify({
    app: 'saglik-panel',
    exportedAt: new Date().toISOString(),
    data: state,
  }, null, 2);
}

export function exportCSV() {
  const keys = Object.keys(state.days).sort();
  const head = 'tarih,adim,mesafe_km,aktif_kcal,egzersiz_dk,ayakta_sa,kilo_kg,kaynak,not';
  const lines = [head];
  for (const k of keys) {
    const d = state.days[k] || {};
    const w = state.weights[k] || {};
    lines.push([
      k,
      d.steps ?? '',
      d.distance_km ?? '',
      d.active_kcal ?? '',
      d.exercise_min ?? '',
      d.stand_hours ?? '',
      w.kg ?? '',
      d.source ?? '',
      (d.note || '').replace(/[\n,;]/g, ' '),
    ].join(','));
  }
  return lines.join('\n');
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  const raw = parsed?.data && parsed?.app === 'saglik-panel' ? parsed.data : parsed;
  if (!raw || typeof raw !== 'object' || !raw.days) throw new Error('Tanınmayan yedek');
  const inc = migrate(raw);
  let added = 0;
  for (const [k, v] of Object.entries(inc.days)) {
    if (!state.days[k]) { state.days[k] = v; state.dirty.days[k] = true; added++; }
  }
  for (const [k, v] of Object.entries(inc.weights)) {
    if (!state.weights[k]) { state.weights[k] = v; state.dirty.weights[k] = true; added++; }
  }
  save({ now: true });
  emit('import');
  return added;
}

export function resetLocal() {
  state = fresh();
  state.onboarded = true;
  save({ now: true });
  emit('reset');
}

/** Test/geliştirme: örnek veri üret. */
export function seedDemo(days = 60) {
  const startKg = 84;
  for (let i = days; i >= 0; i--) {
    const k = shiftDay(today(), -i);
    const base = 6500 + Math.round(Math.sin(i / 3) * 1800 + Math.random() * 2500);
    state.days[k] = {
      steps: base,
      distance_km: Number((base * 0.00072).toFixed(2)),
      active_kcal: 260 + Math.round(base / 30),
      exercise_min: Math.max(0, Math.round(base / 380) - 8),
      stand_hours: 8 + (i % 5),
      source: 'import',
    };
    if (i % 7 === 0) {
      state.weights[k] = {
        kg: Number((startKg - (days - i) * 0.055 + (Math.random() - 0.5) * 0.4).toFixed(1)),
        source: 'import',
      };
    }
  }
  save({ now: true });
  emit('seed');
}
