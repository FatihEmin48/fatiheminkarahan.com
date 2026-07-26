// Metin / çıkartma katmanı ve çerçeveler. Hepsi 2B tuvale çizilir; önizlemede
// WebGL tuvalinin üstündeki saydam tuval, dışa aktarımda tam çözünürlüklü tuval.
// Konumlar 0..1 aralığında (görüntü çıktısına göre) tutulur, böylece her ölçekte aynı durur.

export const FONTS = [
  { id: 'sistem', label: 'Sistem', css: '-apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
  { id: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  { id: 'daktilo', label: 'Daktilo', css: '"Courier New", monospace' },
  { id: 'baslik', label: 'Başlık', css: 'Impact, "Arial Black", sans-serif' },
  { id: 'elyazisi', label: 'El Yazısı', css: '"Segoe Script", "Brush Script MT", cursive' },
];

export const FONT_BY_ID = Object.fromEntries(FONTS.map((f) => [f.id, f]));

export const STICKERS = [
  '❤️', '⭐', '✨', '🔥', '😍', '😂', '👍', '🎉', '☀️', '🌙',
  '🌈', '🌸', '🍂', '⚡', '📍', '🎵', '📷', '☕', '🐾', '🏔️',
];

export const FRAMES = [
  { id: 'none', label: 'Yok' },
  { id: 'kenarlik', label: 'Kenarlık' },
  { id: 'polaroid', label: 'Polaroid' },
  { id: 'yuvarlak', label: 'Yuvarlak' },
  { id: 'ince', label: 'İnce Çizgi' },
];

export function defaultFrame() {
  return { type: 'none', size: 4, color: '#ffffff', radius: 4 };
}

export function newText(text = 'Metin') {
  return {
    id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    kind: 'text',
    text,
    x: 0.5,
    y: 0.82,
    size: 8,          // çıktının yüksekliğine oran (%)
    color: '#ffffff',
    font: 'sistem',
    bold: true,
    rotation: 0,
    opacity: 100,
    shadow: 60,
    stroke: 0,
    strokeColor: '#000000',
    bg: 0,            // arka plan şeridi opaklığı (%)
    bgColor: '#000000',
    align: 'center',
    letterSpacing: 0,
  };
}

export function newSticker(emoji) {
  const o = newText(emoji);
  o.kind = 'sticker';
  o.size = 16;
  o.shadow = 30;
  o.bold = false;
  o.y = 0.5;
  return o;
}

/** Çerçevenin dört kenardaki payı (çıktı pikseli cinsinden) ve toplam ölçü. */
export function frameMetrics(frame, w, h) {
  const none = { l: 0, t: 0, r: 0, b: 0, w, h, radius: 0 };
  if (!frame || frame.type === 'none') return none;
  const unit = Math.min(w, h) / 100;
  const s = Math.max(0, frame.size) * unit;
  if (frame.type === 'kenarlik') {
    return { l: s, t: s, r: s, b: s, w: w + s * 2, h: h + s * 2, radius: 0 };
  }
  if (frame.type === 'polaroid') {
    return { l: s, t: s, r: s, b: s * 3.4, w: w + s * 2, h: h + s * 4.4, radius: 0 };
  }
  if (frame.type === 'yuvarlak') {
    return { ...none, radius: (frame.radius / 100) * Math.min(w, h) };
  }
  if (frame.type === 'ince') {
    return { ...none, inset: Math.max(1, s * 0.35) };
  }
  return none;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Çerçeveyi ve görüntüyü hedef tuvale çizer.
 * `source` bir tuval/görüntü; w,h onun çıktı ölçüsü. Dönüş: görüntünün yerleştiği kutu.
 */
export function drawFramedImage(ctx, source, frame, w, h) {
  const m = frameMetrics(frame, w, h);
  if (frame && frame.type !== 'none' && frame.type !== 'yuvarlak' && frame.type !== 'ince') {
    ctx.fillStyle = frame.color;
    ctx.fillRect(0, 0, m.w, m.h);
  }
  if (frame && frame.type === 'yuvarlak' && m.radius > 0) {
    ctx.save();
    roundRectPath(ctx, 0, 0, w, h, m.radius);
    ctx.clip();
    ctx.drawImage(source, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(source, m.l, m.t, w, h);
  }
  if (frame && frame.type === 'ince') {
    const inset = m.inset || 2;
    ctx.strokeStyle = frame.color;
    ctx.lineWidth = inset;
    ctx.strokeRect(inset * 1.8, inset * 1.8, w - inset * 3.6, h - inset * 3.6);
  }
  return { x: m.l, y: m.t, w, h, total: { w: m.w, h: m.h } };
}

function fontString(o, px) {
  const f = FONT_BY_ID[o.font] || FONTS[0];
  return `${o.bold ? '700' : '400'} ${px}px ${f.css}`;
}

/** Bir katmanın çıktı pikseli cinsinden kapladığı kutu (döndürmeden önce). */
export function measureOverlay(ctx, o, boxW, boxH) {
  const px = Math.max(4, (o.size / 100) * boxH);
  ctx.font = fontString(o, px);
  const lines = String(o.text).split('\n');
  let maxW = 0;
  for (const ln of lines) {
    const m = ctx.measureText(ln);
    const extra = (o.letterSpacing || 0) * 0.01 * px * Math.max(0, ln.length - 1);
    maxW = Math.max(maxW, m.width + extra);
  }
  const lineH = px * 1.18;
  return { w: maxW, h: lineH * lines.length, px, lines, lineH };
}

function drawTracked(ctx, text, x, y, spacingPx, mode) {
  if (!spacingPx) {
    if (mode === 'fill') ctx.fillText(text, x, y);
    else ctx.strokeText(text, x, y);
    return;
  }
  // Harf aralığı elle uygulanır (canvas letterSpacing her yerde yok)
  const chars = [...text];
  let total = 0;
  for (const c of chars) total += ctx.measureText(c).width + spacingPx;
  total -= spacingPx;
  let cx = x - total / 2;
  for (const c of chars) {
    const wch = ctx.measureText(c).width;
    if (mode === 'fill') ctx.fillText(c, cx + wch / 2, y);
    else ctx.strokeText(c, cx + wch / 2, y);
    cx += wch + spacingPx;
  }
}

/** Tek bir katmanı çizer. box: görüntünün tuvaldeki yerleşimi. */
export function drawOverlay(ctx, o, box) {
  const m = measureOverlay(ctx, o, box.w, box.h);
  const cx = box.x + o.x * box.w;
  const cy = box.y + o.y * box.h;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, o.opacity / 100));
  ctx.translate(cx, cy);
  ctx.rotate((o.rotation * Math.PI) / 180);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = fontString(o, m.px);

  if (o.bg > 0) {
    const padX = m.px * 0.35;
    const padY = m.px * 0.16;
    ctx.save();
    ctx.globalAlpha *= o.bg / 100;
    ctx.fillStyle = o.bgColor;
    roundRectPath(ctx, -m.w / 2 - padX, -m.h / 2 - padY, m.w + padX * 2, m.h + padY * 2, m.px * 0.16);
    ctx.fill();
    ctx.restore();
  }

  if (o.shadow > 0) {
    ctx.shadowColor = `rgba(0,0,0,${(o.shadow / 100) * 0.8})`;
    ctx.shadowBlur = m.px * 0.22;
    ctx.shadowOffsetY = m.px * 0.045;
  }

  const spacing = (o.letterSpacing || 0) * 0.01 * m.px;
  const startY = -m.h / 2 + m.lineH / 2;

  if (o.stroke > 0) {
    ctx.lineWidth = (o.stroke / 100) * m.px * 0.22;
    ctx.strokeStyle = o.strokeColor;
    ctx.lineJoin = 'round';
    m.lines.forEach((ln, i) => drawTracked(ctx, ln, 0, startY + i * m.lineH, spacing, 'stroke'));
  }

  ctx.fillStyle = o.color;
  m.lines.forEach((ln, i) => drawTracked(ctx, ln, 0, startY + i * m.lineH, spacing, 'fill'));
  ctx.restore();
  return { cx, cy, w: m.w, h: m.h };
}

export function drawOverlays(ctx, overlays, box) {
  const boxes = {};
  for (const o of overlays) boxes[o.id] = drawOverlay(ctx, o, box);
  return boxes;
}

/**
 * Seçim çerçevesinin geometrisi — çizmeden. Tutamaç konumu katmanın kendi
 * eksenindedir; ekran koordinatı için `rotation` kadar döndürülmesi gerekir.
 */
export function selectionGeometry(ctx, o, box) {
  const m = measureOverlay(ctx, o, box.w, box.h);
  const padX = m.px * 0.3;
  const padY = m.px * 0.18;
  return {
    cx: box.x + o.x * box.w,
    cy: box.y + o.y * box.h,
    hx: m.w / 2 + padX,
    hy: m.h / 2 + padY,
    w: m.w + padX * 2,
    h: m.h + padY * 2,
    px: m.px,
  };
}

/** Tutamacın ekran koordinatı. */
export function handlePoint(o, g) {
  const a = (o.rotation * Math.PI) / 180;
  return {
    x: g.cx + g.hx * Math.cos(a) - g.hy * Math.sin(a),
    y: g.cy + g.hx * Math.sin(a) + g.hy * Math.cos(a),
  };
}

/** Seçili katmanın çevresine tutamaçlı çerçeve çizer (yalnız önizleme). */
export function drawSelection(ctx, o, box, scale = 1) {
  const m = measureOverlay(ctx, o, box.w, box.h);
  const cx = box.x + o.x * box.w;
  const cy = box.y + o.y * box.h;
  const padX = m.px * 0.3;
  const padY = m.px * 0.18;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((o.rotation * Math.PI) / 180);
  ctx.strokeStyle = 'rgba(94,179,255,0.95)';
  ctx.lineWidth = 1.5 * scale;
  ctx.setLineDash([6 * scale, 4 * scale]);
  ctx.strokeRect(-m.w / 2 - padX, -m.h / 2 - padY, m.w + padX * 2, m.h + padY * 2);
  ctx.setLineDash([]);
  ctx.fillStyle = '#5eb3ff';
  const hx = m.w / 2 + padX;
  const hy = m.h / 2 + padY;
  ctx.beginPath();
  ctx.arc(hx, hy, 7 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.2 * scale;
  ctx.stroke();
  ctx.restore();
  return { cx, cy, hx, hy, w: m.w + padX * 2, h: m.h + padY * 2 };
}

/** Ekran noktası hangi katmana denk geliyor? (üstteki önce) */
export function pickOverlay(ctx, overlays, box, px, py) {
  for (let i = overlays.length - 1; i >= 0; i--) {
    const o = overlays[i];
    const m = measureOverlay(ctx, o, box.w, box.h);
    const cx = box.x + o.x * box.w;
    const cy = box.y + o.y * box.h;
    const a = (-o.rotation * Math.PI) / 180;
    const dx = px - cx;
    const dy = py - cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    const hw = m.w / 2 + m.px * 0.3;
    const hh = m.h / 2 + m.px * 0.18;
    if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return { overlay: o, lx, ly, hw, hh };
  }
  return null;
}
