#!/usr/bin/env node
// Fusionne des traductions dans les paquets lang/<langue>.json.
//   node scripts/i18n-apply.mjs <fichier> <langue> [<langue>…]
// Chaque ligne du fichier : « numéro de ligne de lang/source.txt¦traduction¦traduction… », une colonne par langue.
// Puis écrit lang/manifest.json (taille de chaque paquet, lue par les Paramètres).
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.join(import.meta.dirname, '..');
const [file, ...langs] = process.argv.slice(2);
const source = fs.readFileSync(path.join(ROOT, 'lang/source.txt'), 'utf8').split('\n');
const packs = {};
for (const l of langs) {
    const p = path.join(ROOT, `lang/${l}.json`);
    packs[l] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}
let n = 0;
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const [num, ...cols] = line.split('¦');
    const fr = /^\d+$/.test(num) ? source[Number(num) - 1] : num;      // un numéro, ou le texte français lui-même
    if (!fr || cols.length !== langs.length) { console.error('Ligne ignorée :', line.slice(0, 80)); continue; }
    // Un {n} collé en tête est une icône, un {n} isolé en fin souvent aussi : la page ne montre que le texte.
    const lead = /^\{\d\}(?=[A-ZÀ-Ý<{])/.exec(fr);
    const key = lead ? fr.slice(lead[0].length) : fr;
    langs.forEach((l, i) => {
        let v = cols[i].trim();
        if (lead) v = v.split(lead[0]).join('');
        packs[l][key] = v;
        // Variantes que la page montre : icône devant (« {0} Réessayer »), « <b>texte</b> » seul, « · » final.
        const iconed = /^\{\d\} (?=[A-ZÀ-Ý])/.exec(key);
        if (iconed && v.startsWith(iconed[0]) && !(key.slice(iconed[0].length) in packs[l])) packs[l][key.slice(iconed[0].length)] = v.slice(iconed[0].length);
        const wrapped = /^<(b|strong|em)>([^<]*)<\/\1>$/.exec(key), inner = /^<(b|strong|em)>([^<]*)<\/\1>$/.exec(v);
        if (wrapped && inner) packs[l][wrapped[2]] = inner[2];
        if (key.endsWith(' ·') && v.endsWith(' ·')) packs[l][key.slice(0, -2)] = v.slice(0, -2);
        const tail = /\s\{\d\}$/.exec(key);
        if (tail && v.endsWith(tail[0].trim()) && !(key.slice(0, tail.index) in packs[l])) packs[l][key.slice(0, tail.index)] = v.slice(0, -tail[0].trim().length).trim();
    });
    n++;
}
for (const l of langs) fs.writeFileSync(path.join(ROOT, `lang/${l}.json`), JSON.stringify(packs[l], null, 0) + '\n');
const sizes = {};
for (const f of fs.readdirSync(path.join(ROOT, 'lang'))) {
    if (f.endsWith('.json') && f !== 'manifest.json') sizes[f.replace('.json', '')] = fs.statSync(path.join(ROOT, 'lang', f)).size;
}
fs.writeFileSync(path.join(ROOT, 'lang/manifest.json'), JSON.stringify(sizes) + '\n');
console.log(n, 'lignes ;', langs.map(l => `${l} ${Object.keys(packs[l]).length}`).join(', '));
