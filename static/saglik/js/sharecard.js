/* sharecard.js — dönem özetini paylaşılabilir bir PNG'ye çizer.
 *
 * Tuval 1080x1350 (Instagram hikâye/gönderi oranına yakın, WhatsApp'ta da düzgün
 * görünür). Yazı tipi tarayıcının kendi yazı tipi olduğu için Türkçe karakterler
 * sorunsuz çıkar.
 *
 * Kişisel bilgi yazılmaz: ad isteğe bağlıdır, kilo hiçbir zaman karta girmez.
 */

import * as U from './core/core-util.js';

const W = 1080;
const H = 1350;

export const PERIODS = [
  { id: 'week', label: 'Bu Hafta', title: 'HAFTALIK ÖZET' },
  { id: 'month', label: 'Bu Ay', title: 'AYLIK ÖZET' },
  { id: 'year', label: 'Bu Yıl', title: 'YILLIK ÖZET' },
];

export const THEMES = [
  { id: 'yesil', label: 'Yeşil', bg: ['#04231a', '#0b3d2e'], accent: '#34d399', glow: '#34d39955' },
  { id: 'gece', label: 'Gece', bg: ['#0b1020', '#131c33'], accent: '#60a5fa', glow: '#60a5fa55' },
  { id: 'gunbatimi', label: 'Gün Batımı', bg: ['#2a1206', '#4a1f0c'], accent: '#fb923c', glow: '#fb923c55' },
  { id: 'mor', label: 'Mor', bg: ['#1a0b2e', '#2d1b4e'], accent: '#a78bfa', glow: '#a78bfa55' },
];

/** Dönem başlangıcı — sunucudaki date_trunc ile aynı kural (hafta pazartesi). */
export function periodRange(period, ref = U.today()) {
  const to = ref;
  let from;
  if (period === 'week') from = U.weekStart(ref);
  else if (period === 'month') from = U.monthStart(ref);
  else from = U.yearStart(ref);
  return { from, to };
}

/**
 * Günlerden dönem toplamlarını çıkarır.
 * days: { 'YYYY-MM-DD': {steps, distance_km, active_kcal, exercise_min} }
 */
export function summarize(days, period, profile = {}, ref = U.today()) {
  const { from, to } = periodRange(period, ref);
  const rows = [];
  for (const [key, d] of Object.entries(days || {})) {
    if (key >= from && key <= to) rows.push({ day: key, ...d });
  }
  rows.sort((a, b) => (a.day < b.day ? -1 : 1));

  const sum = (k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const active = rows.filter((r) => Number(r.steps) > 0);
  const steps = sum('steps');
  const goal = Number(profile.step_goal) || 8000;

  // Hedefi tutturulan gün sayısı ve en uzun seri
  let streak = 0;
  let best = 0;
  for (const r of rows) {
    if (Number(r.steps) >= goal) { streak++; best = Math.max(best, streak); } else streak = 0;
  }

  return {
    from,
    to,
    steps,
    distance: sum('distance_km'),
    kcal: sum('active_kcal'),
    exercise: sum('exercise_min'),
    days: active.length,
    avg: active.length ? Math.round(steps / active.length) : 0,
    goalDays: rows.filter((r) => Number(r.steps) >= goal).length,
    bestStreak: best,
    bestDay: active.reduce((m, r) => (Number(r.steps) > Number(m?.steps || 0) ? r : m), null),
    series: rows.map((r) => Number(r.steps) || 0),
  };
}

/* ------------------------------------------------------------------- çizim */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const nf = (n) => Number(n || 0).toLocaleString('tr-TR');

function prettyRange(from, to, period) {
  const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const d1 = U.keyToDate(from);
  const d2 = U.keyToDate(to);
  if (period === 'year') return String(d2.getFullYear());
  if (period === 'month') return `${AY[d2.getMonth()]} ${d2.getFullYear()}`;
  if (d1.getMonth() === d2.getMonth()) {
    return `${d1.getDate()}–${d2.getDate()} ${AY[d2.getMonth()]} ${d2.getFullYear()}`;
  }
  return `${d1.getDate()} ${AY[d1.getMonth()]} – ${d2.getDate()} ${AY[d2.getMonth()]} ${d2.getFullYear()}`;
}

/** Sütun grafiği — dönem uzunsa haftalık/aylık kovalara toplanır. */
function drawBars(ctx, series, x, y, w, h, accent, glow) {
  if (!series.length) return;
  let data = series;
  if (series.length > 40) {
    const bucket = Math.ceil(series.length / 30);
    data = [];
    for (let i = 0; i < series.length; i += bucket) {
      data.push(series.slice(i, i + bucket).reduce((a, b) => a + b, 0));
    }
  }
  const max = Math.max(...data, 1);
  const gap = data.length > 20 ? 4 : 10;
  const bw = Math.max(3, (w - gap * (data.length - 1)) / data.length);

  data.forEach((v, i) => {
    const bh = Math.max(4, (v / max) * h);
    const bx = x + i * (bw + gap);
    const by = y + h - bh;
    const g = ctx.createLinearGradient(0, by, 0, y + h);
    g.addColorStop(0, accent);
    g.addColorStop(1, glow);
    ctx.fillStyle = g;
    roundRect(ctx, bx, by, bw, bh, Math.min(bw / 2, 8));
    ctx.fill();
  });
}

function statBox(ctx, x, y, w, h, label, value, unit, accent) {
  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  roundRect(ctx, x, y, w, h, 26);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.52)';
  ctx.font = '600 26px system-ui, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(label.toUpperCase(), x + 32, y + 52);

  ctx.fillStyle = '#fff';
  ctx.font = '700 62px system-ui, "Segoe UI", Roboto, sans-serif';
  const vx = x + 32;
  ctx.fillText(value, vx, y + 122);

  if (unit) {
    const vw = ctx.measureText(value).width;
    ctx.fillStyle = accent;
    ctx.font = '600 30px system-ui, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(unit, vx + vw + 12, y + 122);
  }
}

/**
 * Kartı çizer ve tuvali döndürür.
 * opts: { period, theme, name, showName }
 */
export function drawCard(s, opts = {}) {
  const period = opts.period || 'week';
  const theme = THEMES.find((t) => t.id === opts.theme) || THEMES[0];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Zemin
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, theme.bg[0]);
  bg.addColorStop(1, theme.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const halo = ctx.createRadialGradient(W * 0.82, H * 0.12, 0, W * 0.82, H * 0.12, W * 0.75);
  halo.addColorStop(0, theme.glow);
  halo.addColorStop(1, 'transparent');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  // Başlık
  const meta = PERIODS.find((p) => p.id === period) || PERIODS[0];
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.accent;
  ctx.font = '700 30px system-ui, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(meta.title, 72, 118);

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '500 30px system-ui, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(prettyRange(s.from, s.to, period), 72, 168);

  if (opts.showName && opts.name) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = '600 32px system-ui, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(String(opts.name).slice(0, 20), W - 72, 118);
    ctx.textAlign = 'left';
  }

  // Ana sayı: toplam adım
  ctx.fillStyle = '#fff';
  ctx.font = '800 168px system-ui, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(nf(s.steps), 68, 340);

  ctx.fillStyle = theme.accent;
  ctx.font = '700 44px system-ui, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('adım', 74, 396);

  // Grafik
  drawBars(ctx, s.series, 72, 440, W - 144, 190, theme.accent, theme.glow);

  // Dört kutu
  const gap = 24;
  const bw = (W - 144 - gap) / 2;
  const bh = 165;
  const top = 690;
  statBox(ctx, 72, top, bw, bh, 'Mesafe', String(Math.round(s.distance * 10) / 10).replace('.', ','), 'km', theme.accent);
  statBox(ctx, 72 + bw + gap, top, bw, bh, 'Kalori', nf(s.kcal), 'kcal', theme.accent);
  statBox(ctx, 72, top + bh + gap, bw, bh, 'Egzersiz', nf(s.exercise), 'dk', theme.accent);
  statBox(ctx, 72 + bw + gap, top + bh + gap, bw, bh, 'Günlük ort.', nf(s.avg), 'adım', theme.accent);

  // Alt şerit: hedef ve seri
  const stripY = top + (bh + gap) * 2 + 8;
  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  roundRect(ctx, 72, stripY, W - 144, 118, 26);
  ctx.fill();

  const cells = [
    ['Veri girilen gün', nf(s.days)],
    ['Hedefi tutturulan', nf(s.goalDays)],
    ['En uzun seri', nf(s.bestStreak)],
  ];
  const cw = (W - 144) / cells.length;
  cells.forEach(([label, value], i) => {
    const cx = 72 + cw * i + cw / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '700 46px system-ui, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(value, cx, stripY + 62);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '500 24px system-ui, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(label, cx, stripY + 96);
    if (i < cells.length - 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(72 + cw * (i + 1), stripY + 28, 2, 62);
    }
  });

  // Alt bilgi
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.34)';
  ctx.font = '500 26px system-ui, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Sağlık Panel · fatiheminkarahan.com/saglik', W / 2, H - 52);

  return canvas;
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Görüntü oluşturulamadı'))), type, quality);
  });
}

export function fileName(period) {
  const p = { week: 'hafta', month: 'ay', year: 'yil' }[period] || 'ozet';
  return `saglik-${p}-${U.today()}.png`;
}
