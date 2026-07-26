// Eğri editörü: tuval üzerinde kontrol noktalarını sürükle, boşluğa dokunarak ekle,
// çift dokunuşla sil. Arka planda o anki histogram gösterilir.

import { sampleCurve } from './curves.js';

const HIT = 12;

export class CurveEditor {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    this.channel = 'rgb';
    this.hist = null;
    this.dragIndex = -1;
    this.onChange = opts.onChange || (() => {});
    this.onBegin = opts.onBegin || (() => {});
    this.onEnd = opts.onEnd || (() => {});
    this.bind();
  }

  setPoints(pts) {
    this.points = pts.map((p) => ({ ...p }));
    this.draw();
  }

  getPoints() {
    return this.points.map((p) => ({ ...p }));
  }

  setChannel(ch) {
    this.channel = ch;
    this.draw();
  }

  setHistogram(hist) {
    this.hist = hist;
    this.draw();
  }

  toLocal(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)),
      px: r.width,
      py: r.height,
    };
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      c.setPointerCapture?.(e.pointerId);
      const p = this.toLocal(e);
      const idx = this.hitTest(p);
      if (idx >= 0) {
        this.dragIndex = idx;
      } else {
        this.points.push({ x: p.x, y: p.y });
        this.points.sort((a, b) => a.x - b.x);
        this.dragIndex = this.points.findIndex((q) => q.x === p.x && q.y === p.y);
      }
      this.onBegin();
      this.draw();
      this.onChange(this.getPoints());
    });
    c.addEventListener('pointermove', (e) => {
      if (this.dragIndex < 0) return;
      e.preventDefault();
      const p = this.toLocal(e);
      const pt = this.points[this.dragIndex];
      const isFirst = this.dragIndex === 0;
      const isLast = this.dragIndex === this.points.length - 1;
      if (!isFirst && !isLast) {
        const lo = this.points[this.dragIndex - 1].x + 0.01;
        const hi = this.points[this.dragIndex + 1].x - 0.01;
        pt.x = Math.max(lo, Math.min(hi, p.x));
      }
      pt.y = p.y;
      this.draw();
      this.onChange(this.getPoints());
    });
    const end = () => {
      if (this.dragIndex < 0) return;
      this.dragIndex = -1;
      this.onEnd();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', (e) => {
      const p = this.toLocal(e);
      const idx = this.hitTest(p);
      if (idx > 0 && idx < this.points.length - 1) {
        this.onBegin();
        this.points.splice(idx, 1);
        this.draw();
        this.onChange(this.getPoints());
        this.onEnd();
      }
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = this.toLocal(e);
      const idx = this.hitTest(p);
      if (idx > 0 && idx < this.points.length - 1) {
        this.onBegin();
        this.points.splice(idx, 1);
        this.draw();
        this.onChange(this.getPoints());
        this.onEnd();
      }
    });
  }

  hitTest(p) {
    for (let i = 0; i < this.points.length; i++) {
      const dx = (this.points[i].x - p.x) * p.px;
      const dy = (this.points[i].y - p.y) * p.py;
      if (dx * dx + dy * dy <= HIT * HIT) return i;
    }
    return -1;
  }

  draw() {
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 260;
    const h = this.canvas.clientHeight || 260;
    if (this.canvas.width !== Math.round(w * dpr)) this.canvas.width = Math.round(w * dpr);
    if (this.canvas.height !== Math.round(h * dpr)) this.canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Histogram zemini
    if (this.hist && this.hist.total) {
      const data = this.channel === 'rgb' ? this.hist.l : this.hist[this.channel];
      const sorted = Array.from(data).sort((a, b) => b - a);
      const scale = Math.max(1, sorted[Math.floor(sorted.length * 0.01)] || sorted[0]);
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < 256; i++) {
        ctx.lineTo((i / 255) * w, h - Math.min(1, data[i] / scale) * h * 0.9);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
    }

    // Izgara
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      ctx.beginPath();
      ctx.moveTo(t * w, 0); ctx.lineTo(t * w, h);
      ctx.moveTo(0, t * h); ctx.lineTo(w, t * h);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(w, 0);
    ctx.stroke();

    // Eğri
    const samples = sampleCurve(this.points);
    const colors = { rgb: '#ffffff', r: '#ff6b6b', g: '#4ade80', b: '#60a5fa' };
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const y = h - Math.max(0, Math.min(1, samples[i])) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = colors[this.channel] || '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Noktalar
    for (const p of this.points) {
      const x = p.x * w;
      const y = h - p.y * h;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = colors[this.channel] || '#fff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}
