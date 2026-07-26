// Foto Stüdyo — uygulama kabuğu: durum, arayüz bağlama, render döngüsü.

import { Engine } from './gl.js';
import {
  GROUPS, ADJUSTMENTS, ADJ_BY_KEY, TOGGLES,
  defaultParams, defaultTransform, toUniforms, ART_MODES,
} from './adjustments.js';
import { PRESETS, PRESET_BY_ID } from './presets.js';
import { defaultCurves, buildLUT, isIdentity, CURVE_PRESETS } from './curves.js';
import { CurveEditor } from './curveEditor.js';
import { CropTool, ASPECTS } from './crop.js';
import { computeHistogram, drawHistogram } from './histogram.js';
import { Store, clone } from './store.js';
import * as ex from './exporter.js';
import * as ov from './overlay.js';

const $ = (id) => document.getElementById(id);
const LS_PRESETS = 'fotostudyo.presets.v1';
const LS_EXPORT = 'fotostudyo.export.v1';
const LS_GROUPS = 'fotostudyo.groups.v1';

/* ------------------------------------------------------------------ durum */

function freshState() {
  return {
    presetId: 'none',
    presetStrength: 100,
    user: {},
    transform: defaultTransform(),
    curves: defaultCurves(),
    overlays: [],
    frame: ov.defaultFrame(),
  };
}

const store = new Store(freshState());

let engine = null;
let imageInfo = null;      // { name, width, height, size, type }
let userPresets = [];
let cropMode = false;
let compareMode = false;
let lastHist = null;
let renderQueued = false;
let histTimer = 0;
let previewBox = { x: 0, y: 0, w: 1, h: 1 };   // görüntünün birleştirme tuvalindeki yeri
let selectedOverlayId = null;
let currentTab = 'filters';

/* --------------------------------------------------- parametre hesaplama */

function effectiveParams(state = store.get()) {
  const out = defaultParams();
  const preset = PRESET_BY_ID[state.presetId] || userPresetById(state.presetId);
  const k = (state.presetStrength ?? 100) / 100;

  if (preset) {
    for (const [key, v] of Object.entries(preset.params)) {
      const meta = ADJ_BY_KEY[key];
      if (!meta) { out[key] = v; continue; }          // geçiş anahtarları (bw, invert)
      if (meta.kind === 'hue') { out[key] = v; continue; } // renk açısı ölçeklenmez
      out[key] = meta.def + (v - meta.def) * k;
    }
    for (const t of TOGGLES) {
      if (preset.params[t.key] !== undefined) out[t.key] = k > 0.35 ? preset.params[t.key] : 0;
    }
  }

  for (const [key, v] of Object.entries(state.user || {})) {
    const meta = ADJ_BY_KEY[key];
    if (!meta) { out[key] = v; continue; }
    out[key] = (out[key] ?? meta.def) + (v - meta.def);
    out[key] = Math.max(meta.min, Math.min(meta.max, out[key]));
  }
  return out;
}

/** Kaydırıcı yeni değere ayarlandığında kullanıcı katmanına yazılacak değer. */
function setEffective(key, value) {
  const state = store.get();
  const meta = ADJ_BY_KEY[key];
  const withoutUser = { ...state, user: { ...state.user } };
  delete withoutUser.user[key];
  const base = effectiveParams(withoutUser)[key] ?? meta.def;
  state.user[key] = meta.def + (value - base);
}

function userPresetById(id) {
  return userPresets.find((p) => p.id === id) || null;
}

function currentUniforms(state = store.get(), overrideParams = null) {
  const p = overrideParams || effectiveParams(state);
  return toUniforms(p, { curveOn: !isIdentity(state.curves) });
}

function renderTransform(state = store.get()) {
  const t = clone(state.transform);
  if (cropMode) t.crop = { x: 0, y: 0, w: 1, h: 1 };
  return t;
}

/* ------------------------------------------------- yakınlaştırma / kaydırma */

const view = { zoom: 1, panX: 0, panY: 0 };
const MAX_ZOOM = 8;

function clampPan() {
  const lim = Math.max(0, (1 - 1 / view.zoom) / 2);
  view.panX = Math.max(-lim, Math.min(lim, view.panX));
  view.panY = Math.max(-lim, Math.min(lim, view.panY));
}

/** Görünen pencereyi kırpma dikdörtgenine gömer; böylece yakınlaşınca yeniden işlenir. */
function applyView(transform) {
  if (view.zoom <= 1.001) return transform;
  clampPan();
  const t = clone(transform);
  const f = 1 / view.zoom;
  const wx = 0.5 + view.panX - f / 2;
  const wy = 0.5 + view.panY - f / 2;
  t.crop = {
    x: transform.crop.x + wx * transform.crop.w,
    y: transform.crop.y + wy * transform.crop.h,
    w: transform.crop.w * f,
    h: transform.crop.h * f,
  };
  return t;
}

function setZoom(z, anchorU = 0.5, anchorV = 0.5) {
  const prev = view.zoom;
  const next = Math.max(1, Math.min(MAX_ZOOM, z));
  if (Math.abs(next - prev) < 1e-4) return;
  // İmlecin altındaki noktayı sabit tut
  const winX = 0.5 + view.panX - 0.5 / prev;
  const winY = 0.5 + view.panY - 0.5 / prev;
  const px = winX + anchorU / prev;
  const py = winY + anchorV / prev;
  view.zoom = next;
  view.panX = px - anchorU / next + 0.5 / next - 0.5;
  view.panY = py - anchorV / next + 0.5 / next - 0.5;
  clampPan();
  updateZoomUi();
  scheduleRender();
}

function resetZoom() {
  view.zoom = 1;
  view.panX = 0;
  view.panY = 0;
  updateZoomUi();
}

function updateZoomUi() {
  const wrap = $('canvasWrap');
  wrap.classList.toggle('zoomed', view.zoom > 1.001);
  const btn = $('btnZoomReset');
  if (btn) btn.hidden = view.zoom <= 1.001;
  showHud();
}

/* ---------------------------------------------------------------- render */

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    doRender();
  });
}

/** Önizlemede etkin çerçeve (kırpma ve karşılaştırma kipinde çerçeve gizlenir). */
function activeFrame(state = store.get()) {
  if (cropMode || compareMode) return { type: 'none', size: 0, color: '#fff', radius: 0 };
  return state.frame || ov.defaultFrame();
}

function activeOverlays(state = store.get()) {
  return cropMode || compareMode ? [] : state.overlays || [];
}

function doRender() {
  if (!engine || !imageInfo) return;
  const state = store.get();
  const wrap = $('canvasWrap');
  const stage = $('stage');
  const pad = 24;
  const availW = Math.max(64, stage.clientWidth - pad);
  const availH = Math.max(64, stage.clientHeight - pad);

  engine.setCurveLUT(buildLUT(state.curves));

  // Karşılaştırmada çerçeveleme aynı kalır, yalnız renk düzenlemeleri kalkar
  const params = compareMode ? defaultParams() : effectiveParams(state);
  const uniforms = toUniforms(params, { curveOn: compareMode ? false : !isIdentity(state.curves) });
  const base = renderTransform(state);

  const full = engine.outputSize(base);
  const frame = activeFrame(state);
  const fm = ov.frameMetrics(frame, full.w, full.h);
  const scale = Math.min(availW / fm.w, availH / fm.h, 1);

  const imgW = Math.max(1, Math.round(full.w * scale));
  const imgH = Math.max(1, Math.round(full.h * scale));
  // Ölçüler her zaman aynı fonksiyondan gelsin ki önizleme ile çıktı kaymasın
  const pm = ov.frameMetrics(frame, imgW, imgH);
  const totalW = Math.max(1, Math.round(pm.w));
  const totalH = Math.max(1, Math.round(pm.h));
  const padL = Math.round(pm.l);
  const padT = Math.round(pm.t);

  engine.renderToCanvas(uniforms, applyView(base), imgW, imgH);

  // 2B birleştirme: çerçeve + görüntü + katmanlar. Dışa aktarımla aynı kod yolu.
  const cv = $('view');
  if (cv.width !== totalW || cv.height !== totalH) {
    cv.width = totalW;
    cv.height = totalH;
  }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, totalW, totalH);
  ov.drawFramedImage(ctx, engine.canvas, frame, imgW, imgH);

  // Yakınlaşınca görünen pencereye göre katman kutusu
  const f = 1 / view.zoom;
  const wx = view.zoom > 1.001 ? 0.5 + view.panX - f / 2 : 0;
  const wy = view.zoom > 1.001 ? 0.5 + view.panY - f / 2 : 0;
  previewBox = {
    x: padL - (wx / f) * imgW,
    y: padT - (wy / f) * imgH,
    w: imgW / f,
    h: imgH / f,
  };
  const overlays = activeOverlays(state);
  ov.drawOverlays(ctx, overlays, previewBox);
  const sel = overlays.find((o) => o.id === selectedOverlayId);
  if (sel && currentTab === 'text') ov.drawSelection(ctx, sel, previewBox, 1);

  cv.style.width = totalW + 'px';
  cv.style.height = totalH + 'px';
  wrap.style.width = totalW + 'px';
  wrap.style.height = totalH + 'px';
  wrap.classList.add('ready');

  const outFull = engine.outputSize(state.transform);
  const outFm = ov.frameMetrics(state.frame, outFull.w, outFull.h);
  $('hudSize').textContent = `${Math.round(outFm.w)} × ${Math.round(outFm.h)}`;
  $('hudZoom').textContent = Math.round(scale * view.zoom * 100) + '%';

  clearTimeout(histTimer);
  histTimer = setTimeout(updateHistogram, 90);
}


function updateHistogram() {
  if (!engine || !imageInfo) return;
  const state = store.get();
  const sample = engine.samplePixels(currentUniforms(state), renderTransform(state), 180);
  if (!sample) return;
  lastHist = computeHistogram(sample.pixels);
  drawHistogram($('histogram'), lastHist);
  curveEditor?.setHistogram(lastHist);
  const lowPct = ((lastHist.clipLow / Math.max(1, lastHist.total)) * 100).toFixed(1);
  const highPct = ((lastHist.clipHigh / Math.max(1, lastHist.total)) * 100).toFixed(1);
  $('clipInfo').textContent = `kırpılan: siyah %${lowPct} · beyaz %${highPct}`;
}

/* ------------------------------------------------------------ görüntü aç */

async function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('Bu bir görsel dosyası değil.', true);
    return;
  }
  try {
    const bmp = await createImageBitmap(file).catch(async () => {
      // Safari/eski tarayıcı yedeği
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      URL.revokeObjectURL(url);
      return img;
    });
    const info = engine.setImage(bmp);
    imageInfo = {
      name: file.name || 'foto.jpg',
      width: info.width,
      height: info.height,
      srcWidth: bmp.width,
      srcHeight: bmp.height,
      size: file.size || 0,
      type: file.type || 'image/jpeg',
    };
    bmp.close?.();

    store.state = freshState();
    store.clearHistory();
    $('dropzone').classList.add('hidden');
    $('expName').value = (imageInfo.name || 'foto').replace(/\.[^.]+$/, '');
    engine.reseed();
    resetZoom();
    cropTool.setBBoxAspect(info.width / info.height);
    cropTool.reset();
    syncAll();
    scheduleRender();
    renderPresetThumbs();
    updateInfoList();
    showHud();
    toast(`${imageInfo.width} × ${imageInfo.height} yüklendi`);
  } catch (err) {
    console.error(err);
    toast('Görsel açılamadı: ' + err.message, true);
  }
}

/* --------------------------------------------------------- arayüz kurulum */

function buildAdjustPanel() {
  const host = $('adjustGroups');
  host.innerHTML = '';
  const collapsed = JSON.parse(localStorage.getItem(LS_GROUPS) || '{}');

  for (const g of GROUPS) {
    const items = ADJUSTMENTS.filter((a) => a.group === g.id);
    const toggles = TOGGLES.filter((t) => t.group === g.id);
    if (!items.length && !toggles.length) continue;

    const box = document.createElement('div');
    box.className = 'adj-group' + (collapsed[g.id] ? ' collapsed' : '');
    box.dataset.group = g.id;

    const head = document.createElement('button');
    head.className = 'group-head';
    head.innerHTML = `<span>${g.icon} ${g.label}</span><span class="badge" hidden></span><span class="chev">▼</span>`;
    head.addEventListener('click', () => {
      box.classList.toggle('collapsed');
      const c = JSON.parse(localStorage.getItem(LS_GROUPS) || '{}');
      c[g.id] = box.classList.contains('collapsed');
      localStorage.setItem(LS_GROUPS, JSON.stringify(c));
    });
    box.appendChild(head);

    const body = document.createElement('div');
    body.className = 'group-body';

    if (toggles.length) {
      const row = document.createElement('div');
      row.className = 'chip-row';
      row.style.margin = '4px 0 10px';
      for (const t of toggles) {
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.dataset.toggle = t.key;
        chip.textContent = t.label;
        chip.addEventListener('click', () => {
          const cur = effectiveParams()[t.key] ? 1 : 0;
          store.transact(t.label, (s) => { s.user[t.key] = cur ? 0 : 1; });
          syncAll();
          scheduleRender();
        });
        row.appendChild(chip);
      }
      body.appendChild(row);
    }

    for (const a of items) {
      body.appendChild(a.kind === 'artmode' ? buildArtModeRow(a) : buildSlider(a));
    }
    box.appendChild(body);
    host.appendChild(box);
  }
}

/** Sanatsal efekt seçimi kaydırıcı değil, çip satırı olarak gösterilir. */
function buildArtModeRow(a) {
  const wrap = document.createElement('div');
  wrap.className = 'slider art-modes';
  wrap.dataset.key = a.key;

  const head = document.createElement('div');
  head.className = 'slider-head';
  const label = document.createElement('label');
  label.textContent = a.label;
  head.appendChild(label);

  const row = document.createElement('div');
  row.className = 'chip-row';
  for (const m of ART_MODES) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.art = m.id;
    chip.textContent = m.label;
    chip.addEventListener('click', () => {
      store.transact(m.label, () => setEffective('artMode', m.id));
      syncAll();
      scheduleRender();
    });
    row.appendChild(chip);
  }
  wrap.append(head, row);
  return wrap;
}

function buildSlider(a) {
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  wrap.dataset.key = a.key;

  const head = document.createElement('div');
  head.className = 'slider-head';
  const label = document.createElement('label');
  label.textContent = a.label;
  const out = document.createElement('output');
  head.append(label, out);

  const range = document.createElement('input');
  range.type = 'range';
  range.min = a.min;
  range.max = a.max;
  range.step = a.step || 1;
  range.value = a.def;
  if (a.kind === 'hue') range.classList.add('hue-track');

  range.addEventListener('pointerdown', () => store.begin());
  range.addEventListener('input', () => {
    setEffective(a.key, Number(range.value));
    out.textContent = formatVal(a, Number(range.value));
    wrap.classList.toggle('changed', Math.abs(Number(range.value) - a.def) > 0.001);
    scheduleRender();
    updateGroupBadges();
  });
  const commit = () => store.commit(a.label);
  range.addEventListener('change', commit);
  range.addEventListener('pointerup', commit);
  range.addEventListener('pointercancel', commit);

  // Çift dokunuş → varsayılana dön
  label.addEventListener('dblclick', () => resetKey(a.key));
  out.addEventListener('dblclick', () => resetKey(a.key));

  wrap.append(head, range);
  return wrap;
}

function resetKey(key) {
  const meta = ADJ_BY_KEY[key];
  if (!meta) return;
  store.transact('sıfırla', () => setEffective(key, meta.def));
  syncAll();
  scheduleRender();
}

function formatVal(a, v) {
  const unit = a.unit || '';
  const n = Math.round(v * 10) / 10;
  const sign = a.min < 0 && n > 0 ? '+' : '';
  return sign + n + unit;
}

/** Bağlı ayarları (ör. gren boyutu) ana ayar kapalıyken soluklaştır. */
function updateDependencies(eff) {
  for (const a of ADJUSTMENTS) {
    if (!a.dependsOn) continue;
    const wrap = document.querySelector(`.slider[data-key="${a.key}"]`);
    if (!wrap) continue;
    const live = a.dependsOn.some((dep) => {
      const dm = ADJ_BY_KEY[dep];
      return Math.abs((eff[dep] ?? dm.def) - dm.def) > 0.001;
    });
    wrap.classList.toggle('inactive', !live);
    wrap.title = live ? '' : `Önce “${a.dependsOn.map((d) => ADJ_BY_KEY[d].label).join('” ya da “')}” değerini artır.`;
  }
}

function updateGroupBadges() {
  const eff = effectiveParams();
  for (const g of GROUPS) {
    const box = document.querySelector(`.adj-group[data-group="${g.id}"]`);
    if (!box) continue;
    let n = 0;
    for (const a of ADJUSTMENTS.filter((x) => x.group === g.id)) {
      if (Math.abs((eff[a.key] ?? a.def) - a.def) > 0.001) n++;
    }
    for (const t of TOGGLES.filter((x) => x.group === g.id)) if (eff[t.key]) n++;
    const badge = box.querySelector('.badge');
    badge.hidden = n === 0;
    badge.textContent = n;
  }
  updateDependencies(eff);
}

function syncAll() {
  const state = store.get();
  const eff = effectiveParams(state);

  for (const a of ADJUSTMENTS) {
    const wrap = document.querySelector(`.slider[data-key="${a.key}"]`);
    if (!wrap) continue;
    const v = eff[a.key] ?? a.def;
    if (a.kind === 'artmode') {
      wrap.querySelectorAll('[data-art]').forEach((c) => {
        c.classList.toggle('active', Number(c.dataset.art) === Math.round(v));
      });
      wrap.classList.toggle('changed', Math.round(v) !== a.def);
      continue;
    }
    const range = wrap.querySelector('input');
    const out = wrap.querySelector('output');
    range.value = v;
    out.textContent = formatVal(a, v);
    wrap.classList.toggle('changed', Math.abs(v - a.def) > 0.001);
  }
  for (const t of TOGGLES) {
    const chip = document.querySelector(`.chip[data-toggle="${t.key}"]`);
    if (chip) chip.classList.toggle('active', !!eff[t.key]);
  }
  updateGroupBadges();

  document.querySelectorAll('.preset').forEach((el) => {
    el.classList.toggle('active', el.dataset.preset === state.presetId);
  });
  $('presetStrength').value = state.presetStrength;
  $('presetStrengthOut').textContent = state.presetStrength;

  $('angleRange').value = state.transform.angle;
  $('angleOut').textContent = state.transform.angle.toFixed(1) + '°';

  $('btnUndo').disabled = !store.canUndo();
  $('btnRedo').disabled = !store.canRedo();

  curveEditor?.setPoints(state.curves[curveEditor.channel]);
  if (state.overlays && !state.overlays.some((o) => o.id === selectedOverlayId)) selectedOverlayId = null;
  refreshTextPanel();
  updateInfoList();
}

/* ---------------------------------------------------------- preset ızgara */

function renderPresetGrid() {
  const grid = $('presetGrid');
  grid.innerHTML = '';
  for (const p of PRESETS) {
    grid.appendChild(makePresetCard(p, false));
  }
  renderUserPresets();
}

function renderUserPresets() {
  const grid = $('userPresetGrid');
  grid.innerHTML = '';
  for (const p of userPresets) grid.appendChild(makePresetCard(p, true));
  $('userPresetHint').hidden = userPresets.length > 0;
  if (imageInfo) renderPresetThumbs();
}

function makePresetCard(p, deletable) {
  const el = document.createElement('button');
  el.className = 'preset';
  el.dataset.preset = p.id;
  el.type = 'button';
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  canvas.className = 'thumb';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = p.label;
  el.append(canvas, name);
  el.addEventListener('click', () => applyPreset(p.id));
  if (deletable) {
    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Sil';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      userPresets = userPresets.filter((x) => x.id !== p.id);
      localStorage.setItem(LS_PRESETS, JSON.stringify(userPresets));
      renderUserPresets();
      toast('Filtre silindi');
    });
    el.appendChild(del);
  }
  return el;
}

function applyPreset(id) {
  store.transact('filtre', (s) => {
    s.presetId = id;
    s.presetStrength = 100;
  });
  syncAll();
  scheduleRender();
}

function thumbTransform() {
  const t = defaultTransform();
  const w = engine.srcW;
  const h = engine.srcH;
  if (w > h) {
    const cw = h / w;
    t.crop = { x: (1 - cw) / 2, y: 0, w: cw, h: 1 };
  } else {
    const ch = w / h;
    t.crop = { x: 0, y: (1 - ch) / 2, w: 1, h: ch };
  }
  return t;
}

let thumbJob = 0;
function renderPresetThumbs() {
  if (!engine || !imageInfo) return;
  const job = ++thumbJob;
  const tr = thumbTransform();
  const all = [...PRESETS, ...userPresets];
  let i = 0;

  const step = () => {
    if (job !== thumbJob) return;
    const t0 = performance.now();
    while (i < all.length && performance.now() - t0 < 12) {
      const p = all[i++];
      const card = document.querySelector(`.preset[data-preset="${p.id}"] canvas`);
      if (!card) continue;
      const params = { ...defaultParams(), ...p.params };
      const out = engine.process(toUniforms(params, { curveOn: false }), tr, 96, 96, 'thumb');
      if (!out) continue;
      const gl = engine.gl;
      const px = new Uint8ClampedArray(96 * 96 * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
      gl.readPixels(0, 0, 96, 96, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      card.getContext('2d').putImageData(new ImageData(px, 96, 96), 0, 0);
    }
    if (i < all.length) requestAnimationFrame(step);
    else scheduleRender();
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------ kırpma */

let cropTool = null;

function buildAspectRow() {
  const row = $('aspectRow');
  row.innerHTML = '';
  for (const a of ASPECTS) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (a.id === 'free' ? ' active' : '');
    chip.textContent = a.label;
    chip.dataset.aspect = a.id;
    chip.addEventListener('click', () => {
      row.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      let val = a.value;
      if (val === 'orig') val = imageInfo ? imageInfo.width / imageInfo.height : 1;
      store.begin();
      cropTool.setAspect(val);
      store.get().transform.crop = cropTool.getRect();
      store.commit('oran');
      scheduleRender();
    });
    row.appendChild(chip);
  }
}

function enterCropMode() {
  if (!imageInfo) return;
  cropMode = true;
  resetZoom();
  const st = store.get();
  const size = engine.outputSize({ ...st.transform, crop: { x: 0, y: 0, w: 1, h: 1 } });
  cropTool.setBBoxAspect(size.w / size.h);
  cropTool.setRect(st.transform.crop);
  $('cropOverlay').classList.remove('hidden');
  scheduleRender();
}

function exitCropMode() {
  if (!cropMode) return;
  cropMode = false;
  $('cropOverlay').classList.add('hidden');
  scheduleRender();
}

/* --------------------------------------------------------------- eğriler */

let curveEditor = null;

function buildCurvePresets() {
  const row = $('curvePresets');
  row.innerHTML = '';
  for (const [key, cp] of Object.entries(CURVE_PRESETS)) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = cp.label;
    chip.addEventListener('click', () => {
      store.transact('eğri', (s) => {
        s.curves[curveEditor.channel] = cp.points.map((p) => ({ ...p }));
      });
      curveEditor.setPoints(store.get().curves[curveEditor.channel]);
      scheduleRender();
    });
    row.appendChild(chip);
  }
}

/* ---------------------------------------------------- otomatik iyileştirme */

function autoEnhance() {
  if (!engine || !imageInfo) return;
  const st = store.get();
  const sample = engine.samplePixels(
    toUniforms(defaultParams(), { curveOn: false }),
    { ...st.transform },
    200
  );
  if (!sample) return;
  const h = computeHistogram(sample.pixels);
  const total = h.total || 1;

  const percentile = (arr, p) => {
    let acc = 0;
    const target = total * p;
    for (let i = 0; i < 256; i++) {
      acc += arr[i];
      if (acc >= target) return i;
    }
    return 255;
  };
  const lo = percentile(h.l, 0.004);
  const hi = percentile(h.l, 0.996);
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += h.l[i] * i;
  const mean = sum / total;

  const clampV = (v, a, b) => Math.max(a, Math.min(b, v));
  const spread = hi - lo;

  const patch = {
    exposure: clampV(Math.round((118 - mean) * 0.34), -34, 34),
    blacks: clampV(-Math.round((lo / 255) * 62), -40, 0),
    whites: clampV(Math.round(((255 - hi) / 255) * 62), 0, 40),
    contrast: clampV(Math.round((215 - spread) * 0.22), -8, 28),
    vibrance: 14,
    clarity: 8,
    shadows: lo < 12 ? 14 : 4,
    highlights: hi > 250 ? -16 : -4,
  };

  store.transact('otomatik', (s) => {
    for (const [k, v] of Object.entries(patch)) {
      const meta = ADJ_BY_KEY[k];
      const withoutUser = { ...s, user: { ...s.user } };
      delete withoutUser.user[k];
      const base = effectiveParams(withoutUser)[k] ?? meta.def;
      s.user[k] = meta.def + (v - base);
    }
  });
  syncAll();
  scheduleRender();
  toast('Otomatik iyileştirme uygulandı');
}

/* -------------------------------------------------------------- dışa aktar */

let exportBusy = false;

/** Tam çözünürlüklü birleştirme: GL çıktısı + çerçeve + metin katmanları. */
function composeFullSize(maxSide = 0) {
  const state = store.get();
  const data = engine.renderToImageData(currentUniforms(state), state.transform, maxSide);
  if (!data) throw new Error('Görüntü işlenemedi.');
  const imgCanvas = ex.imageDataToCanvas(data);

  const frame = state.frame || ov.defaultFrame();
  const overlays = state.overlays || [];
  const m = ov.frameMetrics(frame, data.width, data.height);
  if (frame.type === 'none' && !overlays.length) return imgCanvas;

  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(m.w));
  out.height = Math.max(1, Math.round(m.h));
  const ctx = out.getContext('2d');
  const box = ov.drawFramedImage(ctx, imgCanvas, frame, data.width, data.height);
  ov.drawOverlays(ctx, overlays, box);
  return out;
}

async function buildExportBlob() {
  const fmt = $('expFormat').value;
  const quality = Number($('expQuality').value) / 100;
  const maxSide = Number($('expSize').value);
  let canvas = composeFullSize(maxSide);
  if (fmt === 'image/jpeg') canvas = ex.flatten(canvas, '#ffffff');
  const blob = await ex.canvasToBlob(canvas, fmt, fmt === 'image/png' ? undefined : quality);
  return { blob, width: canvas.width, height: canvas.height };
}

async function updateExportMeta() {
  const state = store.get();
  const maxSide = Number($('expSize').value);
  const size = engine ? engine.outputSize(state.transform) : { w: 0, h: 0 };
  let w = size.w;
  let h = size.h;
  if (maxSide > 0 && Math.max(w, h) > maxSide) {
    const k = maxSide / Math.max(w, h);
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  const m = ov.frameMetrics(state.frame, w, h);
  const n = (state.overlays || []).length;
  $('expMeta').textContent =
    `${Math.round(m.w)} × ${Math.round(m.h)} piksel` + (n ? ` · ${n} katman` : '');
}

function saveExportPrefs() {
  localStorage.setItem(LS_EXPORT, JSON.stringify({
    format: $('expFormat').value,
    quality: $('expQuality').value,
    size: $('expSize').value,
  }));
}

async function doExport(mode) {
  if (exportBusy) return;
  if (!imageInfo) { toast('Önce bir fotoğraf aç.', true); return; }
  exportBusy = true;
  const btn = $('btnDoExport');
  const old = btn.textContent;
  btn.textContent = 'Hazırlanıyor…';
  try {
    const { blob } = await buildExportBlob();
    const fmt = ex.FORMATS.find((f) => f.id === $('expFormat').value) || ex.FORMATS[0];
    const name = ex.buildFileName($('expName').value, fmt.ext);
    if (mode === 'share' && ex.canShare(blob, name)) {
      await ex.shareBlob(blob, name);
    } else if (mode === 'clipboard') {
      await ex.copyBlobToClipboard(blob);
      toast('Panoya kopyalandı');
    } else {
      ex.downloadBlob(blob, name);
      toast(`Kaydedildi · ${ex.formatBytes(blob.size)}`);
    }
    saveExportPrefs();
    if (mode !== 'clipboard') $('exportDialog').close();
  } catch (err) {
    console.error(err);
    if (err.name !== 'AbortError') toast('Kaydedilemedi: ' + err.message, true);
  } finally {
    btn.textContent = old;
    exportBusy = false;
  }
}

/* ------------------------------------------------- metin / çıkartma paneli */

const OVERLAY_SLIDERS = [
  { key: 'size', label: 'Boyut', min: 1, max: 60, step: 0.5 },
  { key: 'rotation', label: 'Döndürme', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'opacity', label: 'Opaklık', min: 0, max: 100 },
  { key: 'letterSpacing', label: 'Harf Aralığı', min: -10, max: 60 },
  { key: 'shadow', label: 'Gölge', min: 0, max: 100 },
  { key: 'stroke', label: 'Kontur', min: 0, max: 100 },
  { key: 'bg', label: 'Arka Plan', min: 0, max: 100 },
];

const FRAME_SLIDERS = [
  { key: 'size', label: 'Kalınlık', min: 0, max: 20, step: 0.5, only: ['kenarlik', 'polaroid', 'ince'] },
  { key: 'radius', label: 'Köşe Yuvarlaklığı', min: 0, max: 50, only: ['yuvarlak'] },
];

/** Genel amaçlı kaydırıcı: değeri bir nesneden okur/yazar. */
function propSlider(spec, get, set, onCommit) {
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  wrap.dataset.prop = spec.key;
  const head = document.createElement('div');
  head.className = 'slider-head';
  const label = document.createElement('label');
  label.textContent = spec.label;
  const out = document.createElement('output');
  head.append(label, out);
  const range = document.createElement('input');
  range.type = 'range';
  range.min = spec.min;
  range.max = spec.max;
  range.step = spec.step || 1;

  const refresh = () => {
    const v = get();
    range.value = v;
    out.textContent = (Math.round(v * 10) / 10) + (spec.unit || '');
  };
  range.addEventListener('pointerdown', () => store.begin());
  range.addEventListener('input', () => {
    set(Number(range.value));
    out.textContent = (Math.round(Number(range.value) * 10) / 10) + (spec.unit || '');
    scheduleRender();
  });
  const commit = () => { store.commit(spec.label); onCommit?.(); };
  range.addEventListener('change', commit);
  range.addEventListener('pointerup', commit);
  wrap.append(head, range);
  wrap.refresh = refresh;
  refresh();
  return wrap;
}

function colorField(label, get, set) {
  const el = document.createElement('label');
  el.className = 'color-field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'color';
  input.value = get();
  input.addEventListener('input', () => { set(input.value); scheduleRender(); });
  input.addEventListener('change', () => { store.begin(); set(input.value); store.commit(label); });
  el.append(input, span);
  el.refresh = () => { input.value = get(); };
  return el;
}

function selectedOverlay() {
  return (store.get().overlays || []).find((o) => o.id === selectedOverlayId) || null;
}

function buildTextPanel() {
  // Çıkartmalar
  const row = $('stickerRow');
  row.innerHTML = '';
  for (const s of ov.STICKERS) {
    const b = document.createElement('button');
    b.className = 'sticker';
    b.type = 'button';
    b.textContent = s;
    b.addEventListener('click', () => addOverlay(ov.newSticker(s)));
    row.appendChild(b);
  }

  // Yazı tipleri
  const fr = $('ovFontRow');
  fr.innerHTML = '';
  for (const f of ov.FONTS) {
    const c = document.createElement('button');
    c.className = 'chip';
    c.dataset.font = f.id;
    c.textContent = f.label;
    c.style.fontFamily = f.css;
    c.addEventListener('click', () => {
      const o = selectedOverlay();
      if (!o) return;
      store.transact('yazı tipi', () => { o.font = f.id; });
      refreshTextPanel();
      scheduleRender();
    });
    fr.appendChild(c);
  }
  const boldChip = document.createElement('button');
  boldChip.className = 'chip';
  boldChip.id = 'ovBold';
  boldChip.textContent = 'Kalın';
  boldChip.style.fontWeight = '700';
  boldChip.addEventListener('click', () => {
    const o = selectedOverlay();
    if (!o) return;
    store.transact('kalın', () => { o.bold = !o.bold; });
    refreshTextPanel();
    scheduleRender();
  });
  fr.appendChild(boldChip);

  // Katman kaydırıcıları
  const sl = $('ovSliders');
  sl.innerHTML = '';
  for (const spec of OVERLAY_SLIDERS) {
    sl.appendChild(propSlider(spec,
      () => selectedOverlay()?.[spec.key] ?? spec.min,
      (v) => { const o = selectedOverlay(); if (o) o[spec.key] = v; }));
  }

  const cols = $('ovColors');
  cols.innerHTML = '';
  cols.append(
    colorField('Renk', () => selectedOverlay()?.color || '#ffffff', (v) => { const o = selectedOverlay(); if (o) o.color = v; }),
    colorField('Kontur', () => selectedOverlay()?.strokeColor || '#000000', (v) => { const o = selectedOverlay(); if (o) o.strokeColor = v; }),
    colorField('Zemin', () => selectedOverlay()?.bgColor || '#000000', (v) => { const o = selectedOverlay(); if (o) o.bgColor = v; }),
  );

  $('ovText').addEventListener('input', (e) => {
    const o = selectedOverlay();
    if (!o) return;
    o.text = e.target.value;
    refreshLayerList();
    scheduleRender();
  });
  $('ovText').addEventListener('focus', () => store.begin());
  $('ovText').addEventListener('blur', () => store.commit('yazı'));

  $('btnAddText').addEventListener('click', () => addOverlay(ov.newText('Yeni metin')));
  $('btnAddWatermark').addEventListener('click', () => {
    const o = ov.newText('© ' + new Date().getFullYear());
    o.x = 0.86; o.y = 0.94; o.size = 3.4; o.opacity = 70; o.bold = false; o.shadow = 40;
    addOverlay(o);
  });
  $('btnLayerDel').addEventListener('click', () => removeOverlay(selectedOverlayId));
  $('btnLayerDup').addEventListener('click', () => {
    const o = selectedOverlay();
    if (!o) return;
    const copy = { ...o, id: 'o' + Date.now().toString(36), x: Math.min(0.95, o.x + 0.04), y: Math.min(0.95, o.y + 0.04) };
    addOverlay(copy);
  });

  // Çerçeveler
  const frow = $('frameRow');
  frow.innerHTML = '';
  for (const f of ov.FRAMES) {
    const c = document.createElement('button');
    c.className = 'chip';
    c.dataset.frame = f.id;
    c.textContent = f.label;
    c.addEventListener('click', () => {
      store.transact('çerçeve', (s) => { s.frame = { ...s.frame, type: f.id }; });
      refreshTextPanel();
      scheduleRender();
    });
    frow.appendChild(c);
  }
  const fsl = $('frameSliders');
  fsl.innerHTML = '';
  for (const spec of FRAME_SLIDERS) {
    const el = propSlider(spec,
      () => store.get().frame?.[spec.key] ?? spec.min,
      (v) => { store.get().frame[spec.key] = v; });
    el.dataset.only = (spec.only || []).join(',');
    fsl.appendChild(el);
  }
  const fcol = $('frameColors');
  fcol.innerHTML = '';
  fcol.appendChild(colorField('Çerçeve rengi',
    () => store.get().frame?.color || '#ffffff',
    (v) => { store.get().frame.color = v; }));
}

function addOverlay(o) {
  if (!imageInfo) { toast('Önce bir fotoğraf aç.', true); return; }
  store.transact('katman ekle', (s) => { s.overlays = [...(s.overlays || []), o]; });
  selectedOverlayId = o.id;
  setTab('text');
  refreshTextPanel();
  scheduleRender();
}

function removeOverlay(id) {
  if (!id) return;
  store.transact('katman sil', (s) => { s.overlays = (s.overlays || []).filter((o) => o.id !== id); });
  if (selectedOverlayId === id) selectedOverlayId = null;
  refreshTextPanel();
  scheduleRender();
}

function refreshLayerList() {
  const host = $('layerList');
  const list = store.get().overlays || [];
  host.innerHTML = '';
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    const row = document.createElement('div');
    row.className = 'layer-row' + (o.id === selectedOverlayId ? ' active' : '');
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = (o.kind === 'sticker' ? '' : '🅣 ') + String(o.text).replace(/\n/g, ' ').slice(0, 28);
    const up = document.createElement('button');
    up.className = 'mv';
    up.textContent = '▲';
    up.title = 'Öne getir';
    up.addEventListener('click', (e) => { e.stopPropagation(); moveOverlay(o.id, 1); });
    const down = document.createElement('button');
    down.className = 'mv';
    down.textContent = '▼';
    down.title = 'Arkaya gönder';
    down.addEventListener('click', (e) => { e.stopPropagation(); moveOverlay(o.id, -1); });
    const del = document.createElement('button');
    del.className = 'mv';
    del.textContent = '×';
    del.title = 'Sil';
    del.addEventListener('click', (e) => { e.stopPropagation(); removeOverlay(o.id); });
    row.append(txt, up, down, del);
    row.addEventListener('click', () => {
      selectedOverlayId = o.id;
      refreshTextPanel();
      scheduleRender();
    });
    host.appendChild(row);
  }
  $('layerHint').hidden = list.length > 0;
}

function moveOverlay(id, dir) {
  store.transact('sırala', (s) => {
    const list = s.overlays;
    const i = list.findIndex((o) => o.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  });
  refreshLayerList();
  scheduleRender();
}

function refreshTextPanel() {
  refreshLayerList();
  const o = selectedOverlay();
  $('overlayEditor').hidden = !o;
  if (o) {
    if ($('ovText').value !== o.text) $('ovText').value = o.text;
    $('ovFontRow').querySelectorAll('[data-font]').forEach((c) =>
      c.classList.toggle('active', c.dataset.font === o.font));
    $('ovBold').classList.toggle('active', !!o.bold);
    $('ovSliders').querySelectorAll('.slider').forEach((s) => s.refresh?.());
    $('ovColors').querySelectorAll('.color-field').forEach((s) => s.refresh?.());
  }
  const frame = store.get().frame || ov.defaultFrame();
  $('frameRow').querySelectorAll('[data-frame]').forEach((c) =>
    c.classList.toggle('active', c.dataset.frame === frame.type));
  $('frameSliders').querySelectorAll('.slider').forEach((s) => {
    const only = (s.dataset.only || '').split(',').filter(Boolean);
    s.hidden = only.length > 0 && !only.includes(frame.type);
    s.refresh?.();
  });
  $('frameColors').hidden = frame.type === 'none' || frame.type === 'yuvarlak';
  $('frameColors').querySelectorAll('.color-field').forEach((s) => s.refresh?.());
}

/** Önizleme üzerinde katman taşıma / ölçekleme / döndürme. */
function bindOverlayEditing() {
  const cv = $('view');
  let drag = null;

  const toCanvas = (e) => {
    const r = cv.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * cv.width,
      y: ((e.clientY - r.top) / r.height) * cv.height,
    };
  };

  cv.addEventListener('pointerdown', (e) => {
    if (currentTab !== 'text' || !imageInfo || cropMode) return;
    const ctx = cv.getContext('2d');
    const p = toCanvas(e);
    const sel = selectedOverlay();

    // Önce seçili katmanın tutamacı
    if (sel) {
      const s = ov.selectionGeometry(ctx, sel, previewBox);
      const h = ov.handlePoint(sel, s);
      if (Math.hypot(p.x - h.x, p.y - h.y) < 22) {
        e.preventDefault();
        e.stopPropagation();
        cv.setPointerCapture?.(e.pointerId);
        store.begin();
        drag = {
          mode: 'scale',
          o: sel,
          startSize: sel.size,
          startRot: sel.rotation,
          startAngle: Math.atan2(p.y - s.cy, p.x - s.cx),
          startDist: Math.max(6, Math.hypot(p.x - s.cx, p.y - s.cy)),
        };
        scheduleRender();
        return;
      }
    }

    const hit = ov.pickOverlay(ctx, store.get().overlays || [], previewBox, p.x, p.y);
    if (!hit) {
      if (selectedOverlayId) { selectedOverlayId = null; refreshTextPanel(); scheduleRender(); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    cv.setPointerCapture?.(e.pointerId);
    selectedOverlayId = hit.overlay.id;
    refreshTextPanel();
    store.begin();
    drag = {
      mode: 'move',
      o: hit.overlay,
      startX: hit.overlay.x,
      startY: hit.overlay.y,
      px: p.x,
      py: p.y,
    };
    scheduleRender();
  }, true);

  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.preventDefault();
    const p = toCanvas(e);
    if (drag.mode === 'move') {
      drag.o.x = Math.max(-0.2, Math.min(1.2, drag.startX + (p.x - drag.px) / previewBox.w));
      drag.o.y = Math.max(-0.2, Math.min(1.2, drag.startY + (p.y - drag.py) / previewBox.h));
    } else {
      const cx = previewBox.x + drag.o.x * previewBox.w;
      const cy = previewBox.y + drag.o.y * previewBox.h;
      const dist = Math.max(6, Math.hypot(p.x - cx, p.y - cy));
      const angle = Math.atan2(p.y - cy, p.x - cx);
      drag.o.size = Math.max(1, Math.min(60, drag.startSize * (dist / drag.startDist)));
      drag.o.rotation = Math.round(
        ((drag.startRot + ((angle - drag.startAngle) * 180) / Math.PI + 540) % 360) - 180
      );
    }
    scheduleRender();
  }, true);

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    store.commit('katman');
    refreshTextPanel();
  };
  cv.addEventListener('pointerup', endDrag, true);
  cv.addEventListener('pointercancel', endDrag, true);
}

/* ----------------------------------------------- yakınlaştırma etkileşimi */

function bindZoomPan() {
  const canvas = $('view');
  const wrap = $('canvasWrap');
  const pointers = new Map();
  let panStart = null;
  let pinchStart = null;

  const anchorFrom = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      u: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      v: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
      w: r.width,
      h: r.height,
    };
  };

  canvas.addEventListener('wheel', (e) => {
    if (!imageInfo || cropMode) return;
    e.preventDefault();
    const a = anchorFrom(e);
    const factor = Math.exp(-e.deltaY * 0.0016);
    setZoom(view.zoom * factor, a.u, a.v);
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    if (!imageInfo || cropMode) return;
    const a = anchorFrom(e);
    if (view.zoom > 1.001) { resetZoom(); scheduleRender(); }
    else setZoom(2.5, a.u, a.v);
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (!imageInfo || cropMode) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const r = canvas.getBoundingClientRect();
      pinchStart = {
        dist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
        zoom: view.zoom,
        u: Math.max(0, Math.min(1, ((p1.x + p2.x) / 2 - r.left) / r.width)),
        v: Math.max(0, Math.min(1, ((p1.y + p2.y) / 2 - r.top) / r.height)),
      };
      panStart = null;
    } else if (view.zoom > 1.001) {
      panStart = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY };
      wrap.classList.add('grabbing');
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchStart && pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (pinchStart.dist > 4) {
        setZoom(pinchStart.zoom * (dist / pinchStart.dist), pinchStart.u, pinchStart.v);
      }
      return;
    }
    if (panStart) {
      const r = canvas.getBoundingClientRect();
      view.panX = panStart.panX - (e.clientX - panStart.x) / (view.zoom * r.width);
      view.panY = panStart.panY - (e.clientY - panStart.y) / (view.zoom * r.height);
      clampPan();
      scheduleRender();
    }
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) { panStart = null; wrap.classList.remove('grabbing'); }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);

  $('btnZoomReset').addEventListener('click', () => { resetZoom(); scheduleRender(); });
}

/* ------------------------------------------------------------------ bilgi */

function updateInfoList() {
  const list = $('infoList');
  if (!imageInfo) {
    list.innerHTML = '<dt>Durum</dt><dd>Fotoğraf yok</dd>';
    return;
  }
  const st = store.get();
  const out = engine.outputSize(st.transform);
  const rows = [
    ['Dosya', imageInfo.name],
    ['Kaynak', `${imageInfo.srcWidth} × ${imageInfo.srcHeight}`],
    ['Çıktı', `${out.w} × ${out.h}`],
    ['Boyut', imageInfo.size ? ex.formatBytes(imageInfo.size) : '—'],
    ['Tür', imageInfo.type.replace('image/', '').toUpperCase()],
    ['Döndürme', `${(st.transform.rotate90 * 90 + st.transform.angle).toFixed(1)}°`],
  ];
  list.innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd title="${String(v).replace(/"/g, '')}">${v}</dd>`)
    .join('');
}

/* ------------------------------------------------------------------ toast */

let toastTimer = 0;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  el.classList.toggle('err', isError);
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 220);
  }, isError ? 3600 : 1900);
}

let hudTimer = 0;
function showHud() {
  const hud = $('stageHud');
  hud.classList.add('show');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => hud.classList.remove('show'), 1800);
}

/* ------------------------------------------------------------------ sekme */

function setTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tabpage').forEach((p) => p.classList.toggle('active', p.dataset.page === name));
  if (name === 'crop') enterCropMode();
  else exitCropMode();
  if (name === 'adjust' || name === 'curve') updateHistogram();
  if (name === 'curve') curveEditor?.draw();
  if (name !== 'text') selectedOverlayId = null;
  scheduleRender();
}

/* ------------------------------------------------------------------- init */

function init() {
  // GL ekran dışı bir tuvale çizer; görünen tuval 2B birleştirmeyi yapar.
  try {
    engine = new Engine(document.createElement('canvas'));
  } catch (err) {
    document.body.innerHTML =
      `<div style="padding:40px;font:16px system-ui;color:#e8ecf5;background:#0b0d12;height:100vh">
       <h1>WebGL bulunamadı</h1><p>${err.message}</p>
       <p>Tarayıcı ayarlarından donanım hızlandırmayı açman gerekiyor.</p></div>`;
    return;
  }
  engine.setCurveLUT(buildLUT(defaultCurves()));

  userPresets = JSON.parse(localStorage.getItem(LS_PRESETS) || '[]');

  buildAdjustPanel();
  renderPresetGrid();
  buildCurvePresets();
  buildAspectRow();
  buildTextPanel();
  bindOverlayEditing();

  curveEditor = new CurveEditor($('curveCanvas'), {
    onBegin: () => store.begin(),
    onChange: (pts) => {
      store.get().curves[curveEditor.channel] = pts;
      scheduleRender();
    },
    onEnd: () => store.commit('eğri'),
  });

  bindZoomPan();

  cropTool = new CropTool($('cropOverlay'), {
    onBegin: () => store.begin(),
    onChange: (r) => {
      store.get().transform.crop = r;
      updateInfoList();
    },
    onEnd: () => { store.commit('kırpma'); syncAll(); },
  });

  // Sekmeler
  $('tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) setTab(t.dataset.tab);
  });

  // Kanal seçimi
  $('curveChannels').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    $('curveChannels').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    curveEditor.setChannel(c.dataset.ch);
    curveEditor.setPoints(store.get().curves[c.dataset.ch]);
  });

  // Dosya açma
  $('btnOpen').addEventListener('click', () => $('fileInput').click());
  $('dzPick').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    if (e.target.files?.[0]) loadFile(e.target.files[0]);
    e.target.value = '';
  });

  // Sürükle-bırak
  const dz = $('stage');
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      $('dropzone').classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      $('dropzone').classList.remove('drag');
    })
  );
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) loadFile(f);
  });

  // Panodan yapıştır
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        loadFile(it.getAsFile());
        break;
      }
    }
  });

  // Geçmiş
  $('btnUndo').addEventListener('click', () => { store.undo(); syncAll(); scheduleRender(); });
  $('btnRedo').addEventListener('click', () => { store.redo(); syncAll(); scheduleRender(); });
  $('btnReset').addEventListener('click', () => {
    if (!imageInfo) return;
    store.replace(freshState(), 'sıfırla');
    cropTool.reset();
    syncAll();
    scheduleRender();
    toast('Tüm ayarlar sıfırlandı');
  });
  $('btnResetAdjust').addEventListener('click', () => {
    store.transact('ayarları sıfırla', (s) => { s.user = {}; s.presetId = 'none'; });
    syncAll();
    scheduleRender();
  });
  $('btnAuto').addEventListener('click', autoEnhance);

  // Karşılaştırma
  const cmpOn = () => {
    if (!imageInfo || compareMode) return;
    compareMode = true;
    $('compareBadge').classList.remove('hidden');
    scheduleRender();
  };
  const cmpOff = () => {
    if (!compareMode) return;
    compareMode = false;
    $('compareBadge').classList.add('hidden');
    scheduleRender();
  };
  const cmpBtn = $('btnCompare');
  cmpBtn.addEventListener('pointerdown', cmpOn);
  cmpBtn.addEventListener('pointerup', cmpOff);
  cmpBtn.addEventListener('pointerleave', cmpOff);
  cmpBtn.addEventListener('pointercancel', cmpOff);

  // Preset şiddeti
  $('presetStrength').addEventListener('pointerdown', () => store.begin());
  $('presetStrength').addEventListener('input', (e) => {
    store.get().presetStrength = Number(e.target.value);
    $('presetStrengthOut').textContent = e.target.value;
    syncSlidersOnly();
    scheduleRender();
  });
  $('presetStrength').addEventListener('change', () => store.commit('şiddet'));

  // Kırpma araçları
  $('btnRotL').addEventListener('click', () => rotate90(-1));
  $('btnRotR').addEventListener('click', () => rotate90(1));
  $('btnFlipX').addEventListener('click', () => flip('x'));
  $('btnFlipY').addEventListener('click', () => flip('y'));
  $('btnCropReset').addEventListener('click', () => {
    store.transact('kırpma sıfırla', (s) => {
      s.transform.crop = { x: 0, y: 0, w: 1, h: 1 };
      s.transform.angle = 0;
    });
    cropTool.reset();
    $('aspectRow').querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('active', i === 0));
    syncAll();
    scheduleRender();
  });
  $('btnCropApply').addEventListener('click', () => setTab('filters'));

  const angleRange = $('angleRange');
  angleRange.addEventListener('pointerdown', () => store.begin());
  angleRange.addEventListener('input', () => {
    const a = Number(angleRange.value);
    const s = store.get();
    s.transform.angle = a;
    $('angleOut').textContent = a.toFixed(1) + '°';
    fitCropInside();
    cropTool.setRect(s.transform.crop);
    scheduleRender();
  });
  angleRange.addEventListener('change', () => { store.commit('düzeltme'); syncAll(); });

  // Kaydetme
  $('btnSave').addEventListener('click', openExport);
  $('btnDoExport').addEventListener('click', () => doExport('download'));
  $('btnShare').addEventListener('click', () => doExport('share'));
  $('btnCopyClip').addEventListener('click', () => doExport('clipboard'));
  $('expQuality').addEventListener('input', (e) => { $('expQualityOut').textContent = e.target.value; });
  $('expFormat').addEventListener('change', () => {
    const f = ex.FORMATS.find((x) => x.id === $('expFormat').value);
    $('qualityField').hidden = !f?.quality;
    updateExportMeta();
  });
  $('expSize').addEventListener('change', updateExportMeta);

  // Kullanıcı filtresi kaydetme
  $('btnSavePreset').addEventListener('click', () => {
    if (!imageInfo) { toast('Önce bir fotoğraf aç.', true); return; }
    $('presetName').value = '';
    $('presetDialog').showModal();
    setTimeout(() => $('presetName').focus(), 50);
  });
  $('btnPresetSave').addEventListener('click', () => {
    const name = ($('presetName').value || '').trim();
    if (!name) { toast('Bir isim yaz.', true); return; }
    const eff = effectiveParams();
    const params = {};
    for (const a of ADJUSTMENTS) if (Math.abs(eff[a.key] - a.def) > 0.001) params[a.key] = Math.round(eff[a.key] * 10) / 10;
    for (const t of TOGGLES) if (eff[t.key]) params[t.key] = 1;
    userPresets.push({ id: 'u' + Date.now().toString(36), label: name, params });
    localStorage.setItem(LS_PRESETS, JSON.stringify(userPresets));
    renderUserPresets();
    $('presetDialog').close();
    toast('Filtre kaydedildi');
  });

  // Klavye
  window.addEventListener('keydown', (e) => {
    const typing = /input|textarea|select/i.test(e.target.tagName);
    if (typing && e.key !== 'Escape') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo(); else store.undo();
      syncAll();
      scheduleRender();
      return;
    }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); openExport(); return; }
    if (mod) return;
    switch (e.key.toLowerCase()) {
      case 'o': e.preventDefault(); $('fileInput').click(); break;
      case 'c': cmpOn(); break;
      case 'r': rotate90(1); break;
      case '1': setTab('filters'); break;
      case '2': setTab('adjust'); break;
      case '3': setTab('crop'); break;
      case '4': setTab('curve'); break;
      case '5': setTab('text'); break;
      case '6': setTab('info'); break;
      case 'delete': case 'backspace':
        if (selectedOverlayId) { e.preventDefault(); removeOverlay(selectedOverlayId); }
        break;
      case '0': resetZoom(); scheduleRender(); break;
      case '+': case '=': setZoom(view.zoom * 1.4); break;
      case '-': setZoom(view.zoom / 1.4); break;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'c') cmpOff();
  });

  // Yeniden boyutlandırma
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { scheduleRender(); }, 80);
  });

  // Kurulum istemi
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('btnInstall').hidden = false;
  });
  $('btnInstall').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('btnInstall').hidden = true;
  });

  // Dışa aktarım tercihleri
  const fmtSel = $('expFormat');
  fmtSel.innerHTML = ex.FORMATS.map((f) => `<option value="${f.id}">${f.label}</option>`).join('');
  const prefs = JSON.parse(localStorage.getItem(LS_EXPORT) || '{}');
  if (prefs.format) fmtSel.value = prefs.format;
  if (prefs.quality) { $('expQuality').value = prefs.quality; $('expQualityOut').textContent = prefs.quality; }
  if (prefs.size) $('expSize').value = prefs.size;
  $('qualityField').hidden = !(ex.FORMATS.find((x) => x.id === fmtSel.value)?.quality);

  syncAll();
  updateInfoList();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Otomatik testin ve hata ayıklamanın tutunacağı yüzey
  window.FS = {
    store,
    get engine() { return engine; },
    get imageInfo() { return imageInfo; },
    get cropMode() { return cropMode; },
    loadFile,
    effectiveParams,
    currentUniforms,
    doRender,
    setTab,
    applyPreset,
    buildExportBlob,
    autoEnhance,
    rotate90,
    flip,
    setEffective,
    freshState,
    addOverlay,
    removeOverlay,
    composeFullSize,
    get previewBox() { return previewBox; },
    get selectedOverlayId() { return selectedOverlayId; },
    set selectedOverlayId(v) { selectedOverlayId = v; },
    view,
    setZoom,
    resetZoom,
    applyView,
    ready: true,
  };
  window.dispatchEvent(new Event('fs-ready'));
}

function syncSlidersOnly() {
  const eff = effectiveParams();
  for (const a of ADJUSTMENTS) {
    const wrap = document.querySelector(`.slider[data-key="${a.key}"]`);
    if (!wrap || a.kind === 'artmode') continue;
    wrap.querySelector('input').value = eff[a.key];
    wrap.querySelector('output').textContent = formatVal(a, eff[a.key]);
    wrap.classList.toggle('changed', Math.abs(eff[a.key] - a.def) > 0.001);
  }
  updateGroupBadges();
}

function openExport() {
  if (!imageInfo) { toast('Önce bir fotoğraf aç.', true); return; }
  updateExportMeta();
  const dummy = new Blob([''], { type: 'image/jpeg' });
  $('btnShare').hidden = !(navigator.canShare && navigator.share && ex.canShare(dummy, 'a.jpg'));
  $('exportDialog').showModal();
}

function rotate90(dir) {
  if (!imageInfo) return;
  store.transact('döndür', (s) => {
    s.transform.rotate90 = (((s.transform.rotate90 + dir) % 4) + 4) % 4;
    const r = s.transform.crop;
    s.transform.crop = dir > 0
      ? { x: 1 - (r.y + r.h), y: r.x, w: r.h, h: r.w }
      : { x: r.y, y: 1 - (r.x + r.w), w: r.h, h: r.w };
  });
  const size = engine.outputSize({ ...store.get().transform, crop: { x: 0, y: 0, w: 1, h: 1 } });
  cropTool.setBBoxAspect(size.w / size.h);
  cropTool.setRect(store.get().transform.crop);
  syncAll();
  scheduleRender();
}

function flip(axis) {
  if (!imageInfo) return;
  store.transact('çevir', (s) => {
    // 90°'lik dönüşlerde kullanıcının gördüğü eksen yer değiştirir
    const swapped = s.transform.rotate90 % 2 === 1;
    const key = (axis === 'x') === !swapped ? 'flipX' : 'flipY';
    s.transform[key] = !s.transform[key];
    const r = s.transform.crop;
    if (axis === 'x') s.transform.crop = { ...r, x: 1 - (r.x + r.w) };
    else s.transform.crop = { ...r, y: 1 - (r.y + r.h) };
  });
  cropTool.setRect(store.get().transform.crop);
  syncAll();
  scheduleRender();
}

/** Düzeltme açısından sonra siyah köşeleri dışarıda bırakan en büyük kutuya sığdır. */
function fitCropInside() {
  const s = store.get();
  const a = (s.transform.angle * Math.PI) / 180;
  if (Math.abs(a) < 1e-4) return;
  const w = engine.srcW;
  const h = engine.srcH;
  const rot90 = s.transform.rotate90 % 2 === 1;
  const W = rot90 ? h : w;
  const H = rot90 ? w : h;
  const [rw, rh] = largestInsideRect(W, H, a);
  const ct = Math.abs(Math.cos((s.transform.rotate90 * Math.PI) / 2 + a));
  const st = Math.abs(Math.sin((s.transform.rotate90 * Math.PI) / 2 + a));
  const bw = w * ct + h * st;
  const bh = w * st + h * ct;
  const cw = Math.min(1, rw / bw);
  const ch = Math.min(1, rh / bh);
  s.transform.crop = { x: (1 - cw) / 2, y: (1 - ch) / 2, w: cw, h: ch };
}

/** Döndürülmüş W×H dikdörtgenin içine sığan, aynı orana sahip en büyük dik dörtgen. */
function largestInsideRect(w, h, angle) {
  const sinA = Math.abs(Math.sin(angle));
  const cosA = Math.abs(Math.cos(angle));
  const longSide = Math.max(w, h);
  const shortSide = Math.min(w, h);
  if (shortSide <= 2 * sinA * cosA * longSide || Math.abs(sinA - cosA) < 1e-10) {
    const x = 0.5 * shortSide;
    return w >= h ? [x / sinA, x / cosA] : [x / cosA, x / sinA];
  }
  const cos2a = cosA * cosA - sinA * sinA;
  return [(w * cosA - h * sinA) / cos2a, (h * cosA - w * sinA) / cos2a];
}

document.addEventListener('DOMContentLoaded', init);
