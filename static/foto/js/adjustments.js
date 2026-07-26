// Ayar tanımları: arayüz kaydırıcıları burada tarif edilir, gölgelendirici
// değerlerine dönüşüm tek yerde (toUniforms) yapılır.

export const GROUPS = [
  { id: 'light', label: 'Işık', icon: '☀' },
  { id: 'color', label: 'Renk', icon: '🎨' },
  { id: 'detail', label: 'Detay', icon: '◎' },
  { id: 'effects', label: 'Efekt', icon: '✦' },
  { id: 'split', label: 'Renk Tonlama', icon: '◐' },
  { id: 'art', label: 'Sanatsal', icon: '✎' },
];

/** Sanatsal son işlem kipleri. 0 = kapalı. */
export const ART_MODES = [
  { id: 0, key: 'yok', label: 'Yok' },
  { id: 1, key: 'karakalem', label: 'Karakalem' },
  { id: 2, key: 'suluboya', label: 'Suluboya' },
  { id: 3, key: 'noktalar', label: 'Noktalar' },
  { id: 4, key: 'ascii', label: 'ASCII' },
];

export const ADJUSTMENTS = [
  { key: 'exposure',    label: 'Pozlama',      group: 'light',  min: -100, max: 100, def: 0 },
  { key: 'contrast',    label: 'Kontrast',     group: 'light',  min: -100, max: 100, def: 0 },
  { key: 'highlights',  label: 'Vurgular',     group: 'light',  min: -100, max: 100, def: 0 },
  { key: 'shadows',     label: 'Gölgeler',     group: 'light',  min: -100, max: 100, def: 0 },
  { key: 'whites',      label: 'Beyazlar',     group: 'light',  min: -100, max: 100, def: 0 },
  { key: 'blacks',      label: 'Siyahlar',     group: 'light',  min: -100, max: 100, def: 0 },
  { key: 'gamma',       label: 'Gama',         group: 'light',  min: -100, max: 100, def: 0 },

  { key: 'temperature', label: 'Sıcaklık',     group: 'color',  min: -100, max: 100, def: 0 },
  { key: 'tint',        label: 'Renk Dengesi', group: 'color',  min: -100, max: 100, def: 0 },
  { key: 'vibrance',    label: 'Canlılık',     group: 'color',  min: -100, max: 100, def: 0 },
  { key: 'saturation',  label: 'Doygunluk',    group: 'color',  min: -100, max: 100, def: 0 },
  { key: 'hue',         label: 'Renk Kayması', group: 'color',  min: -180, max: 180, def: 0, unit: '°' },

  { key: 'clarity',     label: 'Netlik',       group: 'detail', min: -100, max: 100, def: 0 },
  { key: 'sharpen',     label: 'Keskinlik',    group: 'detail', min: 0,    max: 100, def: 0 },
  { key: 'blurAmount',  label: 'Bulanıklık',   group: 'detail', min: 0,    max: 100, def: 0 },

  { key: 'vignette',      label: 'Vinyet',       group: 'effects', min: -100, max: 100, def: 0 },
  { key: 'vignetteSize',  label: 'Vinyet Alanı', group: 'effects', min: 0,    max: 100, def: 55, dependsOn: ['vignette'] },
  { key: 'grain',         label: 'Film Greni',   group: 'effects', min: 0,    max: 100, def: 0 },
  { key: 'grainSize',     label: 'Gren Boyutu',  group: 'effects', min: 1,    max: 100, def: 20, dependsOn: ['grain'] },
  { key: 'fade',          label: 'Solgunluk',    group: 'effects', min: 0,    max: 100, def: 0 },
  { key: 'posterize',     label: 'Posterize',    group: 'effects', min: 0,    max: 16,  def: 0 },
  { key: 'threshold',     label: 'Eşikleme',     group: 'effects', min: 0,    max: 100, def: 0 },

  { key: 'shadowHue',     label: 'Gölge Rengi',   group: 'split', min: 0, max: 360, def: 210, unit: '°', kind: 'hue', dependsOn: ['shadowSat'] },
  { key: 'shadowSat',     label: 'Gölge Şiddeti', group: 'split', min: 0, max: 100, def: 0 },
  { key: 'highlightHue',  label: 'Vurgu Rengi',   group: 'split', min: 0, max: 360, def: 45,  unit: '°', kind: 'hue', dependsOn: ['highlightSat'] },
  { key: 'highlightSat',  label: 'Vurgu Şiddeti', group: 'split', min: 0, max: 100, def: 0 },
  { key: 'splitBalance',  label: 'Denge',         group: 'split', min: -100, max: 100, def: 0, dependsOn: ['shadowSat', 'highlightSat'] },

  { key: 'artMode',   label: 'Efekt',      group: 'art', min: 0, max: 4,   def: 0, kind: 'artmode' },
  { key: 'artAmount', label: 'Şiddet',     group: 'art', min: 0, max: 100, def: 100, dependsOn: ['artMode'] },
  { key: 'artCell',   label: 'Kalınlık',   group: 'art', min: 3, max: 40,  def: 12,  dependsOn: ['artMode'] },
  { key: 'artColor',  label: 'Renk Koru',  group: 'art', min: 0, max: 100, def: 0,   dependsOn: ['artMode'] },
];

export const TOGGLES = [
  { key: 'invert', label: 'Negatif', group: 'effects' },
  { key: 'bw',     label: 'Siyah-Beyaz', group: 'color' },
];

export const ADJ_BY_KEY = Object.fromEntries(ADJUSTMENTS.map((a) => [a.key, a]));

export function defaultParams() {
  const p = {};
  for (const a of ADJUSTMENTS) p[a.key] = a.def;
  for (const t of TOGGLES) p[t.key] = 0;
  return p;
}

export function isDefault(params) {
  for (const a of ADJUSTMENTS) if (Math.abs((params[a.key] ?? a.def) - a.def) > 0.001) return false;
  for (const t of TOGGLES) if (params[t.key]) return false;
  return true;
}

/** HSL → RGB (h 0..360, s 0..1, l 0..1) */
export function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const mm = l - c / 2;
  return [r + mm, g + mm, b + mm];
}

/** Arayüz değerlerini gölgelendirici birimlerine çevirir. */
export function toUniforms(params, extra = {}) {
  const v = (k) => params[k] ?? ADJ_BY_KEY[k]?.def ?? 0;
  const sTint = hslToRgb(v('shadowHue'), 1, 0.5).map((x) => (x - 0.35) * (v('shadowSat') / 100) * 0.32);
  const hTint = hslToRgb(v('highlightHue'), 1, 0.5).map((x) => (x - 0.35) * (v('highlightSat') / 100) * 0.32);
  const gammaUi = v('gamma');
  const gamma = gammaUi >= 0 ? 1 + gammaUi / 100 : 1 / (1 - gammaUi / 100);
  const bw = params.bw ? -100 : 0;

  return {
    exposure: v('exposure') / 100,
    contrast: v('contrast') / 100,
    highlights: v('highlights') / 100,
    shadows: v('shadows') / 100,
    whites: v('whites') / 100,
    blacks: v('blacks') / 100,
    temperature: v('temperature') / 100,
    tint: v('tint') / 100,
    vibrance: params.bw ? 0 : v('vibrance') / 100,
    saturation: params.bw ? -1 : v('saturation') / 100,
    hue: v('hue') / 360,
    clarity: v('clarity') / 100,
    sharpen: v('sharpen') / 100,
    blurAmount: v('blurAmount') / 100,
    fade: v('fade') / 100,
    grain: v('grain') / 100,
    grainSize: Math.max(1, v('grainSize') / 12),
    vignette: v('vignette') / 100,
    vignetteSize: v('vignetteSize') / 100,
    gamma,
    shadowTint: new Float32Array(sTint),
    highlightTint: new Float32Array(hTint),
    splitBalance: v('splitBalance') / 100,
    artMode: Math.round(v('artMode')),
    artAmount: v('artAmount') / 100,
    artCell: Math.max(3, v('artCell')),
    artColor: v('artColor') / 100,
    // Karakalem/nokta/ASCII için mürekkep ve kağıt rengi
    artInk: new Float32Array([0.08, 0.09, 0.11]),
    artPaper: new Float32Array([0.96, 0.95, 0.92]),
    invert: params.invert ? 1 : 0,
    posterize: v('posterize') >= 2 ? v('posterize') : 0,
    threshold: v('threshold') / 100,
    curveOn: extra.curveOn ? 1 : 0,
    _bw: bw,
  };
}

export function defaultTransform() {
  return {
    rotate90: 0,
    angle: 0,
    flipX: false,
    flipY: false,
    crop: { x: 0, y: 0, w: 1, h: 1 },
  };
}
