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
