#!/usr/bin/env node
// WO-4.0 Part B — assemble gallery/gallery.html from gallery/states.json +
// the Playwright-captured PNGs in gallery/img/. French captions, grouped by
// flow, phone-scrollable. A state with a MISSING screenshot is rendered as
// a visible gap card — never silently dropped; the manifest's named gaps
// render in their own section. Exit 1 if any listed state lacks its image.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'gallery/states.json'), 'utf8'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let missing = 0;

const groupsHtml = manifest.groups.map((group) => {
  const cards = group.states.map((state) => {
    const img = join(root, 'gallery/img', `${state.id}.png`);
    if (!existsSync(img)) {
      missing += 1;
      return `<figure class="card gap"><figcaption><strong>ÉCRAN MANQUANT</strong> — ${esc(state.caption)}</figcaption></figure>`;
    }
    return `<figure class="card"><img src="img/${state.id}.png" alt="${esc(state.caption)}" loading="lazy"><figcaption>${esc(state.caption)}</figcaption></figure>`;
  }).join('\n');
  return `<section><h2>${esc(group.title)}</h2><div class="grid">${cards}</div></section>`;
}).join('\n');

const gapsHtml = (manifest.gaps ?? []).map((gap) =>
  `<li><strong>${esc(gap.name)}</strong> — ${esc(gap.reason)}</li>`,
).join('\n');

const html = `<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(manifest.surface)} — galerie d'aperçu</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #FAF7F2; color: #221F1A; padding: 16px; }
  h1 { font-size: 22px; } h2 { font-size: 17px; margin: 28px 0 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .card { margin: 0; background: #fff; border: 1px solid #E4DDD3; border-radius: 12px; overflow: hidden; }
  .card img { width: 100%; height: auto; display: block; }
  .card figcaption { padding: 10px 12px; font-size: 14px; }
  .card.gap { padding: 24px 12px; background: #FFF6E8; }
  .note, .gaps { background: #fff; border: 1px solid #E4DDD3; border-radius: 12px; padding: 12px 16px; font-size: 14px; }
</style>
<h1>${esc(manifest.surface)} — galerie d'aperçu</h1>
<p class="note">Chaque image est un état RÉELLEMENT construit, capturé automatiquement (bac à sable — aucune donnée réelle).</p>
${groupsHtml}
<section><h2>États nommés sans écran (les manques, jamais silencieux)</h2><ul class="gaps">${gapsHtml}</ul></section>
</html>
`;
writeFileSync(join(root, 'gallery/gallery.html'), html);
const total = manifest.groups.reduce((n, g) => n + g.states.length, 0);
console.log(`gallery.html assembled: ${total - missing}/${total} states captured, ${missing} missing, ${(manifest.gaps ?? []).length} named gaps`);
process.exit(missing > 0 ? 1 : 0);
