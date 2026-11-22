/* workout.js — Antrenman sekmesi.
   Hareket kütüphanesi (wger.de + Everkinetic), hareket sayfası, tam ekran antrenman oturumu
   (setler, dinlenme sayacı, ekran kararmasın), bitiş özeti ve rekorlar, programlar, geçmiş, ilerleme.
   Hesaplar shared/core-workout.js’te; burada yalnız arayüz var. */

import * as W from './core/core-workout.js';
import { loadLibrary, getExercise, filterLibrary } from './exlib.js';
import { bodyMap } from './bodymap.js';
import { lineChart, sparkline } from './charts.js';

let C = null;          // app.js’ten gelen yardımcılar
let lib = null;        // { list, byId, kaynak }
let libError = null;
let cur = null;        // sürmekte olan antrenman (S.state.activeWorkout’un çalışma kopyası)
let sessionOpen = false;
let clockTimer = null;
let wakeLock = null;
let persistTimer = null;
let rest = null;       // { end, total, label }
let restTimer = null;
let audioCtx = null;
let libFilter = { q: '', kat: '', ekip: '', fav: false };

const $ = (id) => document.getElementById(id);
const S = () => C.S;
const esc = (s) => C.esc(s ?? '');
const num = (v, kind = 'float') => C.U.parseNum(v, kind);
const nf = (v, d = 0) => C.U.nf(v, d);

/* ================= kurulum ================= */

export function initWorkout(ctx) {
  C = ctx;
  buildSessionShell();
  cur = S().state.activeWorkout ? structuredClone(S().state.activeWorkout) : null;
  loadLibrary().then((l) => { lib = l; if (C.view() === 'workout') renderWorkout(); refreshMini(); })
    .catch((e) => { libError = e; if (C.view() === 'workout') renderWorkout(); });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (sessionOpen) { acquireWakeLock(); tickClock(); }
      if (rest) tickRest();
    }
  });
  window.addEventListener('pagehide', () => persist(true));
  // Yerel veri sıfırlanır ya da yedekten dönülürse bellekteki oturum depoyla aynı olsun
  S().onChange((reason) => {
    if (reason === 'reset' || reason === 'import') {
      cur = S().state.activeWorkout ? structuredClone(S().state.activeWorkout) : null;
      if (!cur) closeSessionUI();
    }
  });
  setInterval(refreshMini, 15000);
  refreshMini();
}

export const hasActive = () => !!cur;
export const isSessionOpen = () => sessionOpen;

/* ================= sekme ================= */

export function renderWorkout() {
  const host = $('view-workout');
  if (!host) return;
  if (!lib) {
    host.innerHTML = libError
      ? `<section class="card"><h2 class="card-title">Kütüphane açılamadı</h2>
         <p class="muted small">${esc(libError.message)}</p>
         <button class="btn-ghost wide" data-act="retry">Tekrar dene</button></section>`
      : '<section class="card"><p class="muted small center">Hareket kütüphanesi yükleniyor…</p></section>';
    host.onclick = (e) => {
      if (e.target.closest('[data-act="retry"]')) {
        libError = null;
        renderWorkout();
        loadLibrary().then((l) => { lib = l; renderWorkout(); }).catch((er) => { libError = er; renderWorkout(); });
      }
    };
    return;
  }

  const st = S().state;
  const parts = [];

  if (cur) {
    const sum = W.workoutSummary(cur);
    parts.push(`<section class="card wk-live">
      <div class="card-head"><h2>Antrenman sürüyor</h2><span class="pill ok" data-clock>${clockText()}</span></div>
      <p class="muted">${esc(cur.name)} · ${cur.items.length} hareket · ${sum.sets} set tamamlandı</p>
      <button class="btn-primary wide" data-act="resume">Devam et</button>
    </section>`);
  } else {
    parts.push(`<section class="card">
      <div class="card-head"><h2>Antrenmana başla</h2></div>
      <div class="action-row" style="margin-top:4px">
        <button class="btn-primary" data-act="start-empty">Boş antrenman</button>
        <button class="btn-ghost" data-act="programs">Programdan başla</button>
      </div>
    </section>`);
  }

  // bu hafta
  const wk = W.weekSummary(st.workouts);
  const streak = W.weekStreak(st.workouts);
  const maxG = Math.max(10, ...W.GRUPLAR.map((g) => wk.groups[g] || 0));
  parts.push(`<section class="card">
    <div class="card-head"><h2>Bu hafta</h2><span class="pill">${wk.sessions} antrenman</span></div>
    <div class="stat-grid wk-stats">
      ${statBox('Süre', C.U.dur(wk.minutes))}
      ${statBox('Set', nf(wk.sets))}
      ${statBox('Hacim', wk.volume ? `${nf(wk.volume)}<small> kg</small>` : '—')}
      ${statBox('Düzen', streak ? `${streak}<small> hafta</small>` : '—')}
    </div>
    <div class="wk-groups">${W.GRUPLAR.map((g) => {
      const v = wk.groups[g] || 0;
      return `<div class="wk-g"><span>${W.KATEGORI_AD[g].split(' ')[0]}</span>
        <i><b style="width:${Math.min(100, (v / maxG) * 100).toFixed(0)}%"></b></i><em>${v ? nf(v, v % 1 ? 1 : 0) : '0'}</em></div>`;
    }).join('')}</div>
    <p class="muted small" style="margin-top:8px">Kas grubu başına set (yardımcı kas yarım sayılır). Çoğu kişi için haftada 10–20 set iyi bir hedeftir.</p>
  </section>`);

  // kütüphane
  parts.push(`<section class="card">
    <div class="card-head"><h2>Hareket kütüphanesi</h2><span class="pill">${lib.list.length} hareket</span></div>
    <button class="wk-search" data-act="library">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span>Ara: bench, squat, şınav, plank…</span>
    </button>
    <div class="chips">${W.KATEGORI.map((k) => `<button class="chip" data-act="library" data-kat="${k.id}">${k.ad}</button>`).join('')}
      ${st.exFav.length ? '<button class="chip" data-act="library" data-fav="1">★ Favoriler</button>' : ''}</div>
  </section>`);

  // programlar
  const mine = Object.values(st.routines).filter((r) => !r.deleted)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  parts.push(`<section class="card">
    <div class="card-head"><h2>Programlar</h2><button class="head-link" data-act="new-routine">+ Yeni program</button></div>
    ${mine.length ? `<ul class="wk-list">${mine.map((r) => routineRow(r, false)).join('')}</ul>` : ''}
    <h3 class="sheet-label">Hazır programlar</h3>
    <ul class="wk-list">${W.HAZIR_PROGRAMLAR.map((r) => routineRow(r, true)).join('')}</ul>
  </section>`);

  // geçmiş
  const done = W.finished(st.workouts).reverse();
  parts.push(`<section class="card">
    <div class="card-head"><h2>Son antrenmanlar</h2>${done.length ? `<span class="pill">${done.length}</span>` : ''}</div>
    ${done.length ? `<ul class="wk-list">${done.slice(0, 8).map(historyRow).join('')}</ul>
      ${done.length > 8 ? '<button class="btn-ghost wide" data-act="history" style="margin-top:8px">Tüm geçmiş</button>' : ''}`
      : '<p class="muted small">Henüz antrenman yok. İlk antrenmanını bitirdiğinde burada görünecek.</p>'}
  </section>`);

  // ilerleme
  const prog = progressList(st.workouts);
  if (prog.length) {
    parts.push(`<section class="card">
      <div class="card-head"><h2>İlerleme</h2></div>
      <ul class="wk-list">${prog.map((p) => `<li><button class="wk-row" data-act="exercise" data-id="${p.ex}">
        <span class="wk-row-main"><b>${esc(p.name)}</b><small>${p.sessions} antrenman · ${esc(p.best)}</small></span>
        <span class="wk-spark">${sparkline(p.series, { height: 30, color: 'var(--accent)' })}</span>
      </button></li>`).join('')}</ul>
    </section>`);
  }

  parts.push(`<p class="about wk-credit">Hareket bilgileri ve çizimler: <b>wger.de</b> ve <b>Everkinetic</b>
    (CC BY-SA). <button class="head-link" data-act="credits">Kaynaklar ve lisanslar</button></p>`);

  host.innerHTML = parts.join('');
  host.onclick = onTabClick;
}

/** Bugün sekmesindeki kart: o günün antrenmanları ve sürmekte olan antrenman. */
export function renderTodayCard(host, dayKey) {
  if (!host || !C) return;
  const list = W.finished(S().state.workouts).filter((w) => w.day === dayKey);
  const live = !!cur && cur.day === dayKey;
  if (!list.length && !live) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;
  host.innerHTML = `<div class="card-head"><h2>Antrenman</h2>
      ${live ? `<span class="pill ok" data-clock>${clockText()}</span>` : `<span class="pill">${list.length}</span>`}</div>
    ${live ? '<button class="btn-primary wide" data-act="resume">Sürmekte olan antrenmana dön</button>' : ''}
    ${list.length ? `<ul class="wk-list" style="margin-top:${live ? 10 : 0}px">${list.map(historyRow).join('')}</ul>` : ''}`;
  host.onclick = onTabClick;
}

const statBox = (k, v) => `<div class="stat"><div class="stat-k">${k}</div><div class="stat-v">${v}</div></div>`;

/** Rekor değeri: kg / tekrar / süre */
function prValue(kind, v) {
  if (v == null) return '—';
  if (kind === 'sec') return W.fmtDur(v);
  if (kind === 'reps') return `${v} tekrar`;
  return `${nf(v, v % 1 ? 1 : 0)} kg`;
}

function routineRow(r, builtIn) {
  const n = r.items.length;
  return `<li><div class="wk-row">
    <button class="wk-row-main" data-act="routine" data-id="${esc(r.id)}">
      <b>${esc(r.name)}</b><small>${n} hareket${builtIn ? '' : ' · programın'}</small></button>
    <button class="btn-ghost small-btn" data-act="start-routine" data-id="${esc(r.id)}">Başlat</button>
  </div></li>`;
}

function historyRow(w) {
  const s = W.workoutSummary(w);
  const prs = W.recordCount(W.newRecords(w, S().state.workouts));
  return `<li><button class="wk-row" data-act="workout" data-id="${esc(w.id)}">
    <span class="wk-row-main"><b>${esc(w.name || 'Antrenman')}</b>
      <small>${esc(C.U.relativeDay(w.day))} · ${s.minutes} dk · ${s.sets} set${s.volume ? ` · ${nf(s.volume)} kg` : ''}</small></span>
    ${prs ? `<span class="pill ok">🏆 ${prs}</span>` : ''}
  </button></li>`;
}

/** En sık yapılan hareketlerin özeti ve seans başına en iyi değer serisi. */
function progressList(workouts) {
  const by = new Map();
  for (const w of W.finished(workouts)) {
    for (const it of w.items || []) {
      const sum = W.itemSummary(it);
      if (!sum.sets) continue;
      const key = String(it.ex);
      const m = it.measure || 'agirlik';
      const v = m === 'agirlik' ? sum.bestE1rm : m === 'tekrar' ? sum.bestReps : m === 'sure' ? sum.bestSec : sum.km || sum.sec;
      const e = by.get(key) || { ex: it.ex, name: it.name, measure: m, sessions: 0, series: [] };
      e.sessions++;
      if (v != null) e.series.push(v);
      by.set(key, e);
    }
  }
  return [...by.values()].filter((e) => e.sessions >= 2).sort((a, b) => b.sessions - a.sessions).slice(0, 6)
    .map((e) => {
      const best = e.series.length ? Math.max(...e.series) : null;
      const label = best == null ? '' : e.measure === 'agirlik' ? `tahmini 1TM ${nf(best, best % 1 ? 1 : 0)} kg`
        : e.measure === 'tekrar' ? `en çok ${best} tekrar` : e.measure === 'sure' ? `en uzun ${W.fmtDur(best)}` : '';
      return { ...e, best: label };
    });
}

function onTabClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'resume': openSession(); break;
    case 'start-empty': startWorkout(); break;
    case 'programs': programsSheet(); break;
    case 'library':
      libFilter = { q: '', kat: b.dataset.kat || '', ekip: '', fav: !!b.dataset.fav };
      openLibrary();
      break;
    case 'new-routine': routineEditor(); break;
    case 'routine': routineSheet(findRoutine(id)); break;
    case 'start-routine': startWorkout({ routine: findRoutine(id) }); break;
    case 'workout': workoutSheet(S().state.workouts[id]); break;
    case 'history': historySheet(); break;
    case 'exercise': openExercise(id); break;
    case 'credits': creditsSheet(); break;
    default:
  }
}

const findRoutine = (id) => W.HAZIR_PROGRAMLAR.find((r) => r.id === id) || S().state.routines[id] || null;

/* ================= kütüphane ================= */

function thumb(h, cls = 'ex-thumb') {
  const g = h.gorsel[h.gorsel.length > 1 ? 1 : 0];
  if (g) return `<img class="${cls}${g.stil === 'cizgi' ? ' ln' : ''}" src="${esc(g.f)}" alt="" loading="lazy" decoding="async">`;
  return `<span class="${cls} ex-thumb-map">${bodyMap(h.kas, h.kas2, { labels: false })}</span>`;
}

/**
 * Kütüphane sayfası. pick verilirse seçici kipindedir: satıra dokunmak hareketi seçer.
 * @param {{pick?:(h)=>void, title?:string}} opts
 */
export function openLibrary({ pick = null, title = null } = {}) {
  if (!lib) { C.toast('Kütüphane henüz yüklenmedi'); return; }
  const box = C.el('div', 'lib-sheet');
  const st = S().state;
  box.innerHTML = `
    <div class="lib-search"><input type="search" id="lib-q" placeholder="Hareket ara (Türkçe ya da İngilizce)" value="${esc(libFilter.q)}" enterkeyhint="search" autocomplete="off"></div>
    <div class="chips lib-cats">
      <button class="chip${!libFilter.kat && !libFilter.fav ? ' on' : ''}" data-kat="">Tümü</button>
      ${W.KATEGORI.map((k) => `<button class="chip${libFilter.kat === k.id ? ' on' : ''}" data-kat="${k.id}">${k.ad}</button>`).join('')}
      <button class="chip${libFilter.fav ? ' on' : ''}" data-fav="1">★</button>
    </div>
    <label class="field inline lib-ekip"><span>Ekipman</span><select id="lib-ekip">
      <option value="">Hepsi</option>
      ${Object.entries(W.EKIPMAN).map(([k, v]) => `<option value="${k}"${libFilter.ekip === k ? ' selected' : ''}>${v}</option>`).join('')}
    </select></label>
    <p class="muted small" id="lib-count"></p>
    <ul class="lib-list" id="lib-list"></ul>`;

  const listEl = box.querySelector('#lib-list');
  const countEl = box.querySelector('#lib-count');
  const draw = () => {
    const rows = filterLibrary(lib.list, { ...libFilter, favs: st.exFav });
    countEl.textContent = rows.length ? `${rows.length} hareket${pick ? ' · eklemek için dokun' : ''}` : 'Eşleşen hareket yok.';
    listEl.innerHTML = rows.map((h) => `<li class="lib-item">
      <button class="lib-row" data-id="${h.id}">${thumb(h)}
        <span class="lib-text"><b>${esc(h.ad)}</b><small>${esc(h.alt || h.en)}</small>
          <em>${h.kas.map((k) => W.KAS[k]).join(', ')}</em></span>
      </button>
      ${pick ? `<button class="icon-btn small lib-info" data-info="${h.id}" aria-label="Bilgi">i</button>` : ''}
    </li>`).join('');
  };
  draw();

  const q = box.querySelector('#lib-q');
  q.oninput = () => { libFilter.q = q.value; draw(); };
  box.querySelector('#lib-ekip').onchange = (e) => { libFilter.ekip = e.target.value; draw(); };
  box.querySelector('.lib-cats').onclick = (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    if (c.dataset.fav) { libFilter.fav = !libFilter.fav; libFilter.kat = ''; } else { libFilter.kat = c.dataset.kat; libFilter.fav = false; }
    for (const x of box.querySelectorAll('.lib-cats .chip')) {
      x.classList.toggle('on', x.dataset.fav ? libFilter.fav : (!libFilter.fav && x.dataset.kat === libFilter.kat));
    }
    draw();
  };
  listEl.onclick = (e) => {
    const info = e.target.closest('[data-info]');
    if (info) { openExercise(info.dataset.info, { pick }); return; }
    const row = e.target.closest('.lib-row');
    if (!row) return;
    const h = getExercise(row.dataset.id);
    if (pick) { C.closeSheet(); pick(h); } else openExercise(h.id);
  };
  C.openSheet(title || (pick ? 'Hareket ekle' : 'Hareket kütüphanesi'), box);
}

/* ================= hareket sayfası ================= */

export function openExercise(id, { pick = null } = {}) {
  const h = getExercise(id);
  if (!h) { C.toast('Hareket bulunamadı'); return; }
  const st = S().state;
  const box = C.el('div', 'ex-sheet');
  const frames = h.gorsel;
  const visual = frames.length
    ? `<div class="ex-anim${frames[0].stil === 'cizgi' ? ' line' : ''}" data-n="${frames.length}">${frames.map((g, i) =>
      `<img class="${i === 0 ? 'on' : ''}${g.stil === 'cizgi' ? ' ln' : ''}" src="${esc(g.f)}" alt="${esc(h.ad)} — ${i === 0 ? 'başlangıç' : 'hareket'}">`).join('')}
      ${frames.length > 1 ? '<span class="ex-anim-hint">dokun: durdur / oynat</span>' : ''}</div>`
    : `<div class="ex-map-big">${bodyMap(h.kas, h.kas2, { title: `${h.ad}: çalışan kaslar` })}</div>`;

  const hist = W.exerciseHistory(st.workouts, h.id);
  const rec = hist.length ? W.records(st.workouts, h.id) : null;
  const isFav = st.exFav.includes(String(h.id));
  const lic = frames.length
    ? [...new Set(frames.map((g) => `${g.yazar} · ${g.lisans}`))].join('; ')
    : '';

  box.innerHTML = `
    ${visual}
    <p class="ex-sub">${esc(h.alt || '')}${h.en && h.en.toLocaleLowerCase('tr') !== h.ad.toLocaleLowerCase('tr')
    ? `<small>${esc(h.en)}</small>` : ''}</p>
    <div class="chips">
      <span class="chip ok">${esc(W.KATEGORI_AD[h.kat])}</span>
      <span class="chip">${esc(W.SEVIYE[h.seviye])}</span>
      ${h.ekip.map((k) => `<span class="chip">${esc(W.EKIPMAN[k])}</span>`).join('')}
    </div>
    <div class="ex-muscles">
      ${frames.length ? `<div class="ex-map-small">${bodyMap(h.kas, h.kas2, { labels: false })}</div>` : ''}
      <p class="small"><b>Ana kas:</b> ${h.kas.map((k) => esc(W.KAS[k])).join(', ')}
        ${h.kas2.length ? `<br><b>Yardımcı:</b> ${h.kas2.map((k) => esc(W.KAS[k])).join(', ')}` : ''}</p>
    </div>
    <h3 class="sheet-label">Nasıl yapılır</h3>
    <ol class="ex-steps">${h.adim.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${h.ipucu ? `<p class="ex-tip"><b>İpucu:</b> ${esc(h.ipucu)}</p>` : ''}
    ${rec ? historyBlock(h, hist, rec) : ''}
    ${similarBlock(h)}
    <div class="share-actions">
      <button class="btn-primary" data-act="use">${pick ? 'Bunu ekle' : cur ? 'Antrenmana ekle' : 'Bununla başla'}</button>
      <button class="btn-ghost" data-act="fav">${isFav ? '★ Favoride' : '☆ Favori'}</button>
    </div>
    <p class="about ex-credit">${lic ? `Görsel: ${esc(lic)}<br>` : ''}Metin: wger.de katkıcıları
      (${esc(h.metin?.yazar || 'wger')}) açıklamasından Türkçeye uyarlandı · ${esc(h.metin?.lisans || 'CC BY-SA 4.0')}
      · <a href="${esc(h.kaynak)}" target="_blank" rel="noopener">wger’da aç</a></p>`;

  // kare kare canlandırma (başlangıç ↔ kasılma)
  const anim = box.querySelector('.ex-anim');
  if (anim && frames.length > 1) {
    let i = 0;
    let playing = true;
    const imgs = [...anim.querySelectorAll('img')];
    const t = setInterval(() => {
      if (!box.isConnected) { clearInterval(t); return; }
      if (!playing || document.hidden) return;
      imgs[i].classList.remove('on');
      i = (i + 1) % imgs.length;
      imgs[i].classList.add('on');
    }, 1100);
    anim.onclick = () => { playing = !playing; anim.classList.toggle('paused', !playing); };
  }

  box.onclick = (e) => {
    const sim = e.target.closest('[data-sim]');
    if (sim) { openExercise(sim.dataset.sim, { pick }); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'fav') {
      const on = S().toggleFav(h.id);
      b.textContent = on ? '★ Favoride' : '☆ Favori';
      C.toast(on ? 'Favorilere eklendi' : 'Favorilerden çıkarıldı');
    } else if (b.dataset.act === 'use') {
      if (pick) { C.closeSheet(); pick(h); } else if (cur) { addExercise(h); C.closeSheet(); openSession(); } else startWorkout({ exercise: h });
    }
  };
  C.openSheet(h.ad, box);
}

/**
 * Aynı ana kası çalıştıran alternatifler (makine doluysa, ekipman yoksa). Önce aynı kategori,
 * ana kas örtüşmesi çok olan önde; ekipmanı farklı olanlar da gösterilir.
 */
function similarBlock(h) {
  if (!lib) return '';
  const score = (x) => x.kas.filter((k) => h.kas.includes(k)).length * 2 + (x.kat === h.kat ? 1 : 0);
  const stretch = (x) => x.kat === 'esneme';      // esnemeye esneme, harekete hareket öner
  const list = lib.list
    .filter((x) => x.id !== h.id && x.kas.some((k) => h.kas.includes(k)) && stretch(x) === stretch(h))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 8);
  if (!list.length) return '';
  return `<h3 class="sheet-label">Benzer hareketler</h3>
    <div class="chips">${list.map((x) => `<button class="chip" data-sim="${x.id}">${esc(x.ad)}</button>`).join('')}</div>`;
}

function historyBlock(h, hist, rec) {
  const m = h.olcu || 'agirlik';
  const last = hist[hist.length - 1];
  const bests = [];
  if (rec.e1rm) bests.push(['Tahmini 1TM', `${nf(rec.e1rm.value, rec.e1rm.value % 1 ? 1 : 0)} kg`]);
  if (m === 'agirlik' && rec.kg) bests.push(['En ağır', `${nf(rec.kg.value, rec.kg.value % 1 ? 1 : 0)} kg`]);
  if (m === 'tekrar' && rec.reps) bests.push(['En çok tekrar', String(rec.reps.value)]);
  if ((m === 'sure' || m === 'kardiyo') && rec.sec) bests.push(['En uzun', W.fmtDur(rec.sec.value)]);
  bests.push(['Antrenman', String(rec.sessions)]);
  const pts = hist.map((x) => ({
    label: C.U.prettyDay(x.day),
    value: m === 'agirlik' ? x.bestE1rm : m === 'tekrar' ? x.bestReps : x.bestSec,
  }));
  return `<h3 class="sheet-label">Geçmişin</h3>
    <div class="stat-grid">${bests.map(([k, v]) => statBox(k, v)).join('')}</div>
    <p class="muted small" style="margin-top:8px">Son: ${esc(C.U.prettyDay(last.day))} — ${last.sets.map((s) => esc(W.fmtSet(s, m))).join(' · ')}</p>
    ${pts.filter((p) => p.value != null).length >= 2
    ? `<div class="chart">${lineChart(pts, { height: 130, unit: m === 'agirlik' ? ' kg' : m === 'tekrar' ? ' tekrar' : ' sn' })}</div>`
    : ''}`;
}

/* ================= antrenman oturumu ================= */

function buildSessionShell() {
  if ($('session')) return;
  const s = C.el('div', 'session');
  s.id = 'session';
  s.hidden = true;
  s.setAttribute('role', 'dialog');
  s.setAttribute('aria-label', 'Antrenman');
  s.innerHTML = `
    <header class="ses-head">
      <button class="icon-btn" data-act="min" aria-label="Küçült">
        <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="ses-title"><input id="ses-name" maxlength="60" aria-label="Antrenman adı"><span id="ses-clock">0:00</span></div>
      <button class="icon-btn" data-act="menu" aria-label="Diğer">
        <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>
      </button>
      <button class="btn-primary ses-finish" data-act="finish">Bitir</button>
    </header>
    <div class="ses-body" id="ses-body"></div>
    <div class="ses-rest" id="ses-rest" hidden>
      <div class="ses-rest-bar"><i id="ses-rest-fill"></i></div>
      <div class="ses-rest-row">
        <span class="ses-rest-label" id="ses-rest-label">Dinlenme</span>
        <b id="ses-rest-time">0:00</b>
        <button class="chip" data-act="rest-minus">−15</button>
        <button class="chip" data-act="rest-plus">+15</button>
        <button class="chip ok" data-act="rest-skip">Geç</button>
      </div>
    </div>`;
  document.body.appendChild(s);

  const mini = C.el('button', 'session-mini');
  mini.id = 'session-mini';
  mini.hidden = true;
  mini.onclick = () => openSession();
  document.body.appendChild(mini);

  s.addEventListener('click', onSessionClick);
  s.addEventListener('input', onSessionInput);
  s.addEventListener('change', () => persist(true));
  $('ses-name').addEventListener('input', (e) => { if (cur) { cur.name = e.target.value; persist(); } });
}

function persist(now = false) {
  if (!cur) return;
  clearTimeout(persistTimer);
  const write = () => { persistTimer = null; S().setActiveWorkout(cur); };
  if (now) write(); else persistTimer = setTimeout(write, 500);
}

function startWorkout({ routine = null, exercise = null } = {}) {
  if (cur) {
    const box = C.el('div');
    box.innerHTML = `<p class="muted small">Sürmekte olan bir antrenmanın var: <b>${esc(cur.name)}</b>.</p>
      <div class="share-actions"><button class="btn-primary" data-x="resume">Ona devam et</button>
      <button class="btn-ghost" data-x="discard">Onu sil, yenisini başlat</button></div>`;
    box.onclick = (e) => {
      const x = e.target.closest('[data-x]')?.dataset.x;
      if (x === 'resume') { C.closeSheet(); openSession(); }
      if (x === 'discard') { discardWorkout(); C.closeSheet(); startWorkout({ routine, exercise }); }
    };
    C.openSheet('Antrenman sürüyor', box);
    return;
  }
  const w = W.newWorkout({ routine, lib: lib.byId, workouts: S().state.workouts, name: exercise ? exercise.ad : 'Antrenman' });
  cur = w;
  if (exercise) addExercise(exercise, false);
  persist(true);
  C.closeSheet();
  openSession();
  C.render();
}

function addExercise(h, save = true) {
  if (!cur) return;
  const item = W.itemFromExercise(h, { sets: h.olcu === 'kardiyo' ? 1 : 3 });
  W.prefillFromLast(item, S().state.workouts);
  cur.items.push(item);
  if (save) { persist(true); renderSession(); }
}

export function openSession() {
  if (!cur) return;
  sessionOpen = true;
  $('session').hidden = false;
  $('session-mini').hidden = true;
  document.documentElement.classList.add('ses-lock');
  $('ses-name').value = cur.name || '';
  renderSession();
  tickClock();
  clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 1000);
  acquireWakeLock();
  if (rest) $('ses-rest').hidden = false;
}

export function minimizeSession() {
  sessionOpen = false;
  $('session').hidden = true;
  document.documentElement.classList.remove('ses-lock');
  clearInterval(clockTimer);
  releaseWakeLock();
  persist(true);
  refreshMini();
  C.render();
}

function closeSessionUI() {
  sessionOpen = false;
  $('session').hidden = true;
  document.documentElement.classList.remove('ses-lock');
  clearInterval(clockTimer);
  releaseWakeLock();
  stopRest();
  refreshMini();
}

function refreshMini() {
  const mini = $('session-mini');
  if (!mini) return;
  mini.hidden = !cur || sessionOpen;
  if (cur) mini.innerHTML = `<span class="dot"></span><span>${esc(cur.name || 'Antrenman')} · ${clockText()}</span><b>Devam et</b>`;
  const dot = $('workout-dot');
  if (dot) dot.hidden = !cur;
  for (const el of document.querySelectorAll('[data-clock]')) el.textContent = clockText();
}

function clockText() {
  if (!cur) return '';
  const sec = Math.max(0, Math.floor((Date.now() - Date.parse(cur.started_at)) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function tickClock() {
  const el = $('ses-clock');
  if (el && cur) el.textContent = clockText();
}

async function acquireWakeLock() {
  try {
    if (!('wakeLock' in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* */ }
  wakeLock = null;
}

/* ---------- çizim ---------- */

const MEASURE_COLS = {
  agirlik: [['kg', 'kg', 'decimal'], ['reps', 'tekrar', 'numeric']],
  tekrar: [['kg', '+kg', 'decimal'], ['reps', 'tekrar', 'numeric']],
  sure: [['sec', 'saniye', 'numeric']],
  kardiyo: [['min', 'dakika', 'decimal'], ['km', 'km', 'decimal']],
};

function renderSession() {
  const body = $('ses-body');
  if (!body || !cur) return;
  const ws = S().state.workouts;
  body.innerHTML = cur.items.map((it, i) => {
    const h = getExercise(it.ex);
    const m = it.measure || 'agirlik';
    const last = W.lastPerformance(ws, it.ex, { excludeId: cur.id });
    const cols = MEASURE_COLS[m] || MEASURE_COLS.agirlik;
    const head = `<div class="set-row head"><span>Set</span><span>Önceki</span>${cols.map((c) => `<span>${c[1]}</span>`).join('')}<span>✓</span></div>`;
    const rows = it.sets.map((s, j) => setRow(it, i, s, j, last, cols, m)).join('');
    return `<section class="card ses-item" data-i="${i}">
      <div class="ses-item-head">
        <button class="ses-thumb" data-act="info" data-i="${i}" aria-label="Hareket bilgisi">${h ? thumb(h, 'ses-img') : ''}</button>
        <div class="ses-item-title"><b>${esc(it.name)}</b>
          <small>${it.target ? `Hedef: ${it.sets.length} × ${esc(it.target)} · ` : ''}dinlenme ${W.fmtDur(it.rest || 0)}</small></div>
        <button class="icon-btn small" data-act="item-menu" data-i="${i}" aria-label="Hareket seçenekleri">⋯</button>
      </div>
      ${it.note ? `<p class="muted small ses-note">${esc(it.note)}</p>` : ''}
      ${last ? `<p class="muted small">Geçen sefer (${esc(C.U.relativeDay(last.day))}): ${last.sets.map((s) => esc(W.fmtSet(s, m))).join(' · ')}</p>` : ''}
      <div class="set-table cols-${cols.length}">${head}${rows}</div>
      <div class="ses-item-actions">
        <button class="btn-ghost small-btn" data-act="add-set" data-i="${i}">+ Set</button>
        ${it.sets.length > 1 ? `<button class="btn-ghost small-btn" data-act="del-set" data-i="${i}">− Son set</button>` : ''}
      </div>
    </section>`;
  }).join('') + `
    <button class="btn-ghost wide ses-add" data-act="add-ex">+ Hareket ekle</button>
    ${cur.items.length ? '' : '<p class="muted small center" style="margin-top:12px">Kütüphaneden hareket ekleyerek başla.</p>'}
    <div style="height:120px"></div>`;
}

function setRow(it, i, s, j, last, cols, m) {
  const prev = last?.sets[Math.min(j, last.sets.length - 1)];
  const prevText = prev ? W.fmtSet(prev, m) : '—';
  const typeLabel = s.type === 'w' ? 'I' : s.type === 'd' ? 'D' : s.type === 'f' ? 'T' : String(workIndex(it, j));
  const inputs = cols.map(([f, label, mode]) => {
    const val = f === 'min' ? (s.sec != null ? round1(s.sec / 60) : '') : (s[f] ?? '');
    const ph = placeholderFor(it, j, f, prev);
    return `<input class="set-in" data-f="${f}" data-i="${i}" data-s="${j}" inputmode="${mode}" enterkeyhint="done"
      value="${esc(String(val).replace('.', ','))}" placeholder="${esc(ph)}" aria-label="${label}">`;
  }).join('');
  return `<div class="set-row${s.done ? ' done' : ''}" data-i="${i}" data-s="${j}">
    <button class="set-n t-${s.type || 'n'}" data-act="set-type" data-i="${i}" data-s="${j}" aria-label="Set türü">${typeLabel}</button>
    <span class="set-prev">${esc(prevText)}</span>${inputs}
    <button class="set-ok" data-act="set-done" data-i="${i}" data-s="${j}" aria-label="Seti tamamla">✓</button>
  </div>`;
}

const round1 = (v) => Math.round(v * 10) / 10;
/** Isınma setleri numaralanmaz; çalışma setleri 1’den sayılır. */
const workIndex = (it, j) => it.sets.slice(0, j + 1).filter((s) => s.type !== 'w').length;

function placeholderFor(it, j, f, prev) {
  if (prev) {
    if (f === 'min') return prev.sec != null ? String(round1(prev.sec / 60)).replace('.', ',') : '';
    const v = prev[f];
    if (v != null) return String(v).replace('.', ',');
  }
  if (f === 'reps' && it.target) {
    const m = /\d+/.exec(it.target);
    return m ? m[0] : '';
  }
  return '';
}

/* ---------- olaylar ---------- */

function onSessionInput(e) {
  const inp = e.target.closest('.set-in');
  if (!inp || !cur) return;
  const it = cur.items[Number(inp.dataset.i)];
  const s = it?.sets[Number(inp.dataset.s)];
  if (!s) return;
  const f = inp.dataset.f;
  const raw = inp.value.trim();
  if (f === 'min') s.sec = raw === '' ? null : Math.round((num(raw) || 0) * 60);
  else if (f === 'reps' || f === 'sec') s[f] = raw === '' ? null : num(raw, 'int');
  else s[f] = raw === '' ? null : num(raw);
  persist();
}

function onSessionClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || !cur) return;
  const i = Number(b.dataset.i);
  const j = Number(b.dataset.s);
  const it = cur.items[i];
  switch (b.dataset.act) {
    case 'min': minimizeSession(); break;
    case 'finish': finishFlow(); break;
    case 'menu': sessionMenu(); break;
    case 'add-ex': openLibrary({ pick: (h) => { addExercise(h); } }); break;
    case 'info': openExercise(it.ex); break;
    case 'item-menu': itemMenu(i); break;
    case 'add-set': {
      const lastSet = it.sets[it.sets.length - 1];
      it.sets.push(W.emptySet(lastSet));
      persist(true);
      renderSession();
      break;
    }
    case 'del-set':
      if (it.sets.length > 1) { it.sets.pop(); persist(true); renderSession(); }
      break;
    case 'set-type': {
      const order = ['n', 'w', 'd', 'f'];
      const s = it.sets[j];
      s.type = order[(order.indexOf(s.type || 'n') + 1) % order.length];
      persist(true);
      renderSession();
      C.toast(`Set türü: ${W.SET_TIP[s.type]}`, { ms: 1200 });
      break;
    }
    case 'set-done': toggleDone(i, j); break;
    case 'rest-minus': adjustRest(-15); break;
    case 'rest-plus': adjustRest(15); break;
    case 'rest-skip': stopRest(); break;
    default:
  }
}

function toggleDone(i, j) {
  const it = cur.items[i];
  const s = it.sets[j];
  const m = it.measure || 'agirlik';
  if (!s.done) {
    // Boş alanlar önerilen (geçen seferki) değerle doldurulur: tek dokunuşla “aynısını yaptım”
    const row = document.querySelector(`.set-row[data-i="${i}"][data-s="${j}"]`);
    for (const inp of row?.querySelectorAll('.set-in') || []) {
      if (inp.value.trim() === '' && inp.placeholder) {
        inp.value = inp.placeholder;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    const ok = m === 'agirlik' ? s.reps > 0 && s.kg != null
      : m === 'tekrar' ? s.reps > 0
        : m === 'sure' ? s.sec > 0 : (s.sec > 0 || s.km > 0);
    if (!ok) {
      C.toast(m === 'agirlik' ? 'Önce ağırlık ve tekrarı yaz' : m === 'tekrar' ? 'Önce tekrar sayısını yaz'
        : m === 'sure' ? 'Önce süreyi (saniye) yaz' : 'Önce süre ya da mesafe yaz', { error: true });
      return;
    }
    s.done = true;
    unlockAudio();
    if (S().state.wprefs.restAuto && it.rest > 0 && s.type !== 'w') startRest(it.rest, it.name);
  } else {
    s.done = false;
  }
  persist(true);
  const row = document.querySelector(`.set-row[data-i="${i}"][data-s="${j}"]`);
  row?.classList.toggle('done', s.done);
}

function itemMenu(i) {
  const it = cur.items[i];
  const box = C.el('div');
  box.innerHTML = `
    <label class="field"><span>Not</span><input id="im-note" maxlength="140" value="${esc(it.note || '')}" placeholder="ör. koltuk 4. kademe"></label>
    <label class="field inline"><span>Dinlenme (saniye)</span><input id="im-rest" inputmode="numeric" value="${it.rest || 0}"></label>
    <div class="set-box" style="margin-top:6px">
      <button class="set-action" data-x="info">Hareket bilgisi</button>
      ${i > 0 ? '<button class="set-action" data-x="up">Yukarı taşı</button>' : ''}
      ${i < cur.items.length - 1 ? '<button class="set-action" data-x="down">Aşağı taşı</button>' : ''}
      <button class="set-action danger" data-x="remove">Hareketi çıkar</button>
    </div>
    <button class="btn-primary wide" data-x="save" style="margin-top:12px">Kaydet</button>`;
  box.onclick = (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    if (x === 'info') { openExercise(it.ex); return; }
    if (x === 'up' || x === 'down') {
      const k = x === 'up' ? i - 1 : i + 1;
      [cur.items[i], cur.items[k]] = [cur.items[k], cur.items[i]];
    } else if (x === 'remove') {
      if (it.sets.some((s) => s.done) && !box.dataset.sure) {
        box.dataset.sure = '1';
        e.target.textContent = 'Tamamlanmış setleri de silinecek — tekrar dokun';
        return;
      }
      cur.items.splice(i, 1);
    } else if (x === 'save') {
      it.note = box.querySelector('#im-note').value.trim();
      it.rest = Math.max(0, num(box.querySelector('#im-rest').value, 'int') || 0);
    }
    persist(true);
    C.closeSheet();
    renderSession();
  };
  C.openSheet(it.name, box);
}

function sessionMenu() {
  const box = C.el('div');
  box.innerHTML = `<div class="set-box">
      <button class="set-action" data-x="note">Antrenman notu</button>
      <button class="set-action danger" data-x="discard">Antrenmanı iptal et (kaydetmeden sil)</button>
    </div>`;
  box.onclick = (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === 'note') {
      box.innerHTML = `<label class="field"><span>Not</span><input id="sm-note" maxlength="300" value="${esc(cur.note || '')}"></label>
        <button class="btn-primary wide" data-x="note-save">Kaydet</button>`;
    } else if (b.dataset.x === 'note-save') {
      cur.note = box.querySelector('#sm-note').value.trim();
      persist(true);
      C.closeSheet();
    } else if (b.dataset.x === 'discard') {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Emin misin? Tekrar dokun'; return; }
      discardWorkout();
      C.closeSheet();
      C.toast('Antrenman iptal edildi');
    }
  };
  C.openSheet('Antrenman', box);
}

function discardWorkout() {
  cur = null;
  S().setActiveWorkout(null);
  closeSessionUI();
  C.render();
}

/* ---------- bitirme ---------- */

function finishFlow() {
  const doneSets = cur.items.reduce((a, it) => a + it.sets.filter((s) => s.done).length, 0);
  const pending = W.pendingSets(cur);
  if (!doneSets) {
    const box = C.el('div');
    box.innerHTML = `<p class="muted small">Henüz tamamlanmış set yok. Bir seti bitirince ✓ işaretine dokun.</p>
      <div class="share-actions"><button class="btn-ghost" data-x="back">Geri dön</button>
      <button class="btn-danger" data-x="discard">Antrenmanı iptal et</button></div>`;
    box.onclick = (e) => {
      const x = e.target.closest('[data-x]')?.dataset.x;
      if (x === 'back') C.closeSheet();
      if (x === 'discard') { discardWorkout(); C.closeSheet(); }
    };
    C.openSheet('Bitirmek için set yok', box);
    return;
  }
  if (pending) {
    const box = C.el('div');
    box.innerHTML = `<p class="muted small"><b>${pending} set</b> tamamlanmadı; bitirirsen kaydedilmez.</p>
      <div class="share-actions"><button class="btn-ghost" data-x="back">Geri dön</button>
      <button class="btn-primary" data-x="finish">Yine de bitir</button></div>`;
    box.onclick = (e) => {
      const x = e.target.closest('[data-x]')?.dataset.x;
      if (x === 'back') C.closeSheet();
      if (x === 'finish') { C.closeSheet(); doFinish(); }
    };
    C.openSheet('Tamamlanmayan setler', box);
    return;
  }
  doFinish();
}

function doFinish() {
  const fw = W.finishWorkout(cur);
  if (!fw.name?.trim()) fw.name = 'Antrenman';
  S().saveWorkout(fw);
  cur = null;
  S().setActiveWorkout(null);
  closeSessionUI();
  if (C.cloudOn()) S().push(C.api).catch(() => { /* sonra eşitlenir */ });
  C.render();
  summarySheet(S().state.workouts[fw.id] || fw);
}

function summarySheet(w) {
  const s = W.workoutSummary(w);
  const prs = W.newRecords(w, S().state.workouts);
  const box = C.el('div');
  const groups = W.GRUPLAR.filter((g) => s.groups[g]).map((g) => `${W.KATEGORI_AD[g].split(' ')[0]} ${nf(s.groups[g], s.groups[g] % 1 ? 1 : 0)}`);
  box.innerHTML = `
    <div class="stat-grid">
      ${statBox('Süre', C.U.dur(s.minutes))}${statBox('Set', nf(s.sets))}
      ${statBox('Hareket', nf(s.exercises))}${statBox('Hacim', s.volume ? `${nf(s.volume)}<small> kg</small>` : '—')}
    </div>
    ${prs.length ? `<h3 class="sheet-label">Yeni rekorlar 🏆</h3><ul class="pr-list">${W.groupRecords(prs).map((g) => `<li><b>${esc(g.name)}</b>
      ${g.items.map((p) => `<span>${esc(p.label)}: ${prValue(p.kind, p.value)} <small>(önce ${prValue(p.kind, p.prev)})</small></span>`).join('')}
      </li>`).join('')}</ul>` : ''}
    ${groups.length ? `<p class="muted small" style="margin-top:10px">Kas grubu başına set: ${esc(groups.join(' · '))}</p>` : ''}
    <div class="share-actions">
      ${w.routine_id ? '' : '<button class="btn-ghost" data-x="routine">Program olarak kaydet</button>'}
      <button class="btn-primary" data-x="close">Tamam</button>
    </div>`;
  box.onclick = (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'close') C.closeSheet();
    if (x === 'routine') { const r = W.routineFromWorkout(w); S().saveRoutine(r); C.toast(`Program kaydedildi: <b>${esc(r.name)}</b>`); C.closeSheet(); C.render(); }
  };
  C.openSheet(prs.length ? 'Harika antrenman!' : 'Antrenman kaydedildi', box);
}

/* ---------- dinlenme sayacı ---------- */

function startRest(sec, label) {
  rest = { end: Date.now() + sec * 1000, total: sec, label };
  $('ses-rest').hidden = !sessionOpen;
  $('ses-rest-label').textContent = `Dinlenme · ${label}`;
  clearInterval(restTimer);
  restTimer = setInterval(tickRest, 250);
  tickRest();
  window.SaglikNative?.scheduleRest?.(sec);
}

function adjustRest(delta) {
  if (!rest) return;
  rest.end += delta * 1000;
  rest.total = Math.max(1, rest.total + delta);
  window.SaglikNative?.scheduleRest?.(Math.max(1, Math.round((rest.end - Date.now()) / 1000)));
  tickRest();
}

function stopRest() {
  rest = null;
  clearInterval(restTimer);
  restTimer = null;
  const el = $('ses-rest');
  if (el) el.hidden = true;
  window.SaglikNative?.cancelRest?.();
}

function tickRest() {
  if (!rest) return;
  const left = Math.ceil((rest.end - Date.now()) / 1000);
  if (left <= 0) {
    stopRest();
    restDone();
    return;
  }
  // geri sayım hep d:ss (fmtDur tam dakikada “2 dk” yazardı, sayaç zıplardı)
  $('ses-rest-time').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('ses-rest-fill').style.width = `${Math.max(0, Math.min(100, (left / rest.total) * 100)).toFixed(1)}%`;
}

function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { audioCtx = null; }
}

function restDone() {
  if (S().state.wprefs.sound && audioCtx) {
    try {
      const t0 = audioCtx.currentTime;
      for (const [i, f] of [[0, 880], [1, 1175]]) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.22);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.22 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.18);
        o.connect(g).connect(audioCtx.destination);
        o.start(t0 + i * 0.22);
        o.stop(t0 + i * 0.22 + 0.2);
      }
    } catch { /* ses çıkmasa da olur */ }
  }
  try {
    const H = window.Capacitor?.Plugins?.Haptics;
    if (H?.vibrate) H.vibrate({ duration: 300 }); else navigator.vibrate?.([200, 100, 200]);
  } catch { /* */ }
  if (sessionOpen) C.toast('Dinlenme bitti — sıradaki set!');
}

/* ================= programlar ================= */

function programsSheet() {
  const st = S().state;
  const mine = Object.values(st.routines).filter((r) => !r.deleted);
  const box = C.el('div');
  box.innerHTML = `${mine.length ? `<h3 class="sheet-label">Programların</h3><ul class="wk-list">${mine.map((r) => routineRow(r, false)).join('')}</ul>` : ''}
    <h3 class="sheet-label">Hazır programlar</h3><ul class="wk-list">${W.HAZIR_PROGRAMLAR.map((r) => routineRow(r, true)).join('')}</ul>
    <button class="btn-ghost wide" data-act="new-routine" style="margin-top:12px">+ Kendi programını oluştur</button>`;
  box.onclick = onTabClick;
  C.openSheet('Programdan başla', box);
}

function routineSheet(r) {
  if (!r) return;
  const builtIn = W.HAZIR_PROGRAMLAR.includes(r);
  const box = C.el('div');
  box.innerHTML = `${r.note ? `<p class="muted small">${esc(r.note)}</p>` : ''}
    <ol class="routine-list">${r.items.map((it) => {
      const h = getExercise(it.ex);
      return `<li><button class="wk-row" data-x="ex" data-id="${it.ex}">${h ? thumb(h, 'rt-img') : ''}
        <span class="wk-row-main"><b>${esc(h?.ad || it.name || '?')}</b><small>${it.sets} set × ${esc(it.reps || '—')} · dinlenme ${W.fmtDur(it.rest ?? 90)}</small></span></button></li>`;
    }).join('')}</ol>
    <div class="share-actions">
      <button class="btn-primary" data-x="start">Başlat</button>
      <button class="btn-ghost" data-x="edit">${builtIn ? 'Kopyala ve düzenle' : 'Düzenle'}</button>
      ${builtIn ? '' : '<button class="btn-ghost" data-x="delete">Sil</button>'}
    </div>`;
  box.onclick = (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === 'ex') openExercise(b.dataset.id);
    if (b.dataset.x === 'start') startWorkout({ routine: r });
    if (b.dataset.x === 'edit') routineEditor(builtIn ? { ...structuredClone(r), id: W.uuid(), name: `${r.name} (kopyam)` } : r);
    if (b.dataset.x === 'delete') {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Emin misin?'; return; }
      S().deleteRoutine(r.id);
      C.closeSheet();
      C.render();
      C.toast('Program silindi');
    }
  };
  C.openSheet(r.name, box);
}

function routineEditor(src = null) {
  const r = src ? structuredClone(src) : { id: W.uuid(), name: '', note: '', items: [] };
  const box = C.el('div', 'routine-editor');
  const draw = () => {
    box.innerHTML = `
      <label class="field"><span>Program adı</span><input id="re-name" maxlength="60" value="${esc(r.name)}" placeholder="ör. Pazartesi · Göğüs"></label>
      <ol class="routine-edit-list">${r.items.map((it, i) => {
        const h = getExercise(it.ex);
        return `<li data-i="${i}"><b>${esc(h?.ad || it.name)}</b>
          <div class="re-row">
            <label>Set<input data-f="sets" data-i="${i}" inputmode="numeric" value="${it.sets}"></label>
            <label>Tekrar<input data-f="reps" data-i="${i}" value="${esc(it.reps || '')}" placeholder="8–12"></label>
            <label>Dinlenme sn<input data-f="rest" data-i="${i}" inputmode="numeric" value="${it.rest ?? 90}"></label>
          </div>
          <div class="re-actions">
            ${i > 0 ? `<button class="chip" data-x="up" data-i="${i}">↑</button>` : ''}
            ${i < r.items.length - 1 ? `<button class="chip" data-x="down" data-i="${i}">↓</button>` : ''}
            <button class="chip" data-x="del" data-i="${i}">Çıkar</button>
          </div></li>`;
      }).join('')}</ol>
      <button class="btn-ghost wide" data-x="add">+ Hareket ekle</button>
      <button class="btn-primary wide" data-x="save" style="margin-top:10px">Programı kaydet</button>`;
  };
  draw();
  box.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 're-name') { r.name = t.value; return; }
    const it = r.items[Number(t.dataset.i)];
    if (!it) return;
    if (t.dataset.f === 'sets') it.sets = Math.max(1, Math.min(20, num(t.value, 'int') || 1));
    if (t.dataset.f === 'rest') it.rest = Math.max(0, num(t.value, 'int') || 0);
    if (t.dataset.f === 'reps') it.reps = t.value.trim();
  });
  box.onclick = (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    const i = Number(b.dataset.i);
    if (b.dataset.x === 'up') [r.items[i - 1], r.items[i]] = [r.items[i], r.items[i - 1]];
    if (b.dataset.x === 'down') [r.items[i + 1], r.items[i]] = [r.items[i], r.items[i + 1]];
    if (b.dataset.x === 'del') r.items.splice(i, 1);
    if (b.dataset.x === 'add') {
      openLibrary({
        pick: (h) => {
          r.items.push({ ex: h.id, name: h.ad, sets: 3, reps: h.olcu === 'sure' ? '30–45 sn' : h.olcu === 'kardiyo' ? '20 dk' : '8–12', rest: W.defaultRest(h) });
          routineEditorShow();
        },
      });
      return;
    }
    if (b.dataset.x === 'save') {
      if (!r.name.trim()) { C.toast('Programa bir ad ver', { error: true }); return; }
      if (!r.items.length) { C.toast('En az bir hareket ekle', { error: true }); return; }
      S().saveRoutine({ id: r.id, name: r.name.trim(), note: r.note || '', items: r.items.map((it) => ({ ex: it.ex, name: it.name, sets: it.sets, reps: it.reps, rest: it.rest })) });
      C.closeSheet();
      C.render();
      C.toast('Program kaydedildi');
      return;
    }
    draw();
  };
  const routineEditorShow = () => { draw(); C.openSheet(src && S().state.routines[src.id] ? 'Programı düzenle' : 'Yeni program', box); };
  routineEditorShow();
}

/* ================= geçmiş ================= */

function workoutSheet(w) {
  if (!w || w.deleted) return;
  const s = W.workoutSummary(w);
  const prs = W.newRecords(w, S().state.workouts);
  const box = C.el('div');
  const when = new Date(w.started_at);
  box.innerHTML = `<p class="muted small">${esc(C.U.prettyDayFull(w.day))} · ${when.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</p>
    <div class="stat-grid">${statBox('Süre', C.U.dur(s.minutes))}${statBox('Set', nf(s.sets))}${statBox('Hareket', nf(s.exercises))}${statBox('Hacim', s.volume ? `${nf(s.volume)}<small> kg</small>` : '—')}</div>
    ${prs.length ? `<p class="small" style="margin-top:10px">🏆 Rekor: ${W.groupRecords(prs).map((g) => esc(g.name)).join(', ')}</p>` : ''}
    <ul class="hist-items">${w.items.map((it) => `<li><b>${esc(it.name)}</b>
      <span>${W.workSets(it).map((x) => esc(W.fmtSet(x, it.measure))).join(' · ') || '—'}</span>
      ${it.sets.some((x) => x.type === 'w') ? '<small class="muted">+ ısınma</small>' : ''}</li>`).join('')}</ul>
    ${w.note ? `<p class="muted small">Not: ${esc(w.note)}</p>` : ''}
    <div class="share-actions">
      <button class="btn-primary" data-x="again">Tekrarla</button>
      <button class="btn-ghost" data-x="routine">Program yap</button>
      <button class="btn-ghost" data-x="delete">Sil</button>
    </div>`;
  box.onclick = (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === 'again') startWorkout({ routine: { ...W.routineFromWorkout(w), id: null, name: w.name } });
    if (b.dataset.x === 'routine') { S().saveRoutine(W.routineFromWorkout(w)); C.toast('Program kaydedildi'); C.closeSheet(); C.render(); }
    if (b.dataset.x === 'delete') {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Emin misin?'; return; }
      S().deleteWorkout(w.id);
      if (C.cloudOn()) S().push(C.api).catch(() => {});
      C.closeSheet();
      C.render();
      C.toast('Antrenman silindi');
    }
  };
  C.openSheet(w.name || 'Antrenman', box);
}

function historySheet() {
  const box = C.el('div');
  const done = W.finished(S().state.workouts).reverse();
  box.innerHTML = `<ul class="wk-list">${done.map(historyRow).join('')}</ul>`;
  box.onclick = (e) => {
    const b = e.target.closest('[data-act="workout"]');
    if (b) workoutSheet(S().state.workouts[b.dataset.id]);
  };
  C.openSheet('Antrenman geçmişi', box);
}

/* ================= kaynaklar ================= */

export function creditsSheet() {
  const box = C.el('div');
  const withImg = lib ? lib.list.filter((h) => h.gorsel.length).length : 0;
  const vec = lib ? lib.list.filter((h) => h.gorsel.some((g) => g.vektor)).length : 0;
  box.innerHTML = `
    <p class="small">Antrenman kütüphanesi açık lisanslı iki eserden derlendi:</p>
    <ul class="credit-list">
      <li><b>wger.de</b> — özgür yazılım fitness projesi. Hareket bilgileri ve açıklamalar; her hareketin
        lisansı (CC BY-SA 3.0/4.0, CC0) ve yazarı hareket sayfasında yazar.
        <a href="https://wger.de" target="_blank" rel="noopener">wger.de</a></li>
      <li><b>Everkinetic</b> (everkinetic.com, Greg Priday) — hareketlerin başlangıç ve kasılma çizimleri,
        CC BY-SA 4.0. <a href="https://github.com/everkinetic/data" target="_blank" rel="noopener">github.com/everkinetic/data</a></li>
    </ul>
    <p class="small">${lib ? `${lib.list.length} hareketin ${withImg} tanesinde çizim var (${vec} tanesi vektör); ` : ''}
      çizimi olmayanlarda kas haritası gösterilir. Kas haritası bu uygulamaya aittir.</p>
    <p class="small">Türkçe adlar ve adım adım anlatımlar wger açıklamalarından uyarlanmıştır ve aynı lisansla
      (<a href="https://creativecommons.org/licenses/by-sa/4.0/deed.tr" target="_blank" rel="noopener">CC BY-SA 4.0</a>) paylaşılır.</p>
    <p class="muted small">Yapay zekâyla üretilmiş ya da kaynağı doğrulanamayan görseller (ör. ticari sitelerden
      kopyalanıp yüklenmiş olanlar) bilerek kullanılmadı.</p>
    <p class="muted small">Buradaki bilgiler tıbbi tavsiye değildir; ağrı ya da sağlık sorunun varsa bir uzmana danış.</p>`;
  C.openSheet('Kaynaklar ve lisanslar', box);
}
