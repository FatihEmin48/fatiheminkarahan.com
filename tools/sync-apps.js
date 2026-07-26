/* tools/sync-apps.js — kardeş klasörlerdeki web uygulamalarını static/ altına kopyalar.
   Uygulamalar ayrı projelerde geliştirilir; site yalnız yayımlanmış kopyayı tutar.

     node tools/sync-apps.js          hepsini eşitle
     node tools/sync-apps.js foto     yalnız birini eşitle
*/

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const projects = path.join(root, '..');

/** hedef: static/<slug>/ , kaynak: ../<proje>/web */
const APPS = [
  { slug: 'saglik', source: 'saglik-panel/web', title: 'Sağlık Panel' },
  { slug: 'foto', source: 'foto-studyo/web', title: 'Foto Stüdyo' },
  { slug: 'donustur', source: 'dosya-donusturucu/web', title: 'Dosya Dönüştürücü' },
];

const SKIP = new Set(['node_modules', '.git', '.DS_Store', 'Thumbs.db']);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      const r = copyDir(s, d);
      files += r.files;
      bytes += r.bytes;
    } else {
      fs.copyFileSync(s, d);
      files++;
      bytes += fs.statSync(s).size;
    }
  }
  return { files, bytes };
}

const human = (n) => (n < 1024 * 1024 ? (n / 1024).toFixed(0) + ' KB' : (n / (1024 * 1024)).toFixed(1) + ' MB');

const only = process.argv[2];
let total = 0;
let missing = 0;

for (const app of APPS) {
  if (only && app.slug !== only) continue;
  const src = path.join(projects, app.source);
  const dst = path.join(root, 'static', app.slug);
  if (!fs.existsSync(src)) {
    console.error(`  ✗ ${app.title}: kaynak yok — ${path.relative(projects, src)}`);
    missing++;
    continue;
  }
  fs.rmSync(dst, { recursive: true, force: true });
  const r = copyDir(src, dst);
  total += r.bytes;
  console.log(`  ✓ ${app.title} → static/${app.slug}/  (${r.files} dosya, ${human(r.bytes)})`);
}

if (missing) {
  console.error(`\n${missing} uygulama bulunamadı.`);
  process.exit(1);
}
console.log(`\nToplam ${human(total)}. Şimdi: hugo server  ya da  git add static content layouts`);
