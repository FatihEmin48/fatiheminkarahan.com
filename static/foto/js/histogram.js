// Canlı histogram: küçük ölçekli piksel örneğinden RGB + parlaklık dağılımı.

export function computeHistogram(pixels) {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  let clipLow = 0;
  let clipHigh = 0;
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 8) continue;
    const R = pixels[i], G = pixels[i + 1], B = pixels[i + 2];
    r[R]++; g[G]++; b[B]++;
    const L = (R * 77 + G * 150 + B * 29) >> 8;
    l[L]++;
    total++;
    if (R <= 1 && G <= 1 && B <= 1) clipLow++;
    if (R >= 254 && G >= 254 && B >= 254) clipHigh++;
  }
  return { r, g, b, l, total, clipLow, clipHigh };
}

export function drawHistogram(canvas, hist) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 260;
  const h = canvas.clientHeight || 90;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!hist || !hist.total) return;

  // Uç değerleri kırparak ölçek (tek bir zirve grafiği ezmesin)
  const peak = (arr) => {
    const s = Array.from(arr).sort((a, b) => b - a);
    return Math.max(1, s[Math.floor(s.length * 0.005)] || s[0]);
  };
  const scale = Math.max(peak(hist.r), peak(hist.g), peak(hist.b), 1);

  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const x = (w * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  const channels = [
    { data: hist.r, color: 'rgba(255,70,70,0.62)' },
    { data: hist.g, color: 'rgba(60,230,120,0.62)' },
    { data: hist.b, color: 'rgba(70,140,255,0.62)' },
  ];
  ctx.globalCompositeOperation = 'lighter';
  for (const ch of channels) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const y = h - Math.min(1, ch.data[i] / scale) * (h - 2);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = ch.color;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  ctx.beginPath();
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * w;
    const y = h - Math.min(1, hist.l[i] / scale) * (h - 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
}
