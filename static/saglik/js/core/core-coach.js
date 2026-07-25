/* OTOMATİK KOPYA — kaynak: shared/core-coach.js. Elle düzenleme, shared/ içindekini düzenle. */
/* core-coach.js — verilerden özet çıkarır ve yapay zekâ olmadan da çalışan
   bir değerlendirme metni üretir. AI açıksa aynı özet ona da gönderilir. */

import {
  today, weekStart, monthStart, shiftDay, prettyWeek, prettyMonth, nf, dur,
} from './core-util.js';
import {
  weekReport, monthReport, weightReport, stepStreak, missingDays, dayScore,
} from './core-analysis.js';

/** Değerlendirme için gereken sayıları tek nesnede toplar (kişisel bilgi içermez). */
export function buildSummary(days, weights, profile = {}) {
  const w = weekReport(days, weekStart(), profile);
  const prevW = weekReport(days, shiftDay(weekStart(), -7), profile);
  const m = monthReport(days, monthStart(), profile);
  const wr = weightReport(weights, profile);
  const streak = stepStreak(days, profile.step_goal || 8000);
  const eksik = missingDays(days, 14).filter((k) => k !== today());

  const gunler = w.series.filter((d) => !d.future && d.steps != null);
  const enIyi = gunler.reduce((a, b) => (a && a.steps >= b.steps ? a : b), null);
  const enDusuk = gunler.reduce((a, b) => (a && a.steps <= b.steps ? a : b), null);

  return {
    hedefler: {
      adim: profile.step_goal || 8000,
      kalori: profile.kcal_goal || 500,
      egzersiz: profile.exercise_goal || 30,
      hedefKilo: profile.target_weight ?? null,
      boy: profile.height_cm ?? null,
    },
    buHafta: {
      etiket: prettyWeek(w.start),
      kayitliGun: w.totals.daysLogged,
      adim: w.totals.steps,
      gunlukOrtalamaAdim: w.totals.avgSteps,
      mesafeKm: w.totals.distance_km,
      kalori: w.totals.active_kcal,
      egzersizDk: w.totals.exercise_min,
      hedefTutanGun: w.stepGoalDays,
      kiyasEtiketi: w.prevLabel,
      adimDegisimYuzde: w.delta.steps.pct,
      egzersizDegisimYuzde: w.delta.exercise_min.pct,
    },
    gecenHafta: {
      adim: prevW.totals.steps,
      gunlukOrtalamaAdim: prevW.totals.avgSteps,
      egzersizDk: prevW.totals.exercise_min,
    },
    buAy: {
      etiket: prettyMonth(m.start),
      kayitliGun: m.totals.daysLogged,
      adim: m.totals.steps,
      gunlukOrtalamaAdim: m.totals.avgSteps,
      hedefTutanGun: m.stepGoalDays,
      adimDegisimYuzde: m.delta.steps.pct,
    },
    kilo: wr.empty ? null : {
      son: wr.latest.kg,
      olcumSayisi: wr.count,
      haftalikDegisim: wr.sinceWeek,
      aylikDegisim: wr.sinceMonth,
      baslangictanBeri: wr.sinceStart,
      egilimKgHafta: wr.slopePerWeek,
      vke: wr.bmi,
      vkeEtiketi: wr.bmiLabel,
      hedefeKalan: wr.toTarget,
      hedefeHaftaTahmini: wr.etaWeeks,
    },
    seri: streak,
    eksikGunSayisi: eksik.length,
    enIyiGun: enIyi ? { gun: enIyi.day, adim: enIyi.steps } : null,
    enDusukGun: enDusuk ? { gun: enDusuk.day, adim: enDusuk.steps } : null,
    bugun: (() => {
      const rec = days[today()];
      if (!rec) return null;
      const sc = dayScore(rec, profile);
      return { adim: rec.steps ?? null, kalori: rec.active_kcal ?? null,
        egzersizDk: rec.exercise_min ?? null, yuzde: sc.overall };
    })(),
  };
}

const yuzde = (v) => (v == null ? null : `%${Math.abs(v)}`);

/** Yapay zekâ olmadan, kurallara dayalı değerlendirme (her zaman çalışır). */
export function localAssessment(s) {
  const p = [];
  const h = s.buHafta;

  if (!h.kayitliGun) {
    p.push('Bu hafta henüz veri girilmemiş. Bir günün adım ve egzersiz bilgisini girersen '
      + 'karşılaştırmalar hemen başlar.');
  } else {
    p.push(`Bu hafta ${h.kayitliGun} günde ${nf(h.adim)} adım attın; günlük ortalaman `
      + `${nf(h.gunlukOrtalamaAdim)} adım (hedef ${nf(s.hedefler.adim)}).`);

    if (h.adimDegisimYuzde != null) {
      const yon = h.adimDegisimYuzde >= 0 ? 'daha yüksek' : 'daha düşük';
      p.push(`${h.kiyasEtiketi} ile karşılaştırıldığında ${yuzde(h.adimDegisimYuzde)} ${yon} bir tempo.`);
    }

    if (h.hedefTutanGun >= 5) {
      p.push(`Adım hedefini ${h.hedefTutanGun} gün tutturmuşsun — bu haftanın en güçlü yanı bu.`);
    } else if (h.hedefTutanGun > 0) {
      p.push(`Adım hedefini ${h.hedefTutanGun} gün tutturdun; bir gün daha eklemek ortalamayı `
        + 'belirgin şekilde yukarı çeker.');
    } else {
      p.push('Bu hafta adım hedefini tutturduğun gün yok. Hedefi biraz düşürmek ya da '
        + 'güne 15 dakikalık bir yürüyüş eklemek işe yarayabilir.');
    }

    if (h.egzersizDk != null) {
      const gunluk = h.kayitliGun ? Math.round(h.egzersizDk / h.kayitliGun) : 0;
      p.push(`Egzersiz toplamı ${dur(h.egzersizDk)} (günde ~${gunluk} dk, hedef `
        + `${s.hedefler.egzersiz} dk).`);
    }
  }

  if (s.seri > 2) p.push(`${s.seri} gündür adım hedefini kesintisiz tutuyorsun.`);

  if (s.kilo) {
    const k = s.kilo;
    const parts = [`Son ölçümün ${nf(k.son, 1)} kg`];
    if (k.haftalikDegisim != null && k.haftalikDegisim !== 0) {
      parts.push(`son bir haftada ${k.haftalikDegisim < 0 ? 'düşüş' : 'artış'} `
        + `${nf(Math.abs(k.haftalikDegisim), 1)} kg`);
    }
    if (k.egilimKgHafta) {
      parts.push(`eğilim haftada ${nf(k.egilimKgHafta, 2)} kg`);
    }
    p.push(parts.join(', ') + '.');

    if (k.hedefeKalan != null && k.hedefeHaftaTahmini) {
      p.push(`Hedefe ${nf(Math.abs(k.hedefeKalan), 1)} kg kaldı; bu hızla yaklaşık `
        + `${k.hedefeHaftaTahmini} hafta sürer.`);
    } else if (k.hedefeKalan != null) {
      p.push(`Hedefine ${nf(Math.abs(k.hedefeKalan), 1)} kg var; kiloyu düzenli girmek `
        + 'eğilimi netleştirir.');
    }
    if (k.vke) p.push(`Vücut kitle endeksin ${nf(k.vke, 1)} (${k.vkeEtiketi}).`);
  } else {
    p.push('Henüz kilo ölçümü yok; haftada bir tartılmak eğilimi görmenin en kolay yolu.');
  }

  if (s.eksikGunSayisi >= 3) {
    p.push(`Son iki haftada ${s.eksikGunSayisi} günün verisi eksik — eksik günler `
      + 'ortalamaları olduğundan düşük gösterir.');
  }

  return p.join(' ');
}

/** AI'ya gönderilecek istem (kişisel bilgi yok, yalnız sayılar). */
export function buildPrompt(s) {
  return [
    'Aşağıda bir kişinin son dönem aktivite ve kilo verileri var (JSON).',
    'Türkçe, sade ve somut bir değerlendirme yaz:',
    '1) Bu haftanın özeti ve geçen haftaya göre durumu,',
    '2) İyi giden bir şey ve düzeltilmesi gereken bir şey,',
    '3) Önümüzdeki hafta için 2-3 uygulanabilir, ölçülebilir öneri,',
    '4) Kilo eğilimi hakkında kısa bir yorum (veri varsa).',
    'Kurallar: en fazla 180 kelime, madde işareti kullanma, abartılı övgü yok,',
    'tıbbi teşhis koyma, verideki sayıları kullan, gereksiz uyarı cümleleri ekleme.',
    '',
    JSON.stringify(s),
  ].join('\n');
}
