// Kırpma kutusu etkileşimi. Dikdörtgen, döndürülmüş görüntünün sınır kutusuna göre
// 0..1 aralığında normalize tutulur; en-boy oranı piksel cinsinden korunur.

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN = 0.04;

export class CropTool {
  constructor(overlay, opts = {}) {
    this.overlay = overlay;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.aspect = null;      // piksel oranı (g/y) veya null = serbest
    this.bboxAspect = 1;     // döndürülmüş görüntünün g/y oranı
    this.onChange = opts.onChange || (() => {});
    this.onBegin = opts.onBegin || (() => {});
    this.onEnd = opts.onEnd || (() => {});
    this.active = false;
    this.build();
  }

  build() {
    this.overlay.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'crop-box';
    for (const h of HANDLES) {
      const el = document.createElement('div');
      el.className = 'crop-handle h-' + h;
      el.dataset.handle = h;
      box.appendChild(el);
    }
    const grid = document.createElement('div');
    grid.className = 'crop-grid';
    grid.innerHTML = '<i></i><i></i><i></i><i></i>';
    box.appendChild(grid);
    this.box = box;
    this.overlay.appendChild(box);

    this.overlay.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  setBBoxAspect(a) {
    this.bboxAspect = a || 1;
  }

  setRect(r) {
    this.rect = { ...r };
    this.layout();
  }

  getRect() {
    return { ...this.rect };
  }

  setAspect(a) {
    this.aspect = a;
    if (a) this.applyAspect('se');
    this.layout();
    this.onChange(this.getRect());
  }

  reset() {
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.aspect = null;
    this.layout();
  }

  /** Oranı, merkezden büyütmeden, mevcut kutunun içine sığdırarak uygular. */
  applyAspect(anchor = 'se') {
    if (!this.aspect) return;
    const r = this.rect;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    // normalize alanda hedef yükseklik
    let w = r.w;
    let h = (w * this.bboxAspect) / this.aspect;
    if (h > 1) {
      h = Math.min(1, r.h);
      w = (h * this.aspect) / this.bboxAspect;
    }
    if (w > 1) { w = 1; h = (w * this.bboxAspect) / this.aspect; }
    r.w = Math.min(1, w);
    r.h = Math.min(1, h);
    r.x = Math.max(0, Math.min(1 - r.w, cx - r.w / 2));
    r.y = Math.max(0, Math.min(1 - r.h, cy - r.h / 2));
  }

  layout() {
    const r = this.rect;
    const s = this.box.style;
    s.left = (r.x * 100).toFixed(4) + '%';
    s.top = (r.y * 100).toFixed(4) + '%';
    s.width = (r.w * 100).toFixed(4) + '%';
    s.height = (r.h * 100).toFixed(4) + '%';
  }

  onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const rectPx = this.overlay.getBoundingClientRect();
    if (rectPx.width < 4 || rectPx.height < 4) return;
    const handle = e.target?.dataset?.handle || null;
    const start = { ...this.rect };
    const p0 = {
      x: (e.clientX - rectPx.left) / rectPx.width,
      y: (e.clientY - rectPx.top) / rectPx.height,
    };
    const inside =
      p0.x >= start.x && p0.x <= start.x + start.w &&
      p0.y >= start.y && p0.y <= start.y + start.h;
    if (!handle && !inside) return;

    e.preventDefault();
    this.overlay.setPointerCapture?.(e.pointerId);
    this.active = true;
    this.onBegin();

    const move = (ev) => {
      const px = (ev.clientX - rectPx.left) / rectPx.width;
      const py = (ev.clientY - rectPx.top) / rectPx.height;
      const dx = px - p0.x;
      const dy = py - p0.y;
      if (handle) this.resize(handle, start, dx, dy);
      else this.translate(start, dx, dy);
      this.layout();
      this.onChange(this.getRect());
    };
    const up = () => {
      this.overlay.removeEventListener('pointermove', move);
      this.overlay.removeEventListener('pointerup', up);
      this.overlay.removeEventListener('pointercancel', up);
      this.active = false;
      this.onEnd();
    };
    this.overlay.addEventListener('pointermove', move);
    this.overlay.addEventListener('pointerup', up);
    this.overlay.addEventListener('pointercancel', up);
  }

  translate(start, dx, dy) {
    const r = this.rect;
    r.w = start.w;
    r.h = start.h;
    r.x = Math.max(0, Math.min(1 - start.w, start.x + dx));
    r.y = Math.max(0, Math.min(1 - start.h, start.y + dy));
  }

  resize(handle, start, dx, dy) {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;

    if (handle.includes('w')) left = Math.min(right - MIN, Math.max(0, start.x + dx));
    if (handle.includes('e')) right = Math.max(left + MIN, Math.min(1, start.x + start.w + dx));
    if (handle.includes('n')) top = Math.min(bottom - MIN, Math.max(0, start.y + dy));
    if (handle.includes('s')) bottom = Math.max(top + MIN, Math.min(1, start.y + start.h + dy));

    let w = right - left;
    let h = bottom - top;

    if (this.aspect) {
      // Oranı koru: sürüklenen kenara göre karşıt kenarı sabit tut
      const targetH = (w * this.bboxAspect) / this.aspect;
      const targetW = (h * this.aspect) / this.bboxAspect;
      const horizontal = handle === 'e' || handle === 'w';
      const vertical = handle === 'n' || handle === 's';
      if (horizontal || (!vertical && Math.abs(dx) >= Math.abs(dy))) {
        h = targetH;
        if (handle.includes('n')) top = bottom - h; else bottom = top + h;
      } else {
        w = targetW;
        if (handle.includes('w')) left = right - w; else right = left + w;
      }
      // Sınır dışına taşarsa küçült
      if (top < 0) { const k = 1 + top / (bottom - top); top = 0; }
      if (left < 0) left = 0;
      if (bottom > 1) bottom = 1;
      if (right > 1) right = 1;
      w = right - left;
      h = bottom - top;
      const fixH = (w * this.bboxAspect) / this.aspect;
      if (fixH <= h) {
        if (handle.includes('n')) top = bottom - fixH; else bottom = top + fixH;
      } else {
        const fixW = (h * this.aspect) / this.bboxAspect;
        if (handle.includes('w')) left = right - fixW; else right = left + fixW;
      }
      if (top < 0) { bottom -= top; top = 0; }
      if (left < 0) { right -= left; left = 0; }
      if (bottom > 1) { top -= bottom - 1; bottom = 1; }
      if (right > 1) { left -= right - 1; right = 1; }
      top = Math.max(0, top); left = Math.max(0, left);
      bottom = Math.min(1, bottom); right = Math.min(1, right);
    }

    this.rect = {
      x: left,
      y: top,
      w: Math.max(MIN, right - left),
      h: Math.max(MIN, bottom - top),
    };
  }
}

export const ASPECTS = [
  { id: 'free', label: 'Serbest', value: null },
  { id: 'orig', label: 'Orijinal', value: 'orig' },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:5', label: '4:5', value: 4 / 5 },
  { id: '5:4', label: '5:4', value: 5 / 4 },
  { id: '3:4', label: '3:4', value: 3 / 4 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '2:3', label: '2:3', value: 2 / 3 },
  { id: '3:2', label: '3:2', value: 3 / 2 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
];
