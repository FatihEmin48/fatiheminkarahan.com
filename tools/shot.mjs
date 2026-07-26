// tools/shot.mjs — public/ altındaki üretilmiş siteden ekran görüntüsü alır.
//   hugo --minify   sonra:
//   node tools/shot.mjs --path /tr/projects/ --out C:/tmp/a.png --w 1100 --h 1400

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = 5403;
const CDP_PORT = 9424;

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) { args[key] = next; i++; } else args[key] = true;
}

/* Git Bash, "/tr/projects/" gibi argümanları Windows yoluna çeviriyor
   (C:/Program Files/Git/tr/projects/). Gelen değeri site yoluna geri indir. */
function normalizePath(p) {
  let s = String(p || '/tr/projects/').replace(/\\/g, '/');
  const m = /^[A-Za-z]:\/.*?\/Git(\/.*)$/.exec(s);      // MSYS dönüşümünü geri al
  if (m) s = m[1];
  if (!s.startsWith('/')) s = '/' + s;
  return s;
}

const PAGE = normalizePath(args.path);
const OUT = args.out || path.join(os.tmpdir(), 'site.png');
const W = Number(args.w || 1100);
const H = Number(args.h || 1200);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.JPG': 'image/jpeg', '.pdf': 'application/pdf',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

if (!fs.existsSync(PUBLIC)) {
  console.error('public/ yok — önce: hugo --minify');
  process.exit(1);
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
].find((c) => c && fs.existsSync(c));

async function main() {
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    try {
      const d = await fsp.readFile(path.join(PUBLIC, p));
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      res.end(d);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'site-shot-'));
  const url = `http://127.0.0.1:${PORT}${PAGE}`;
  // about:blank ile aç, sonra Page.navigate ile git. Adresi doğrudan argüman
  // olarak vermek bazen Chrome'un yeni sekme sayfasına takılıyor ve o hedef
  // CDP ile http adresine yönlendirilemiyor.
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    `--window-size=${W},${H}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      try {
        const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        target = l.find((t) => t.type === 'page');
      } catch { /* bekle */ }
      if (!target) await new Promise((r) => setTimeout(r, 250));
    }
    if (!target) throw new Error('Chrome hedefi bulunamadı');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (!m.id || !pending.has(m.id)) return;
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      // Hataları yutma: sessizce undefined dönerse sorun görünmez oluyor
      if (m.error) rej(new Error(`${m.error.message} (${m.error.code})`));
      else res(m.result);
    });
    const send = (method, params = {}) => new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => {
        if (pending.has(i)) { pending.delete(i); rej(new Error(method + ' zaman aşımı')); }
      }, 30000);
    });

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: W, height: H, deviceScaleFactor: 2, mobile: W < 700,
    });
    await send('Page.navigate', { url });

    // Yüklenmeyi bekle ve nereye gittiğimizi doğrula
    let info = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const r = await send('Runtime.evaluate', {
        expression: 'JSON.stringify({href: location.href, ready: document.readyState, '
          + 'imgs: document.images.length, title: document.title})',
        returnByValue: true,
      });
      try { info = JSON.parse(r?.result?.value || 'null'); } catch { info = null; }
      if (info && info.ready === 'complete' && info.href.startsWith(url)) break;
    }
    if (!info || !info.href.startsWith(url)) {
      throw new Error(`Sayfaya gidilemedi. Şu an: ${info?.href || 'bilinmiyor'}`);
    }
    console.log(`  ${info.title} · ${info.imgs} görsel`);

    // Tembel yüklenen görseller yüklensin diye sayfayı gezdir
    await send('Runtime.evaluate', {
      expression: 'window.scrollTo(0, document.body.scrollHeight);',
    });
    await new Promise((r) => setTimeout(r, 900));
    await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0);' });
    await new Promise((r) => setTimeout(r, 700));

    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: !!args.full,
    });
    await fsp.writeFile(OUT, Buffer.from(shot.data, 'base64'));
    console.log('✓', OUT);
    ws.close();
  } finally {
    proc.kill();
    server.close();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 400);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
