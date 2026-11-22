/* OTOMATİK KOPYA — kaynak: shared/core-export.js. Elle düzenleme, shared/ içindekini düzenle. */
/* core-export.js — gün gün dışa aktarma.

   İki biçim:
   - Markdown (.md): bir yapay zekâya "değerlendir" diye gönderilecek TEK dosya. Bağlam
     (hedefler, birimler, sütun anlamları), uygulamanın hazır hesapladığı özet, her günün
     satırı ve sonda kısa bir değerlendirme isteği. Özet şart: dil modelleri yüzlerce
     satırı kafadan toplarken ve tarihten haftanın gününü çıkarırken yanılıyor.
   - CSV (.csv): Türkçe Excel'in çift tıklayınca sütunlara ayırdığı biçim — UTF-8 BOM,
     ";" ayırıcı, ondalık virgül.
   - Antrenman setleri (.csv): her set bir satır (Excel'de süzmek / pivot için).

   Kurallar:
   - Yalnız TAMAMLANMIŞ günler: bugün yarım gün olduğu için dışarıda kalır (yoksa
     "en düşük gün" hep bugün çıkar, ortalama aşağı çekilir).
   - Dönem ilk kayıttan önce başlıyorsa ilk kayda kırpılır; uygulama kullanılmadan
     önceki aylar "veri yok" satırlarıyla dolmasın. Dönem içindeki boşluklar ise olduğu
     gibi kalır — onlar da bilgi.
   - Bitmiş antrenman tamamlanmış veridir: dönem dünde bitiyorsa (yani bugüne uzanıyorsa)
     bugün bitirilen antrenmanlar da antrenman bölümlerine girer; günlük tabloya girmez.
   - Boş hücre = o gün veri girilmedi; sıfır değildir.
   - Kullanıcı adı, e-posta ve kısayol anahtarı (ingest_token) dosyaya hiç girmez.

   Saf fonksiyonlar; DOM ve ağ yok. Web ve Android aynı dosyayı kullanır. */

import {
  dayKey, keyToDate, shiftDay, dayRange, daysBetween, today, weekStart, weekdayName, isValidKey,
} from './core-util.js';
import {
  periodStats, finished, GRUPLAR, KATEGORI_AD, fmtDur, workoutSummary, newRecords, groupRecords,
  setVolume, e1rm, SET_TIP,
} from './core-workout.js';

/** Bitmiş antrenmanların günleri (dönem sınırları için). */
const workoutDays = (workouts) => finished(workouts).map((w) => w.day).filter(isValidKey);

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** Date.getDay() sırasıyla (0 = Pazar) */
const WD_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const WD_LONG = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];          // Pazartesi → Pazar

/** Aktivite ölçütleri. core: her dosyada sütunu olur; diğerleri yalnız veri varsa. */
const ACT = [
  { key: 'steps', col: 'adim', label: 'Adım', dp: 0, avgDp: 0, totalDp: 0, core: true,
    doc: 'günlük adım sayısı' },
  { key: 'distance_km', col: 'mesafe_km', label: 'Mesafe (km)', dp: 2, avgDp: 2, totalDp: 1, core: true,
    doc: 'yürüme + koşu mesafesi, km' },
  { key: 'active_kcal', col: 'aktif_kcal', label: 'Aktif kalori (kcal)', dp: 0, avgDp: 0, totalDp: 0, core: true,
    doc: 'aktif enerji (Apple "Hareket" halkası), kcal; dinlenme enerjisi hariç' },
  { key: 'exercise_min', col: 'egzersiz_dk', label: 'Egzersiz (dk)', dp: 0, avgDp: 0, totalDp: 0, core: true,
    doc: 'egzersiz dakikası (Apple "Egzersiz" halkası)' },
  { key: 'stand_hours', col: 'ayakta_sa', label: 'Ayakta (saat)', dp: 0, avgDp: 1, totalDp: null,
    doc: 'ayakta durma saati (Apple Watch); saat takılmayan günlerde boş' },
  { key: 'resting_kcal', col: 'dinlenme_kcal', label: 'Dinlenme kalorisi (kcal)', dp: 0, avgDp: 0, totalDp: null,
    doc: 'dinlenme (bazal) enerjisi, kcal' },
];

const WGT = [
  { key: 'kg', col: 'kilo_kg', label: 'Kilo (kg)', dp: 1, core: true,
    doc: 'tartı, kg; yalnız tartılan günlerde dolu' },
  { key: 'body_fat', col: 'yag_yuzde', label: 'Yağ (%)', dp: 1, doc: 'vücut yağ oranı, %' },
  { key: 'muscle_kg', col: 'kas_kg', label: 'Kas (kg)', dp: 1, doc: 'kas kütlesi, kg' },
];

const SOURCE = {
  shortcut: 'kısayol', screenshot: 'görsel', manual: 'elle', healthconnect: 'telefon', import: 'aktarım',
};
const SOURCE_DOC = {
  kısayol: "iPhone Sağlık'tan otomatik", görsel: 'ekran görüntüsünden okundu', elle: 'elle girildi',
  telefon: 'Android Health Connect', aktarım: 'dışarıdan aktarıldı',
};

/** Yaygın adım sınıflaması (günlük adım). */
const STEP_BANDS = [
  { min: 0, max: 5000, label: '< 5000 (hareketsiz)' },
  { min: 5000, max: 7500, label: '5000–7499 (az aktif)' },
  { min: 7500, max: 10000, label: '7500–9999 (orta)' },
  { min: 10000, max: 12500, label: '10000–12499 (aktif)' },
  { min: 12500, max: Infinity, label: '≥ 12500 (çok aktif)' },
];

/* ---------------- küçük yardımcılar ---------------- */

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;
/** Makine biçimi: 12923 · 6.12 · -2.8 (binlik ayırıcı yok, ondalık nokta) */
const fx = (v, dp = 0) => (v == null || !Number.isFinite(v) ? '' : String(round(v, dp) || 0));
const signed = (v, dp = 1) => (v == null ? '' : (round(v, dp) > 0 ? '+' : '') + fx(v, dp));
const pct = (a, b) => (b ? `%${Math.round((a / b) * 100)}` : '—');
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());

const hasActivity = (rec) => !!rec && ACT.some((m) => num(rec[m.key]) != null);
const hasWeight = (rec) => !!rec && num(rec.kg) != null;

/** "25 Temmuz 2026" — yıl her zaman yazılır (dosya yıllar sonra da okunabilsin). */
export function longDate(key) {
  const d = keyToDate(key);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/* ---------------- dönem ---------------- */

/** Kaydı olan ilk ve son gün (aktivite ya da kilo). */
export function dataBounds(days = {}, weights = {}, { includeWeight = true, workouts = {} } = {}) {
  let first = null;
  let last = null;
  const see = (k) => {
    if (!first || k < first) first = k;
    if (!last || k > last) last = k;
  };
  for (const [k, v] of Object.entries(days)) if (isValidKey(k) && hasActivity(v)) see(k);
  if (includeWeight) {
    for (const [k, v] of Object.entries(weights)) if (isValidKey(k) && hasWeight(v)) see(k);
  }
  for (const k of workoutDays(workouts)) see(k);
  return { first, last };
}

function anyDataBetween(days, weights, from, to, includeWeight, workouts = {}) {
  for (const [k, v] of Object.entries(days)) if (k >= from && k <= to && hasActivity(v)) return true;
  if (includeWeight) {
    for (const [k, v] of Object.entries(weights)) if (k >= from && k <= to && hasWeight(v)) return true;
  }
  return workoutDays(workouts).some((k) => k >= from && k <= to);
}

/**
 * Hazır dönemler: verisi olan her takvim yılı (yeniden eskiye), son 12 ay / 90 / 30 gün, tümü.
 * Hepsi dünde biter — bugün henüz tamamlanmadı.
 */
export function exportPresets(days = {}, weights = {}, todayKey = today(), workouts = {}) {
  const last = shiftDay(todayKey, -1);
  const years = new Set();
  for (const [k, v] of Object.entries(days)) {
    if (isValidKey(k) && k <= last && hasActivity(v)) years.add(Number(k.slice(0, 4)));
  }
  for (const [k, v] of Object.entries(weights)) {
    if (isValidKey(k) && k <= last && hasWeight(v)) years.add(Number(k.slice(0, 4)));
  }
  for (const k of workoutDays(workouts)) if (k <= last) years.add(Number(k.slice(0, 4)));
  const out = [...years].sort((a, b) => b - a).map((y) => ({
    id: `y${y}`, label: String(y), from: `${y}-01-01`, to: `${y}-12-31`, year: y,
  }));
  out.push({ id: 'd365', label: 'Son 12 ay', from: shiftDay(last, -364), to: last });
  out.push({ id: 'd90', label: 'Son 90 gün', from: shiftDay(last, -89), to: last });
  out.push({ id: 'd30', label: 'Son 30 gün', from: shiftDay(last, -29), to: last });
  const { first } = dataBounds(days, weights, { workouts });
  out.push({ id: 'all', label: 'Tümü', from: first && first <= last ? first : last, to: last });
  return out;
}

/**
 * İstenen aralığı dışa aktarılacak aralığa çevirir: bugün ve sonrası atılır, ilk kayıttan
 * önceki kısım kırpılır. empty: aralıkta tamamlanmış bir günün kaydı yok.
 */
export function resolveRange(days = {}, weights = {}, from, to,
  { todayKey = today(), includeWeight = true, workouts = {} } = {}) {
  let a = isValidKey(from) ? from : todayKey;
  let b = isValidKey(to) ? to : todayKey;
  if (a > b) [a, b] = [b, a];
  const lastDone = shiftDay(todayKey, -1);
  const out = {
    requested: { from: a, to: b },
    from: a,
    to: b,
    startCut: false,
    todayCut: false,
    empty: false,
    dayCount: 0,
  };
  if (b > lastDone) {
    out.to = lastDone;
    out.todayCut = a <= todayKey;
  }
  const { first } = dataBounds(days, weights, { includeWeight, workouts });
  if (first && first > out.from && first <= out.to) {
    out.from = first;
    out.startCut = true;
  }
  out.empty = !first || out.from > out.to
    || !anyDataBetween(days, weights, out.from, out.to, includeWeight, workouts);
  out.dayCount = out.empty ? 0 : daysBetween(out.to, out.from) + 1;
  return out;
}

/* ---------------- satırlar ---------------- */

/** Aralıktaki HER gün için bir satır; verisi olmayan gün de boş satır olarak yer alır. */
export function buildRows(days = {}, weights = {}, from, to, { includeWeight = true, byDay = null } = {}) {
  return dayRange(from, to).map((k) => {
    const d = days[k] || {};
    const w = (includeWeight && weights[k]) || {};
    const row = { day: k, wd: keyToDate(k).getDay() };
    for (const m of ACT) row[m.key] = num(d[m.key]);
    for (const m of WGT) row[m.key] = includeWeight ? num(w[m.key]) : null;
    // o günün antrenman(lar)ı: süre, çalışma seti, hacim (kg × tekrar)
    const t = byDay?.[k];
    row.w_names = t ? t.names.join(' + ') || 'Antrenman' : null;
    row.w_min = t ? t.minutes : null;
    row.w_sets = t ? t.sets : null;
    row.w_vol = t ? t.volume : null;
    row.logged = ACT.some((m) => row[m.key] != null);
    row.source = row.logged && d.source ? SOURCE[d.source] || String(d.source) : null;
    const notes = [];
    if (clean(d.note)) notes.push(clean(d.note));
    if (includeWeight && clean(w.note)) notes.push(`tartı: ${clean(w.note)}`);
    row.note = notes.join(' · ') || null;
    return row;
  });
}

/** Hangi sütunlar yazılacak: çekirdek ölçütler her zaman, diğerleri yalnız veri varsa. */
function columnsFor(rows, { includeWeight = true } = {}) {
  const has = (key) => rows.some((r) => r[key] != null);
  return {
    act: ACT.filter((m) => m.core || has(m.key)),
    wgt: includeWeight ? WGT.filter((m) => m.core || has(m.key)) : [],
    wk: rows.some((r) => r.w_sets != null),
    source: rows.some((r) => r.source),
    note: rows.some((r) => r.note),
  };
}

/* ---------------- özet istatistikler ---------------- */

function metricStats(rows, key) {
  const vals = [];
  for (const r of rows) if (r[key] != null) vals.push({ day: r.day, v: r[key] });
  if (!vals.length) return { n: 0 };
  const sorted = vals.map((x) => x.v).sort((x, y) => x - y);
  const total = sorted.reduce((a, b) => a + b, 0);
  const mid = sorted.length >> 1;
  let max = vals[0];
  let min = vals[0];
  for (const x of vals) {
    if (x.v > max.v) max = x;
    if (x.v < min.v) min = x;
  }
  return {
    n: vals.length,
    total,
    avg: total / vals.length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    max,
    min,
  };
}

function goalStats(rows, key, goal) {
  const have = rows.filter((r) => r[key] != null);
  return { goal, n: have.length, hit: have.filter((r) => r[key] >= goal).length };
}

function buckets(rows, keyOf, goals) {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()].map(([key, rs]) => {
    const kgs = rs.map((r) => r.kg).filter((v) => v != null);
    return {
      key,
      from: rs[0].day,
      to: rs[rs.length - 1].day,
      days: rs.length,
      logged: rs.filter((r) => r.logged).length,
      steps: metricStats(rs, 'steps'),
      distance_km: metricStats(rs, 'distance_km'),
      active_kcal: metricStats(rs, 'active_kcal'),
      exercise_min: metricStats(rs, 'exercise_min'),
      stepGoalDays: rs.filter((r) => r.steps != null && r.steps >= goals.steps).length,
      kgAvg: kgs.length ? mean(kgs) : null,
    };
  });
}

function weightStats(rows, profile = {}) {
  const es = rows.filter((r) => r.kg != null);
  if (!es.length) return null;
  const first = es[0];
  const last = es[es.length - 1];
  let min = first;
  let max = first;
  for (const e of es) {
    if (e.kg < min.kg) min = e;
    if (e.kg > max.kg) max = e;
  }
  // Doğrusal eğilim (kg/hafta): en az iki hafta aralıklı ölçüm yoksa anlamsız
  const span = daysBetween(last.day, first.day);
  let slope = null;
  if (es.length >= 2 && span >= 14) {
    const xs = es.map((e) => daysBetween(e.day, first.day) / 7);
    const ys = es.map((e) => e.kg);
    const mx = mean(xs);
    const my = mean(ys);
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    if (den) slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den;
  }
  const h = num(profile.height_cm);
  const bmi = (kg) => (h ? kg / (h / 100) ** 2 : null);
  const target = num(profile.target_weight);
  const fats = rows.filter((r) => r.body_fat != null);
  return {
    n: es.length,
    first: { day: first.day, kg: first.kg },
    last: { day: last.day, kg: last.kg },
    change: last.kg - first.kg,
    min: { day: min.day, kg: min.kg },
    max: { day: max.day, kg: max.kg },
    spanDays: span,
    slopePerWeek: slope,
    height: h,
    bmiFirst: bmi(first.kg),
    bmiLast: bmi(last.kg),
    target,
    toTarget: target != null ? last.kg - target : null,
    fat: fats.length
      ? { first: fats[0].body_fat, last: fats[fats.length - 1].body_fat, n: fats.length }
      : null,
  };
}

/** Satırlardan özet: kapsam, toplam/ortalama, hedef tutma, seri, dağılım, gün/ay/hafta dökümü, kilo. */
export function computeStats(rows, profile = {}) {
  const goals = {
    steps: num(profile.step_goal) || 8000,
    active_kcal: num(profile.kcal_goal) || 500,
    exercise_min: num(profile.exercise_goal) || 30,
  };

  let missing = 0;
  let gap = 0;
  let gapFrom = null;
  let longestGap = null;
  for (const r of rows) {
    if (r.logged) { gap = 0; continue; }
    missing++;
    if (!gap) gapFrom = r.day;
    gap++;
    if (!longestGap || gap > longestGap.len) longestGap = { len: gap, from: gapFrom, to: r.day };
  }

  const metrics = {};
  for (const m of ACT) metrics[m.key] = metricStats(rows, m.key);

  const all3 = rows.filter((r) => r.steps != null && r.active_kcal != null && r.exercise_min != null);
  const goalsHit = {
    steps: goalStats(rows, 'steps', goals.steps),
    active_kcal: goalStats(rows, 'active_kcal', goals.active_kcal),
    exercise_min: goalStats(rows, 'exercise_min', goals.exercise_min),
    all: {
      n: all3.length,
      hit: all3.filter((r) => r.steps >= goals.steps && r.active_kcal >= goals.active_kcal
        && r.exercise_min >= goals.exercise_min).length,
    },
  };

  // Adım hedefi serisi: veri olmayan gün seriyi bozar (uygulamadaki seriyle aynı kural)
  let run = 0;
  let runFrom = null;
  let longest = { len: 0, from: null, to: null };
  for (const r of rows) {
    if (r.steps != null && r.steps >= goals.steps) {
      if (!run) runFrom = r.day;
      run++;
      if (run > longest.len) longest = { len: run, from: runFrom, to: r.day };
    } else {
      run = 0;
    }
  }

  const withSteps = rows.filter((r) => r.steps != null);
  const bands = STEP_BANDS.map((b) => ({
    label: b.label,
    n: withSteps.filter((r) => r.steps >= b.min && r.steps < b.max).length,
  }));

  const weekdays = WEEK_ORDER.map((wd) => {
    const rs = rows.filter((r) => r.wd === wd);
    return {
      wd,
      name: WD_LONG[wd],
      days: rs.length,
      steps: metricStats(rs, 'steps'),
      active_kcal: metricStats(rs, 'active_kcal'),
      exercise_min: metricStats(rs, 'exercise_min'),
      stepGoalDays: rs.filter((r) => r.steps != null && r.steps >= goals.steps).length,
    };
  });

  return {
    goals,
    dayCount: rows.length,
    logged: rows.filter((r) => r.logged).length,
    missing,
    longestGap,
    metrics,
    goalsHit,
    streak: { longest, atEnd: run },
    bands,
    weekdays,
    // Kısa dönemde aylık döküm anlamsız, çok uzun dönemde haftalık döküm kalabalık
    months: rows.length > 45 ? buckets(rows, (r) => r.day.slice(0, 7), goals) : [],
    weeks: rows.length <= 400 ? buckets(rows, (r) => weekStart(r.day), goals) : [],
    weight: weightStats(rows, profile),
  };
}

/* ---------------- Markdown (yapay zekâ için) ---------------- */

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|');
const mdRow = (cells) => `| ${cells.map(cell).join(' | ')} |`;
function mdTable(head, rows) {
  return [mdRow(head), `|${head.map(() => '---').join('|')}|`, ...rows.map(mdRow)].join('\n');
}

function csvCell(v, sep) {
  if (v == null) return '';
  const s = String(v);
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const span = (a, b) => (a === b ? a : `${a} → ${b}`);
const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

function bucketTable(list, { kind, includeWeight }) {
  const head = [kind === 'month' ? 'Ay' : 'Hafta (Pzt)', 'Kayıtlı gün', 'Toplam adım', 'Ort. adım',
    'Ort. km', 'Ort. aktif kcal', 'Ort. egzersiz dk', 'Adım hedefi tutulan gün'];
  if (includeWeight) head.push('Ort. kilo');
  const rows = list.map((b) => {
    const full = kind === 'month' ? daysInMonth(b.key) : 7;
    const name = kind === 'month'
      ? `${b.key} ${MONTHS[Number(b.key.slice(5, 7)) - 1]}`
      : b.key;
    const r = [
      b.days < full ? `${name} (kısmi)` : name,
      `${b.logged}/${b.days}`,
      b.steps.n ? fx(b.steps.total) : '',
      b.steps.n ? fx(b.steps.avg) : '',
      b.distance_km.n ? fx(b.distance_km.avg, 2) : '',
      b.active_kcal.n ? fx(b.active_kcal.avg) : '',
      b.exercise_min.n ? fx(b.exercise_min.avg) : '',
      b.steps.n ? b.stepGoalDays : '',
    ];
    if (includeWeight) r.push(b.kgAvg == null ? '' : fx(b.kgAvg, 1));
    return r;
  });
  return mdTable(head, rows);
}

function dailyCsv(rows, cols) {
  const head = ['tarih', 'gun', ...cols.act.map((m) => m.col), ...cols.wgt.map((m) => m.col)];
  if (cols.wk) head.push('antrenman', 'antrenman_dk', 'set', 'hacim_kg');
  if (cols.source) head.push('kaynak');
  if (cols.note) head.push('not');
  const lines = [head.join(',')];
  for (const r of rows) {
    const cells = [
      r.day,
      WD_SHORT[r.wd],
      ...cols.act.map((m) => fx(r[m.key], m.dp)),
      ...cols.wgt.map((m) => fx(r[m.key], m.dp)),
    ];
    if (cols.wk) cells.push((r.w_names || '').replace(/`/g, "'"), fx(r.w_min), fx(r.w_sets), fx(r.w_vol));
    if (cols.source) cells.push(r.source || '');
    // ters tırnak kod bloğunu kapatabilir
    if (cols.note) cells.push((r.note || '').replace(/`/g, "'"));
    lines.push(cells.map((c) => csvCell(c, ',')).join(','));
  }
  return lines.join('\n');
}

/* ---------------- antrenman günlüğü (gün gün, set set) ---------------- */

const SET_MARK = { w: 'ısınma', d: 'drop', f: 'tükeniş' };

/** "14:05" (antrenmanın başladığı yerel saat) */
function hhmm(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Setin makine dostu yazımı: "62.5 kg × 8", "12 tekrar", "+10 kg × 6", "45 sn", "20 dk · 3.2 km".
 * dec: ondalık ayırıcı (Markdown '.', Türkçe Excel ',').
 */
function setText(s, measure = 'agirlik', dec = '.') {
  const f = (v, dp = 0) => fx(v, dp).replace('.', dec);
  const kg = num(s?.kg);
  const reps = num(s?.reps);
  const sec = num(s?.sec);
  const km = num(s?.km);
  if (measure === 'sure') return sec != null ? `${f(sec)} sn` : '';
  if (measure === 'kardiyo') {
    return [sec != null ? `${f(sec / 60, 1)} dk` : '', km != null ? `${f(km, 2)} km` : ''].filter(Boolean).join(' · ');
  }
  if (measure === 'tekrar') {
    if (reps == null) return '';
    return kg > 0 ? `+${f(kg, 1)} kg × ${f(reps)}` : `${f(reps)} tekrar`;
  }
  if (kg == null && reps == null) return '';
  return `${kg == null ? '?' : f(kg, 1)} kg × ${reps == null ? '?' : f(reps)}`;
}

/** Bir hareketin setleri tek satırda; art arda aynı setler "60 kg × 8 (3 set)" diye birleşir. */
function setsText(item, dec = '.') {
  const m = item?.measure || 'agirlik';
  const parts = [];
  for (const s of (item?.sets || []).filter((x) => x.done)) {
    const txt = setText(s, m, dec);
    if (!txt) continue;
    const mark = SET_MARK[s.type] || '';
    const prev = parts[parts.length - 1];
    if (prev && prev.txt === txt && prev.mark === mark) prev.n++;
    else parts.push({ txt, mark, n: 1 });
  }
  return parts.map((p) => {
    const extra = [p.mark, p.n > 1 ? `${p.n} set` : ''].filter(Boolean).join(', ');
    return extra ? `${p.txt} (${extra})` : p.txt;
  }).join(' · ');
}

/** Bir günün antrenman(lar)ı tek hücrede: "Squat: 60 kg × 8 (3 set) | Plank: 45 sn (3 set)". */
function dayExercisesText(list, dec) {
  return list.flatMap((w) => (w.items || []).map((it) => {
    const t = setsText(it, dec);
    return t ? `${clean(it.name)}: ${t}` : '';
  })).filter(Boolean).join(' | ');
}

function prText(p) {
  const v = (x) => (p.kind === 'reps' ? fx(x) : p.kind === 'sec' ? `${fx(x)} sn` : `${fx(x, 1)} kg`);
  return `${p.label} ${v(p.value)} (önceki ${v(p.prev)})`;
}

/** Markdown: her antrenman bir başlık, altında hareketler ve setler. */
function workoutLog(list, workouts) {
  const out = [];
  for (const w of list) {
    const s = workoutSummary(w);
    out.push(`### ${w.day} ${WD_SHORT[keyToDate(w.day).getDay()]} · ${clean(w.name) || 'Antrenman'}`, '');
    const meta = [];
    const t = hhmm(w.started_at);
    if (t) meta.push(`başlangıç ${t}`);
    meta.push(`${s.minutes} dk`, `${s.exercises} hareket`, `${s.sets} set`);
    if (s.volume) meta.push(`hacim ${fx(s.volume)} kg`);
    if (s.km) meta.push(`${fx(s.km, 2)} km`);
    out.push(`- ${meta.join(' · ')}`);
    for (const it of w.items || []) {
      const txt = setsText(it);
      if (!txt) continue;
      out.push(`- ${clean(it.name) || 'Hareket'}: ${txt}${clean(it.note) ? ` — not: ${clean(it.note)}` : ''}`);
    }
    const prs = groupRecords(newRecords(w, workouts));
    if (prs.length) {
      out.push(`- Rekor: ${prs.map((g) => `${clean(g.name)} — ${g.items.map(prText).join(', ')}`).join('; ')}`);
    }
    if (clean(w.note)) out.push(`- Not: ${clean(w.note)}`);
    out.push('');
  }
  return out;
}

/** Excel: her set bir satır. */
function toSetsCSV(list) {
  const SEP = ';';
  const dec = (v, dp = 0) => fx(v, dp).replace('.', ',');
  const head = ['Tarih', 'Gün', 'Başlangıç', 'Antrenman', 'Antrenman (dk)', 'Sıra', 'Hareket', 'Kategori',
    'Set', 'Set türü', 'Kg', 'Tekrar', 'Süre (sn)', 'Mesafe (km)', 'Hacim (kg)', 'Tahmini 1TM (kg)', 'Not'];
  const lines = [head.map((h) => csvCell(h, SEP)).join(SEP)];
  for (const w of list) {
    const minutes = workoutSummary(w).minutes;
    let order = 0;
    for (const it of w.items || []) {
      const sets = (it.sets || []).filter((x) => x.done);
      if (!sets.length) continue;
      order++;
      const m = it.measure || 'agirlik';
      sets.forEach((s, i) => {
        const vol = setVolume(s, m);
        const est = m === 'agirlik' && s.type !== 'w' ? e1rm(s.kg, s.reps) : null;
        lines.push([
          w.day,
          WD_SHORT[keyToDate(w.day).getDay()],
          hhmm(w.started_at),
          safeText(clean(w.name) || 'Antrenman'),
          dec(minutes),
          order,
          safeText(clean(it.name)),
          KATEGORI_AD[it.cat] || '',
          i + 1,
          SET_TIP[s.type] || SET_TIP.n,
          dec(num(s.kg), 2),
          dec(num(s.reps)),
          dec(num(s.sec)),
          dec(num(s.km), 2),
          vol ? dec(vol, 1) : '',
          dec(est, 1),
          i === 0 ? safeText(clean(it.note)) : '',
        ].map((c) => csvCell(c, SEP)).join(SEP));
      });
    }
  }
  return lines.join('\r\n') + '\r\n';
}

const fmtHours = (min) => (min >= 60 ? `${Math.floor(min / 60)} sa ${min % 60} dk` : `${min} dk`);

function toMarkdown({
  rows, cols, stats: s, profile: p, range: r, includeWeight, now, todayKey, title, ws = null, wList = [], workouts = {},
}) {
  const out = [];
  const add = (...lines) => out.push(...lines);
  const w = includeWeight ? s.weight : null;

  add(`# Sağlık Panel: ${title}, gün gün`, '');
  add(`Günlük aktivite${includeWeight ? ', kilo' : ''}${ws?.sessions ? ' ve antrenman' : ''} kayıtlarım. Özet bölümündeki sayıları `
    + 'uygulama hesapladı; altında her günün satırı'
    + (ws?.sessions ? ' ve her antrenmanın hareket hareket, set set dökümü' : '') + ' var.', '');
  add(`- **Dönem:** ${longDate(r.from)} – ${longDate(r.to)} (${r.dayCount} gün)`);
  if (r.startCut) {
    add(`- İstenen dönem ${longDate(r.requested.from)} tarihinde başlıyor, ama ilk kaydım `
      + `${longDate(r.from)}; tablo oradan başlıyor.`);
  }
  if (r.todayCut) {
    add(ws?.todayIncluded
      ? `- Bugün (${longDate(todayKey)}) henüz bitmediği için günlük tabloya girmedi; bugün bitirdiğim `
        + 'antrenman(lar) antrenman bölümlerinde var.'
      : `- Bugün (${longDate(todayKey)}) henüz bitmediği için dahil edilmedi.`);
  }
  add(`- **Oluşturuldu:** ${longDate(dayKey(now))}, Sağlık Panel`);
  add('- **Okuma kuralları:** boş hücre o gün veri girilmedi demektir, sıfır değildir. '
    + 'Ortalamalar yalnız verisi olan günlerden hesaplandı. Sayılarda ondalık ayırıcı nokta, '
    + 'binlik ayırıcı yok. Tarihler YYYY-AA-GG.', '');

  /* hedefler */
  add('## Hedefler ve ölçüler', '');
  const settings = [
    ['Günlük adım hedefi', fx(s.goals.steps)],
    ['Günlük aktif kalori hedefi', `${fx(s.goals.active_kcal)} kcal`],
    ['Günlük egzersiz hedefi', `${fx(s.goals.exercise_min)} dk`],
  ];
  if (includeWeight) {
    if (num(p.height_cm)) settings.push(['Boy', `${fx(num(p.height_cm))} cm`]);
    if (num(p.target_weight) != null) settings.push(['Hedef kilo', `${fx(num(p.target_weight), 1)} kg`]);
    if (num(p.weigh_day)) settings.push(['Tartı günü', `${weekdayName(p.weigh_day)} (haftada bir)`]);
  }
  add(mdTable(['Ayar', 'Değer'], settings), '');
  add('Hedefler bugünkü ayarlardır; dönem içinde değiştirilmiş olabilir.', '');

  /* özet */
  add('## Özet', '', '### Veri kapsamı', '');
  add(`- Aktivite kaydı olan gün: ${s.logged} / ${s.dayCount} (${pct(s.logged, s.dayCount)})`);
  if (s.missing) {
    add(`- Kaydı olmayan gün: ${s.missing}; en uzun boşluk ${s.longestGap.len} gün `
      + `(${span(s.longestGap.from, s.longestGap.to)})`);
  } else {
    add('- Kaydı olmayan gün yok.');
  }
  if (includeWeight) add(`- Kilo ölçümü: ${w ? w.n : 0}`);
  add('');

  add('### Aktivite', '');
  add(mdTable(
    ['Ölçü', 'Veri olan gün', 'Toplam', 'Günlük ort.', 'Medyan', 'En yüksek', 'En düşük'],
    cols.act.map((m) => {
      const st = s.metrics[m.key];
      if (!st.n) return [m.label, 0, '', '', '', '', ''];
      return [
        m.label,
        st.n,
        m.totalDp == null ? '' : fx(st.total, m.totalDp),
        fx(st.avg, m.avgDp),
        fx(st.median, m.dp),
        `${fx(st.max.v, m.dp)} (${st.max.day})`,
        `${fx(st.min.v, m.dp)} (${st.min.day})`,
      ];
    }),
  ), '');

  add('### Hedef tutma', '');
  const g = s.goalsHit;
  add(mdTable(['Hedef', 'Tutulan gün', 'Oran'], [
    [`Adım ≥ ${fx(s.goals.steps)}`, `${g.steps.hit} / ${g.steps.n}`, pct(g.steps.hit, g.steps.n)],
    [`Aktif kalori ≥ ${fx(s.goals.active_kcal)} kcal`, `${g.active_kcal.hit} / ${g.active_kcal.n}`,
      pct(g.active_kcal.hit, g.active_kcal.n)],
    [`Egzersiz ≥ ${fx(s.goals.exercise_min)} dk`, `${g.exercise_min.hit} / ${g.exercise_min.n}`,
      pct(g.exercise_min.hit, g.exercise_min.n)],
    ['Üçü aynı gün', `${g.all.hit} / ${g.all.n}`, pct(g.all.hit, g.all.n)],
  ]), '');
  add('Payda: o ölçütün verisi olan gün sayısı.', '');
  const L = s.streak.longest;
  add(`- En uzun adım hedefi serisi: ${L.len ? `${L.len} gün (${span(L.from, L.to)})` : 'yok'}`);
  add(`- Dönemin son günü itibarıyla süren seri: ${s.streak.atEnd} gün`, '');

  if (s.metrics.steps.n) {
    add('### Günlük adım dağılımı', '');
    add(mdTable(['Günlük adım', 'Gün', 'Oran'],
      s.bands.map((b) => [b.label, b.n, pct(b.n, s.metrics.steps.n)])), '');
  }

  add('### Haftanın günleri', '');
  add(mdTable(
    ['Gün', 'Adım verisi olan gün', 'Ort. adım', 'Ort. aktif kcal', 'Ort. egzersiz dk', 'Adım hedefi tutulan gün'],
    s.weekdays.map((d) => [
      d.name,
      d.steps.n,
      d.steps.n ? fx(d.steps.avg) : '',
      d.active_kcal.n ? fx(d.active_kcal.avg) : '',
      d.exercise_min.n ? fx(d.exercise_min.avg) : '',
      d.steps.n ? d.stepGoalDays : '',
    ]),
  ), '');

  if (s.months.length) {
    add('### Aylık döküm', '');
    add(bucketTable(s.months, { kind: 'month', includeWeight }), '');
  }
  if (s.weeks.length) {
    add('### Haftalık döküm', '');
    add(bucketTable(s.weeks, { kind: 'week', includeWeight }), '');
  }
  if (s.months.length || s.weeks.length) {
    add('"Kayıtlı gün": verisi olan gün / dönemdeki gün. "(kısmi)": dönemin başında ya da sonunda '
      + 'kesilen ay/hafta.', '');
  }

  if (includeWeight) {
    add('### Kilo', '');
    if (!w) {
      add('- Bu dönemde kilo ölçümü yok.', '');
    } else {
      add(`- Ölçüm sayısı: ${w.n} (ilk ${w.first.day}, son ${w.last.day})`);
      if (w.n > 1) {
        add(`- İlk → son: ${fx(w.first.kg, 1)} → ${fx(w.last.kg, 1)} kg (değişim ${signed(w.change)} kg)`);
        add(`- En düşük: ${fx(w.min.kg, 1)} kg (${w.min.day}); en yüksek: ${fx(w.max.kg, 1)} kg (${w.max.day})`);
      } else {
        add(`- Tek ölçüm: ${fx(w.last.kg, 1)} kg`);
      }
      add(w.slopePerWeek == null
        ? '- Doğrusal eğilim: hesaplanmadı (en az iki hafta aralıklı iki ölçüm gerekir)'
        : `- Doğrusal eğilim (tüm ölçümlerden): ${signed(w.slopePerWeek, 2)} kg/hafta`);
      if (w.height) {
        add(w.n > 1
          ? `- Vücut kitle endeksi: ${fx(w.bmiFirst, 1)} → ${fx(w.bmiLast, 1)} (boy ${fx(w.height)} cm)`
          : `- Vücut kitle endeksi: ${fx(w.bmiLast, 1)} (boy ${fx(w.height)} cm)`);
      }
      if (w.target != null) {
        const d = round(w.toTarget, 1);
        add(`- Hedef kilo ${fx(w.target, 1)} kg; `
          + (d === 0 ? 'son ölçüm hedefte'
            : `son ölçüm hedefin ${fx(Math.abs(d), 1)} kg ${d > 0 ? 'üstünde' : 'altında'}`));
      }
      if (w.fat) add(`- Yağ oranı: %${fx(w.fat.first, 1)} → %${fx(w.fat.last, 1)} (${w.fat.n} ölçüm)`);
      add('');
    }
  }

  /* antrenman */
  if (ws?.sessions) {
    add('### Antrenman', '');
    add(`- Antrenman: ${ws.sessions} (haftada ortalama ${fx(ws.perWeek, 1)}); toplam süre ${fmtHours(ws.minutes)}`);
    add(`- Çalışma seti: ${ws.sets} (ısınma setleri hariç); toplam hacim ${fx(ws.volume)} kg (kg × tekrar)`);
    if (ws.records) add(`- Dönemde kişisel rekor kırılan hareket sayısı: ${ws.records}`);
    add('- Her antrenmanın hareket ve set dökümü aşağıda, **Antrenman günlüğü** bölümünde.');
    const g = GRUPLAR.filter((k) => ws.groups[k]).map((k) => `${KATEGORI_AD[k]} ${fx(ws.groups[k], 1)}`);
    if (g.length) add(`- Kas grubu başına toplam set (yardımcı kas ½ sayılır): ${g.join(' · ')}`);
    add('');
    const top = ws.exercises.slice(0, 12);
    if (top.length) {
      add('En sık yapılan hareketler (1TM: Epley formülüyle tahmini bir tekrar maksimum):', '');
      add(mdTable(['Hareket', 'Antrenman', 'Set', 'İlk 1TM', 'Son 1TM', 'Değişim', 'En iyi'], top.map((e) => {
        const ch = e.firstE1rm != null && e.lastE1rm != null && e.sessions > 1 ? e.lastE1rm - e.firstE1rm : null;
        const best = e.bestKg != null ? `${fx(e.bestKg, 1)} kg`
          : e.bestReps != null ? `${e.bestReps} tekrar` : e.bestSec != null ? fmtDur(e.bestSec) : '';
        return [e.name, e.sessions, e.sets, fx(e.firstE1rm, 1), fx(e.lastE1rm, 1),
          ch == null ? '' : `${signed(ch)} kg`, best];
      })), '');
    }
  }

  /* günlük tablo */
  add('## Günlük tablo', '');
  add(`Her gün bir satır (${rows.length} satır). Sütunlar:`, '');
  add('- `tarih`: YYYY-AA-GG');
  add('- `gun`: haftanın günü (Pzt, Sal, Çar, Per, Cum, Cmt, Paz)');
  for (const m of [...cols.act, ...cols.wgt]) add(`- \`${m.col}\`: ${m.doc}`);
  if (cols.wk) {
    add('- `antrenman`: o gün kaydettiğim antrenmanın adı (Antrenman sekmesi)');
    add('- `antrenman_dk`: antrenman süresi, dk · `set`: çalışma seti (ısınma hariç) · `hacim_kg`: kg × tekrar toplamı');
  }
  if (cols.source) {
    const seen = [...new Set(rows.map((x) => x.source).filter(Boolean))];
    add(`- \`kaynak\`: verinin geliş yolu — ${seen.map((x) => `${x} = ${SOURCE_DOC[x] || x}`).join(', ')}`);
  }
  if (cols.note) add('- `not`: o güne yazdığım not');
  add('', '```csv', dailyCsv(rows, cols), '```', '');

  /* antrenman günlüğü: gün gün, set set */
  if (wList.length) {
    add('## Antrenman günlüğü', '');
    add(`Her antrenman (${wList.length}) eskiden yeniye; hareketler yaptığım sırayla. Set yazımı: `
      + '`60 kg × 8` ağırlık × tekrar · `12 tekrar` ya da `+10 kg × 6` vücut ağırlığı · `45 sn` süre · '
      + '`20 dk · 3.2 km` kardiyo. Art arda aynı setler `(3 set)` diye birleştirildi. `ısınma` setleri '
      + 'hacme ve rekora sayılmaz; `drop` ağırlığı düşürerek ara vermeden devam, `tükeniş` son tekrara kadar. '
      + 'Hacim = kg × tekrar (vücut ağırlığı hareketlerinde yalnız eklenen ağırlık). Rekor: o güne kadarki '
      + 'en iyiyi geçen set (1TM: Epley formülüyle tahmini bir tekrar maksimum).', '');
    add(...workoutLog(wList, workouts));
  }

  /* istek: uzun verinin SONUNDA (model önce veriyi okusun) */
  const asks = [
    '**Genel tablo:** Bu dönemde ne kadar hareketliydim, hedeflerime ne kadar uydum? '
      + 'Eksik günler değerlendirmeyi etkiliyor mu?',
    '**Eğilim:** Dönem boyunca iyiye mi kötüye mi gittim? Belirgin kırılma noktaları hangi tarihlerde?',
    '**Örüntüler:** haftanın günlerine göre farklar, uzun boşluklar, sıra dışı günler.',
  ];
  if (w && w.n > 1) {
    asks.push('**Kilo:** değişimin hızı, hedefime göre durumum ve aktiviteyle ilişkisi.');
  }
  if (ws?.sessions) {
    asks.push('**Antrenman:** düzenim, güç ilerlemem (1TM değişimi) ve kas gruplarının dengesi; '
      + 'ihmal ettiğim bir kas grubu var mı?');
  }
  asks.push('**Güçlü yanlarım** ve en çok gelişmeye açık 2–3 konu.');
  asks.push('**Önümüzdeki dönem için 3–5 öneri:** her biri ölçülebilir olsun; hedeflerimi '
    + 'değiştirmem gerekiyorsa yeni değer öner.');
  add('## Değerlendirme isteği', '');
  add('Bu dosyayı değerlendirmen için gönderiyorum. Bir antrenör gözüyle; Türkçe, sade ve somut yaz:', '');
  asks.forEach((a, i) => add(`${i + 1}. ${a}`));
  add('', 'Sayıları özetten ve günlük tablodan al; kendin hesapladığın bir sayı varsa nasıl '
    + 'hesapladığını kısaca belirt. Boş hücreleri sıfır sayma. Tıbbi teşhis koyma.');

  return out.join('\n') + '\n';
}

/* ---------------- CSV (Excel için) ---------------- */

/** Excel'in hücreyi formül sanmaması için (=, +, -, @ ile başlayan metin). */
const safeText = (s) => (s && /^[=+\-@]/.test(s) ? `'${s}` : s || '');

function toCSV(rows, cols) {
  const SEP = ';';
  const dec = (v, dp) => fx(v, dp).replace('.', ',');
  const head = ['Tarih', 'Gün', ...cols.act.map((m) => m.label), ...cols.wgt.map((m) => m.label)];
  if (cols.wk) head.push('Antrenman', 'Antrenman (dk)', 'Set', 'Hacim (kg)', 'Hareketler');
  if (cols.source) head.push('Kaynak');
  if (cols.note) head.push('Not');
  const lines = [head.map((h) => csvCell(h, SEP)).join(SEP)];
  for (const r of rows) {
    const cells = [
      r.day,
      WD_SHORT[r.wd],
      ...cols.act.map((m) => dec(r[m.key], m.dp)),
      ...cols.wgt.map((m) => dec(r[m.key], m.dp)),
    ];
    if (cols.wk) {
      cells.push(safeText(r.w_names || ''), dec(r.w_min, 0), dec(r.w_sets, 0), dec(r.w_vol, 0), safeText(r.w_ex || ''));
    }
    if (cols.source) cells.push(r.source || '');
    if (cols.note) cells.push(safeText(r.note));
    lines.push(cells.map((c) => csvCell(c, SEP)).join(SEP));
  }
  return lines.join('\r\n') + '\r\n';
}

/* ---------------- giriş noktası ---------------- */

function fullYearOf({ from, to }) {
  const y = from.slice(0, 4);
  return from === `${y}-01-01` && to === `${y}-12-31` ? Number(y) : null;
}

/**
 * Dışa aktarma dosyasını üretir.
 * data: { days, weights, profile } (core-store state'i doğrudan verilebilir)
 * opts: { from, to, format: 'md'|'csv'|'sets', includeWeight, todayKey, now }
 *   'sets': antrenman setleri, her set bir satır (Excel). Dönemde antrenman yoksa empty + reason 'workouts'.
 * @returns {empty:true, range} | {empty:false, format, text, filename, mime, bom, range, rows, stats}
 *   bom: dosyaya yazarken başa UTF-8 BOM eklenmeli (Excel Türkçe harfleri ancak böyle tanıyor).
 */
export function buildExport(data = {}, opts = {}) {
  const { days = {}, weights = {}, profile = {}, workouts = {} } = data;
  const {
    from, to, format = 'md', includeWeight = true, todayKey = today(), now = new Date(),
  } = opts;

  const range = resolveRange(days, weights, from, to, { todayKey, includeWeight, workouts });
  if (range.empty) return { empty: true, range };

  // Bitmiş antrenman tamamlanmış veridir: dönem bugüne uzanıyorsa bugünküler de girer (günlük tabloya değil).
  const all = finished(workouts);
  const wTo = range.to === shiftDay(todayKey, -1) && all.some((w) => w.day === todayKey) ? todayKey : range.to;
  const wList = all.filter((w) => w.day >= range.from && w.day <= wTo);
  const ws = periodStats(workouts, range.from, wTo);
  ws.todayIncluded = wTo !== range.to;
  const rows = buildRows(days, weights, range.from, range.to, { includeWeight, byDay: ws.byDay });
  const listByDay = {};
  for (const w of wList) (listByDay[w.day] || (listByDay[w.day] = [])).push(w);
  for (const r of rows) r.w_ex = listByDay[r.day] ? dayExercisesText(listByDay[r.day], ',') || null : null;
  const cols = columnsFor(rows, { includeWeight });
  const stats = computeStats(rows, profile);
  stats.workouts = ws;
  const year = fullYearOf(range.requested);
  const base = year ? `saglik-panel-${year}` : `saglik-panel-${range.from}_${range.to}`;

  if (format === 'sets') {
    if (!wList.length) return { empty: true, reason: 'workouts', range, format, stats };
    return {
      empty: false, format, range, rows, stats,
      text: toSetsCSV(wList), filename: `${base.replace('saglik-panel', 'saglik-panel-antrenman')}.csv`,
      mime: 'text/csv', bom: true,
    };
  }
  if (format === 'csv') {
    return {
      empty: false, format, range, rows, stats,
      text: toCSV(rows, cols), filename: `${base}.csv`, mime: 'text/csv', bom: true,
    };
  }
  const title = year ? `${year} yılı` : `${longDate(range.from)} – ${longDate(range.to)}`;
  return {
    empty: false, format: 'md', range, rows, stats,
    text: toMarkdown({ rows, cols, stats, profile, range, includeWeight, now, todayKey, title, ws, wList, workouts }),
    filename: `${base}.md`, mime: 'text/markdown', bom: false,
  };
}
