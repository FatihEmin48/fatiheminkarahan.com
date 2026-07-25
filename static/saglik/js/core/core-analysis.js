/* OTOMATİK KOPYA — kaynak: shared/core-analysis.js. Elle düzenleme, shared/ içindekini düzenle. */
/* core-analysis.js — haftalık / aylık / yıllık analiz ve kilo eğilimi.
   Tüm fonksiyonlar saf: girdi olarak {gün anahtarı → kayıt} sözlükleri alır. */

import {
  dayKey, shiftDay, dayRange, weekStart, monthStart, today, keyToDate,
  daysBetween, pctChange, monthShort,
} from './core-util.js';

const METRIC_KEYS = ['steps', 'distance_km', 'active_kcal', 'exercise_min', 'stand_hours'];

const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** Bir aralığın toplamları ve ortalamaları. */
export function sumRange(days, fromKey, toKey) {
  const keys = dayRange(fromKey, toKey);
  const out = {
    from: fromKey,
    to: toKey,
    dayCount: keys.length,
    daysLogged: 0,
    steps: 0,
    distance_km: 0,
    active_kcal: 0,
    exercise_min: 0,
    stand_hours: 0,
    activeDays: 0,       // en az bir metriği olan gün
    bestDay: null,       // en çok adım atılan gün
  };

  let bestSteps = -1;
  for (const k of keys) {
    const rec = days[k];
    if (!rec) continue;
    const hasAny = METRIC_KEYS.some((m) => num(rec[m]) != null);
    if (!hasAny) continue;
    out.daysLogged++;
    out.activeDays++;
    for (const m of METRIC_KEYS) {
      const v = num(rec[m]);
      if (v != null) out[m] += v;
    }
    const s = num(rec.steps);
    if (s != null && s > bestSteps) {
      bestSteps = s;
      out.bestDay = { day: k, steps: s };
    }
  }

  out.distance_km = Math.round(out.distance_km * 100) / 100;
  out.avgSteps = out.daysLogged ? Math.round(out.steps / out.daysLogged) : 0;
  out.avgKcal = out.daysLogged ? Math.round(out.active_kcal / out.daysLogged) : 0;
  out.avgExercise = out.daysLogged ? Math.round(out.exercise_min / out.daysLogged) : 0;
  out.avgDistance = out.daysLogged ? Math.round((out.distance_km / out.daysLogged) * 100) / 100 : 0;
  return out;
}

/** İki dönemi karşılaştır: her metrik için fark ve yüzde. */
export function compare(current, previous) {
  const out = {};
  for (const m of [...METRIC_KEYS, 'avgSteps', 'daysLogged']) {
    const now = current[m] ?? 0;
    const prev = previous[m] ?? 0;
    out[m] = {
      now,
      prev,
      diff: Math.round((now - prev) * 100) / 100,
      pct: pctChange(now, prev),
    };
  }
  return out;
}

/** Hedeflere göre gün değerlendirmesi. */
export function dayScore(rec, profile = {}) {
  const stepGoal = profile.step_goal || 8000;
  const kcalGoal = profile.kcal_goal || 500;
  const exGoal = profile.exercise_goal || 30;
  const steps = num(rec?.steps) || 0;
  const kcal = num(rec?.active_kcal) || 0;
  const ex = num(rec?.exercise_min) || 0;
  const parts = [
    Math.min(1, steps / stepGoal),
    Math.min(1, kcal / kcalGoal),
    Math.min(1, ex / exGoal),
  ];
  return {
    steps: parts[0],
    kcal: parts[1],
    exercise: parts[2],
    overall: Math.round((parts.reduce((a, b) => a + b, 0) / 3) * 100),
    goalsHit: (steps >= stepGoal ? 1 : 0) + (kcal >= kcalGoal ? 1 : 0) + (ex >= exGoal ? 1 : 0),
    perfect: steps >= stepGoal && kcal >= kcalGoal && ex >= exGoal,
  };
}

/** Adım hedefi serisi: bugünden geriye kesintisiz hedef tutulan gün sayısı. */
export function stepStreak(days, stepGoal = 8000, endKey = today()) {
  let key = endKey;
  let n = 0;
  // bugün henüz veri girilmediyse seriyi bozmaz
  if (!days[key] || num(days[key].steps) == null) key = shiftDay(key, -1);
  let guard = 0;
  while (guard++ < 800) {
    const rec = days[key];
    const s = rec ? num(rec.steps) : null;
    if (s == null || s < stepGoal) break;
    n++;
    key = shiftDay(key, -1);
  }
  return n;
}

export function longestStreak(days, stepGoal = 8000) {
  const keys = Object.keys(days).filter((k) => num(days[k].steps) != null).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    const hit = num(days[k].steps) >= stepGoal;
    if (!hit) { run = 0; prev = k; continue; }
    run = prev && daysBetween(k, prev) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

/* ---------------- dönem raporları ---------------- */

/**
 * Sürmekte olan dönemin kaç günü geçti?
 * Yarım haftayı tam haftayla kıyaslamak yanıltıcı olduğu için önceki dönem
 * aynı gün sayısına kırpılır.
 */
function elapsedDays(startKey, endKey, todayKey = today()) {
  if (todayKey >= endKey) return null;                 // dönem tamamlanmış
  if (todayKey < startKey) return 0;                   // gelecek dönem
  return daysBetween(todayKey, startKey);              // 0 = ilk gün
}

/** Haftalık rapor: toplamlar, önceki haftayla karşılaştırma, günlük seri. */
export function weekReport(days, startKey = weekStart(), profile = {}) {
  const endKey = shiftDay(startKey, 6);
  const cur = sumRange(days, startKey, endKey);
  const prevStart = shiftDay(startKey, -7);
  const elapsed = elapsedDays(startKey, endKey);
  const prevEnd = elapsed == null ? shiftDay(prevStart, 6) : shiftDay(prevStart, elapsed);
  const prev = sumRange(days, prevStart, prevEnd);

  const series = dayRange(startKey, endKey).map((k) => {
    const rec = days[k] || null;
    return {
      day: k,
      steps: num(rec?.steps),
      distance_km: num(rec?.distance_km),
      active_kcal: num(rec?.active_kcal),
      exercise_min: num(rec?.exercise_min),
      score: rec ? dayScore(rec, profile) : null,
      future: k > today(),
    };
  });

  const goalDays = series.filter((d) => d.score && d.score.goalsHit === 3).length;
  const stepGoalDays = series.filter((d) => d.steps != null
    && d.steps >= (profile.step_goal || 8000)).length;

  return {
    kind: 'week',
    start: startKey,
    end: endKey,
    totals: cur,
    prev,
    delta: compare(cur, prev),
    partial: elapsed != null,
    prevLabel: elapsed != null
      ? `geçen haftanın ilk ${elapsed + 1} günü`
      : 'geçen hafta',
    series,
    goalDays,
    stepGoalDays,
    missingDays: series.filter((d) => !d.future && d.steps == null).map((d) => d.day),
  };
}

/** Aylık rapor: toplamlar, önceki ayla karşılaştırma, hafta hafta seri. */
export function monthReport(days, startKey = monthStart(), profile = {}) {
  const d = keyToDate(startKey);
  const endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const endKey = dayKey(endDate);
  const cur = sumRange(days, startKey, endKey);

  const prevDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const prevStart = dayKey(prevDate);
  const prevMonthEnd = dayKey(new Date(d.getFullYear(), d.getMonth(), 0));
  const elapsed = elapsedDays(startKey, endKey);
  const prevEnd = elapsed == null ? prevMonthEnd
    : (shiftDay(prevStart, elapsed) > prevMonthEnd ? prevMonthEnd : shiftDay(prevStart, elapsed));
  const prev = sumRange(days, prevStart, prevEnd);

  // ay içindeki haftalar (pazartesi başlangıçlı, aya kırpılmış)
  const weeks = [];
  let wk = weekStart(startKey);
  let guard = 0;
  while (wk <= endKey && guard++ < 8) {
    const from = wk < startKey ? startKey : wk;
    const to = shiftDay(wk, 6) > endKey ? endKey : shiftDay(wk, 6);
    weeks.push({ start: wk, ...sumRange(days, from, to) });
    wk = shiftDay(wk, 7);
  }

  return {
    kind: 'month',
    start: startKey,
    end: endKey,
    label: `${monthShort(startKey)} ${keyToDate(startKey).getFullYear()}`,
    totals: cur,
    prev,
    delta: compare(cur, prev),
    partial: elapsed != null,
    prevLabel: elapsed != null
      ? `önceki ayın ilk ${elapsed + 1} günü`
      : 'önceki ay',
    weeks,
    stepGoalDays: dayRange(startKey, endKey)
      .filter((k) => num(days[k]?.steps) >= (profile.step_goal || 8000)).length,
  };
}

/** Yıllık rapor: aylık seri + en iyi ay/gün + önceki yılla karşılaştırma. */
export function yearReport(days, year = new Date().getFullYear(), profile = {}) {
  const startKey = `${year}-01-01`;
  const endKey = `${year}-12-31`;
  const cur = sumRange(days, startKey, endKey);
  // sürmekte olan yılı, geçen yılın aynı tarihine kadarki kısmıyla kıyasla
  const elapsed = elapsedDays(startKey, endKey);
  const prevEnd = elapsed == null ? `${year - 1}-12-31`
    : shiftDay(`${year - 1}-01-01`, elapsed);
  const prev = sumRange(days, `${year - 1}-01-01`, prevEnd);

  const months = [];
  for (let m = 0; m < 12; m++) {
    const mStart = dayKey(new Date(year, m, 1));
    const mEnd = dayKey(new Date(year, m + 1, 0));
    months.push({
      month: m + 1,
      label: monthShort(mStart),
      start: mStart,
      ...sumRange(days, mStart, mEnd),
    });
  }

  const withData = months.filter((m) => m.daysLogged > 0);
  const bestMonth = withData.length
    ? withData.reduce((a, b) => (b.steps > a.steps ? b : a))
    : null;

  return {
    kind: 'year',
    year,
    totals: cur,
    prev,
    delta: compare(cur, prev),
    partial: elapsed != null,
    prevLabel: elapsed != null ? `geçen yılın aynı dönemi` : 'geçen yıl',
    months,
    bestMonth,
    stepGoalDays: dayRange(startKey, endKey)
      .filter((k) => num(days[k]?.steps) >= (profile.step_goal || 8000)).length,
  };
}

/* ---------------- kilo ---------------- */

/**
 * Kilo eğilimi: son ölçüm, haftalık/aylık değişim, hedefe kalan, seri.
 * weights: {gün → {kg, body_fat}}
 */
export function weightReport(weights, profile = {}) {
  const entries = Object.entries(weights)
    .filter(([, v]) => v && num(v.kg) != null)
    .map(([day, v]) => ({ day, kg: Number(v.kg), body_fat: num(v.body_fat) }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  if (!entries.length) {
    return { empty: true, entries: [], latest: null };
  }

  const latest = entries[entries.length - 1];
  const prev = entries.length > 1 ? entries[entries.length - 2] : null;
  const first = entries[0];

  const atOrBefore = (key) => {
    let found = null;
    for (const e of entries) if (e.day <= key) found = e; else break;
    return found;
  };
  const weekAgo = atOrBefore(shiftDay(latest.day, -7));
  const monthAgo = atOrBefore(shiftDay(latest.day, -30));
  const yearAgo = atOrBefore(shiftDay(latest.day, -365));

  const diff = (a, b) => (a && b ? Math.round((a.kg - b.kg) * 10) / 10 : null);

  // son 4 ölçümün eğilimi (kg/hafta)
  const tail = entries.slice(-4);
  let slope = null;
  if (tail.length >= 2) {
    const x0 = keyToDate(tail[0].day).getTime();
    const xs = tail.map((e) => (keyToDate(e.day).getTime() - x0) / (7 * 86400000));
    const ys = tail.map((e) => e.kg);
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    slope = den ? Math.round((xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den) * 100) / 100 : 0;
  }

  const target = num(profile.target_weight);
  const height = num(profile.height_cm);
  const bmi = height ? Math.round((latest.kg / ((height / 100) ** 2)) * 10) / 10 : null;

  let etaWeeks = null;
  if (target != null && slope && Math.abs(slope) > 0.05) {
    const need = latest.kg - target;
    if ((need > 0 && slope < 0) || (need < 0 && slope > 0)) {
      etaWeeks = Math.ceil(Math.abs(need / slope));
    }
  }

  return {
    empty: false,
    entries,
    latest,
    prevEntry: prev,
    sinceLast: diff(latest, prev),
    sinceWeek: diff(latest, weekAgo),
    sinceMonth: diff(latest, monthAgo),
    sinceYear: diff(latest, yearAgo),
    sinceStart: diff(latest, first),
    min: entries.reduce((a, b) => (b.kg < a.kg ? b : a)),
    max: entries.reduce((a, b) => (b.kg > a.kg ? b : a)),
    slopePerWeek: slope,
    bmi,
    bmiLabel: bmiLabel(bmi),
    target,
    toTarget: target != null ? Math.round((latest.kg - target) * 10) / 10 : null,
    etaWeeks,
    count: entries.length,
  };
}

export function bmiLabel(bmi) {
  if (bmi == null) return null;
  if (bmi < 18.5) return 'zayıf';
  if (bmi < 25) return 'normal';
  if (bmi < 30) return 'fazla kilolu';
  if (bmi < 35) return 'obez (1. derece)';
  if (bmi < 40) return 'obez (2. derece)';
  return 'obez (3. derece)';
}

/** Kilo tartım günü geldi mi? (profil: weigh_day 1=Pazartesi) */
export function weighDueDay(profile = {}, todayKey = today()) {
  const wd = Number(profile.weigh_day) || 1;
  const d = keyToDate(todayKey);
  const cur = ((d.getDay() + 6) % 7) + 1;         // 1..7
  const back = (cur - wd + 7) % 7;
  return shiftDay(todayKey, -back);               // bu haftanın tartım günü
}

export function isWeighPending(weights, profile = {}, todayKey = today()) {
  const due = weighDueDay(profile, todayKey);
  return !weights[due];
}

/* ---------------- eksik gün / veri sağlığı ---------------- */

export function missingDays(days, n = 14, endKey = today()) {
  return dayRange(shiftDay(endKey, -(n - 1)), endKey)
    .filter((k) => {
      const rec = days[k];
      return !rec || METRIC_KEYS.every((m) => num(rec[m]) == null);
    });
}

/** Panelde gösterilecek kısa özet cümlesi. */
export function headline(week, weight) {
  const parts = [];
  if (week.totals.daysLogged) {
    parts.push(`Bu hafta ${week.totals.steps.toLocaleString('tr-TR')} adım`);
    const pct = week.delta.steps.pct;
    if (pct != null) {
      parts.push(pct >= 0 ? `geçen haftaya göre %${pct} fazla` : `geçen haftaya göre %${Math.abs(pct)} az`);
    }
  } else {
    parts.push('Bu hafta henüz veri yok');
  }
  if (weight && !weight.empty && weight.sinceLast != null) {
    const s = weight.sinceLast;
    parts.push(s === 0 ? 'kilo sabit' : s < 0 ? `${Math.abs(s)} kg verdin` : `${s} kg aldın`);
  }
  return parts.join(' · ');
}
