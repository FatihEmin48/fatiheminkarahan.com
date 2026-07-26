// Ton eğrileri: kontrol noktalarından monoton kübik (Fritsch–Carlson) enterpolasyon.
// Monoton seçilmesinin sebebi klasik spline'ın aşırı sallanıp ton tersine çevirmesi.

export const CHANNELS = ['rgb', 'r', 'g', 'b'];

export function defaultCurves() {
  return {
    rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    r: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  };
}

export function isIdentity(curves) {
  return CHANNELS.every((ch) => {
    const p = curves[ch];
    return p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 1 && p[1].y === 1;
  });
}

/** Kontrol noktalarından 256 örneklik dizi üretir (0..1). */
export function sampleCurve(points) {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const n = pts.length;
  const out = new Float32Array(256);

  if (n === 0) {
    for (let i = 0; i < 256; i++) out[i] = i / 255;
    return out;
  }
  if (n === 1) {
    out.fill(pts[0].y);
    return out;
  }

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);

  // Sekant eğimleri
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    d[i] = dx === 0 ? 0 : (ys[i + 1] - ys[i]) / dx;
  }

  // Teğetler
  const t = new Array(n);
  t[0] = d[0];
  t[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) t[i] = 0;
    else t[i] = (d[i - 1] + d[i]) / 2;
  }
  // Monotonluğu koru
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / d[i];
    const b = t[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * d[i];
      t[i + 1] = k * b * d[i];
    }
  }

  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    if (x <= xs[0]) { out[i] = ys[0]; continue; }
    if (x >= xs[n - 1]) { out[i] = ys[n - 1]; continue; }
    while (seg < n - 2 && x > xs[seg + 1]) seg++;
    while (seg > 0 && x < xs[seg]) seg--;
    const h = xs[seg + 1] - xs[seg];
    const s = (x - xs[seg]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    out[i] = h00 * ys[seg] + h10 * h * t[seg] + h01 * ys[seg + 1] + h11 * h * t[seg + 1];
  }
  return out;
}

/** 256x1 RGBA doku verisi: .r/.g/.b kanal eğrileri, .a ana (RGB) eğri. */
export function buildLUT(curves) {
  const rgb = sampleCurve(curves.rgb);
  const r = sampleCurve(curves.r);
  const g = sampleCurve(curves.g);
  const b = sampleCurve(curves.b);
  const bytes = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    bytes[i * 4 + 0] = Math.max(0, Math.min(255, Math.round(r[i] * 255)));
    bytes[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g[i] * 255)));
    bytes[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b[i] * 255)));
    bytes[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(rgb[i] * 255)));
  }
  return bytes;
}

export const CURVE_PRESETS = {
  duz: { label: 'Düz', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  sKontrast: { label: 'S Kontrast', points: [
    { x: 0, y: 0 }, { x: 0.25, y: 0.18 }, { x: 0.5, y: 0.5 }, { x: 0.75, y: 0.82 }, { x: 1, y: 1 }] },
  yumusakS: { label: 'Yumuşak S', points: [
    { x: 0, y: 0 }, { x: 0.3, y: 0.26 }, { x: 0.7, y: 0.74 }, { x: 1, y: 1 }] },
  matSiyah: { label: 'Mat Siyah', points: [
    { x: 0, y: 0.12 }, { x: 0.5, y: 0.52 }, { x: 1, y: 0.95 }] },
  parlak: { label: 'Parlak', points: [
    { x: 0, y: 0 }, { x: 0.35, y: 0.45 }, { x: 1, y: 1 }] },
  koyu: { label: 'Koyu', points: [
    { x: 0, y: 0 }, { x: 0.35, y: 0.25 }, { x: 1, y: 1 }] },
};
