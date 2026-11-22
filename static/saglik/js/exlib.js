/* exlib.js — hareket kütüphanesi: data/hareketler.json’u bir kez yükler, arar, süzer.
   Kütüphane tools/build-exercises.mjs ile üretilir (wger.de + Everkinetic). */

import { fold } from './core/core-util.js';

let lib = null;
let loading = null;

/** Kütüphaneyi yükler (bir kez; sonra bellekten). */
export function loadLibrary() {
  if (lib) return Promise.resolve(lib);
  if (!loading) {
    loading = fetch('data/hareketler.json')
      .then((r) => {
        if (!r.ok) throw new Error(`Hareket kütüphanesi yüklenemedi (${r.status})`);
        return r.json();
      })
      .then((doc) => {
        const list = doc.hareketler.map((h) => ({
          ...h,
          _q: fold([h.ad, h.en, h.alt, ...(h.diger || [])].join(' ')),
        }));
        lib = { list, byId: new Map(list.map((h) => [String(h.id), h])), kaynak: doc.kaynak, surum: doc.surum };
        return lib;
      })
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

export const libraryReady = () => !!lib;
export const getExercise = (id) => lib?.byId.get(String(id)) || null;

/**
 * Arama ve süzme. Sonuç: ad başında geçenler önce, sonra içinde geçenler.
 * @param {{q?:string, kat?:string, ekip?:string, fav?:boolean, favs?:string[]}} f
 */
export function filterLibrary(list, { q = '', kat = '', ekip = '', fav = false, favs = [] } = {}) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  const favSet = new Set(favs.map(String));
  const out = [];
  for (const h of list) {
    if (kat && h.kat !== kat) continue;
    if (ekip && !h.ekip.includes(ekip)) continue;
    if (fav && !favSet.has(String(h.id))) continue;
    if (terms.length && !terms.every((t) => h._q.includes(t))) continue;
    out.push(h);
  }
  if (terms.length) {
    const first = terms[0];
    const rank = (h) => (fold(h.ad).startsWith(first) || fold(h.en).startsWith(first) ? 0 : 1);
    out.sort((a, b) => rank(a) - rank(b));
  }
  return out;
}
