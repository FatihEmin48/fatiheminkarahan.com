/* charts.js — bağımlılıksız SVG grafikler (çubuk, çizgi, kıvılcım). */

import { nf } from './core/core-util.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Çubuk grafik.
 * items: [{label, value, hit, sub}] · goal: hedef çizgisi (isteğe bağlı)
 */
export function barChart(items, { goal = null, height = 132, unit = '', showValues = true } = {}) {
  const n = Math.max(1, items.length);
  const W = 300;
  const H = height;
  const padB = 18;
  const padT = showValues ? 14 : 6;
  const gap = n > 20 ? 1 : n > 12 ? 2 : 4;
  const bw = (W - gap * (n - 1)) / n;
  const max = Math.max(goal || 0, ...items.map((i) => Number(i.value) || 0), 1);
  const scale = (v) => ((H - padB - padT) * (Number(v) || 0)) / max;

  let out = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px">`;

  if (goal) {
    const y = H - padB - scale(goal);
    out += `<line class="goal-line" x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}"/>`;
  }

  items.forEach((it, i) => {
    const v = Number(it.value) || 0;
    const h = Math.max(v > 0 ? 2 : 0, scale(v));
    const x = i * (bw + gap);
    const y = H - padB - h;
    const cls = v === 0 ? 'bar dim' : it.hit ? 'bar hit' : 'bar';
    out += `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}"`
      + ` height="${h.toFixed(1)}" rx="${Math.min(3, bw / 3).toFixed(1)}"><title>${esc(it.label)}: `
      + `${nf(v)}${unit}</title></rect>`;
    if (it.label) {
      out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle"`
        + ` style="font-size:${n > 14 ? 7 : 9}px">${esc(it.label)}</text>`;
    }
    if (showValues && v > 0 && n <= 12) {
      out += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle"`
        + ` style="font-size:8px">${esc(shortNum(v))}</text>`;
    }
  });

  return out + '</svg>';
}

function shortNum(v) {
  if (v >= 10000) return Math.round(v / 1000) + 'b';
  if (v >= 1000) return (v / 1000).toFixed(1).replace('.', ',') + 'b';
  return String(Math.round(v));
}

/**
 * Çizgi grafik (kilo eğrisi).
 * points: [{label, value}] · target: hedef çizgisi
 */
export function lineChart(points, { height = 150, target = null, unit = ' kg' } = {}) {
  const pts = points.filter((p) => p.value != null);
  if (pts.length < 2) {
    return `<div class="muted small" style="padding:18px 0;text-align:center">`
      + `En az iki ölçüm olunca eğri çizilir.</div>`;
  }
  const W = 300;
  const H = height;
  const padL = 4;
  const padR = 4;
  const padT = 12;
  const padB = 20;

  const vals = pts.map((p) => Number(p.value));
  const all = target != null ? [...vals, target] : vals;
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (max - min < 1) { max += 0.5; min -= 0.5; }
  const padY = (max - min) * 0.12;
  min -= padY;
  max += padY;

  const x = (i) => padL + ((W - padL - padR) * i) / (pts.length - 1);
  const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / (max - min));

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${H - padB} L${x(0).toFixed(1)} ${H - padB} Z`;

  let out = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px">`;
  out += `<path class="area" d="${area}"/><path class="line" d="${line}"/>`;

  if (target != null) {
    const ty = y(target);
    out += `<line class="target" x1="0" y1="${ty.toFixed(1)}" x2="${W}" y2="${ty.toFixed(1)}"/>`
      + `<text x="${W - 2}" y="${(ty - 4).toFixed(1)}" text-anchor="end">hedef ${nf(target, 1)}</text>`;
  }

  pts.forEach((p, i) => {
    const last = i === pts.length - 1;
    out += `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}"`
      + ` r="${last ? 3.4 : 2.1}"><title>${esc(p.label)}: ${nf(p.value, 1)}${unit}</title></circle>`;
  });

  // ilk/son etiket ve son değer
  out += `<text x="${padL}" y="${H - 5}">${esc(pts[0].label)}</text>`
    + `<text x="${W - padR}" y="${H - 5}" text-anchor="end">${esc(pts[pts.length - 1].label)}</text>`
    + `<text x="${W - padR}" y="${Math.max(9, y(vals[vals.length - 1]) - 8).toFixed(1)}"`
    + ` text-anchor="end" style="font-size:10px;font-weight:800">${nf(vals[vals.length - 1], 1)}</text>`;

  return out + '</svg>';
}

/** Küçük kıvılcım çizgisi. */
export function sparkline(values, { height = 46, color = 'var(--stand)' } = {}) {
  const vals = values.filter((v) => v != null).map(Number);
  if (vals.length < 2) return '';
  const W = 300;
  const H = height;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => (W * i) / (vals.length - 1);
  const y = (v) => 4 + (H - 10) * (1 - (v - min) / span);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px">`
    + `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"`
    + ` stroke-linejoin="round"/>`
    + `<circle cx="${x(vals.length - 1).toFixed(1)}" cy="${y(vals[vals.length - 1]).toFixed(1)}"`
    + ` r="3" fill="${color}"/></svg>`;
}
