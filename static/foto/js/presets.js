// Hazır filtreler. Her biri yalnızca ayar değerleri taşır — seçtikten sonra
// tüm kaydırıcılar açık kalır, üzerine elle oynanabilir.

export const PRESETS = [
  { id: 'none', label: 'Orijinal', params: {} },

  { id: 'canli', label: 'Canlı', params: {
    exposure: 4, contrast: 18, vibrance: 32, saturation: 6, clarity: 14, shadows: 10, highlights: -12 } },

  { id: 'yumusak', label: 'Yumuşak', params: {
    exposure: 6, contrast: -12, highlights: -20, shadows: 22, fade: 18, vibrance: 10, clarity: -8 } },

  { id: 'sinema', label: 'Sinema', params: {
    contrast: 16, highlights: -28, shadows: 18, blacks: -12, saturation: -8, vibrance: 14,
    shadowHue: 205, shadowSat: 34, highlightHue: 40, highlightSat: 22, splitBalance: -10, vignette: 22 } },

  { id: 'sicak', label: 'Sıcak', params: {
    temperature: 26, tint: 6, exposure: 4, vibrance: 18, highlights: -10, highlightHue: 38, highlightSat: 18 } },

  { id: 'soguk', label: 'Soğuk', params: {
    temperature: -28, tint: -6, contrast: 10, vibrance: 12, shadowHue: 215, shadowSat: 26 } },

  { id: 'siyahbeyaz', label: 'Siyah-Beyaz', params: {
    bw: 1, contrast: 24, clarity: 22, blacks: -10, whites: 8 } },

  { id: 'noir', label: 'Noir', params: {
    bw: 1, contrast: 46, blacks: -30, whites: 14, clarity: 34, vignette: 42, grain: 26, grainSize: 16 } },

  { id: 'gumus', label: 'Gümüş', params: {
    bw: 1, contrast: 8, fade: 24, shadows: 18, highlights: -14, grain: 14 } },

  { id: 'sepya', label: 'Sepya', params: {
    saturation: -78, temperature: 22, highlightHue: 36, highlightSat: 46, shadowHue: 28, shadowSat: 30,
    contrast: 12, fade: 12 } },

  { id: 'vintage', label: 'Vintage', params: {
    exposure: 4, contrast: -8, fade: 34, saturation: -14, temperature: 14,
    shadowHue: 190, shadowSat: 24, highlightHue: 45, highlightSat: 30, grain: 22, vignette: 26 } },

  { id: 'analog', label: 'Analog', params: {
    contrast: 10, fade: 20, shadows: 16, blacks: -8, temperature: 8, vibrance: 16,
    grain: 30, grainSize: 14, vignette: 18, shadowHue: 165, shadowSat: 18 } },

  { id: 'solmus', label: 'Solmuş', params: {
    fade: 46, contrast: -16, saturation: -22, highlights: -12, shadows: 20, temperature: -6 } },

  { id: 'punch', label: 'Punch', params: {
    contrast: 34, clarity: 30, vibrance: 40, blacks: -18, whites: 12, sharpen: 24 } },

  { id: 'mat', label: 'Mat', params: {
    fade: 30, contrast: -6, blacks: 14, highlights: -18, saturation: -8, vibrance: 12 } },

  { id: 'gunbatimi', label: 'Gün Batımı', params: {
    temperature: 34, tint: 12, exposure: 6, contrast: 14, vibrance: 26,
    highlightHue: 25, highlightSat: 40, shadowHue: 260, shadowSat: 22, vignette: 20 } },

  { id: 'gece', label: 'Gece', params: {
    exposure: -12, contrast: 22, shadows: -14, blacks: -22, temperature: -22,
    shadowHue: 225, shadowSat: 40, highlightSat: 10, vignette: 34, grain: 16 } },

  { id: 'portre', label: 'Portre', params: {
    exposure: 6, contrast: 8, highlights: -18, shadows: 16, clarity: -14, sharpen: 18,
    temperature: 8, vibrance: 14, saturation: -4 } },

  { id: 'manzara', label: 'Manzara', params: {
    contrast: 20, clarity: 28, vibrance: 34, saturation: 4, highlights: -22, shadows: 14,
    sharpen: 22, temperature: -6 } },

  { id: 'yemek', label: 'Yemek', params: {
    exposure: 8, contrast: 14, vibrance: 30, saturation: 8, clarity: 18, temperature: 10,
    highlights: -14, sharpen: 20 } },

  { id: 'sokak', label: 'Sokak', params: {
    contrast: 26, clarity: 32, saturation: -18, blacks: -16, grain: 20, vignette: 24,
    shadowHue: 200, shadowSat: 18 } },

  { id: 'pastel', label: 'Pastel', params: {
    exposure: 10, contrast: -18, fade: 26, saturation: -12, vibrance: 20,
    highlightHue: 330, highlightSat: 22, shadowHue: 190, shadowSat: 18 } },

  { id: 'neon', label: 'Neon', params: {
    contrast: 28, vibrance: 46, saturation: 20, shadowHue: 285, shadowSat: 46,
    highlightHue: 180, highlightSat: 34, blacks: -20, clarity: 16 } },

  { id: 'kizilotesi', label: 'Kızılötesi', params: {
    hue: 130, vibrance: 30, contrast: 20, saturation: 14, clarity: 18 } },

  { id: 'cyanotype', label: 'Siyanotip', params: {
    saturation: -85, shadowHue: 215, shadowSat: 60, highlightHue: 195, highlightSat: 40,
    contrast: 18, fade: 10 } },

  { id: 'poster', label: 'Poster', params: {
    posterize: 6, contrast: 22, saturation: 24, clarity: 14 } },

  { id: 'cizim', label: 'Çizim', params: {
    bw: 1, threshold: 52, clarity: 40, contrast: 30 } },

  { id: 'ruya', label: 'Rüya', params: {
    exposure: 10, blurAmount: 16, fade: 24, contrast: -10, vibrance: 22,
    highlightHue: 320, highlightSat: 26, vignette: -18 } },
];

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
