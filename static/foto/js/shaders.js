// WebGL gölgelendirici kaynakları. Tümü tek geçişli, pointwise; yalnız bulanıklık
// ayrı ping-pong geçişinde üretilir.

export const VERT_QUAD = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Kırpma / döndürme / çevirme: çıkış uv'si 3x3 matrisle kaynak uv'sine taşınır.
export const FRAG_TRANSFORM = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform mat3 uUvMatrix;
void main() {
  vec3 p = uUvMatrix * vec3(vUv, 1.0);
  vec2 uv = p.xy;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }
  gl_FragColor = texture2D(uImage, uv);
}
`;

// Ayrılabilir gauss bulanıklığı (yatay ya da dikey, uDir ile).
export const FRAG_BLUR = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform vec2 uDir;      // piksel cinsinden adım (1/size * yarıçap)
void main() {
  vec4 sum = vec4(0.0);
  sum += texture2D(uImage, vUv - uDir * 4.0) * 0.0162;
  sum += texture2D(uImage, vUv - uDir * 3.0) * 0.0540;
  sum += texture2D(uImage, vUv - uDir * 2.0) * 0.1216;
  sum += texture2D(uImage, vUv - uDir * 1.0) * 0.1946;
  sum += texture2D(uImage, vUv)              * 0.2270;
  sum += texture2D(uImage, vUv + uDir * 1.0) * 0.1946;
  sum += texture2D(uImage, vUv + uDir * 2.0) * 0.1216;
  sum += texture2D(uImage, vUv + uDir * 3.0) * 0.0540;
  sum += texture2D(uImage, vUv + uDir * 4.0) * 0.0162;
  gl_FragColor = sum;
}
`;

// Ana renk geçişi: tüm ayarlar, eğriler, split tone, vinyet, gren.
export const FRAG_MAIN = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uImage;
uniform sampler2D uBlur;     // küçük yarıçap — netlik için
uniform sampler2D uBlurBig;  // büyük yarıçap — genel bulanıklık için
uniform sampler2D uCurve;

uniform vec2  uTexel;        // 1.0 / dokusu boyutu
uniform float uAspect;

uniform float uExposure;     // -1..1
uniform float uContrast;     // -1..1
uniform float uHighlights;   // -1..1
uniform float uShadows;      // -1..1
uniform float uWhites;       // -1..1
uniform float uBlacks;       // -1..1

uniform float uTemp;         // -1..1
uniform float uTint;         // -1..1
uniform float uVibrance;     // -1..1
uniform float uSaturation;   // -1..1
uniform float uHue;          // -0.5..0.5 (tur)

uniform float uClarity;      // -1..1
uniform float uSharpen;      // 0..1
uniform float uFade;         // 0..1
uniform float uGrain;        // 0..1
uniform float uGrainSize;    // piksel
uniform float uVignette;     // -1..1
uniform float uVignetteSize; // 0..1
uniform float uBlurAmount;   // 0..1
uniform float uGamma;        // 0.2..3

uniform vec3  uShadowTint;
uniform vec3  uHighlightTint;
uniform float uSplitBalance;

uniform float uSeed;
uniform float uCurveOn;
uniform float uInvert;
uniform float uPosterize;    // 0 = kapalı, yoksa seviye sayısı
uniform float uThreshold;    // 0 = kapalı

// Doku maskesi: kenarlarda saydamlık korunur
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec4 src = texture2D(uImage, vUv);
  float alpha = src.a;
  vec3 c = src.rgb;
  vec3 blurred = texture2D(uBlur, vUv).rgb;

  // 1) Genel bulanıklık
  if (uBlurAmount > 0.001) {
    c = mix(c, texture2D(uBlurBig, vUv).rgb, uBlurAmount);
  }

  // 2) Beyaz dengesi
  c.r += uTemp * 0.12;
  c.b -= uTemp * 0.12;
  c.g -= uTint * 0.10;
  c.r += uTint * 0.05;
  c.b += uTint * 0.05;
  c = clamp(c, 0.0, 4.0);

  // 3) Pozlama (doğrusal alanda)
  c *= pow(2.0, uExposure * 2.0);

  // 4) Vurgular / gölgeler / beyazlar / siyahlar
  float l = luma(c);
  float hMask = smoothstep(0.45, 1.0, l);
  float sMask = 1.0 - smoothstep(0.0, 0.55, l);
  c += uHighlights * hMask * 0.45 * (uHighlights > 0.0 ? (1.0 - c) : c);
  c += uShadows * sMask * 0.45 * (uShadows > 0.0 ? (1.0 - c) : c);
  c += uWhites * smoothstep(0.6, 1.0, l) * 0.35;
  c += uBlacks * (1.0 - smoothstep(0.0, 0.4, l)) * 0.35;

  // 5) Kontrast (0.5 ekseninde)
  float kc = uContrast > 0.0 ? (1.0 + uContrast * 1.4) : (1.0 + uContrast * 0.9);
  c = (c - 0.5) * kc + 0.5;

  // 6) Netlik — büyük yarıçaplı bulanıklıkla yerel kontrast
  if (abs(uClarity) > 0.001) {
    vec3 detail = c - blurred;
    float midMask = 1.0 - abs(luma(c) - 0.5) * 1.4;
    c += detail * uClarity * 1.6 * max(midMask, 0.15);
  }

  // 7) Keskinlik — 5 noktalı unsharp
  if (uSharpen > 0.001) {
    vec3 n = texture2D(uImage, vUv + vec2(0.0, -uTexel.y)).rgb
           + texture2D(uImage, vUv + vec2(0.0,  uTexel.y)).rgb
           + texture2D(uImage, vUv + vec2(-uTexel.x, 0.0)).rgb
           + texture2D(uImage, vUv + vec2( uTexel.x, 0.0)).rgb;
    vec3 edge = src.rgb - n * 0.25;
    c += edge * uSharpen * 1.8;
  }

  c = clamp(c, 0.0, 1.0);

  // 8) Canlılık / doygunluk
  float lg = luma(c);
  if (abs(uVibrance) > 0.001) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float sat = mx - mn;
    c = mix(vec3(lg), c, 1.0 + uVibrance * (1.0 - sat) * 1.2);
  }
  c = mix(vec3(lg), c, 1.0 + uSaturation);
  c = clamp(c, 0.0, 1.0);

  // 9) Renk kayması
  if (abs(uHue) > 0.0005) {
    vec3 hsv = rgb2hsv(c);
    hsv.x = fract(hsv.x + uHue);
    c = hsv2rgb(hsv);
  }

  // 10) Split tone
  float bal = clamp(luma(c) + uSplitBalance * 0.5, 0.0, 1.0);
  c += uShadowTint * (1.0 - smoothstep(0.0, 0.6, bal));
  c += uHighlightTint * smoothstep(0.4, 1.0, bal);
  c = clamp(c, 0.0, 1.0);

  // 11) Gamma
  c = pow(c, vec3(1.0 / uGamma));

  // 12) Eğriler
  if (uCurveOn > 0.5) {
    c.r = texture2D(uCurve, vec2(c.r, 0.5)).a;
    c.g = texture2D(uCurve, vec2(c.g, 0.5)).a;
    c.b = texture2D(uCurve, vec2(c.b, 0.5)).a;
    c.r = texture2D(uCurve, vec2(c.r, 0.5)).r;
    c.g = texture2D(uCurve, vec2(c.g, 0.5)).g;
    c.b = texture2D(uCurve, vec2(c.b, 0.5)).b;
  }

  // 13) Solgunluk (mat görünüm)
  c = c * (1.0 - uFade * 0.28) + uFade * 0.12;

  // 14) Vinyet
  vec2 vp = (vUv - 0.5) * vec2(uAspect, 1.0);
  float vd = length(vp) / (0.5 * length(vec2(uAspect, 1.0)));
  float vmask = smoothstep(uVignetteSize, 1.25, vd);
  c *= 1.0 - vmask * max(uVignette, 0.0);
  c += vmask * max(-uVignette, 0.0) * 0.75 * (1.0 - c);

  // 15) Film greni
  if (uGrain > 0.001) {
    float g = hash(floor(gl_FragCoord.xy / max(uGrainSize, 0.5)) + uSeed);
    float lm = 1.0 - abs(luma(c) - 0.5) * 1.2;
    c += (g - 0.5) * uGrain * 0.35 * max(lm, 0.2);
  }

  // 16) Stilize son işlemler
  if (uPosterize > 1.5) {
    c = floor(c * uPosterize) / (uPosterize - 1.0);
  }
  if (uThreshold > 0.001) {
    float t = luma(c);
    c = mix(c, vec3(step(uThreshold, t)), 1.0);
  }
  c = mix(c, 1.0 - c, uInvert);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), alpha);
}
`;

/**
 * Sanatsal son işlem. Tek gölgelendirici, uMode ile dallanır:
 *   1 karakalem  2 suluboya  3 yarım ton nokta  4 ASCII
 * Hepsi ana renk geçişinin çıktısı üzerinde çalışır, böylece kullanıcının
 * yaptığı tüm ayarlar (pozlama, kontrast, filtre…) sanatsal etkiye de yansır.
 */
export const FRAG_ART = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform sampler2D uGlyphs;   // ASCII glif atlası (16 hücre, koyudan açığa)
uniform vec2  uSize;         // çıktı piksel ölçüsü
uniform float uMode;
uniform float uAmount;       // 0..1 karışım
uniform float uCell;         // hücre boyutu (piksel)
uniform float uColorize;     // 0 = tek renk, 1 = kaynağın rengini koru
uniform vec3  uInk;
uniform vec3  uPaper;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 sample(vec2 uv) { return texture2D(uImage, clamp(uv, 0.0, 1.0)).rgb; }

/* --- Sobel kenar şiddeti --- */
float edge(vec2 uv, vec2 px) {
  float tl = luma(sample(uv + px * vec2(-1.0, -1.0)));
  float t  = luma(sample(uv + px * vec2( 0.0, -1.0)));
  float tr = luma(sample(uv + px * vec2( 1.0, -1.0)));
  float l  = luma(sample(uv + px * vec2(-1.0,  0.0)));
  float r  = luma(sample(uv + px * vec2( 1.0,  0.0)));
  float bl = luma(sample(uv + px * vec2(-1.0,  1.0)));
  float b  = luma(sample(uv + px * vec2( 0.0,  1.0)));
  float br = luma(sample(uv + px * vec2( 1.0,  1.0)));
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  return sqrt(gx * gx + gy * gy);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/* --- Kuwahara: kenarları koruyan bölge ortalaması, suluboya hissi verir --- */
vec3 kuwahara(vec2 uv, vec2 px, float radius) {
  vec3 mean[4];
  float sigma[4];
  for (int k = 0; k < 4; k++) { mean[k] = vec3(0.0); sigma[k] = 0.0; }
  float n = 0.0;

  for (int i = 0; i <= 6; i++) {
    for (int j = 0; j <= 6; j++) {
      float fi = float(i) - 3.0;
      float fj = float(j) - 3.0;
      vec3 c = sample(uv + px * vec2(fi, fj) * radius);
      float l = luma(c);
      // Dört çeyreğe dağıt (merkez satır/sütun birden fazla çeyreğe girer)
      if (fi <= 0.0 && fj <= 0.0) { mean[0] += c; sigma[0] += l * l; }
      if (fi >= 0.0 && fj <= 0.0) { mean[1] += c; sigma[1] += l * l; }
      if (fi <= 0.0 && fj >= 0.0) { mean[2] += c; sigma[2] += l * l; }
      if (fi >= 0.0 && fj >= 0.0) { mean[3] += c; sigma[3] += l * l; }
    }
  }
  n = 16.0;
  vec3 best = mean[0] / n;
  float bestVar = sigma[0] / n - luma(best) * luma(best);
  for (int k = 1; k < 4; k++) {
    vec3 m = mean[k] / n;
    float v = sigma[k] / n - luma(m) * luma(m);
    if (v < bestVar) { bestVar = v; best = m; }
  }
  return best;
}

void main() {
  vec4 src = texture2D(uImage, vUv);
  vec3 base = src.rgb;
  vec2 px = 1.0 / uSize;
  vec3 art = base;
  float cell = max(3.0, uCell);

  /* ---------------- karakalem ---------------- */
  if (uMode < 1.5) {
    float e = edge(vUv, px * 1.2);
    float line = 1.0 - clamp(e * 1.5, 0.0, 1.0);
    // Kağıt dokusu: ince taramalar
    float grain = hash(floor(gl_FragCoord.xy * 0.7)) * 0.16;
    float shade = smoothstep(0.15, 0.85, luma(base));
    float hatch = sin((gl_FragCoord.x + gl_FragCoord.y) * 0.7) * 0.5 + 0.5;
    float dark = 1.0 - shade;
    float tone = 1.0 - clamp(dark * (0.55 + hatch * 0.45), 0.0, 1.0);
    float v = clamp(min(line, tone * 1.12) - grain * dark, 0.0, 1.0);
    art = mix(uInk, uPaper, v);
    art = mix(art, art * base * 2.0, uColorize * 0.5);
  }
  /* ---------------- suluboya ---------------- */
  else if (uMode < 2.5) {
    vec3 k = kuwahara(vUv, px, max(1.0, cell * 0.34));
    // Renkleri hafifçe basamaklandır, kenarları koyulaştır
    vec3 q = floor(k * 9.0 + 0.5) / 9.0;
    float e = clamp(edge(vUv, px * 1.6) * 0.9, 0.0, 1.0);
    vec3 wash = mix(q, q * 0.55, e * 0.75);
    // Kağıt lekesi
    float blot = hash(floor(gl_FragCoord.xy / 3.0)) * 0.09;
    art = clamp(wash * (1.0 - blot) + 0.035, 0.0, 1.0);
  }
  /* ---------------- yarım ton nokta ---------------- */
  else if (uMode < 3.5) {
    float ang = 0.4363;                       // ~25°, klasik tram açısı
    mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 p = rot * gl_FragCoord.xy;
    vec2 grid = mod(p, cell) - cell * 0.5;
    vec2 centerPx = p - grid;
    // Hücre merkezi döndürülmüş uzayda; örneklemek için geri döndür
    mat2 inv = mat2(cos(-ang), -sin(-ang), sin(-ang), cos(-ang));
    vec2 centerUv = clamp((inv * centerPx) / uSize, 0.0, 1.0);
    vec3 cellColor = sample(centerUv);
    float l = luma(cellColor);
    float radius = sqrt(1.0 - clamp(l, 0.0, 1.0)) * cell * 0.62;
    float d = length(grid);
    float dot0 = 1.0 - smoothstep(radius - 1.2, radius + 1.2, d);
    vec3 ink = mix(uInk, cellColor * 0.85, uColorize);
    art = mix(uPaper, ink, dot0);
  }
  /* ---------------- ASCII ---------------- */
  else {
    vec2 cellPx = vec2(cell * 0.6, cell);     // karakterler dikdörtgen
    vec2 cellIdx = floor(gl_FragCoord.xy / cellPx);
    vec2 inCell = (gl_FragCoord.xy - cellIdx * cellPx) / cellPx;
    vec2 centerUv = clamp((cellIdx + 0.5) * cellPx / uSize, 0.0, 1.0);
    vec3 cellColor = sample(centerUv);
    float l = clamp(luma(cellColor), 0.0, 1.0);
    float idx = floor(l * 15.999);            // 16 glif, koyudan açığa
    vec2 atlasUv = vec2((idx + inCell.x) / 16.0, 1.0 - inCell.y);
    float glyph = texture2D(uGlyphs, atlasUv).r;
    vec3 ink = mix(uInk, cellColor, uColorize);
    art = mix(uPaper, ink, glyph);
  }

  gl_FragColor = vec4(mix(base, art, uAmount), src.a);
}
`;

// Ekrana kopyalama (dama tahtası zemin üstüne alfa harmanlı).
export const FRAG_PRESENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
void main() {
  vec4 c = texture2D(uImage, vec2(vUv.x, 1.0 - vUv.y));
  vec2 g = floor(gl_FragCoord.xy / 10.0);
  float chk = mod(g.x + g.y, 2.0) * 0.06 + 0.14;
  vec3 bg = vec3(chk);
  gl_FragColor = vec4(mix(bg, c.rgb, c.a), 1.0);
}
`;
