// tools/add-og-frontmatter.mjs — proje içerik dosyalarına `image:` alanı ekler.
// static/og/<slug>.png varsa hem <slug>.md hem <slug>.tr.md güncellenir.
// Zaten `image:` olan dosyalara dokunulmaz.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OG = path.join(ROOT, 'static', 'og');
const CONTENT = path.join(ROOT, 'content');

if (!fs.existsSync(OG)) {
  console.error('static/og yok — önce: node tools/og-images.mjs');
  process.exit(1);
}

const slugs = fs.readdirSync(OG)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''));

let added = 0;
let already = 0;
let missing = [];

for (const slug of slugs) {
  const files = [`${slug}.md`, `${slug}.tr.md`]
    .map((n) => path.join(CONTENT, n))
    .filter((p) => fs.existsSync(p));

  if (!files.length) { missing.push(slug); continue; }

  for (const file of files) {
    let src = fs.readFileSync(file, 'utf8');
    if (!src.startsWith('---')) {
      console.log(`  ! ${path.basename(file)}: ön bilgi bloğu yok, atlandı`);
      continue;
    }
    if (/^image:\s*/m.test(src.slice(0, src.indexOf('---', 3)))) { already++; continue; }

    // Kapanış "---" satırının hemen öncesine ekle
    const end = src.indexOf('\n---', 3);
    if (end < 0) { console.log(`  ! ${path.basename(file)}: ön bilgi kapanmıyor`); continue; }
    src = src.slice(0, end) + `\nimage: /og/${slug}.png` + src.slice(end);
    fs.writeFileSync(file, src, 'utf8');
    added++;
  }
}

console.log(`\n${added} dosyaya eklendi, ${already} zaten vardı.`);
if (missing.length) {
  console.log(`İçerik dosyası bulunamayan görseller: ${missing.join(', ')}`);
}
