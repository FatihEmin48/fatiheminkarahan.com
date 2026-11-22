/* bodymap.js — önden ve arkadan stilize kas haritası (SVG metni).
   Ana kaslar vurgu rengiyle, yardımcı kaslar yarı saydam boyanır. Renkler CSS değişkenlerinden
   gelir; açık/koyu tema kendiliğinden uyar. Kendi çizimimiz — dış kaynak yok. */

// Bir bölge birden çok kas anahtarıyla yanabilir (ör. arkadan görünen omuz hem 'omuz' hem 'arka_omuz').
// e: elips [cx, cy, rx, ry] · d: SVG yolu. Ön görünüm x: 0–120, arka görünüm aynı koordinatlarla 140 sağda.
const FRONT = [
  { k: ['boyun'], d: 'M54 33h12v9H54z' },
  { k: ['trapez'], d: 'M53 40l-10 6 11 1zM67 40l10 6-11 1z' },
  { k: ['omuz'], e: [37, 52, 9.5, 9] }, { k: ['omuz'], e: [83, 52, 9.5, 9] },
  { k: ['gogus'], d: 'M45 46q8-3 14 0v17q-8 5-15 0q-3-9 1-17z' },
  { k: ['gogus'], d: 'M75 46q-8-3-14 0v17q8 5 15 0q3-9-1-17z' },
  { k: ['biseps'], e: [31, 73, 5.8, 12] }, { k: ['biseps'], e: [89, 73, 5.8, 12] },
  { k: ['onkol'], e: [26.5, 101, 4.8, 14] }, { k: ['onkol'], e: [93.5, 101, 4.8, 14] },
  { k: ['karin'], d: 'M52 68h16q2 0 2 2v30q-10 8-20 0V70q0-2 2-2z' },
  { k: ['oblik'], d: 'M44 70q4 0 5 3v24q-3 2-5-1q-3-13 0-26z' },
  { k: ['oblik'], d: 'M76 70q-4 0-5 3v24q3 2 5-1q3-13 0-26z' },
  { k: ['dis_kalca'], e: [42, 114, 4.5, 8] }, { k: ['dis_kalca'], e: [78, 114, 4.5, 8] },
  { k: ['on_bacak'], d: 'M42 120q8-6 15 2l-1 40q-5 6-11 0q-5-20-3-42z' },
  { k: ['on_bacak'], d: 'M78 120q-8-6-15 2l1 40q5 6 11 0q5-20 3-42z' },
  { k: ['ic_bacak'], d: 'M57.5 123q2 6 1.5 22l-2 8q-1-14 .5-30z' },
  { k: ['ic_bacak'], d: 'M62.5 123q-2 6-1.5 22l2 8q1-14-.5-30z' },
];

const BACK = [
  { k: ['boyun'], d: 'M54 33h12v9H54z' },
  { k: ['trapez'], d: 'M60 37l-17 9 12 6 5 30 5-30 12-6z' },
  { k: ['arka_omuz', 'omuz'], e: [37, 52, 9.5, 9] }, { k: ['arka_omuz', 'omuz'], e: [83, 52, 9.5, 9] },
  { k: ['orta_sirt'], d: 'M47 56l8 1 3 22-9-6zM73 56l-8 1-3 22 9-6z' },
  { k: ['kanat'], d: 'M45 60q-3 18 7 34l6 4-1-20-11-18z' },
  { k: ['kanat'], d: 'M75 60q3 18-7 34l-6 4 1-20 11-18z' },
  { k: ['triseps'], e: [30.5, 72, 6, 12.5] }, { k: ['triseps'], e: [89.5, 72, 6, 12.5] },
  { k: ['onkol'], e: [26.5, 101, 4.8, 14] }, { k: ['onkol'], e: [93.5, 101, 4.8, 14] },
  { k: ['bel'], d: 'M53.5 84h5.5v22h-6.5q-1-11 1-22zM66.5 84H61v22h6.5q1-11-1-22z' },
  { k: ['dis_kalca'], e: [44, 110, 5, 6.5] }, { k: ['dis_kalca'], e: [76, 110, 5, 6.5] },
  { k: ['kalca'], d: 'M45 113q7-6 14 0v15q-7 5-14 0q-2-8 0-15z' },
  { k: ['kalca'], d: 'M75 113q-7-6-14 0v15q7 5 14 0q2-8 0-15z' },
  { k: ['arka_bacak'], d: 'M45 131q6 4 12 0l-1 32q-5 5-10 0q-3-16-1-32z' },
  { k: ['arka_bacak'], d: 'M75 131q-6 4-12 0l1 32q5 5 10 0q3-16 1-32z' },
  { k: ['baldir'], e: [50, 185, 6.5, 14] }, { k: ['baldir'], e: [70, 185, 6.5, 14] },
];

/** Gövde silüeti (iki görünümde aynı). */
const SILHOUETTE = [
  '<ellipse cx="60" cy="19" rx="12.5" ry="14.5"/>',
  '<path d="M52 32h16v10H52z"/>',
  // gövde
  '<path d="M41 44q19-8 38 0q6 2 7 10l-1 24q-3 22-4 34q-1 8-21 10q-20-2-21-10q-1-12-4-34l-1-24q1-8 7-10z"/>',
  // kollar
  '<path d="M29 46q8-4 10 8l-2 30q-1 10-2 24q-1 12-5 18q-4 1-6-2q-2-14-1-30q1-26 6-48z"/>',
  '<path d="M91 46q-8-4-10 8l2 30q1 10 2 24q1 12 5 18q4 1 6-2q2-14 1-30q-1-26-6-48z"/>',
  // eller
  '<ellipse cx="24.5" cy="128" rx="4.5" ry="6"/><ellipse cx="95.5" cy="128" rx="4.5" ry="6"/>',
  // bacaklar
  '<path d="M40 116q10-4 19 4q1 30-2 46q-1 16-1 30q0 16-3 26q-4 3-7 0q-3-20-4-34q-1-14-2-30q-2-20 0-42z"/>',
  '<path d="M80 116q-10-4-19 4q-1 30 2 46q1 16 1 30q0 16 3 26q4 3 7 0q3-20 4-34q1-14 2-30q2-20 0-42z"/>',
  // ayaklar
  '<path d="M44 222q6-2 10 1l1 6q-6 2-12 0z"/><path d="M76 222q-6-2-10 1l-1 6q6 2 12 0z"/>',
].join('');

function shapes(list, prim, sec) {
  return list.map((s) => {
    const p = s.k.some((k) => prim.has(k));
    const q = !p && s.k.some((k) => sec.has(k));
    const cls = p ? 'bm-p' : q ? 'bm-s' : 'bm-m';
    if (s.e) {
      const [cx, cy, rx, ry] = s.e;
      return `<ellipse class="${cls}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;
    }
    return `<path class="${cls}" d="${s.d}"/>`;
  }).join('');
}

/**
 * Kas haritası SVG metni.
 * @param {string[]} primary ana kaslar  @param {string[]} secondary yardımcı kaslar
 * @param {{labels?:boolean, title?:string}} opts
 */
export function bodyMap(primary = [], secondary = [], { labels = true, title = '' } = {}) {
  const prim = new Set(primary);
  const sec = new Set(secondary);
  const view = (list, dx, label) => `<g transform="translate(${dx} 0)">`
    + `<g class="bm-body">${SILHOUETTE}</g>${shapes(list, prim, sec)}`
    + (labels ? `<text x="60" y="244" class="bm-t">${label}</text>` : '')
    + '</g>';
  return `<svg class="bodymap" viewBox="0 0 260 ${labels ? 250 : 234}" role="img"`
    + ` aria-label="${title || 'Çalışan kaslar'}">`
    + view(FRONT, 0, 'Ön') + view(BACK, 140, 'Arka') + '</svg>';
}

/** Küçük (liste küçük resmi) kas haritası: yalnız hangi bölgenin baskın olduğu görünsün. */
export const bodyThumb = (primary, secondary) => bodyMap(primary, secondary, { labels: false });
