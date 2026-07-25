/* app.js — Sağlık Panel web/PWA denetleyicisi. */

import * as U from './core/core-util.js';
import * as P from './core/core-parse.js';
import * as A from './core/core-analysis.js';
import * as S from './core/core-store.js';
import { api, isConfigured } from './core/core-api.js';
import {
  CONFIG, isCloudEnabled, isCloudFromDevice,
  setCloudConfig, clearCloudConfig, testCloudConfig,
} from './core/config.js';
import { barChart, lineChart, sparkline } from './charts.js';

const $ = (id) => document.getElementById(id);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** Android uygulaması (Capacitor) içinde mi çalışıyoruz? */
const isAndroidApp = () => !!window.Capacitor?.isNativePlatform?.();

let view = 'today';
let range = 'week';
let offset = 0;            // 0 = bu dönem, -1 = önceki
let authMode = 'signin';   // signin | signup
let localOnly = false;
let uploads = [];

const METRICS = [
  { key: 'steps', label: 'Adım', color: 'var(--steps)', goal: 'step_goal', fmt: (v) => U.nf(v) },
  { key: 'active_kcal', label: 'Kalori', color: 'var(--move)', goal: 'kcal_goal', unit: 'kcal', fmt: (v) => U.nf(v) },
  { key: 'exercise_min', label: 'Egzersiz', color: 'var(--exercise)', goal: 'exercise_goal', unit: 'dk', fmt: (v) => U.nf(v) },
  { key: 'distance_km', label: 'Mesafe', color: 'var(--stand)', unit: 'km', fmt: (v) => U.nf(v, 1) },
  { key: 'stand_hours', label: 'Ayakta', color: 'var(--warn)', unit: 'sa', fmt: (v) => U.nf(v), optional: true },
];

const SOURCE_LABEL = {
  shortcut: 'iPhone Kısayolu ile geldi',
  screenshot: 'Ekran görüntüsünden okundu',
  manual: 'Elle girildi',
  healthconnect: 'Telefon sensöründen alındı',
  import: 'Dışarıdan aktarıldı',
};

/* ================= küçük yardımcılar ================= */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

let toastTimer = null;
function toast(msg, { error = false, ms = 2600 } = {}) {
  const host = $('toast-host');
  const t = el('div', 'toast' + (error ? ' err' : ''), msg);
  host.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
  }, ms);
  while (host.children.length > 2) host.firstElementChild.remove();
}

function busy(text) { $('busy-text').textContent = text; $('busy').hidden = false; }
const unbusy = () => { $('busy').hidden = true; };

function openSheet(title, body) {
  $('sheet-title').textContent = title;
  const host = $('sheet-body');
  host.innerHTML = '';
  host.appendChild(body);
  $('sheet-backdrop').hidden = false;
  $('sheet').hidden = false;
  $('sheet').scrollTop = 0;
}
function closeSheet() {
  $('sheet-backdrop').hidden = true;
  $('sheet').hidden = true;
  $('sheet-body').innerHTML = '';
}
const sheetOpen = () => !$('sheet').hidden;

const cloudOn = () => isCloudEnabled() && api.isLoggedIn();

function copyText(text, label = 'Kopyalandı') {
  const done = () => toast(label);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallback());
  } else fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Kopyalanamadı', { error: true }); }
    ta.remove();
  }
}

function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ================= tema ================= */

function applyTheme() {
  const theme = S.state.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f2f6f7' : '#0a1014');
}

/* ================= giriş ================= */

function showAuth() {
  $('view-auth').hidden = false;
  $('app').hidden = true;
  $('field-username').hidden = authMode === 'signin';
  $('auth-submit').textContent = authMode === 'signin' ? 'Giriş yap' : 'Hesap oluştur';
  $('auth-password').autocomplete = authMode === 'signin' ? 'current-password' : 'new-password';
  for (const b of $('auth-mode').children) b.classList.toggle('on', b.dataset.mode === authMode);

  const ready = isCloudEnabled();
  $('auth-mode').hidden = !ready;
  $('auth-form').hidden = !ready;
  $('auth-hint').hidden = !ready;
  $('auth-config-note').hidden = ready;
  // "kendi projene bağlan" yalnızca gömülü ayar yoksa ya da elle bağlandıysa görünür
  $('auth-cloud').hidden = ready && !isCloudFromDevice();
  $('auth-error').hidden = true;
}

function showApp() {
  $('view-auth').hidden = true;
  $('app').hidden = false;
  render();
}

async function doAuth(e) {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  const username = $('auth-username').value.trim();
  const errBox = $('auth-error');
  errBox.hidden = true;

  if (authMode === 'signup' && username.length < 2) {
    errBox.textContent = 'Kullanıcı adı en az 2 karakter olmalı.';
    errBox.hidden = false;
    return;
  }

  busy(authMode === 'signin' ? 'Giriş yapılıyor…' : 'Hesap oluşturuluyor…');
  try {
    if (authMode === 'signin') await api.signIn(email, password);
    else await api.signUp(email, password, username);
    localOnly = false;
    if (authMode === 'signup' && username) S.setProfile({ username }, { dirty: true });
    unbusy();
    showApp();
    toast('Hoş geldin!');
    await syncNow({ quiet: true });
  } catch (err) {
    unbusy();
    errBox.textContent = err.message || 'İşlem başarısız.';
    errBox.hidden = false;
  }
}

/* ================= eşitleme ================= */

let syncing = false;
async function syncNow({ quiet = false } = {}) {
  if (!cloudOn() || syncing) return;
  syncing = true;
  $('btn-sync').classList.add('spinning');
  try {
    await S.sync(api);
    await loadUploads();
    render();
    if (!quiet) toast('Eşitlendi');
  } catch (err) {
    if (!quiet) toast(err.message || 'Eşitleme başarısız', { error: true });
  } finally {
    syncing = false;
    $('btn-sync').classList.remove('spinning');
  }
}

async function loadUploads() {
  if (!cloudOn()) { uploads = []; return; }
  try {
    uploads = await api.select('sp_uploads', 'select=*&order=created_at.desc&limit=8') || [];
  } catch (e) { uploads = []; }
}

/* ================= çizim: üst ================= */

function render() {
  applyTheme();
  const p = S.profile();
  $('top-eyebrow').textContent = p.username ? `@${p.username}` : (localOnly ? 'yalnız bu cihaz' : 'sağlık paneli');
  $('top-title').textContent = view === 'today' ? 'Bugün' : 'Analiz';
  $('btn-sync').hidden = !cloudOn();

  $('view-today').hidden = view !== 'today';
  $('view-analysis').hidden = view !== 'analysis';
  for (const t of document.querySelectorAll('.tab')) {
    t.classList.toggle('on', t.dataset.view === view);
  }

  if (view === 'today') renderToday();
  else renderAnalysis();
}

/* ================= çizim: bugün ================= */

function renderToday() {
  const key = U.today();
  const rec = S.getDay(key) || {};
  const p = S.profile();

  $('today-label').textContent = U.prettyDayFull(key);
  const has = S.hasDayData(key);
  $('today-source').textContent = has
    ? (SOURCE_LABEL[rec.source] || 'Kaydedildi')
    : 'Bugünün verisi henüz yok';

  const score = A.dayScore(rec, p);
  const C = 2 * Math.PI * 30;
  $('score-bar').style.strokeDashoffset = (C * (1 - score.overall / 100)).toFixed(1);
  $('score-text').textContent = `${score.overall}%`;

  // ölçüt kutuları
  const grid = $('today-metrics');
  grid.innerHTML = '';
  for (const m of METRICS) {
    const v = rec[m.key];
    if (m.optional && v == null) continue;
    const goal = m.goal ? p[m.goal] : null;
    const box = el('div', 'metric');
    box.style.setProperty('--mc', m.color);
    box.innerHTML = `<div class="metric-label">${m.label}</div>`
      + `<div class="metric-value">${v == null ? '—' : m.fmt(v)}`
      + `${v == null ? '' : `<small>${m.unit || ''}</small>`}</div>`
      + (goal ? `<div class="metric-goal">hedef ${U.nf(goal)}</div>`
        + `<div class="metric-bar"><i style="width:${Math.min(100, ((v || 0) / goal) * 100).toFixed(0)}%"></i></div>` : '');
    box.onclick = () => manualSheet(key);
    grid.appendChild(box);
  }

  // kısayol tuşu / ipucu ortama göre
  const hint = $('shortcut-hint');
  hint.hidden = false;
  if (isAndroidApp()) {
    // Android uygulamasında iPhone kısayolu çalıştırılamaz
    $('btn-shortcut').hidden = true;
    hint.innerHTML = 'iPhone verileri, web panelinden kurduğun kısayolla buluta düşer ve '
      + 'burada kendiliğinden görünür. <b>Telefondan çek</b> ise bu telefonun kendi '
      + 'adım verisini (Health Connect) okur.';
  } else if (isIOS) {
    $('btn-shortcut').hidden = false;
    hint.innerHTML = `Kısayol adı: <b>${esc(CONFIG.shortcutName)}</b>. `
      + 'Henüz kurmadıysan Ayarlar → “iPhone kısayolunu kur” adımlarını izle.';
  } else {
    $('btn-shortcut').hidden = false;
    hint.innerHTML = 'Kısayol tuşu yalnız iPhone/iPad\'de çalışır. '
      + 'Bilgisayarda "Elle gir" ya da "Ekran görüntüsü" yolunu kullan.';
  }

  renderWeightCard();
  renderMissing();
  renderUploads();
}

function renderWeightCard() {
  const p = S.profile();
  const wr = A.weightReport(S.state.weights, p);
  const due = A.weighDueDay(p, U.today());
  const pending = A.isWeighPending(S.state.weights, p, U.today());

  const pill = $('weigh-pill');
  pill.textContent = pending
    ? `${U.weekdayName(p.weigh_day)} tartımı bekliyor`
    : `${U.relativeDay(due)} tartıldı`;
  pill.className = 'pill ' + (pending ? 'warn' : 'ok');

  $('weight-big').textContent = wr.empty ? '—' : U.kg(wr.latest.kg);
  $('weight-sub').textContent = wr.empty
    ? 'İlk ölçümünü gir, eğilim buradan görünecek'
    : `${U.relativeDay(wr.latest.day)}${wr.bmi ? ` · VKE ${U.nf(wr.bmi, 1)} (${wr.bmiLabel})` : ''}`;

  const trend = $('weight-trend');
  trend.innerHTML = '';
  if (!wr.empty) {
    const rows = [
      ['Geçen ölçüm', wr.sinceLast],
      ['Son 30 gün', wr.sinceMonth],
      ['Hedefe', wr.toTarget == null ? null : wr.toTarget],
    ];
    for (const [label, val] of rows) {
      if (val == null) continue;
      const dir = val < 0 ? 'down' : val > 0 ? 'up' : '';
      const isTarget = label === 'Hedefe';
      trend.appendChild(el('div', 'trend-row ' + (isTarget ? '' : dir),
        `${label} <b>${isTarget ? U.nf(Math.abs(val), 1) + ' kg' : U.signed(val, ' kg')}</b>`));
    }
    if (wr.slopePerWeek) {
      trend.appendChild(el('div', 'trend-row', `Eğilim <b>${U.signed(wr.slopePerWeek, ' kg/hf')}</b>`));
    }
  }

  const input = $('weight-input');
  const existing = S.getWeight(due);
  input.value = existing?.kg != null ? String(existing.kg).replace('.', ',') : '';
  input.placeholder = wr.empty ? 'örn. 82,4' : `son: ${String(wr.latest.kg).replace('.', ',')}`;

  const spark = $('weight-spark');
  const last12 = wr.empty ? [] : wr.entries.slice(-12).map((e) => e.kg);
  spark.innerHTML = last12.length >= 2 ? sparkline(last12, { color: 'var(--accent)' }) : '';
}

function renderMissing() {
  const miss = A.missingDays(S.state.days, 8).filter((k) => k !== U.today());
  const card = $('missing-card');
  card.hidden = miss.length === 0;
  $('missing-pill').textContent = String(miss.length);
  const host = $('missing-chips');
  host.innerHTML = '';
  for (const k of miss.reverse()) {
    const c = el('button', 'chip', U.relativeDay(k));
    c.onclick = () => manualSheet(k);
    host.appendChild(c);
  }
}

function renderUploads() {
  const card = $('uploads-card');
  if (!cloudOn() || !uploads.length) { card.hidden = true; return; }
  card.hidden = false;
  const pend = uploads.filter((u) => u.status === 'pending').length;
  $('uploads-pill').textContent = pend ? `${pend} bekliyor` : 'güncel';
  const list = $('upload-list');
  list.innerHTML = '';
  for (const u of uploads.slice(0, 6)) {
    const row = el('li', 'upload-row');
    const when = u.day ? U.relativeDay(u.day) : new Date(u.created_at).toLocaleDateString('tr-TR');
    const kind = u.kind === 'scale' ? 'tartı' : 'fitness';
    const parsed = u.parsed && typeof u.parsed === 'object'
      ? Object.entries(u.parsed).filter(([, v]) => v != null).length : 0;
    row.innerHTML = `<span>${esc(when)} · ${kind}${parsed ? ` · ${parsed} değer` : ''}</span>`
      + `<span class="status ${u.status}">${u.status === 'pending' ? 'okunacak'
        : u.status === 'processed' ? 'okundu' : u.status === 'failed' ? 'okunamadı' : 'atlandı'}</span>`;
    list.appendChild(row);
  }
  const failed = uploads.filter((u) => u.status === 'failed');
  const note = $('uploads-note');
  note.innerHTML = '';
  if (pend) {
    note.textContent = window.SaglikNative
      ? 'Bekleyen görüntüler bu cihazda okunacak.'
      : 'Android uygulamasını açtığında bu görüntüler cihaz üzerinde okunup verilere işlenir. '
        + 'İstersen iPhone kısayoluyla da okuyabilirsin (Ayarlar → iPhone kısayolunu kur).';
  } else if (failed.length) {
    note.textContent = `Okunamayan ${failed.length} görüntü var: ${esc(failed[0].error || '')}`;
  }

  const actions = el('div', 'action-row');
  actions.style.marginTop = '10px';
  if (window.SaglikNative && pend) {
    const now = el('button', 'btn-ghost', 'Şimdi oku');
    now.onclick = async () => {
      busy('Görüntüler okunuyor…');
      try { await window.SaglikNative.processUploads({ quiet: false }); } catch (e) { /* */ }
      await loadUploads();
      unbusy();
      render();
    };
    actions.appendChild(now);
  }
  if (failed.length) {
    const retry = el('button', 'btn-ghost', `Tekrar dene (${failed.length})`);
    retry.onclick = async () => {
      busy('Kuyruğa alınıyor…');
      try {
        for (const u of failed) await api.markUpload(u.id, { status: 'pending', error: null });
        await loadUploads();
        if (window.SaglikNative) await window.SaglikNative.processUploads({ quiet: false });
        await loadUploads();
      } catch (e) { toast(e.message || 'Olmadı', { error: true }); }
      unbusy();
      render();
    };
    actions.appendChild(retry);
  }
  if (actions.children.length) list.parentElement.appendChild(actions);
}

/* ================= çizim: analiz ================= */

function periodInfo() {
  const days = S.state.days;
  const p = S.profile();
  if (range === 'week') {
    const start = U.shiftDay(U.weekStart(), offset * 7);
    const r = A.weekReport(days, start, p);
    return {
      label: U.prettyWeek(start) + (offset === 0 ? ' (bu hafta)' : ''),
      report: r,
      items: r.series.map((d) => ({
        label: U.dayShort(d.day),
        value: d.steps || 0,
        hit: (d.steps || 0) >= p.step_goal,
      })),
      goal: p.step_goal,
      note: `${r.stepGoalDays}/7 gün adım hedefi tutuldu`
        + (r.totals.bestDay ? ` · en iyi gün ${U.prettyDay(r.totals.bestDay.day)} (${U.nf(r.totals.bestDay.steps)})` : '')
        + (r.missingDays.length ? ` · ${r.missingDays.length} gün veri yok` : ''),
      canNext: offset < 0,
    };
  }
  if (range === 'month') {
    const base = U.keyToDate(U.monthStart());
    const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const start = U.dayKey(d);
    const r = A.monthReport(days, start, p);
    return {
      label: U.prettyMonth(start),
      report: r,
      items: r.weeks.map((w, i) => ({
        label: `${i + 1}.hf`,
        value: w.steps,
        hit: w.avgSteps >= p.step_goal,
      })),
      goal: p.step_goal * 7,
      note: `${r.stepGoalDays} gün adım hedefi tutuldu · ${r.totals.daysLogged} gün kayıt`
        + (r.totals.bestDay ? ` · en iyi gün ${U.nf(r.totals.bestDay.steps)} adım` : ''),
      canNext: offset < 0,
    };
  }
  const year = new Date().getFullYear() + offset;
  const r = A.yearReport(days, year, p);
  return {
    label: String(year),
    report: r,
    items: r.months.map((m) => ({ label: m.label.slice(0, 3), value: m.steps, hit: false })),
    goal: null,
    note: `${r.totals.daysLogged} gün kayıt · ${r.stepGoalDays} gün hedef tutuldu`
      + (r.bestMonth ? ` · en iyi ay ${r.bestMonth.label} (${U.nf(r.bestMonth.steps)} adım)` : ''),
    canNext: offset < 0,
  };
}

function deltaBox(label, value, delta, unit = '') {
  const box = el('div', 'stat');
  const pct = delta?.pct;
  const cls = pct == null ? 'flat' : pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const arrow = pct == null ? '' : pct > 0 ? '▲' : pct < 0 ? '▼' : '■';
  box.innerHTML = `<div class="stat-k">${label}</div>`
    + `<div class="stat-v">${value}${unit ? `<small> ${unit}</small>` : ''}</div>`
    + `<div class="stat-d ${cls}">${pct == null ? 'geçmiş veri yok' : `${arrow} %${Math.abs(pct)}`}</div>`;
  return box;
}

function renderAnalysis() {
  const info = periodInfo();
  const r = info.report;
  const p = S.profile();

  $('period-label').textContent = info.label;
  $('period-next').disabled = !info.canNext;
  $('period-next').style.opacity = info.canNext ? '1' : '.35';

  const stats = $('period-stats');
  stats.innerHTML = '';
  stats.appendChild(deltaBox('Adım', U.nf(r.totals.steps), r.delta.steps));
  stats.appendChild(deltaBox('Mesafe', U.nf(r.totals.distance_km, 1), r.delta.distance_km, 'km'));
  stats.appendChild(deltaBox('Egzersiz', U.dur(r.totals.exercise_min), r.delta.exercise_min));
  stats.appendChild(deltaBox('Kalori', U.nf(r.totals.active_kcal), r.delta.active_kcal, 'kcal'));

  $('period-chart').innerHTML = barChart(info.items, {
    goal: info.goal,
    unit: ' adım',
    showValues: range !== 'year',
  });
  $('period-note').textContent = info.note
    + (r.prevLabel ? ` · yüzdeler ${r.prevLabel} ile karşılaştırıldı` : '');

  // kilo
  const wr = A.weightReport(S.state.weights, p);
  $('weight-count').textContent = wr.empty ? 'ölçüm yok' : `${wr.count} ölçüm`;
  $('weight-chart').innerHTML = wr.empty ? '<div class="muted small" style="padding:16px 0;text-align:center">'
    + 'Haftalık kilonu girmeye başlayınca eğri burada.</div>'
    : lineChart(wr.entries.slice(-26).map((e) => ({ label: U.prettyDay(e.day), value: e.kg })),
      { target: wr.target });

  const ws = $('weight-stats');
  ws.innerHTML = '';
  if (!wr.empty) {
    const add = (k, v, d) => {
      const b = el('div', 'stat');
      b.innerHTML = `<div class="stat-k">${k}</div><div class="stat-v">${v}</div>`
        + (d ? `<div class="stat-d flat">${d}</div>` : '');
      ws.appendChild(b);
    };
    add('Şu an', U.nf(wr.latest.kg, 1) + ' kg', U.relativeDay(wr.latest.day));
    add('30 günde', U.signed(wr.sinceMonth ?? 0, ' kg'), wr.sinceYear != null ? `yılda ${U.signed(wr.sinceYear, ' kg')}` : '');
    add('En düşük', U.nf(wr.min.kg, 1) + ' kg', U.prettyDay(wr.min.day));
    add('Hedef', wr.target == null ? '—' : U.nf(wr.target, 1) + ' kg',
      wr.etaWeeks ? `bu hızla ~${wr.etaWeeks} hafta` : (wr.toTarget != null ? `${U.nf(Math.abs(wr.toTarget), 1)} kg kaldı` : ''));
  }

  renderDayList();
}

function renderDayList() {
  const host = $('day-list');
  host.innerHTML = '';
  const p = S.profile();
  const keys = U.lastNDays(30).reverse();
  for (const k of keys) {
    const rec = S.getDay(k);
    const w = S.getWeight(k);
    const row = el('button', 'day-row' + (rec ? '' : ' empty'));
    const bits = [];
    if (rec?.steps != null) bits.push(`${U.nf(rec.steps)} adım`);
    if (rec?.exercise_min != null) bits.push(`${rec.exercise_min} dk`);
    if (rec?.active_kcal != null) bits.push(`${U.nf(rec.active_kcal)} kcal`);
    if (w?.kg != null) bits.push(`${U.nf(w.kg, 1)} kg`);
    const hit = rec?.steps != null && rec.steps >= p.step_goal;
    row.innerHTML = `<span class="d">${U.relativeDay(k)}</span>`
      + `<span class="v">${bits.length ? esc(bits.join(' · ')) : 'veri yok'}</span>`
      + `<span class="s">${hit ? '✓' : ''}</span>`;
    row.onclick = () => manualSheet(k);
    host.appendChild(row);
  }
}

/* ================= elle giriş sayfası ================= */

function numberField(label, id, value, { unit = '', step = '1', mode = 'numeric' } = {}) {
  const wrap = el('label', 'field inline');
  wrap.innerHTML = `<span>${label}${unit ? ` <small style="color:var(--text-faint)">(${unit})</small>` : ''}</span>`;
  const input = el('input');
  input.id = id;
  input.type = 'text';
  input.inputMode = mode === 'decimal' ? 'decimal' : 'numeric';
  input.value = value == null ? '' : String(value).replace('.', ',');
  input.placeholder = '—';
  wrap.appendChild(input);
  return wrap;
}

function manualSheet(key) {
  const rec = S.getDay(key) || {};
  const w = S.getWeight(key);
  const box = el('div');

  const g1 = el('div', 'set-group');
  g1.appendChild(el('div', 'set-title', U.prettyDayFull(key)));
  const b1 = el('div', 'set-box');
  b1.appendChild(numberField('Adım', 'm-steps', rec.steps));
  b1.appendChild(numberField('Mesafe', 'm-dist', rec.distance_km, { unit: 'km', mode: 'decimal' }));
  b1.appendChild(numberField('Aktif kalori', 'm-kcal', rec.active_kcal, { unit: 'kcal' }));
  b1.appendChild(numberField('Egzersiz', 'm-ex', rec.exercise_min, { unit: 'dk' }));
  b1.appendChild(numberField('Ayakta', 'm-stand', rec.stand_hours, { unit: 'saat' }));
  b1.appendChild(numberField('Kilo', 'm-kg', w?.kg, { unit: 'kg', mode: 'decimal' }));
  g1.appendChild(b1);
  box.appendChild(g1);

  const noteWrap = el('label', 'field');
  noteWrap.innerHTML = '<span>Not</span>';
  const note = el('input');
  note.id = 'm-note';
  note.type = 'text';
  note.maxLength = 200;
  note.value = rec.note || '';
  note.placeholder = 'ör. sabah koşusu, dizim ağrıdı…';
  noteWrap.appendChild(note);
  box.appendChild(noteWrap);

  const paste = el('button', 'btn-ghost wide', 'Ekran görüntüsü metnini yapıştır');
  paste.style.marginTop = '4px';
  paste.onclick = () => pasteSheet(key);
  box.appendChild(paste);

  const save = el('button', 'btn-primary wide', 'Kaydet');
  save.onclick = async () => {
    const patch = {
      steps: U.parseNum($('m-steps').value, 'int'),
      distance_km: U.parseNum($('m-dist').value, 'float'),
      active_kcal: U.parseNum($('m-kcal').value, 'int'),
      exercise_min: U.parseNum($('m-ex').value, 'int'),
      stand_hours: U.parseNum($('m-stand').value, 'int'),
      note: $('m-note').value.trim() || null,
    };
    S.setDay(key, patch, { source: 'manual' });
    const kgVal = P.normalizeWeightInput($('m-kg').value);
    if (kgVal != null) S.setWeight(key, { kg: kgVal }, { source: 'manual' });
    closeSheet();
    toast('Kaydedildi');
    render();
    if (cloudOn()) { try { await S.push(api); } catch (e) { toast('Bulut sonra eşitlenecek'); } }
  };
  box.appendChild(save);

  if (S.getDay(key) || w) {
    const del = el('button', 'set-action danger', 'Bu günün verisini sil');
    del.style.marginTop = '10px';
    del.onclick = async () => {
      if (!del.dataset.sure) {
        del.dataset.sure = '1';
        del.textContent = 'Silmek için tekrar dokun';
        return;
      }
      S.setDay(key, {
        steps: null, distance_km: null, active_kcal: null, exercise_min: null,
        stand_hours: null, note: null,
      });
      S.removeWeight(key);
      closeSheet();
      render();
      toast('Silindi');
      if (cloudOn()) { try { await S.push(api); } catch (e) { /* sonra */ } }
    };
    box.appendChild(del);
  }

  openSheet('Veri gir', box);
}

/* ================= ekran görüntüsü metni yapıştır ================= */

function pasteSheet(key = U.today(), prefill = '') {
  const box = el('div');
  box.appendChild(el('p', 'muted small',
    'iPhone\'da Fotoğraflar uygulamasında ekran görüntüsüne bas, metni seç ve <b>Kopyala</b>ya dokun '
    + '(Canlı Metin). Sonra buraya yapıştır — sayılar kendiliğinden ayrıştırılır.'));

  const ta = document.createElement('textarea');
  ta.rows = 7;
  ta.placeholder = 'Hareket\n455/500 KAL\nEgzersiz\n32/30 DK\nAdım\n8.432\nMesafe\n6,1 KM';
  Object.assign(ta.style, {
    width: '100%', marginTop: '10px', background: 'var(--card-2)', color: 'var(--text)',
    border: '1px solid var(--line)', borderRadius: '14px', padding: '12px 13px',
    fontSize: '.92rem', lineHeight: '1.5', outline: 'none', fontFamily: 'inherit', resize: 'vertical',
  });
  if (prefill) ta.value = prefill;
  box.appendChild(ta);

  const result = el('div');
  result.style.marginTop = '12px';
  box.appendChild(result);

  let parsed = null;

  const parseBtn = el('button', 'btn-ghost wide', 'Ayrıştır');
  parseBtn.style.marginTop = '10px';
  parseBtn.onclick = () => {
    const out = P.parseFitnessText(ta.value);
    parsed = out;
    result.innerHTML = '';
    if (out.empty) {
      result.appendChild(el('p', 'muted small',
        'Tanıdık bir değer bulunamadı. Metnin tamamını kopyaladığından emin ol '
        + 'ya da “Elle gir” ile yaz.'));
      return;
    }
    const found = el('div', 'metric-grid');
    for (const m of METRICS) {
      const v = out.values[m.key];
      if (v == null) continue;
      const cell = el('div', 'metric');
      cell.style.setProperty('--mc', m.color);
      cell.innerHTML = `<div class="metric-label">${m.label}</div>`
        + `<div class="metric-value">${m.fmt(v)}<small>${m.unit || ''}</small></div>`;
      found.appendChild(cell);
    }
    result.appendChild(found);
    saveBtn.hidden = false;
  };
  box.appendChild(parseBtn);

  const saveBtn = el('button', 'btn-primary wide', `${U.relativeDay(key)} olarak kaydet`);
  saveBtn.hidden = true;
  saveBtn.onclick = async () => {
    if (!parsed || parsed.empty) return;
    const values = P.toActivityPatch(parsed.values);
    closeSheet();
    const ok = await applyOrAsk(key, values, { source: 'screenshot', label: 'yapıştırılan metin' });
    render();
    if (ok) {
      toast('Ekran görüntüsünden <b>kaydedildi</b>');
      if (cloudOn()) { try { await S.push(api); } catch (e) { /* sonra */ } }
    }
  };
  box.appendChild(saveBtn);

  openSheet('Metinden oku', box);
  setTimeout(() => ta.focus(), 120);
}

/* ================= görsel yükleme ================= */

async function uploadImage(file, kind) {
  if (!file) return;
  if (!cloudOn()) {
    toast('Görsel yüklemek için bulut hesabı gerekli — şimdilik metni yapıştır', { error: true });
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast('Dosya 10 MB\'ı geçiyor', { error: true });
    return;
  }
  busy('Yükleniyor…');
  try {
    const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const path = `${api.userId}/${kind}/${Date.now()}.${ext}`;
    await api.uploadImage(path, file, file.type || 'image/jpeg');
    await api.upsert('sp_uploads', {
      user_id: api.userId,
      path,
      kind,
      day: U.today(),
      status: 'pending',
    });
    await loadUploads();
    unbusy();
    render();
    toast('Yüklendi — Android uygulamasında okunacak');
  } catch (err) {
    unbusy();
    toast(err.message || 'Yüklenemedi', { error: true });
  }
}

/* ================= aynı güne ikinci ölçüm (çakışma) ================= */

/**
 * Ölçümü uygular; kayıtlıdan düşük değer varsa kullanıcıya sorar.
 * @returns Promise<boolean> uygulandı mı
 */
function applyOrAsk(day, values, { source = 'screenshot', label = 'Yeni okuma' } = {}) {
  const res = S.applyMeasurement(day, values, { source });
  if (res.applied) return Promise.resolve(true);
  if (!res.conflict) return Promise.resolve(false);
  return new Promise((resolve) => conflictSheet(res.conflict, { source, label }, resolve));
}

function conflictSheet(conflict, { source = 'screenshot', label = 'Yeni okuma' } = {}, done = () => {}) {
  const box = el('div');
  const day = conflict.day;

  box.appendChild(el('p', 'muted small',
    `<b>${esc(U.relativeDay(day))}</b> için zaten kayıtlı değerler var ve yeni okuma daha `
    + 'düşük. Adım, kalori ve mesafe gün içinde yalnız artar — bu yüzden yanlış '
    + '(ör. dünün) ekran görüntüsü yüklenmiş olabilir. Hangisi doğru?'));

  const table = el('div', 'set-box');
  table.style.marginTop = '12px';
  const head = el('div', 'set-row');
  head.innerHTML = '<div class="set-label"><b>Ölçüt</b></div>'
    + '<div style="width:78px;text-align:right;font-size:.78rem;color:var(--text-faint);font-weight:700">KAYITLI</div>'
    + '<div style="width:78px;text-align:right;font-size:.78rem;color:var(--accent);font-weight:700">YENİ</div>';
  table.appendChild(head);

  const fmtVal = (f, v) => (f === 'distance_km' ? U.nf(v, 1) : U.nf(v));
  for (const row of [...conflict.lower, ...conflict.higher]) {
    const r = el('div', 'set-row');
    const down = row.next < row.old;
    r.innerHTML = `<div class="set-label"><b>${esc(row.label)}</b></div>`
      + `<div style="width:78px;text-align:right;font-variant-numeric:tabular-nums">${fmtVal(row.field, row.old)}</div>`
      + `<div style="width:78px;text-align:right;font-variant-numeric:tabular-nums;`
      + `color:${down ? 'var(--danger)' : 'var(--accent)'};font-weight:700">${fmtVal(row.field, row.next)}</div>`;
    table.appendChild(r);
  }
  box.appendChild(table);

  let settled = false;
  const finish = (applied) => {
    if (settled) return;
    settled = true;
    closeSheet();
    render();
    if (applied && cloudOn()) { S.push(api).catch(() => {}); }
    done(applied);
  };

  const useNew = el('button', 'btn-primary wide', 'Yeni değerleri kullan');
  useNew.style.marginTop = '14px';
  useNew.onclick = () => {
    S.applyMeasurement(day, conflict.incoming, { source, mode: 'replace' });
    toast('Yeni değerler kaydedildi');
    finish(true);
  };
  box.appendChild(useNew);

  const keepMax = el('button', 'btn-ghost wide', 'Her ölçütün büyüğünü al');
  keepMax.style.marginTop = '8px';
  keepMax.onclick = () => {
    S.applyMeasurement(day, conflict.incoming, { source, mode: 'max' });
    toast('Yüksek olan değerler tutuldu');
    finish(true);
  };
  box.appendChild(keepMax);

  const keep = el('button', 'btn-ghost wide', 'Kayıtlı değerler doğru — bunu yok say');
  keep.style.marginTop = '8px';
  keep.onclick = () => {
    toast('Yeni okuma yok sayıldı');
    finish(false);
  };
  box.appendChild(keep);

  box.appendChild(el('p', 'about',
    `Kaynak: ${esc(label)}. Kararın yalnız ${esc(U.prettyDay(day))} gününü etkiler; `
    + 'istediğin zaman "Elle gir" ile düzeltebilirsin.'));

  openSheet('Hangisi doğru?', box);
}

/* ================= URL ile veri alma (iPhone kısayolu) =================
   Kısayol iki biçimde veri verebilir:
     .../saglik/#adim=8432&mesafe=6.1&kalori=455&egzersiz=32&ayakta=11&gun=2026-07-25
     .../saglik/#ocr=<Görüntüden Çıkarılan Metin>&gun=2026-07-25
   İkincisi Apple'ın kendi metin tanımasını kullanır: ekran görüntüsü iPhone'da okunur,
   sayıları bizim ayrıştırıcı çıkarır. Bulut gerekmez; çevrimdışı da çalışır. */

const HASH_FIELDS = {
  adim: ['steps', 'int'],
  steps: ['steps', 'int'],
  mesafe: ['distance_km', 'float'],
  distance: ['distance_km', 'float'],
  kalori: ['active_kcal', 'int'],
  kcal: ['active_kcal', 'int'],
  egzersiz: ['exercise_min', 'int'],
  exercise: ['exercise_min', 'int'],
  ayakta: ['stand_hours', 'int'],
  stand: ['stand_hours', 'int'],
};

async function handleHashIngest() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return false;
  let p;
  try { p = new URLSearchParams(raw); } catch (e) { return false; }
  if (![...p.keys()].length) return false;

  const clearHash = () => history.replaceState(null, '', location.pathname + location.search);
  const day = U.isValidKey(p.get('gun') || '') ? p.get('gun') : U.today();
  const notes = [];

  // 1) doğrudan sayılar
  const direct = {};
  for (const [key, [field, kind]] of Object.entries(HASH_FIELDS)) {
    if (!p.has(key) || direct[field] != null) continue;
    const v = U.parseNum(p.get(key), kind);
    if (v != null) direct[field] = v;
  }
  if (Object.keys(direct).length) {
    const ok = await applyOrAsk(day, P.toActivityPatch(direct),
      { source: 'shortcut', label: 'iPhone kısayolu' });
    if (ok) notes.push(`${U.relativeDay(day)}: ${Object.keys(direct).length} değer kaydedildi`);
  }

  // 2) kilo
  if (p.has('kilo') || p.has('weight')) {
    const kgVal = P.normalizeWeightInput(p.get('kilo') || p.get('weight'));
    if (kgVal != null) {
      S.setWeight(A.weighDueDay(S.profile(), day), { kg: kgVal }, { source: 'shortcut' });
      notes.push(`kilo ${U.nf(kgVal, 1)} kg`);
    }
  }

  // 3) ekran görüntüsünden çıkarılmış metin (Apple Canlı Metin / Kısayol OCR)
  const ocr = p.get('ocr') || p.get('metin');
  if (ocr) {
    const parsed = P.parseFitnessText(ocr);
    if (parsed.empty) {
      clearHash();
      if (!$('app').hidden) pasteSheet(day, ocr);
      toast('Metinde tanıdık değer bulunamadı — gözden geçir', { error: true });
      return true;
    }
    const ok = await applyOrAsk(day, P.toActivityPatch(parsed.values),
      { source: 'screenshot', label: 'iPhone ekran görüntüsü' });
    if (ok) notes.push(`ekran görüntüsünden ${Object.keys(parsed.values).length} değer okundu`);
  }

  clearHash();
  if (!notes.length) return false;

  if (!$('app').hidden) render();
  toast(notes.join(' · '), { ms: 3200 });
  if (cloudOn()) { try { await S.push(api); } catch (e) { /* sonra eşitlenir */ } }
  return true;
}

/* ================= bulut bağlantısı ================= */

const CLOUD_ERR = {
  'bad-url': 'Adres <code>https://xxxx.supabase.co</code> biçiminde olmalı.',
  'bad-key': 'Anahtar kabul edilmedi. Supabase → Project Settings → API sayfasındaki '
    + '<b>anon public</b> anahtarını kopyala (service_role değil).',
  'no-schema': 'Anahtar doğru ama tablolar yok. Supabase → SQL Editor’de '
    + '<code>db/schema.sql</code> dosyasını çalıştır, sonra tekrar dene.',
  unreachable: 'Adrese ulaşılamadı. İnterneti ve adresi kontrol et.',
};

function cloudSheet() {
  const box = el('div');
  box.appendChild(el('p', 'muted small',
    'Supabase panelinde <b>Project Settings → API</b> sayfasındaki iki değeri yapıştır. '
    + 'Bilgiler yalnız bu cihazda saklanır — yeniden yayınlamak ya da uygulamayı '
    + 'yeniden kurmak gerekmez. Aynı bilgileri diğer cihazda da bir kez girersin.'));

  const mk = (label, placeholder, value, type = 'text') => {
    const f = el('label', 'field');
    f.innerHTML = `<span>${label}</span>`;
    const i = el('input');
    i.type = type;
    i.placeholder = placeholder;
    i.value = value || '';
    i.autocapitalize = 'off';
    i.autocomplete = 'off';
    i.spellcheck = false;
    f.appendChild(i);
    box.appendChild(f);
    return i;
  };

  const urlInput = mk('Project URL', 'https://xxxx.supabase.co', CONFIG.url, 'url');
  const keyInput = mk('anon public anahtarı', 'eyJhbGciOi...', CONFIG.anonKey);

  const msg = el('p', 'muted small');
  msg.style.marginTop = '2px';
  box.appendChild(msg);

  const save = el('button', 'btn-primary wide', 'Bağlan');
  save.onclick = async () => {
    save.disabled = true;
    msg.innerHTML = 'Deneniyor…';
    const r = await testCloudConfig(urlInput.value, keyInput.value);
    if (r !== 'ok') {
      msg.innerHTML = `<span style="color:var(--danger)">${CLOUD_ERR[r] || 'Bağlanamadı.'}</span>`;
      save.disabled = false;
      return;
    }
    try {
      setCloudConfig({ url: urlInput.value, anonKey: keyInput.value });
    } catch (e) {
      msg.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
      save.disabled = false;
      return;
    }
    msg.innerHTML = '<b>Bağlandı.</b> Yeniden yükleniyor…';
    setTimeout(() => location.reload(), 700);
  };
  box.appendChild(save);

  if (isCloudFromDevice()) {
    const rm = el('button', 'set-action danger', 'Bulut bağlantısını bu cihazdan kaldır');
    rm.style.marginTop = '12px';
    rm.onclick = () => {
      if (!rm.dataset.sure) {
        rm.dataset.sure = '1';
        rm.textContent = 'Yerel veriler kalır, bulut kapanır — tekrar dokun';
        return;
      }
      clearCloudConfig();
      location.reload();
    };
    box.appendChild(rm);
  }

  box.appendChild(el('p', 'about',
    'anon anahtarı istemcide durmak üzere tasarlanmıştır: tüm tablolarda satır düzeyi '
    + 'güvenlik (RLS) açık, yani bu anahtarla kimse başkasının verisini göremez. '
    + '<b>service_role</b> anahtarını hiçbir yere yazma.'));

  openSheet('Bulutu bağla', box);
}

/* ================= ayarlar ================= */

function settingsSheet() {
  const p = S.profile();
  const box = el('div');

  /* hatırlatıcılar */
  const g1 = el('div', 'set-group');
  g1.appendChild(el('div', 'set-title', 'Hatırlatıcılar'));
  const b1 = el('div', 'set-box');

  const timeRow = el('label', 'field inline');
  timeRow.innerHTML = '<span>Günlük veri saati</span>';
  const timeInput = el('input');
  timeInput.type = 'time';
  timeInput.value = p.reminder_time || '21:00';
  timeInput.onchange = () => S.setProfile({ reminder_time: timeInput.value });
  timeRow.appendChild(timeInput);
  b1.appendChild(timeRow);

  const dayRow = el('label', 'field inline');
  dayRow.innerHTML = '<span>Tartı günü</span>';
  const daySel = el('select');
  for (let i = 1; i <= 7; i++) {
    const o = el('option', null, U.weekdayName(i));
    o.value = String(i);
    if (Number(p.weigh_day) === i) o.selected = true;
    daySel.appendChild(o);
  }
  daySel.onchange = () => { S.setProfile({ weigh_day: Number(daySel.value) }); render(); };
  dayRow.appendChild(daySel);
  b1.appendChild(dayRow);

  const wTimeRow = el('label', 'field inline');
  wTimeRow.innerHTML = '<span>Tartı saati</span>';
  const wTime = el('input');
  wTime.type = 'time';
  wTime.value = p.weigh_time || '08:00';
  wTime.onchange = () => S.setProfile({ weigh_time: wTime.value });
  wTimeRow.appendChild(wTime);
  b1.appendChild(wTimeRow);
  g1.appendChild(b1);
  g1.appendChild(el('p', 'about',
    'Bildirimler <b>Android uygulaması</b> ve <b>iPhone kısayol otomasyonu</b> tarafından gönderilir; '
    + 'saatler burada tutulur, iki taraf da bu ayarı kullanır.'));
  box.appendChild(g1);

  /* hedefler */
  const g2 = el('div', 'set-group');
  g2.appendChild(el('div', 'set-title', 'Hedefler ve ölçüler'));
  const b2 = el('div', 'set-box');
  const nf2 = (label, key, unit, mode = 'numeric') => {
    const row = numberField(label, 'set-' + key, p[key], { unit, mode });
    const input = row.querySelector('input');
    input.onchange = () => {
      const v = U.parseNum(input.value, mode === 'decimal' ? 'float' : 'int');
      S.setProfile({ [key]: v });
      render();
    };
    b2.appendChild(row);
  };
  nf2('Günlük adım', 'step_goal');
  nf2('Günlük kalori', 'kcal_goal', 'kcal');
  nf2('Günlük egzersiz', 'exercise_goal', 'dk');
  nf2('Boy', 'height_cm', 'cm');
  nf2('Hedef kilo', 'target_weight', 'kg', 'decimal');
  g2.appendChild(b2);
  box.appendChild(g2);

  /* bulut (yalnız gelişmiş durum: gömülü ayar yok ya da elle bağlanmış) */
  const showCloudGroup = !isCloudEnabled() || isCloudFromDevice();
  const gc = el('div', 'set-group');
  gc.hidden = !showCloudGroup;
  gc.appendChild(el('div', 'set-title', 'Bulut'));
  const bc = el('div', 'set-box');
  const cloudBtn = el('button', 'set-action',
    isCloudEnabled() ? 'Bulut bilgilerini değiştir' : 'Bulutu bağla (Supabase)');
  cloudBtn.onclick = cloudSheet;
  bc.appendChild(cloudBtn);
  gc.appendChild(bc);
  gc.appendChild(el('p', 'about', isCloudEnabled()
    ? `Bağlı: <b>${esc(CONFIG.url.replace('https://', ''))}</b>`
      + `${cloudOn() ? ` · giriş: ${esc(api.email || '')}` : ' · henüz giriş yapılmadı'}`
    : 'Bağlı değil — veriler yalnız bu cihazda. Bağlarsan iPhone kısayolu ve '
      + 'cihazlar arası eşitleme açılır.'));
  box.appendChild(gc);

  /* iPhone */
  const g3 = el('div', 'set-group');
  g3.appendChild(el('div', 'set-title', 'iPhone bağlantısı'));
  const b3 = el('div', 'set-box');
  const wiz = el('button', 'set-action', 'iPhone kısayolunu kur (adım adım)');
  wiz.onclick = shortcutWizard;
  b3.appendChild(wiz);
  const pasteAct = el('button', 'set-action', 'Ekran görüntüsü metnini yapıştır');
  pasteAct.onclick = () => pasteSheet(U.today());
  b3.appendChild(pasteAct);
  g3.appendChild(b3);
  box.appendChild(g3);

  /* görünüm */
  const g4 = el('div', 'set-group');
  g4.appendChild(el('div', 'set-title', 'Görünüm'));
  const b4 = el('div', 'set-box');
  const themeRow = el('div', 'field inline');
  themeRow.innerHTML = '<span>Tema</span>';
  const seg = el('div', 'seg');
  for (const [v, label] of [['dark', 'Koyu'], ['light', 'Açık']]) {
    const b = el('button', S.state.theme === v ? 'on' : null, label);
    b.onclick = () => {
      S.setTheme(v);
      applyTheme();
      for (const c of seg.children) c.classList.toggle('on', c === b);
    };
    seg.appendChild(b);
  }
  themeRow.appendChild(seg);
  b4.appendChild(themeRow);
  g4.appendChild(b4);
  box.appendChild(g4);

  /* veri */
  const g5 = el('div', 'set-group');
  g5.appendChild(el('div', 'set-title', 'Veri'));
  const b5 = el('div', 'set-box');

  const csv = el('button', 'set-action', 'CSV olarak indir');
  csv.onclick = () => { download(`saglik-panel-${U.today()}.csv`, S.exportCSV(), 'text/csv'); };
  b5.appendChild(csv);

  const json = el('button', 'set-action', 'JSON yedek indir');
  json.onclick = () => { download(`saglik-panel-${U.today()}.json`, S.exportJSON(), 'application/json'); };
  b5.appendChild(json);

  if (cloudOn()) {
    const sync = el('button', 'set-action', 'Şimdi eşitle');
    sync.onclick = () => { closeSheet(); syncNow(); };
    b5.appendChild(sync);
    const out = el('button', 'set-action', 'Çıkış yap');
    out.onclick = async () => {
      await api.signOut();
      closeSheet();
      showAuth();
      toast('Çıkış yapıldı');
    };
    b5.appendChild(out);
  }

  const wipe = el('button', 'set-action danger', 'Bu cihazdaki veriyi sıfırla');
  wipe.onclick = () => {
    if (wipe.dataset.sure) {
      S.resetLocal();
      closeSheet();
      render();
      toast('Yerel veri sıfırlandı');
    } else {
      wipe.dataset.sure = '1';
      wipe.textContent = 'Emin misin? Tekrar dokun';
    }
  };
  b5.appendChild(wipe);
  g5.appendChild(b5);
  box.appendChild(g5);

  const st = A.weightReport(S.state.weights, p);
  box.appendChild(el('p', 'about',
    `${Object.keys(S.state.days).length} gün kayıt · ${st.empty ? 0 : st.count} kilo ölçümü`
    + `${S.dirtyCount() ? ` · ${S.dirtyCount()} kayıt eşitlenmeyi bekliyor` : ''}`
    + `<br>${cloudOn() ? `Bulut: açık (${esc(api.email || '')})` : 'Bulut: kapalı — veriler yalnız bu tarayıcıda'}`
    + `${S.state.lastSync ? `<br>Son eşitleme: ${new Date(S.state.lastSync).toLocaleString('tr-TR')}` : ''}`));

  openSheet('Ayarlar', box);
}

/* ================= kısayol sihirbazı ================= */

function shortcutWizard() {
  const p = S.profile();
  const token = p.ingest_token;
  const box = el('div');
  const base = (CONFIG.webUrl || location.origin + location.pathname).replace(/\/+$/, '') + '/';

  box.appendChild(el('p', 'muted small',
    `Panelin <b>iPhone'dan veri çek</b> tuşu, telefonundaki <b>${esc(CONFIG.shortcutName)}</b> `
    + 'adlı kısayolu çalıştırır. Kısayol yoksa “bulunamadı” der — bir kez kurman yeterli. '
    + 'İki yol var: <b>A</b> daha kolay, <b>B</b> arka planda kendiliğinden çalışır.'));

  const copyRow = (title, value, note) => {
    const g = el('div', 'set-group');
    g.appendChild(el('div', 'set-title', title));
    g.appendChild(el('div', 'copybox', esc(value)));
    if (note) g.appendChild(el('p', 'muted small', note));
    const btn = el('button', 'btn-ghost wide', 'Kopyala');
    btn.style.marginTop = '6px';
    btn.onclick = () => copyText(value, 'Kopyalandı');
    g.appendChild(btn);
    box.appendChild(g);
  };

  /* ---------- A: kolay yol ---------- */
  const gA = el('div', 'set-group');
  gA.appendChild(el('div', 'set-title', 'A · Kolay yol (anahtar gerekmez)'));
  const listA = el('ol', 'steps-list');
  const stepsA = [
    'Kısayollar uygulamasını aç → sağ üstte <b>+</b>.',
    `Üstteki ada dokunup adını <b>${esc(CONFIG.shortcutName)}</b> yap (birebir aynı olmalı).`,
    '<b>Sağlık Örneklerini Bul</b> ekle → Tür: <b>Adımlar</b>, Filtre: <b>Başlangıç Tarihi bugün</b>. '
      + 'Altına <b>İstatistik Hesapla</b> → <b>Toplam</b> ekle. Sonuca uzun basıp '
      + '<b>Değişkene Ata</b> → adı: <b>adim</b>.',
    'Aynı üçlüyü tekrarla: <b>Aktif Enerji</b> → <b>kalori</b>, '
      + '<b>Egzersiz Dakikası</b> → <b>egzersiz</b>, <b>Yürüme + Koşu Mesafesi</b> → <b>mesafe</b>.',
    '<b>URL’leri Aç</b> (Open URLs) ekle ve aşağıdaki adresi yapıştır. Sonra '
      + '<b>ADIM / KALORI / EGZERSIZ / MESAFE</b> yazan yerleri silip yerlerine ilgili '
      + '<b>değişkeni</b> sürükle.',
    'Kısayolu bir kez çalıştır → Sağlık izni isterse <b>İzin Ver</b>. Panel açılır, o günün '
      + 'verileri kaydedilir. Artık paneldeki <b>iPhone’dan veri çek</b> tuşu bunu çağırır.',
  ];
  for (const it of stepsA) listA.appendChild(el('li', null, it));
  gA.appendChild(listA);
  box.appendChild(gA);

  copyRow('A · Kısayola yapıştırılacak adres',
    `${base}#adim=ADIM&kalori=KALORI&egzersiz=EGZERSIZ&mesafe=MESAFE`,
    'Büyük harfli yerlere Kısayollar’daki değişkenleri sürükle. Ayakta saatini de eklemek '
    + 'istersen sonuna &ayakta=AYAKTA yaz.');

  /* ---------- B: otomatik yol ---------- */
  const gB = el('div', 'set-group');
  gB.appendChild(el('div', 'set-title', 'B · Otomatik yol (arka planda, panel açılmadan)'));
  if (!cloudOn()) {
    gB.appendChild(el('p', 'muted small',
      'Bu yol için hesabınla giriş yapmış olman gerekir — veriler doğrudan hesabına yazılır.'));
    box.appendChild(gB);
  } else if (!token) {
    gB.appendChild(el('p', 'muted small',
      'Gönderim anahtarı henüz gelmedi. Üstteki eşitleme tuşuna dokunup tekrar dene.'));
    box.appendChild(gB);
  } else {
    const listB = el('ol', 'steps-list');
    const stepsB = [
      'A yolundaki 1-4. adımları aynen yap (değişkenler hazır olsun).',
      '<b>URL İçeriğini Al</b> (Get Contents of URL) ekle → aşağıdaki <b>adresi</b> yapıştır, '
        + 'Yöntem: <b>POST</b>.',
      'Başlıklar: <b>apikey</b> = aşağıdaki anahtar, <b>Content-Type</b> = <b>application/json</b>.',
      'İstek Gövdesi: <b>JSON</b> → <b>p_token</b> (metin, gönderim anahtarı), '
        + '<b>p_day</b> (Geçerli Tarih → <b>Tarihi Biçimlendir</b> → özel biçim <b>yyyy-MM-dd</b>), '
        + '<b>p_steps</b>=adim, <b>p_active_kcal</b>=kalori, <b>p_exercise_min</b>=egzersiz, '
        + '<b>p_distance_km</b>=mesafe.',
      'Otomatik olsun istersen: Kısayollar → <b>Otomasyon</b> → <b>Saat</b> → '
        + `<b>${esc(p.reminder_time || '21:00')}</b> → “Çalıştırmadan Önce Sor”u kapat → `
        + 'bu kısayolu seç. Artık her akşam kendiliğinden gider.',
    ];
    for (const it of stepsB) listB.appendChild(el('li', null, it));
    gB.appendChild(listB);
    box.appendChild(gB);

    copyRow('B · Adres (URL)', api.ingestEndpoint());
    copyRow('B · apikey başlığı', CONFIG.anonKey);
    copyRow('B · Gönderim anahtarı (p_token)', token,
      'Bu anahtar yalnız veri YAZAR; kimse onunla verilerini okuyamaz.');
  }

  /* ---------- C: ekran görüntüsü kısayolu ---------- */
  const gC = el('div', 'set-group');
  gC.appendChild(el('div', 'set-title', 'C · Ekran görüntüsünü iPhone okusun (isteğe bağlı)'));
  const listC = el('ol', 'steps-list');
  const stepsC = [
    'Yeni kısayol → adı <b>Sağlık Görüntü</b>.',
    '<b>Görüntüden Metin Çıkar</b> → girdi: <b>Kısayol Girdisi</b>.',
    '<b>Metni URL Kodla</b> ekle.',
    `<b>URL’leri Aç</b> → <code>${esc(base)}#ocr=</code> + (kodlanmış metin).`,
    '<b>ⓘ</b> → <b>Paylaşım Sayfasında Göster</b> aç, tür: <b>Görüntüler</b>. Artık '
      + 'Fotoğraflar’da ekran görüntüsünü paylaşıp bu kısayolu seçebilirsin.',
  ];
  for (const it of stepsC) listC.appendChild(el('li', null, it));
  gC.appendChild(listC);
  box.appendChild(gC);

  const runBtn = el('button', 'btn-primary wide', 'Kısayolu şimdi çalıştır');
  runBtn.style.marginTop = '14px';
  runBtn.onclick = () => {
    window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(CONFIG.shortcutName)}`;
  };
  box.appendChild(runBtn);

  const openApp = el('button', 'btn-ghost wide', 'Kısayollar uygulamasını aç');
  openApp.style.marginTop = '8px';
  openApp.onclick = () => { window.location.href = 'shortcuts://'; };
  box.appendChild(openApp);

  if (cloudOn() && token) {
    const rot = el('button', 'set-action danger', 'Gönderim anahtarını yenile');
    rot.style.marginTop = '12px';
    rot.onclick = async () => {
      if (!rot.dataset.sure) {
        rot.dataset.sure = '1';
        rot.textContent = 'Eski kısayol çalışmaz olur — tekrar dokun';
        return;
      }
      busy('Yenileniyor…');
      try {
        const t = await api.rotateIngestToken();
        S.setProfile({ ingest_token: typeof t === 'string' ? t : t?.[0] || null }, { dirty: false });
        unbusy();
        toast('Yeni anahtar alındı');
        shortcutWizard();
      } catch (e) {
        unbusy();
        toast(e.message || 'Yenilenemedi', { error: true });
      }
    };
    box.appendChild(rot);
  }

  openSheet('iPhone kısayolu', box);
}

/* ================= olaylar ================= */

function wire() {
  $('auth-form').addEventListener('submit', doAuth);
  $('auth-mode').onclick = (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b || b.dataset.mode === authMode) return;
    authMode = b.dataset.mode;
    showAuth();
  };
  $('auth-cloud').onclick = cloudSheet;
  $('auth-local').onclick = () => {
    localOnly = true;
    S.markOnboarded();
    showApp();
    toast('Yalnız bu cihazda çalışıyor');
  };

  for (const t of document.querySelectorAll('.tab')) {
    t.onclick = () => { view = t.dataset.view; offset = 0; render(); window.scrollTo(0, 0); };
  }

  $('btn-settings').onclick = settingsSheet;
  $('btn-sync').onclick = () => syncNow();
  $('sheet-close').onclick = closeSheet;
  $('sheet-backdrop').onclick = closeSheet;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });

  $('btn-shortcut').onclick = () => {
    if (!isIOS) { toast('Bu tuş iPhone/iPad içindir', { error: true }); return; }
    const t0 = Date.now();
    window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(CONFIG.shortcutName)}`;
    // Kısayol açılırsa sayfa arka plana düşer. 1,6 sn sonra hâlâ öndeysek kısayol yok demektir.
    setTimeout(() => {
      if (document.visibilityState === 'visible' && Date.now() - t0 < 4000) {
        toast(`<b>${esc(CONFIG.shortcutName)}</b> adlı kısayol bulunamadı — kurulum açılıyor`, { ms: 3000 });
        shortcutWizard();
      } else {
        syncNow({ quiet: true });
      }
    }, 1600);
    setTimeout(() => syncNow({ quiet: true }), 6000);
  };
  $('btn-manual').onclick = () => manualSheet(U.today());
  $('btn-upload-fitness').onclick = () => {
    // iPhone/iPad: Apple'ın kendi metin tanıması anında sonuç verir, Android beklemeye gerek yok
    if (isIOS || !cloudOn()) pasteSheet(U.today());
    else $('file-fitness').click();
  };
  $('file-fitness').onchange = (e) => {
    uploadImage(e.target.files?.[0], 'fitness');
    e.target.value = '';
  };
  $('btn-upload-scale').onclick = () => $('file-scale').click();
  $('file-scale').onchange = (e) => {
    uploadImage(e.target.files?.[0], 'scale');
    e.target.value = '';
  };

  $('weight-save').onclick = async () => {
    const kgVal = P.normalizeWeightInput($('weight-input').value);
    if (kgVal == null) { toast('Kiloyu 25–400 arası yaz (ör. 82,4)', { error: true }); return; }
    const due = A.weighDueDay(S.profile(), U.today());
    S.setWeight(due, { kg: kgVal }, { source: 'manual' });
    render();
    toast(`${U.relativeDay(due)} için <b>${U.nf(kgVal, 1)} kg</b> kaydedildi`);
    if (cloudOn()) { try { await S.push(api); } catch (e) { /* sonra */ } }
  };
  $('weight-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('weight-save').click(); }
  });

  $('range-seg').onclick = (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    range = b.dataset.range;
    offset = 0;
    for (const c of $('range-seg').children) c.classList.toggle('on', c === b);
    renderAnalysis();
  };
  $('period-prev').onclick = () => { offset--; renderAnalysis(); };
  $('period-next').onclick = () => { if (offset < 0) { offset++; renderAnalysis(); } };

  window.addEventListener('focus', () => syncNow({ quiet: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow({ quiet: true });
  });
  window.addEventListener('beforeunload', () => S.save({ now: true }));

  S.onChange((reason) => {
    if (reason === 'sync' || reason === 'import' || reason === 'reset') render();
  });

  // native-extras (Android OCR işçisi) buradan çakışma sorabilir
  window.SaglikPanel = {
    applyOrAsk,
    conflictSheet,
    render,
    toast,
  };
}

/* ================= açılış ================= */

async function boot() {
  S.load();
  applyTheme();
  wire();

  if (isCloudEnabled() && api.isLoggedIn()) {
    showApp();
    await syncNow({ quiet: true });
  } else if (isCloudEnabled()) {
    showAuth();
  } else if (S.state.onboarded) {
    localOnly = true;
    showApp();
  } else {
    showAuth();
  }

  await handleHashIngest();
  window.addEventListener('hashchange', () => { handleHashIngest(); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
