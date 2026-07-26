// Dosya Dönüştürücü — kuyruk, hedef seçimi, ayarlar ve çalıştırma.

import { detect, humanSize, KIND_LABEL } from './detect.js';
import { CONVERTERS, CONVERTER_BY_ID, OPTION_SPECS, targetsFor, UNSUPPORTED_NOTE } from './registry.js';
import { createZip } from './zip.js';

const $ = (id) => document.getElementById(id);
const LS_OPTS = 'donusturucu.opts.v1';

let queue = [];
let selectedId = null;
let results = [];
let busy = false;
let options = JSON.parse(localStorage.getItem(LS_OPTS) || '{}');

const KIND_ICON = {
  image: '🖼', pdf: '📕', docx: '📘', doc: '📘', xlsx: '📗', xls: '📗',
  pptx: '📙', odt: '📄', text: '📄', zip: '🗜', unknown: '❓',
};

/* ------------------------------------------------------------------- kuyruk */

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const added = [];
  for (const f of files) {
    if (f.size > 400 * 1024 * 1024) {
      toast(`${f.name} çok büyük (400 MB üstü).`, true);
      continue;
    }
    try {
      const info = await detect(f);
      info.id = 'f' + Math.random().toString(36).slice(2, 9);
      queue.push(info);
      added.push(info);
    } catch (e) {
      toast(`${f.name} okunamadı: ${e.message}`, true);
    }
  }
  if (added.length) {
    // Karışık türler dönüşümü engeller; kullanıcıya erken haber ver
    render();
    toast(`${added.length} dosya eklendi`);
  }
}

function removeFile(id) {
  queue = queue.filter((f) => f.id !== id);
  render();
}

function clearQueue() {
  queue = [];
  selectedId = null;
  render();
}

/* -------------------------------------------------------------------- çizim */

function render() {
  const has = queue.length > 0;
  $('queuePanel').hidden = !has;
  $('drop').classList.toggle('compact', has);
  $('matrixPanel').hidden = has;
  $('queueCount').textContent = queue.length;

  const list = $('fileList');
  list.innerHTML = '';
  for (const f of queue) {
    const li = document.createElement('li');
    li.className = 'file-row' + (UNSUPPORTED_NOTE[f.kind] ? ' bad' : '');
    li.innerHTML =
      `<span class="file-icon">${KIND_ICON[f.kind] || '📄'}</span>` +
      `<span class="file-main"><span class="file-name"></span>` +
      `<span class="file-meta">${KIND_LABEL[f.kind] || f.kind}` +
      `${f.sub && f.sub !== f.kind ? ' · ' + f.sub.toUpperCase() : ''} · ${humanSize(f.size)}</span></span>` +
      `<button class="x" title="Kaldır">×</button>`;
    li.querySelector('.file-name').textContent = f.name;
    li.querySelector('.x').addEventListener('click', () => removeFile(f.id));
    list.appendChild(li);
  }

  // Türler karışıksa ya da desteklenmiyorsa uyar
  const kinds = [...new Set(queue.map((f) => f.kind))];
  const warn = $('queueWarn');
  const unsupported = kinds.filter((k) => UNSUPPORTED_NOTE[k]);
  if (unsupported.length) {
    warn.hidden = false;
    warn.textContent = unsupported.map((k) => UNSUPPORTED_NOTE[k]).join(' ');
  } else if (kinds.length > 1) {
    warn.hidden = false;
    warn.textContent = 'Kuyrukta farklı türde dosyalar var. Ortak dönüşüm yoksa aynı türden dosyaları ayrı ayrı dönüştür.';
  } else {
    warn.hidden = true;
  }

  renderTargets();
}

function renderTargets() {
  const host = $('targetGroups');
  const list = targetsFor(queue);
  $('targetPanel').hidden = !queue.length;
  host.innerHTML = '';

  if (!list.length) {
    if (queue.length) {
      host.innerHTML = '<p class="hint" style="margin:0">Bu dosya birleşimi için ortak bir dönüşüm yok. Dosyaları tek tür halinde ayırıp yeniden dene.</p>';
    }
    selectedId = null;
    renderOptions();
    return;
  }
  if (!list.some((c) => c.id === selectedId)) selectedId = list[0].id;

  const groups = {};
  for (const c of list) (groups[c.group] ||= []).push(c);

  for (const [group, items] of Object.entries(groups)) {
    const box = document.createElement('div');
    box.className = 'target-group';
    const h = document.createElement('h3');
    h.textContent = group;
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const c of items) {
      const b = document.createElement('button');
      b.className = 'chip' + (c.id === selectedId ? ' active' : '');
      b.textContent = c.label;
      b.addEventListener('click', () => {
        selectedId = c.id;
        renderTargets();
        renderOptions();
      });
      chips.appendChild(b);
    }
    box.append(h, chips);
    host.appendChild(box);
  }
  renderOptions();
}

function optValue(key) {
  const spec = OPTION_SPECS[key];
  return options[key] !== undefined ? options[key] : spec.def;
}

function renderOptions() {
  const conv = CONVERTER_BY_ID[selectedId];
  const body = $('optionsBody');
  body.innerHTML = '';
  const keys = conv?.options || [];
  $('optionsPanel').hidden = !conv || (!keys.length && !conv.note);
  $('actionBar').hidden = !conv;
  $('convNote').textContent = conv?.note || '';

  for (const key of keys) {
    const spec = OPTION_SPECS[key];
    if (!spec) continue;
    const wrap = document.createElement('div');
    wrap.className = 'opt' + (spec.type === 'check' ? ' check' : '');

    if (spec.type === 'check') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'opt-' + key;
      input.checked = optValue(key) !== false;
      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = spec.label;
      input.addEventListener('change', () => setOption(key, input.checked));
      wrap.append(input, label);
    } else if (spec.type === 'select') {
      const label = document.createElement('label');
      label.textContent = spec.label;
      const sel = document.createElement('select');
      for (const [v, t] of spec.choices) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        sel.appendChild(o);
      }
      sel.value = String(optValue(key));
      sel.addEventListener('change', () => setOption(key, sel.value));
      wrap.append(label, sel);
    } else {
      const label = document.createElement('label');
      const out = document.createElement('span');
      out.textContent = optValue(key) + (spec.unit || '');
      label.append(document.createTextNode(spec.label), out);
      const range = document.createElement('input');
      range.type = 'range';
      range.min = spec.min;
      range.max = spec.max;
      range.value = optValue(key);
      range.addEventListener('input', () => {
        out.textContent = range.value + (spec.unit || '');
        setOption(key, Number(range.value));
      });
      wrap.append(label, range);
    }
    body.appendChild(wrap);
  }
}

function setOption(key, value) {
  options[key] = value;
  localStorage.setItem(LS_OPTS, JSON.stringify(options));
}

/* --------------------------------------------------------------- dönüştürme */

async function convert() {
  const conv = CONVERTER_BY_ID[selectedId];
  if (!conv || busy || !queue.length) return;
  busy = true;
  $('btnConvert').disabled = true;
  $('progress').hidden = false;
  setProgress(0, 'Başlıyor…');

  const opts = {};
  for (const key of conv.options || []) opts[key] = optValue(key);

  const t0 = performance.now();
  try {
    const out = await conv.run(queue, opts, (n, total) => {
      setProgress(total ? n / total : 0, `${n} / ${total}`);
    });
    results = out;
    renderResults();
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    toast(`${out.length} dosya hazır · ${secs} sn`);
  } catch (e) {
    console.error(e);
    toast('Dönüştürülemedi: ' + (e.message || e), true);
  } finally {
    busy = false;
    $('btnConvert').disabled = false;
    $('progress').hidden = true;
  }
}

function setProgress(ratio, text) {
  $('progressBar').style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
  $('progressText').textContent = text || '';
}

function renderResults() {
  $('resultPanel').hidden = !results.length;
  $('resultCount').textContent = results.length;
  $('btnDownloadAll').hidden = results.length < 2;
  const list = $('resultList');
  list.innerHTML = '';
  for (const r of results) {
    const li = document.createElement('li');
    li.className = 'file-row';
    li.innerHTML =
      `<span class="file-icon">✓</span>` +
      `<span class="file-main"><span class="file-name"></span>` +
      `<span class="file-meta">${humanSize(r.blob.size)}</span></span>` +
      `<button class="btn tiny">İndir</button>`;
    li.querySelector('.file-name').textContent = r.name;
    li.querySelector('button').addEventListener('click', () => download(r.blob, r.name));
    list.appendChild(li);
  }
  $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function downloadAll() {
  if (results.length < 2) return;
  const entries = await Promise.all(results.map(async (r) => ({
    name: r.name,
    data: new Uint8Array(await r.blob.arrayBuffer()),
    store: /\.(jpg|jpeg|png|webp|pdf|docx|xlsx|zip)$/i.test(r.name),
  })));
  const bytes = await createZip(entries);
  download(new Blob([bytes], { type: 'application/zip' }), 'donusturulen-dosyalar.zip');
}

/* --------------------------------------------------------------------- yardım */

const MATRIX = [
  { icon: '🖼', title: 'Görseller', text: 'PNG, JPEG, WebP, GIF, BMP, AVIF, SVG → PNG / JPEG / WebP / PDF. Boyut küçültme ve kalite ayarı.' },
  { icon: '📕', title: 'PDF → başka biçim', text: 'PNG, JPEG (sayfa sayfa, 72–600 DPI), metin, Word (.docx), Markdown, HTML.' },
  { icon: '🔗', title: 'PDF araçları', text: 'Birden çok PDF\'i birleştir, sayfalara böl, çözünürlük düşürerek küçült.' },
  { icon: '📘', title: 'Word (.docx)', text: 'PDF, metin, Markdown ve HTML\'e çevir. Başlıklar, listeler ve tablolar korunur.' },
  { icon: '📗', title: 'Excel (.xlsx)', text: 'CSV, JSON ve PDF\'e çevir. Çok sayfalı dosyalarda her sayfa ayrı çıktı olur.' },
  { icon: '📄', title: 'Metin ve veri', text: 'TXT, Markdown, HTML, CSV, JSON arası dönüşüm; hepsinden PDF ve Word üretimi.' },
];

function renderMatrix() {
  const grid = $('matrixGrid');
  grid.innerHTML = '';
  for (const m of MATRIX) {
    const el = document.createElement('div');
    el.className = 'matrix-card';
    el.innerHTML = `<h4><span>${m.icon}</span>${m.title}</h4><p>${m.text}</p>`;
    grid.appendChild(el);
  }
}

/* ------------------------------------------------------------------ bildirim */

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
  }, isError ? 5200 : 2200);
}

/* ---------------------------------------------------------------------- init */

function init() {
  renderMatrix();
  render();

  const input = $('fileInput');
  const pick = () => input.click();
  $('btnPick').addEventListener('click', (e) => { e.stopPropagation(); pick(); });
  $('btnAddMore').addEventListener('click', pick);
  $('drop').addEventListener('click', pick);
  input.addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  });

  $('btnClear').addEventListener('click', clearQueue);
  $('btnConvert').addEventListener('click', convert);
  $('btnDownloadAll').addEventListener('click', downloadAll);
  $('btnClearResults').addEventListener('click', () => {
    results = [];
    renderResults();
  });

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) =>
    window.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    window.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'drop' || e.relatedTarget === null) drop.classList.remove('drag');
    }));
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) addFiles(files);
  });

  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    $('btnInstall').hidden = false;
  });
  $('btnInstall').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    $('btnInstall').hidden = true;
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // Otomatik test yüzeyi
  window.DD = {
    get queue() { return queue; },
    get results() { return results; },
    addFiles,
    clearQueue,
    convert,
    setOption,
    select(id) { selectedId = id; renderTargets(); },
    get selectedId() { return selectedId; },
    targetsFor: () => targetsFor(queue).map((c) => c.id),
    CONVERTERS,
    ready: true,
  };
}

document.addEventListener('DOMContentLoaded', init);
