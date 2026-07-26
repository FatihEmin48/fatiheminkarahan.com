// tools/og-images.mjs — proje sayfaları için paylaşım görseli (Open Graph) üretir.
//
// WhatsApp/Twitter/LinkedIn bağlantıyı önizlerken bu görseli gösterir. Canlı
// demosu olan projelerin gerçek ekran görüntüsü alınır; olmayanlar için markalı
// kart çizilir. Çıktı: static/og/<slug>.png (1200x630)
//
//   node tools/og-images.mjs            hepsini üret (var olanları atlar)
//   node tools/og-images.mjs --force    hepsini yeniden üret
//   node tools/og-images.mjs saglik-panel foto-studyo    yalnız seçilenler
//
// Not: Kart HTML olarak kurulup Chrome'da ekran görüntüsü alınır. SVG'ye metin
// gömmek yerine böyle yapılıyor çünkü Türkçe karakterlerin doğru yazı tipiyle
// çizileceği ancak tarayıcıda garanti.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'static', 'og');
const PORT = 5399;
const CDP_PORT = 9420;

const W = 1200;
const H = 630;

/* Uygulamaları "dolu" göstermek için sayfada çalıştırılan hazırlık betikleri.
   Boş bir giriş ekranı ya da boş bırakma alanı, bağlantıyı gören kişiye
   uygulamanın ne yaptığını anlatmıyor — asıl istenen buydu. */

/* Bulut yapılandırması gömülü olduğu için uygulama açılışta giriş soruyor;
   "yalnız bu cihaz" düğmesi onu atlar. Sonra gösterimlik veri BELLEĞE yazılır —
   localStorage'a yazmak işe yaramıyor, çünkü uygulamanın gecikmeli save()'i
   az sonra bellekteki boş durumu üstüne yazıyor. */
const PREP_SAGLIK = `
  for (let i = 0; i < 150; i++) {
    if (!document.getElementById('view-auth').hidden || window.SP?.ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const b = document.getElementById('auth-local');
  if (b && document.getElementById('app').hidden) b.click();
  for (let i = 0; i < 80; i++) {
    if (window.SP?.ready && !document.getElementById('app').hidden) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!window.SP) throw new Error('SP yüzeyi yok');

  const S = window.SP.S;
  const gun = (n) => { const d = new Date(); d.setDate(d.getDate() - n);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };

  [11240, 8430, 12980, 7610, 9950, 14320, 10407].forEach((s, i) => {
    S.state.days[gun(6 - i)] = {
      steps: s, distance_km: +(s * 0.00078).toFixed(2),
      active_kcal: Math.round(s * 0.078), exercise_min: Math.round(s / 190),
      stand_hours: 8 + (i % 4), source: 'shortcut',
    };
  });
  S.state.weights[gun(7)] = { kg: 119.4, source: 'manual' };
  S.state.weights[gun(0)] = { kg: 118.0, source: 'manual' };
  Object.assign(S.state.profile, {
    username: 'fatih', step_goal: 8000, kcal_goal: 500, exercise_goal: 30,
    height_cm: 183, target_weight: 95,
  });
  S.save({ now: true });
  window.SP.render();
  await new Promise(r => setTimeout(r, 400));
  return { gun: Object.keys(S.state.days).length };
`;

const PREP_FOTO = `
  for (let i = 0; i < 150; i++) { if (window.FS?.ready) break; await new Promise(r => setTimeout(r, 100)); }
  const c = document.createElement('canvas');
  c.width = 1400; c.height = 1000;
  const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, 620);
  sky.addColorStop(0, '#1b3b6f'); sky.addColorStop(0.55, '#e07a3f'); sky.addColorStop(1, '#f6d08a');
  x.fillStyle = sky; x.fillRect(0, 0, 1400, 620);
  x.fillStyle = '#fff6d8'; x.beginPath(); x.arc(980, 470, 78, 0, 7); x.fill();
  x.fillStyle = '#2a3f5f';
  x.beginPath(); x.moveTo(0, 620); x.lineTo(280, 380); x.lineTo(520, 620); x.closePath(); x.fill();
  x.fillStyle = '#1f3350';
  x.beginPath(); x.moveTo(360, 620); x.lineTo(720, 300); x.lineTo(1120, 620); x.closePath(); x.fill();
  x.fillStyle = '#e8eef7';
  x.beginPath(); x.moveTo(660, 360); x.lineTo(720, 300); x.lineTo(790, 372); x.closePath(); x.fill();
  const water = x.createLinearGradient(0, 620, 0, 1000);
  water.addColorStop(0, '#c4713a'); water.addColorStop(1, '#12243d');
  x.fillStyle = water; x.fillRect(0, 620, 1400, 380);
  x.fillStyle = 'rgba(255,220,170,0.35)';
  for (let i = 0; i < 26; i++) x.fillRect(900 + (i*7 % 120) - 60, 640 + i*13, 120 - i*3, 5);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  await window.FS.loadFile(new File([blob], 'manzara.png', { type: 'image/png' }));
  window.FS.applyPreset('gunbatimi');
  await new Promise(r => setTimeout(r, 900));
  window.FS.doRender();
`;

const PREP_DONUSTUR = `
  for (let i = 0; i < 150; i++) { if (window.DD?.ready) break; await new Promise(r => setTimeout(r, 100)); }
  const c = document.createElement('canvas');
  c.width = 900; c.height = 600;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 900, 600);
  g.addColorStop(0, '#1b3b6f'); g.addColorStop(1, '#e07a3f');
  x.fillStyle = g; x.fillRect(0, 0, 900, 600);
  const png = await new Promise(r => c.toBlob(r, 'image/png'));
  await window.DD.addFiles([
    new File([png], 'tatil-fotografi.png', { type: 'image/png' }),
    new File([png], 'manzara.png', { type: 'image/png' }),
  ]);
  window.DD.select('img2pdf');
  await new Promise(r => setTimeout(r, 500));
`;

/**
 * shot: ekran görüntüsü alınacak adres (yerel /foto/ gibi ya da tam URL)
 * wait: sayfa yüklendikten sonra beklenecek ms (oyunlar için animasyon otursun)
 * prep: görüntüden önce sayfada çalıştırılacak hazırlık betiği
 * tint: demosu olmayan projelerin kart rengi
 */
const PROJECTS = [
  // --- araçlar ve uygulamalar (yerel kopyadan) ---
  { slug: 'saglik-panel', title: 'Sağlık Panel', sub: 'Spor ve kilo takibi · çevrimdışı · arkadaş sıralaması',
    shot: '/saglik/', wait: 2500, prep: PREP_SAGLIK, after: 900 },
  { slug: 'foto-studyo', title: 'Foto Stüdyo', sub: 'Tarayıcıda WebGL fotoğraf filtresi ve düzenleme',
    shot: '/foto/', wait: 1500, prep: PREP_FOTO, after: 600 },
  { slug: 'dosya-donusturucu', title: 'Dosya Dönüştürücü', sub: 'PDF, Word, Excel, resim ve metin dönüşümü',
    shot: '/donustur/', wait: 1500, prep: PREP_DONUSTUR, after: 600 },

  // --- canlı demosu olan dış projeler ---
  { slug: 'browser-annotator', title: 'Görüntü Etiketleme Aracı', sub: 'Tarayıcıda YOLO / COCO veri seti hazırlama',
    shot: 'https://fatihemin48.github.io/browser-annotator/', wait: 3000 },
  { slug: 'okuanla', title: 'OkuAnla', sub: 'Türkçe metin sadeleştirme ve anlama asistanı',
    shot: 'https://fatiheminkarahan-okuanla.hf.space', wait: 6000 },
  { slug: 'egg-detection', title: 'Yumurta Tespiti', sub: 'Tarayıcıda çalışan nesne tespiti modeli',
    shot: 'https://fatihemin48.github.io/egg-detector/', wait: 3500 },
  { slug: 'hayatta-kalma', title: 'Hayatta Kalma', sub: 'Tarayıcı oyunu',
    shot: 'https://fatihemin48.github.io/hayatta-kalma/', wait: 3000 },
  { slug: 'altin-madeni', title: 'Altın Madeni', sub: 'Tarayıcı oyunu',
    shot: 'https://fatihemin48.github.io/altin-madeni/', wait: 3000 },
  { slug: 'ciftlik', title: 'Çiftlik', sub: 'Tarayıcı oyunu',
    shot: 'https://fatihemin48.github.io/ciftlik/', wait: 3000 },
  { slug: 'zipla', title: 'Zıpla!', sub: 'Tarayıcı oyunu · Android sürümü var',
    shot: 'https://fatihemin48.github.io/zipla/', wait: 3000 },

  // --- araştırma projeleri (canlı demo yok, markalı kart) ---
  { slug: 'domates-tespiti', title: 'Domates Olgunluk Tespiti', sub: 'Bilgisayarlı görü · YOLO · akıllı tarım',
    tint: ['#7f1d1d', '#ef4444'], icon: '🍅' },
  { slug: 'crop-phenology-detection', title: 'Bitki Fenolojisi Tespiti', sub: 'Uydu ve saha görüntülerinden büyüme evresi',
    tint: ['#14532d', '#4ade80'], icon: '🌱' },
  { slug: 'broiler-chicken-detection', title: 'Broyler Tavuk Tespiti', sub: 'Kümes içi sayım ve davranış analizi',
    tint: ['#78350f', '#fbbf24'], icon: '🐔' },
  { slug: 'ai-dermatology-diagnosis', title: 'Dermatoloji Görüntü Analizi', sub: 'Derin öğrenme ile cilt lezyonu sınıflandırma',
    tint: ['#1e3a8a', '#60a5fa'], icon: '🔬' },
  { slug: 'teknofest-autonomous-tractor', title: 'Otonom Traktör', sub: 'TEKNOFEST · otonom navigasyon ve algılama',
    tint: ['#0c4a6e', '#38bdf8'], icon: '🚜' },
];

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/google-chrome',
].find((c) => c && fs.existsSync(c));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.JPG': 'image/jpeg',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream',
  '.pdf': 'application/pdf',
};

function startServer() {
  const base = path.join(ROOT, 'static');
  return new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(base, p);
      try {
        const d = await fsp.readFile(f);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        res.end(d);
      } catch { res.writeHead(404).end(); }
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(method + ' zaman aşımı')); } }, 60000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Ekran görüntüsünü tam kaplayan kart. */
function cardWithShot(p, dataUri) {
  return `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${W}px;height:${H}px;overflow:hidden;position:relative;
       background:#0b0d12;font:400 16px/1.4 "Segoe UI",system-ui,Roboto,Arial,sans-serif}
  .shot{position:absolute;inset:0;background:url('${dataUri}') center top/cover no-repeat;
        filter:saturate(1.05)}
  .veil{position:absolute;inset:0;
        background:linear-gradient(180deg,rgba(11,13,18,.10) 0%,rgba(11,13,18,.05) 42%,
                   rgba(11,13,18,.86) 78%,rgba(11,13,18,.97) 100%)}
  .bar{position:absolute;left:0;right:0;bottom:0;height:8px;
       background:linear-gradient(90deg,#6ee7a8,#56c8ff,#a77bff)}
  .txt{position:absolute;left:64px;right:64px;bottom:62px;color:#fff}
  h1{font-size:62px;font-weight:700;letter-spacing:-.5px;line-height:1.05;
     text-shadow:0 3px 22px rgba(0,0,0,.65)}
  p{margin-top:14px;font-size:27px;color:#cdd6e4;text-shadow:0 2px 14px rgba(0,0,0,.7)}
  .who{position:absolute;top:44px;left:64px;font-size:22px;color:#e8ecf5;font-weight:600;
       background:rgba(11,13,18,.55);padding:9px 18px;border-radius:999px;
       border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(6px)}
  </style>
  <div class="shot"></div><div class="veil"></div>
  <div class="who">fatiheminkarahan.com</div>
  <div class="txt"><h1>${esc(p.title)}</h1><p>${esc(p.sub)}</p></div>
  <div class="bar"></div>`;
}

/** Canlı demosu olmayan projeler için çizilen kart. */
function cardPlain(p) {
  const [c1, c2] = p.tint || ['#1f2937', '#6ee7a8'];
  return `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${W}px;height:${H}px;overflow:hidden;position:relative;background:#0b0d12;
       font:400 16px/1.4 "Segoe UI",system-ui,Roboto,Arial,sans-serif;color:#fff}
  .bg{position:absolute;inset:0;
      background:radial-gradient(900px 520px at 78% 18%, ${c2}38 0%, transparent 62%),
                 radial-gradient(720px 460px at 12% 92%, ${c1}66 0%, transparent 60%),
                 linear-gradient(140deg,#0b0d12 0%,#141a24 100%)}
  .grid{position:absolute;inset:0;opacity:.16;
        background-image:linear-gradient(rgba(255,255,255,.5) 1px,transparent 1px),
                         linear-gradient(90deg,rgba(255,255,255,.5) 1px,transparent 1px);
        background-size:64px 64px;
        -webkit-mask-image:radial-gradient(circle at 70% 30%,#000 0%,transparent 72%)}
  .ico{position:absolute;right:78px;top:50%;transform:translateY(-50%);font-size:230px;
       line-height:1;filter:drop-shadow(0 18px 40px rgba(0,0,0,.55));opacity:.95}
  .txt{position:absolute;left:70px;bottom:96px;right:400px}
  h1{font-size:60px;font-weight:700;letter-spacing:-.5px;line-height:1.06}
  p{margin-top:16px;font-size:27px;color:#c3cede}
  .who{position:absolute;top:46px;left:70px;font-size:22px;color:#93a2b8;font-weight:600}
  .bar{position:absolute;left:0;right:0;bottom:0;height:8px;
       background:linear-gradient(90deg,${c2},#56c8ff,#a77bff)}
  </style>
  <div class="bg"></div><div class="grid"></div>
  <div class="who">fatiheminkarahan.com</div>
  <div class="ico">${p.icon || '◧'}</div>
  <div class="txt"><h1>${esc(p.title)}</h1><p>${esc(p.sub)}</p></div>
  <div class="bar"></div>`;
}

async function main() {
  if (!CHROME) { console.error('Chrome bulunamadı.'); process.exit(1); }

  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const only = argv.filter((a) => !a.startsWith('--'));
  const list = only.length ? PROJECTS.filter((p) => only.includes(p.slug)) : PROJECTS;
  if (!list.length) { console.error('Eşleşen proje yok.'); process.exit(1); }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--window-size=${W},${H}`, 'about:blank',
  ], { stdio: 'ignore' });

  let ok = 0;
  let fail = 0;
  try {
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      try {
        const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        target = l.find((t) => t.type === 'page');
      } catch { /* bekle */ }
      if (!target) await new Promise((r) => setTimeout(r, 250));
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    for (const p of list) {
      const out = path.join(OUT_DIR, `${p.slug}.png`);
      if (!force && fs.existsSync(out)) { console.log(`  · ${p.slug} (var, atlandı)`); continue; }

      try {
        let html;
        if (p.shot) {
          // 1) Uygulamanın kendisini yakala
          const url = p.shot.startsWith('http') ? p.shot : `http://127.0.0.1:${PORT}${p.shot}`;
          await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 1280, height: 800, deviceScaleFactor: 1.5, mobile: false,
          });
          await cdp.send('Page.navigate', { url });
          await new Promise((r) => setTimeout(r, p.wait || 2500));
          for (const step of [p.prep, p.prep2]) {
            if (!step) continue;
            // Yeniden yükleme yapan adımlar bağlamı yok eder; bu beklenen bir durum
            await cdp.eval(step).catch(() => {});
            await new Promise((r) => setTimeout(r, p.after || 800));
          }
          const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
          html = cardWithShot(p, `data:image/jpeg;base64,${shot.data}`);
        } else {
          html = cardPlain(p);
        }

        // 2) Kartı kur ve 1200x630 olarak yakala
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: W, height: H, deviceScaleFactor: 1, mobile: false,
        });
        await cdp.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
        await new Promise((r) => setTimeout(r, 700));
        const card = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await fsp.writeFile(out, Buffer.from(card.data, 'base64'));
        const kb = (fs.statSync(out).size / 1024).toFixed(0);
        console.log(`  ✓ ${p.slug}.png  (${kb} KB)${p.shot ? '' : ' — çizilmiş kart'}`);
        ok++;
      } catch (e) {
        console.log(`  ✗ ${p.slug}: ${String(e.message).slice(0, 90)}`);
        fail++;
      }
    }
    ws.close();
  } finally {
    proc.kill();
    server.close();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 400);
  }

  console.log(`\n${ok} görsel üretildi${fail ? `, ${fail} başarısız` : ''}. Klasör: static/og/`);
  process.exit(fail && !ok ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
