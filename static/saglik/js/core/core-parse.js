/* OTOMATİK KOPYA — kaynak: shared/core-parse.js. Elle düzenleme, shared/ içindekini düzenle. */
/* core-parse.js — Apple Fitness / tartı ekran görüntüsü OCR metnini sayılara çevirir.
   Türkçe ve İngilizce arayüz, "455/500" biçimli hedefli değerler, TR/EN sayı biçimleri. */

import { parseNum, fold, clamp } from './core-util.js';

/* Etiket sözlüğü: her ölçüt için anahtar sözcükler ve birim kalıpları. */
const METRICS = [
  {
    key: 'active_kcal',
    kind: 'int',
    labels: ['hareket', 'move', 'aktif kalori', 'active energy', 'aktif enerji', 'kalori', 'calories'],
    units: ['kal', 'cal', 'kcal', 'kalori'],
    range: [0, 20000],
  },
  {
    key: 'exercise_min',
    kind: 'int',
    labels: ['egzersiz', 'exercise', 'antrenman', 'workout', 'egzersiz dakikasi'],
    units: ['dk', 'dak', 'min', 'mins', 'dakika'],
    range: [0, 1440],
  },
  {
    key: 'stand_hours',
    kind: 'int',
    labels: ['ayakta', 'stand', 'ayakta durma', 'durus', 'ayakta durma saati'],
    units: ['sa', 'saat', 'hrs', 'hr', 'hour', 'hours'],
    range: [0, 24],
  },
  {
    key: 'steps',
    kind: 'int',
    labels: ['adim', 'adim sayisi', 'steps', 'step count', 'adim sayisi bugun'],
    units: ['adim', 'steps'],
    range: [0, 200000],
  },
  {
    key: 'distance_km',
    kind: 'float',
    labels: ['mesafe', 'distance', 'yurume + kosu mesafesi', 'walking + running distance',
      'yurume ve kosu mesafesi', 'adim mes', 'adim mesafesi', 'walking distance'],
    units: ['km', 'kilometre', 'mi', 'mil', 'miles'],
    range: [0, 500],
  },
];

const MI_TO_KM = 1.609344;

/**
 * OCR çıktısını okunur hale getirir: satır sonu normalize, fazla boşluk temizliği.
 * ML Kit / Apple Canlı Metin çıktısı doğrudan buraya verilebilir.
 */
export function cleanText(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "455/500" → 455 · "8.432" → 8432 */
function firstNumber(text, kind) {
  const m = String(text).match(/-?[\d][\d.,]*/);
  if (!m) return null;
  return parseNum(m[0], kind);
}

/** satırdaki tüm sayı adaylarını sırayla döndür */
function numbersIn(text, kind) {
  const out = [];
  const re = /-?[\d][\d.,]*/g;
  let m;
  while ((m = re.exec(text))) {
    const v = parseNum(m[0], kind);
    if (v != null) out.push({ value: v, index: m.index, raw: m[0] });
  }
  return out;
}

/**
 * OCR metnini ayrıştırır.
 * @returns {{values: object, hits: object, unmatched: string[]}}
 *   values: {steps, distance_km, active_kcal, exercise_min, stand_hours}
 *   hits: her ölçüt için hangi satırdan geldiği (gözden geçirme ekranında gösterilir)
 */
export function parseFitnessText(raw) {
  const lines = cleanText(raw)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const values = {};
  const hits = {};
  const used = new Set();      // değeri alınan satırlar (ikinci geçişte tekrar kullanılmasın)

  const setValue = (key, value, line, range) => {
    if (value == null) return;
    if (value < range[0] || value > range[1]) return;
    if (values[key] != null) return;              // ilk güvenilir eşleşme kalır
    values[key] = value;
    hits[key] = line;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = fold(line);

    for (const m of METRICS) {
      if (values[m.key] != null) continue;

      const hasLabel = m.labels.some((l) => f.includes(l));
      const unitRe = new RegExp(`(?:^|[^a-z])(${m.units.join('|')})(?:$|[^a-z])`, 'i');
      const hasUnit = unitRe.test(f);
      if (!hasLabel && !hasUnit) continue;

      // 1) aynı satırda sayı var mı?
      let nums = numbersIn(line, m.kind);
      let src = line;

      // 2) yoksa sonraki satırlara bak: OCR etiketi ve değeri ayrı satırlara,
      //    hatta araya "Bugün" gibi satırlar koyarak verebiliyor.
      let srcIndex = i;
      for (let j = 1; j <= 5 && !nums.length && i + j < lines.length; j++) {
        const nextLine = lines[i + j];
        const nf2 = fold(nextLine);
        // Başka bir ölçütün etiketine geldiysek dur — ama o etiket bu ölçütünkini de
        // içeriyorsa (ör. "Adım Sayısı" ve "Adım Mes...") durmak yerine devam et.
        const otherLabel = METRICS.some((o) => o.key !== m.key
          && o.labels.some((l) => nf2.includes(l))
          && !m.labels.some((l) => nf2.includes(l) && l.length > 3));
        if (otherLabel) break;
        // "Bugün", "Today", ">" gibi ara satırları atla
        if (!/\d/.test(nextLine)) continue;
        const cand = numbersIn(nextLine, m.kind);
        // aralık dışı değer bu ölçüte ait değildir; aramayı sürdür
        if (cand.length && (cand[0].value < m.range[0] || cand[0].value > m.range[1])) continue;
        nums = cand;
        src = nextLine;
        srcIndex = i + j;
      }
      if (!nums.length) continue;

      let value = nums[0].value;

      // "455/500 KAL" → hedef değil, ulaşılan değer
      if (/\d\s*\/\s*\d/.test(src) && nums.length >= 2) value = nums[0].value;

      // mil → km
      if (m.key === 'distance_km' && /(^|[^a-z])(mi|mil|miles)([^a-z]|$)/i.test(fold(src))
          && !/km/i.test(fold(src))) {
        value = Math.round(value * MI_TO_KM * 100) / 100;
      }

      // adım sayısı ondalık gelmez (OCR "8.432" → 8432)
      if (m.kind === 'int') value = Math.round(value);

      setValue(m.key, value, src, m.range);
      if (values[m.key] != null) used.add(srcIndex);
    }
  }

  // İkinci geçiş: OCR satırları karıştığında "12.923" gibi tek başına kalan sayı
  // neredeyse her zaman adım sayısıdır. Etiketi görülmüş ama değeri bulunamamışsa kurtar.
  if (values.steps == null) {
    const sawStepLabel = lines.some((l) => {
      const f2 = fold(l);
      return ['adim sayisi', 'adim', 'steps'].some((k) => f2.includes(k));
    });
    if (sawStepLabel) {
      for (let i = 0; i < lines.length; i++) {
        if (used.has(i)) continue;
        const line = lines[i];
        if (!/^[\d][\d.,\s]*$/.test(line)) continue;          // yalnız sayıdan ibaret satır
        const v = parseNum(line, 'int');
        if (v == null || v < 500 || v > 200000) continue;
        values.steps = Math.round(v);
        hits.steps = line;
        used.add(i);
        break;
      }
    }
  }

  // Tutarlılık: 100 km'den uzun "mesafe" ya da adım/mesafe karışması olduysa ele
  if (values.distance_km != null && values.steps != null) {
    // 10.000 adım ≈ 7-8 km; mesafe adım sayısıyla taban tabana zıtsa mesafeyi at
    const implied = values.steps * 0.00075;
    if (values.distance_km > implied * 4 + 5) {
      delete values.distance_km;
      delete hits.distance_km;
    }
  }

  return {
    values,
    hits,
    lineCount: lines.length,
    empty: Object.keys(values).length === 0,
  };
}

/**
 * Tartı fotoğrafı / metni → kilogram.
 * "78,4" · "78.4 kg" · "078.4" · "kg 78,4" biçimlerini yakalar; makul aralık: 25-400.
 */
export function parseWeightText(raw, { min = 25, max = 400, hint = null, strict = false } = {}) {
  const text = String(raw || '');
  const cands = [];

  const re = /(\d{2,3})\s*[.,]?\s*(\d)?\s*(?:kg|kilo)?/gi;
  let m;
  while ((m = re.exec(text))) {
    const whole = Number(m[1]);
    const hasDec = !!m[2];
    const frac = hasDec ? Number(m[2]) : 0;
    let v = whole + frac / 10;
    // "784" gibi ayırıcısı okunmamış değerler: 78,4 olarak yorumla
    if (v > max && v >= 250 && v <= 4000) v = Number((v / 10).toFixed(1));
    if (v < min || v > max) continue;
    const near = /kg|kilo/i.test(text.slice(Math.max(0, m.index - 6), m.index + m[0].length + 6));
    cands.push({ value: Number(v.toFixed(1)), near, dec: hasDec, score: (near ? 2 : 0) + (hasDec ? 1 : 0) });
  }

  if (!cands.length) return null;

  // Fotoğraftan okumada gürültü çok: yalnız inandırıcı adayları kabul et.
  let list = cands;
  if (strict) {
    list = cands.filter((c) => c.dec || c.near);
    if (hint != null) list = list.filter((c) => Math.abs(c.value - hint) <= 20);
    else list = list.filter((c) => c.value >= 30 && c.value <= 250);
    if (!list.length) return null;
  }

  if (hint != null) {
    list.sort((a, b) => Math.abs(a.value - hint) - Math.abs(b.value - hint) || b.score - a.score);
  } else {
    list.sort((a, b) => b.score - a.score || b.value - a.value);
  }
  return list[0].value;
}

/** Kullanıcının elle girdiği kiloyu temizler ("78,4 kg" → 78.4) */
export function normalizeWeightInput(raw) {
  const v = parseNum(raw, 'float');
  if (v == null) return null;
  const kg = v > 400 && v < 4000 ? v / 10 : v;    // 784 → 78.4
  if (kg < 25 || kg > 400) return null;
  return Number(kg.toFixed(1));
}

/** OCR sonucunu daily_activity satırına çevirir (null alanlar dokunulmaz). */
export function toActivityPatch(values) {
  const out = {};
  if (values.steps != null) out.steps = clamp(Math.round(values.steps), 0, 200000);
  if (values.distance_km != null) out.distance_km = Number(clamp(values.distance_km, 0, 500).toFixed(2));
  if (values.active_kcal != null) out.active_kcal = clamp(Math.round(values.active_kcal), 0, 20000);
  if (values.exercise_min != null) out.exercise_min = clamp(Math.round(values.exercise_min), 0, 1440);
  if (values.stand_hours != null) out.stand_hours = clamp(Math.round(values.stand_hours), 0, 24);
  return out;
}
