/* OTOMATİK KOPYA — kaynak: shared/core-workout.js. Elle düzenleme, shared/ içindekini düzenle. */
/* core-workout.js — antrenman: sözlükler, hesaplar (hacim, 1TM tahmini, rekorlar), geçmiş,
   haftalık ve dönemlik özetler, hazır programlar.
   Saf fonksiyonlar; DOM ve ağ yok. Web, Android, dışa aktarma ve testler aynı dosyayı kullanır.

   Veri modeli (yerelde state.workouts[id], bulutta sp_workouts.data):
   workout = { id, name, started_at, ended_at, day, routine_id, note, items: [item], updated_at }
   item    = { ex, name, measure, muscles, muscles2, cat, rest, target, note, sets: [set] }
   set     = { kg, reps, sec, km, done, type }      type: 'n' normal · 'w' ısınma · 'd' drop · 'f' tükeniş
   measure = 'agirlik' (kg × tekrar) · 'tekrar' (vücut ağırlığı, isteğe bağlı +kg) · 'sure' (sn) · 'kardiyo' (sn + km)
   name/muscles/cat hareketin o anki kopyasıdır: kütüphane değişse de geçmiş okunabilir kalır. */

import { dayKey, shiftDay, weekStart, daysBetween, today, nf } from './core-util.js';

/* ---------------- sözlükler ---------------- */

export const KATEGORI = [
  { id: 'gogus', ad: 'Göğüs' },
  { id: 'sirt', ad: 'Sırt' },
  { id: 'omuz', ad: 'Omuz' },
  { id: 'kol', ad: 'Kol' },
  { id: 'bacak', ad: 'Bacak & kalça' },
  { id: 'karin', ad: 'Karın & core' },
  { id: 'kardiyo', ad: 'Kardiyo' },
  { id: 'esneme', ad: 'Esneme' },
];
export const KATEGORI_AD = Object.fromEntries(KATEGORI.map((k) => [k.id, k.ad]));

export const EKIPMAN = {
  vucut: 'Vücut ağırlığı',
  halter: 'Halter',
  dambil: 'Dambıl',
  ez: 'EZ bar',
  kablo: 'Kablo',
  makine: 'Makine',
  kettlebell: 'Kettlebell',
  bant: 'Direnç bandı',
  barfiks: 'Barfiks barı',
  sehpa: 'Sehpa',
  top: 'Top',
  rulo: 'Köpük rulo',
  ip: 'Atlama ipi',
  kardiyo: 'Kardiyo makinesi',
  tekerlek: 'Karın tekerleği',
};

export const KAS = {
  gogus: 'Göğüs',
  omuz: 'Omuz',
  arka_omuz: 'Arka omuz',
  biseps: 'Pazı (biseps)',
  triseps: 'Arka kol (triseps)',
  onkol: 'Ön kol',
  karin: 'Karın',
  oblik: 'Yan karın',
  trapez: 'Trapez',
  kanat: 'Kanat (latissimus)',
  orta_sirt: 'Orta sırt',
  bel: 'Bel',
  kalca: 'Kalça',
  on_bacak: 'Ön bacak',
  arka_bacak: 'Arka bacak',
  baldir: 'Baldır',
  ic_bacak: 'İç bacak',
  dis_kalca: 'Dış kalça',
  boyun: 'Boyun',
};

/** Kasın bağlı olduğu kas grubu (haftalık denge özetinde kullanılır). */
export const KAS_GRUP = {
  gogus: 'gogus',
  kanat: 'sirt', orta_sirt: 'sirt', bel: 'sirt', trapez: 'sirt',
  omuz: 'omuz', arka_omuz: 'omuz',
  biseps: 'kol', triseps: 'kol', onkol: 'kol',
  on_bacak: 'bacak', arka_bacak: 'bacak', kalca: 'bacak', baldir: 'bacak', ic_bacak: 'bacak', dis_kalca: 'bacak',
  karin: 'karin', oblik: 'karin',
  boyun: 'omuz',
};
export const GRUPLAR = ['gogus', 'sirt', 'omuz', 'kol', 'bacak', 'karin'];

export const OLCU = {
  agirlik: 'Ağırlık × tekrar',
  tekrar: 'Tekrar',
  sure: 'Süre',
  kardiyo: 'Süre + mesafe',
};

export const SEVIYE = { 1: 'Başlangıç', 2: 'Orta', 3: 'İleri' };

export const SET_TIP = { n: 'Normal', w: 'Isınma', d: 'Drop set', f: 'Tükeniş' };

/* ---------------- küçük yardımcılar ---------------- */

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** RFC 4122 v4 kimlik (sp_workouts.id uuid). */
export function uuid() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const isWarmup = (s) => s?.type === 'w';
/** Sayılan setler: tamamlanmış ve ısınma olmayan. */
export const workSets = (item) => (item?.sets || []).filter((s) => s.done && !isWarmup(s));

/**
 * Tahmini 1 tekrar maksimum (Epley). 15 tekrardan sonrası güvenilir olmadığı için hesaplanmaz.
 */
export function e1rm(kg, reps) {
  const w = num(kg);
  const r = num(reps);
  if (!(w > 0) || !(r > 0) || r > 15) return null;
  if (r === 1) return w;
  return Math.round(w * (1 + r / 30) * 10) / 10;
}

/** Setin hacmi (kg × tekrar). Vücut ağırlığı hareketinde yalnız eklenen ağırlık sayılır. */
export function setVolume(s, measure = 'agirlik') {
  if (!s?.done || isWarmup(s)) return 0;
  if (measure !== 'agirlik' && measure !== 'tekrar') return 0;
  const kg = num(s.kg);
  const reps = num(s.reps);
  return kg > 0 && reps > 0 ? kg * reps : 0;
}

/** Bir setin okunur hali: "60 kg × 8", "12 tekrar", "45 sn", "20 dk · 3,2 km". */
export function fmtSet(s, measure = 'agirlik') {
  if (!s) return '';
  const kg = num(s.kg);
  const reps = num(s.reps);
  const sec = num(s.sec);
  const km = num(s.km);
  if (measure === 'sure') return sec != null ? fmtDur(sec) : '';
  if (measure === 'kardiyo') {
    const parts = [];
    if (sec != null) parts.push(fmtDur(sec));
    if (km != null) parts.push(`${nf(km, km % 1 ? 2 : 0)} km`);
    return parts.join(' · ');
  }
  if (measure === 'tekrar') {
    if (reps == null) return '';
    return kg > 0 ? `+${nf(kg, kg % 1 ? 1 : 0)} kg × ${reps}` : `${reps} tekrar`;
  }
  if (kg == null && reps == null) return '';
  return `${kg == null ? '—' : nf(kg, kg % 1 ? 1 : 0)} kg × ${reps ?? '—'}`;
}

/** 75 → "1:15", 3600 → "60 dk", 45 → "45 sn" */
export function fmtDur(sec) {
  const s = Math.round(num(sec) || 0);
  if (s < 60) return `${s} sn`;
  if (s % 60 === 0) return `${s / 60} dk`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Antrenman süresi (dakika); bitmemişse şimdiye kadar. */
export function durationMin(w, now = Date.now()) {
  const a = Date.parse(w?.started_at);
  const b = w?.ended_at ? Date.parse(w.ended_at) : now;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 60000);
}

/* ---------------- özetler ---------------- */

/** Bir hareketin bu antrenmandaki özeti. */
export function itemSummary(item) {
  const m = item?.measure || 'agirlik';
  const sets = workSets(item);
  const out = {
    sets: sets.length, reps: 0, volume: 0, sec: 0, km: 0,
    bestE1rm: null, bestKg: null, bestReps: null, bestSec: null,
  };
  for (const s of sets) {
    const reps = num(s.reps);
    const kg = num(s.kg);
    const sec = num(s.sec);
    const km = num(s.km);
    if (reps) out.reps += reps;
    if (sec) out.sec += sec;
    if (km) out.km += km;
    out.volume += setVolume(s, m);
    if (m === 'agirlik') {
      const e = e1rm(kg, reps);
      if (e != null && (out.bestE1rm == null || e > out.bestE1rm)) out.bestE1rm = e;
      if (kg != null && reps && (out.bestKg == null || kg > out.bestKg)) out.bestKg = kg;
    }
    if (reps != null && (out.bestReps == null || reps > out.bestReps)) out.bestReps = reps;
    if (sec != null && (out.bestSec == null || sec > out.bestSec)) out.bestSec = sec;
  }
  out.volume = Math.round(out.volume * 10) / 10;
  out.km = Math.round(out.km * 100) / 100;
  return out;
}

/**
 * Kas başına çalışılan set: ana kas 1, yardımcı kas 0,5 set sayılır (yaygın hacim sayımı).
 * @returns {muscles:{kas:set}, groups:{grup:set}}
 */
export function muscleSets(items) {
  const muscles = {};
  const groups = {};
  const add = (k, v) => {
    muscles[k] = (muscles[k] || 0) + v;
    const g = KAS_GRUP[k];
    if (g) groups[g] = (groups[g] || 0) + v;
  };
  for (const it of items || []) {
    const n = workSets(it).length;
    if (!n) continue;
    for (const k of it.muscles || []) add(k, n);
    for (const k of it.muscles2 || []) add(k, n * 0.5);
  }
  return { muscles, groups };
}

/** Antrenmanın özeti: süre, set, tekrar, hacim, kas dağılımı. */
export function workoutSummary(w, now = Date.now()) {
  const out = { minutes: durationMin(w, now), sets: 0, reps: 0, volume: 0, km: 0, cardioSec: 0, exercises: 0 };
  for (const it of w?.items || []) {
    const s = itemSummary(it);
    if (s.sets) out.exercises++;
    out.sets += s.sets;
    out.reps += s.reps;
    out.volume += s.volume;
    out.km += s.km;
    if (it.measure === 'kardiyo' || it.cat === 'kardiyo') out.cardioSec += s.sec;
  }
  out.volume = Math.round(out.volume);
  out.km = Math.round(out.km * 100) / 100;
  Object.assign(out, muscleSets(w?.items));
  return out;
}

/** Tamamlanmış (bitirilmiş, silinmemiş) antrenmanlar, eskiden yeniye. */
export function finished(workouts) {
  return Object.values(workouts || {})
    .filter((w) => w && !w.deleted && w.ended_at)
    .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
}

/* ---------------- geçmiş ve rekorlar ---------------- */

/** Bir hareketin geçmişi (eskiden yeniye): her antrenman için çalışılan setler ve özet. */
export function exerciseHistory(workouts, exId, { before = null } = {}) {
  const out = [];
  for (const w of finished(workouts)) {
    if (before && String(w.started_at) >= String(before)) continue;
    for (const it of w.items || []) {
      if (String(it.ex) !== String(exId)) continue;
      const sum = itemSummary(it);
      if (!sum.sets) continue;
      // sets: set DİZİSİ (önceki performans için); sayısı setCount’ta
      out.push({ ...sum, setCount: sum.sets, id: w.id, day: w.day, started_at: w.started_at, measure: it.measure, sets: workSets(it) });
    }
  }
  return out;
}

/** Hareketin son yapıldığı antrenmandaki setler (ısınma dahil değil). */
export function lastPerformance(workouts, exId, { excludeId = null, before = null } = {}) {
  const h = exerciseHistory(workouts, exId, { before }).filter((x) => x.id !== excludeId);
  return h.length ? h[h.length - 1] : null;
}

/** Hareketin kişisel rekorları. */
export function records(workouts, exId, opts = {}) {
  const rec = { e1rm: null, kg: null, reps: null, sec: null, volume: null, sessions: 0 };
  const better = (cur, v) => v != null && v > 0 && (cur == null || v > cur.value);
  for (const h of exerciseHistory(workouts, exId, opts)) {
    rec.sessions++;
    if (better(rec.e1rm, h.bestE1rm)) rec.e1rm = { value: h.bestE1rm, day: h.day };
    if (better(rec.kg, h.bestKg)) rec.kg = { value: h.bestKg, day: h.day };
    if (better(rec.reps, h.bestReps)) rec.reps = { value: h.bestReps, day: h.day };
    if (better(rec.sec, h.bestSec)) rec.sec = { value: h.bestSec, day: h.day };
    if (better(rec.volume, h.volume)) rec.volume = { value: h.volume, day: h.day };
  }
  return rec;
}

const PR_LABEL = { e1rm: 'tahmini 1TM', kg: 'en ağır', reps: 'en çok tekrar', sec: 'en uzun süre' };

/**
 * Bu antrenmanda kırılan rekorlar (daha önceki antrenmanlara göre). Hareketi ilk kez
 * yapmak rekor sayılmaz — yoksa her yeni hareket “rekor” olurdu.
 */
export function newRecords(w, workouts) {
  const out = [];
  for (const it of w?.items || []) {
    const sum = itemSummary(it);
    if (!sum.sets) continue;
    const prev = records(workouts, it.ex, { before: w.started_at });
    if (!prev.sessions) continue;
    const m = it.measure || 'agirlik';
    const kinds = m === 'agirlik' ? ['e1rm', 'kg'] : m === 'tekrar' ? ['reps'] : m === 'sure' ? ['sec'] : [];
    for (const k of kinds) {
      const v = k === 'e1rm' ? sum.bestE1rm : k === 'kg' ? sum.bestKg : k === 'reps' ? sum.bestReps : sum.bestSec;
      const p = prev[k]?.value ?? null;
      if (v != null && p != null && v > p) {
        out.push({ ex: it.ex, name: it.name, kind: k, label: PR_LABEL[k], value: v, prev: p });
      }
    }
  }
  return out;
}

/** Rekor kıran hareket sayısı: aynı harekette hem “en ağır” hem “1TM” rekoru bir sayılır. */
export const recordCount = (prs) => new Set((prs || []).map((p) => String(p.ex))).size;

/** Rekorları harekete göre toplar: [{ex, name, items:[rekor]}] */
export function groupRecords(prs) {
  const by = new Map();
  for (const p of prs || []) {
    const k = String(p.ex);
    if (!by.has(k)) by.set(k, { ex: p.ex, name: p.name, items: [] });
    by.get(k).items.push(p);
  }
  return [...by.values()];
}

/* ---------------- haftalık ve dönemlik özet ---------------- */

/** startKey haftasının (Pazartesi) antrenman özeti. */
export function weekSummary(workouts, startKey = weekStart()) {
  const endKey = shiftDay(startKey, 6);
  const list = finished(workouts).filter((w) => w.day >= startKey && w.day <= endKey);
  const out = {
    start: startKey, end: endKey, sessions: list.length, minutes: 0, sets: 0, volume: 0,
    days: [...new Set(list.map((w) => w.day))], groups: {}, muscles: {},
  };
  for (const w of list) {
    const s = workoutSummary(w);
    out.minutes += s.minutes;
    out.sets += s.sets;
    out.volume += s.volume;
    for (const [k, v] of Object.entries(s.groups)) out.groups[k] = (out.groups[k] || 0) + v;
    for (const [k, v] of Object.entries(s.muscles)) out.muscles[k] = (out.muscles[k] || 0) + v;
  }
  return out;
}

/** Üst üste en az bir antrenman yapılan hafta sayısı (bu hafta henüz boşsa geçen haftadan sayılır). */
export function weekStreak(workouts, todayKey = today()) {
  const weeks = new Set(finished(workouts).map((w) => weekStart(w.day)));
  let wk = weekStart(todayKey);
  if (!weeks.has(wk)) wk = shiftDay(wk, -7);
  let n = 0;
  while (weeks.has(wk) && n < 600) { n++; wk = shiftDay(wk, -7); }
  return n;
}

/**
 * Dönem özeti (dışa aktarma ve değerlendirme için).
 * byDay: gün → {count, minutes, sets, volume, names}
 * exercises: en sık yapılan hareketler; ağırlık hareketlerinde ilk ve son tahmini 1TM.
 */
export function periodStats(workouts, from, to) {
  const list = finished(workouts).filter((w) => w.day >= from && w.day <= to);
  const out = {
    sessions: list.length, minutes: 0, sets: 0, volume: 0, km: 0,
    weeks: Math.max(1, Math.round((daysBetween(to, from) + 1) / 7 * 10) / 10),
    groups: {}, muscles: {}, byDay: {}, exercises: [], records: 0,
  };
  const ex = new Map();
  for (const w of list) {
    const s = workoutSummary(w);
    out.minutes += s.minutes;
    out.sets += s.sets;
    out.volume += s.volume;
    out.km += s.km;
    for (const [k, v] of Object.entries(s.groups)) out.groups[k] = (out.groups[k] || 0) + v;
    for (const [k, v] of Object.entries(s.muscles)) out.muscles[k] = (out.muscles[k] || 0) + v;
    const d = out.byDay[w.day] || (out.byDay[w.day] = { count: 0, minutes: 0, sets: 0, volume: 0, names: [] });
    d.count++;
    d.minutes += s.minutes;
    d.sets += s.sets;
    d.volume += s.volume;
    if (w.name) d.names.push(w.name);
    out.records += recordCount(newRecords(w, workouts));
    for (const it of w.items || []) {
      const is = itemSummary(it);
      if (!is.sets) continue;
      const key = String(it.ex);
      const e = ex.get(key) || {
        ex: it.ex, name: it.name, measure: it.measure || 'agirlik', sessions: 0, sets: 0,
        firstDay: w.day, lastDay: w.day, firstE1rm: null, lastE1rm: null, bestE1rm: null, bestKg: null,
        bestReps: null, bestSec: null,
      };
      e.sessions++;
      e.sets += is.sets;
      e.lastDay = w.day;
      if (is.bestE1rm != null) {
        if (e.firstE1rm == null) e.firstE1rm = is.bestE1rm;
        e.lastE1rm = is.bestE1rm;
        e.bestE1rm = Math.max(e.bestE1rm ?? 0, is.bestE1rm);
      }
      if (is.bestKg != null) e.bestKg = Math.max(e.bestKg ?? 0, is.bestKg);
      if (is.bestReps != null) e.bestReps = Math.max(e.bestReps ?? 0, is.bestReps);
      if (is.bestSec != null) e.bestSec = Math.max(e.bestSec ?? 0, is.bestSec);
      ex.set(key, e);
    }
  }
  out.volume = Math.round(out.volume);
  out.km = Math.round(out.km * 100) / 100;
  out.perWeek = Math.round((out.sessions / out.weeks) * 10) / 10;
  out.exercises = [...ex.values()].sort((a, b) => b.sessions - a.sessions || b.sets - a.sets);
  return out;
}

/* ---------------- programlar ---------------- */

/**
 * Hazır programlar. ex: wger hareket kimliği (tools/exercises kataloğunda olmalı — test denetler).
 * reps metin olarak durur: "8–12", "30–45 sn", "en fazla".
 */
export const HAZIR_PROGRAMLAR = [
  {
    id: 'hz-tv-a', name: 'Başlangıç · Tüm vücut A',
    note: 'Haftada 3 gün, A ve B’yi sırayla yap (A-B-A, sonraki hafta B-A-B). Her hafta ağırlığı azar azar artırmaya çalış.',
    items: [
      { ex: 1801, sets: 3, reps: '5–8', rest: 150 },
      { ex: 73, sets: 3, reps: '5–8', rest: 150 },
      { ex: 83, sets: 3, reps: '8–10', rest: 120 },
      { ex: 567, sets: 2, reps: '8–12', rest: 90 },
      { ex: 458, sets: 3, reps: '30–45 sn', rest: 45 },
    ],
  },
  {
    id: 'hz-tv-b', name: 'Başlangıç · Tüm vücut B',
    note: 'A ile dönüşümlü yap. Deadlift’te formun bozulduğu ağırlığa çıkma.',
    items: [
      { ex: 184, sets: 3, reps: '5', rest: 180 },
      { ex: 537, sets: 3, reps: '8–10', rest: 120 },
      { ex: 355, sets: 3, reps: '8–12', rest: 90 },
      { ex: 999, sets: 2, reps: '10 / bacak', rest: 90 },
      { ex: 377, sets: 3, reps: '10–15', rest: 45 },
    ],
  },
  {
    id: 'hz-ev', name: 'Evde · Ekipmansız',
    note: 'Ekipman gerektirmez. Hareketler arasında kısa ara ver; zorlaşınca tekrarı ya da tur sayısını artır.',
    items: [
      { ex: 1208, sets: 3, reps: '15–20', rest: 60 },
      { ex: 1551, sets: 3, reps: 'en fazla', rest: 60 },
      { ex: 999, sets: 3, reps: '10 / bacak', rest: 60 },
      { ex: 2773, sets: 3, reps: '12 / kol', rest: 60 },
      { ex: 265, sets: 3, reps: '15', rest: 45 },
      { ex: 458, sets: 3, reps: '30–45 sn', rest: 45 },
      { ex: 996, sets: 3, reps: '30 sn', rest: 45 },
    ],
  },
  {
    id: 'hz-ev-kardiyo', name: 'Evde · Kardiyo devresi',
    note: 'Ekipman gerektirmez; nabzı yükselten kısa ve yoğun bir devre (~25 dk). Yerinde yürüyüşle ısın. '
      + 'Zorlanırsan Burpee yerine Şınavsız Burpee, Zıplamalı Squat yerine normal squat, Şınav yerine Dizüstü Şınav yap. '
      + 'Alt kattakileri düşünüyorsan Jumping Jack yerine Adımlı Jumping Jack.',
    items: [
      { ex: 1584, sets: 1, reps: '3 dk', rest: 30 },
      { ex: 1314, sets: 3, reps: '40 sn', rest: 20 },
      { ex: 614, sets: 3, reps: '12', rest: 40 },
      { ex: 1551, sets: 3, reps: '8–12', rest: 40 },
      { ex: 996, sets: 3, reps: '30 sn', rest: 30 },
      { ex: 986, sets: 3, reps: '10 / bacak', rest: 40 },
      { ex: 997, sets: 3, reps: '8–10', rest: 60 },
      { ex: 1489, sets: 3, reps: '30 sn', rest: 30 },
      { ex: 1412, sets: 3, reps: '20', rest: 30 },
    ],
  },
  {
    id: 'hz-ev-bacak', name: 'Evde · Bacak, kalça & karın',
    note: 'Ekipman gerektirmez; duvar ve bir paspas yeter. Bacak, kalça ve karın kaslarına odaklanır. '
      + 'Tüm vücut ekipmansız programıyla dönüşümlü yapabilirsin (ör. Pzt tüm vücut, Çar bacak & karın, Cum tüm vücut).',
    items: [
      { ex: 1208, sets: 3, reps: '15–20', rest: 60 },
      { ex: 1366, sets: 3, reps: '10–12 / bacak', rest: 60 },
      { ex: 718, sets: 3, reps: '30–60 sn', rest: 60 },
      { ex: 1740, sets: 3, reps: '10–12 / bacak', rest: 45 },
      { ex: 1823, sets: 2, reps: '15 / taraf', rest: 30 },
      { ex: 1243, sets: 3, reps: '15–20', rest: 30 },
      { ex: 636, sets: 3, reps: '12', rest: 45 },
      { ex: 1772, sets: 3, reps: '12–15', rest: 30 },
      { ex: 297, sets: 3, reps: '20–30 sn', rest: 30 },
    ],
  },
  {
    id: 'hz-dambil', name: 'Dambılla tüm vücut',
    note: 'Bir çift dambıl ve sehpa yeterli. 10–12 tekrarı rahat yapınca ağırlığı artır.',
    items: [
      { ex: 203, sets: 3, reps: '10–12', rest: 90 },
      { ex: 75, sets: 3, reps: '8–12', rest: 90 },
      { ex: 81, sets: 3, reps: '10–12 / kol', rest: 75 },
      { ex: 567, sets: 3, reps: '10–12', rest: 75 },
      { ex: 1652, sets: 3, reps: '10–12', rest: 90 },
      { ex: 92, sets: 2, reps: '12', rest: 60 },
      { ex: 1336, sets: 2, reps: '12', rest: 60 },
    ],
  },
  {
    id: 'hz-itme', name: 'İtme · göğüs, omuz, arka kol',
    note: 'İtme / Çekme / Bacak programının ilk günü.',
    items: [
      { ex: 73, sets: 4, reps: '6–8', rest: 150 },
      { ex: 537, sets: 3, reps: '8–12', rest: 120 },
      { ex: 567, sets: 3, reps: '8–12', rest: 90 },
      { ex: 348, sets: 3, reps: '12–15', rest: 60 },
      { ex: 659, sets: 3, reps: '10–12', rest: 60 },
      { ex: 1519, sets: 2, reps: '10–12', rest: 60 },
    ],
  },
  {
    id: 'hz-cekme', name: 'Çekme · sırt, pazı',
    note: 'İtme / Çekme / Bacak programının ikinci günü. Barfiks yapamıyorsan Lat Pulldown ile değiştir.',
    items: [
      { ex: 475, sets: 3, reps: 'en fazla', rest: 120 },
      { ex: 83, sets: 3, reps: '8–10', rest: 120 },
      { ex: 394, sets: 3, reps: '10–12', rest: 90 },
      { ex: 1732, sets: 3, reps: '15–20', rest: 60 },
      { ex: 91, sets: 3, reps: '8–12', rest: 60 },
      { ex: 272, sets: 2, reps: '10–12', rest: 60 },
    ],
  },
  {
    id: 'hz-bacak', name: 'Bacak · ön, arka, kalça, baldır',
    note: 'İtme / Çekme / Bacak programının üçüncü günü.',
    items: [
      { ex: 1801, sets: 4, reps: '6–8', rest: 180 },
      { ex: 1700, sets: 3, reps: '8–10', rest: 120 },
      { ex: 371, sets: 3, reps: '10–12', rest: 120 },
      { ex: 365, sets: 3, reps: '10–12', rest: 75 },
      { ex: 622, sets: 4, reps: '12–15', rest: 60 },
      { ex: 2674, sets: 3, reps: '10–15', rest: 60 },
    ],
  },
];

/** Hareketin varsayılan dinlenmesi (sn). */
export function defaultRest(ex) {
  if (ex?.dinlenme != null) return ex.dinlenme;
  if (ex?.kat === 'esneme') return 0;
  if (ex?.olcu === 'kardiyo') return 0;
  if (ex?.kat === 'karin' || ex?.kat === 'kardiyo') return 45;
  return ex?.cok ? 120 : 75;
}

/** Kütüphane kaydından antrenman kalemi. */
export function itemFromExercise(ex, { sets = 1, target = '', rest = null } = {}) {
  return {
    ex: ex.id,
    name: ex.ad,
    measure: ex.olcu || 'agirlik',
    muscles: [...(ex.kas || [])],
    muscles2: [...(ex.kas2 || [])],
    cat: ex.kat,
    rest: rest ?? defaultRest(ex),
    target,
    note: '',
    sets: Array.from({ length: Math.max(1, sets) }, () => emptySet()),
  };
}

export const emptySet = (from = null) => ({
  kg: from?.kg ?? null, reps: from?.reps ?? null, sec: from?.sec ?? null, km: from?.km ?? null,
  done: false, type: 'n',
});

/**
 * Yeni antrenman. routine verilirse kalemler ondan, kg/tekrar son performanstan doldurulur.
 * lib: id → kütüphane kaydı (bulunamayan hareket atlanır).
 */
export function newWorkout({ name = 'Antrenman', routine = null, lib = new Map(), workouts = {}, now = new Date() } = {}) {
  const w = {
    id: uuid(),
    name: routine?.name || name,
    started_at: now.toISOString(),
    ended_at: null,
    day: dayKey(now),
    routine_id: routine?.id || null,
    note: '',
    items: [],
    updated_at: now.toISOString(),
  };
  for (const r of routine?.items || []) {
    const ex = lib.get(String(r.ex));
    if (!ex) continue;
    const item = itemFromExercise(ex, { sets: r.sets || 3, target: r.reps || '', rest: r.rest ?? null });
    prefillFromLast(item, workouts);
    w.items.push(item);
  }
  return w;
}

/** Son yapılan antrenmandaki değerleri (aynı set sırasına göre) önerilen değer olarak koyar. */
export function prefillFromLast(item, workouts, opts = {}) {
  const last = lastPerformance(workouts, item.ex, opts);
  if (!last) return item;
  item.sets = item.sets.map((s, i) => {
    const src = last.sets[Math.min(i, last.sets.length - 1)];
    return src ? { ...s, kg: src.kg ?? null, reps: src.reps ?? null, sec: src.sec ?? null, km: src.km ?? null } : s;
  });
  return item;
}

/** Bitmiş antrenmandan program: hareketler ve set sayıları, hedef tekrar son değerlerden. */
export function routineFromWorkout(w, name = null) {
  return {
    id: uuid(),
    name: name || w.name || 'Programım',
    note: '',
    items: (w.items || []).filter((it) => it.sets?.length).map((it) => {
      const ws = workSets(it);
      const reps = ws.map((s) => num(s.reps)).filter((r) => r != null);
      const secs = ws.map((s) => num(s.sec)).filter((r) => r != null);
      let target = it.target || '';
      if (!target && reps.length) {
        const lo = Math.min(...reps);
        const hi = Math.max(...reps);
        target = lo === hi ? String(lo) : `${lo}–${hi}`;
      } else if (!target && secs.length) target = fmtDur(Math.max(...secs));
      return { ex: it.ex, name: it.name, sets: Math.max(1, ws.length || it.sets.length), reps: target, rest: it.rest };
    }),
    updated_at: new Date().toISOString(),
  };
}

/** Antrenmanı bitirir: tamamlanmamış setler atılır, setsiz kalan hareketler çıkarılır. */
export function finishWorkout(w, now = new Date()) {
  const items = (w.items || [])
    .map((it) => ({ ...it, sets: (it.sets || []).filter((s) => s.done) }))
    .filter((it) => it.sets.length);
  return { ...w, items, ended_at: now.toISOString(), updated_at: now.toISOString() };
}

/** Tamamlanmamış set sayısı (bitirmeden önce uyarmak için). */
export const pendingSets = (w) => (w?.items || []).reduce((a, it) => a + (it.sets || []).filter((s) => !s.done).length, 0);
