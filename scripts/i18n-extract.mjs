#!/usr/bin/env node
// Relève les textes français de l'application dans lang/source.txt, un par ligne : la liste à traduire
// (scripts/i18n-apply.mjs range les traductions dans les paquets lang/<langue>.json).
// Analyse le JavaScript (chaînes, gabarits imbriqués, commentaires, expressions régulières). Un ${…} devient {0}, {1}… ;
// un texte s'arrête aux balises, sauf les balises de mise en valeur (INLINE) : la phrase entière se traduit (i18n.js).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const SKIP_FILES = /i18n\.js$|icons\.js$|cloudConfig\.js$|storageAdapter\.js$/;
const files = walk(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && !SKIP_FILES.test(f));

// Toutes les chaînes d'un source : { text } ; un ${…} d'un gabarit est remplacé par {n} et son contenu analysé à son tour.
function literals(src, out = []) {
    let i = 0;
    const string = q => {
        let s = ''; i++;
        while (i < src.length && src[i] !== q) {
            if (src[i] === '\\') { const c = src[i + 1]; s += c === 'n' ? ' ' : c === 'u' ? String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)) : c; i += c === 'u' ? 6 : 2; continue; }
            s += src[i++];
        }
        i++;
        return s;
    };
    const template = () => {
        let s = '', n = 0; i++;
        while (i < src.length && src[i] !== '`') {
            if (src[i] === '\\') { s += src[i + 1] === 'n' ? ' ' : src[i + 1]; i += 2; continue; }
            if (src[i] === '$' && src[i + 1] === '{') {
                let d = 1, j = i + 2, q = null;
                const start = j;
                while (j < src.length && d) {          // fin de l'expression, chaînes et gabarits imbriqués compris
                    const c = src[j];
                    if (q) { if (c === '\\') j++; else if (c === q && q !== '`') q = null; else if (q === '`') { if (c === '`') q = null; else if (c === '$' && src[j + 1] === '{') { const e = skipExpr(src, j + 2); j = e - 1; } } }
                    else if (c === "'" || c === '"' || c === '`') q = c;
                    else if (c === '{') d++;
                    else if (c === '}') d--;
                    j++;
                }
                literals(src.slice(start, j - 1), out);
                s += `{${n++ % 10}}`;
                i = j;
                continue;
            }
            s += src[i++];
        }
        i++;
        return s;
    };
    let prev = '';
    while (i < src.length) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) break; continue; }
        if (c === "'" || c === '"') { out.push(string(c)); prev = 'x'; continue; }
        if (c === '`') { out.push(template()); prev = 'x'; continue; }
        if (c === '/' && /[(,=:[!&|?{};\n>]|^$/.test(prev)) {      // expression régulière
            let inClass = false; i++;
            while (i < src.length && (src[i] !== '/' || inClass)) { if (src[i] === '\\') i++; else if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false; i++; }
            i++; prev = 'x'; continue;
        }
        if (!/\s/.test(c)) prev = c; else if (c === '\n' && /[;{}]/.test(prev)) prev = '\n';
        i++;
    }
    return out;
}
function skipExpr(src, j) {                                     // renvoie l'indice après le } fermant
    let d = 1, q = null;
    while (j < src.length && d) {
        const c = src[j];
        if (q) { if (c === '\\') j++; else if (c === q) q = null; else if (q === '`' && c === '$' && src[j + 1] === '{') j = skipExpr(src, j + 2) - 1; }
        else if (c === "'" || c === '"' || c === '`') q = c;
        else if (c === '{') d++;
        else if (c === '}') d--;
        j++;
    }
    return j;
}

const INLINE = 'b|strong|em|i|kbd|code|u';
const fragments = raw => raw.replace(/&nbsp;/g, ' ').split(new RegExp(`<(?!/?(?:${INLINE})>)[^>]*>`)).map(s => s.replace(/\s+/g, ' ').trim());
const attrsOf = raw => [...raw.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g)].map(m => m[1]);

function looksLikeText(s) {
    const t = s.replace(/<[^>]+>/g, '').replace(/\{\d\}/g, ' ').trim();
    if (!/\p{L}{2}/u.test(t)) return false;
    if (/^[a-z0-9_-]+( [a-z0-9_-]+)*$/.test(s) && (/[-_]/.test(s) || !/ /.test(s)) && !/[éèêàùçôîûœ]/.test(s)) return false;   // classes, clés
    if (/^[a-z]+[A-Z]\w*$/.test(s) || /^[A-Z][a-z]+[A-Z]\w*$/.test(s)) return false;                // camelCase
    if (/^(use strict|https?:|#|\.|\/|\[|\?|&|data-|chessTrainer|openingDB|var\(|rgba?\(|oklch|color-mix|setoption|position |go |engine\/|application\/|image\/|return=|[a-z-]+:\s*\S*;?$)/.test(s)) return false;
    if (/[=;{]\s*$|=>|\bfunction\b|\bconst\b|document\.|\.classList|querySelector|\$\{/.test(s)) return false;
    if (/^(POST|PUT|GET|PATCH|DELETE|Escape|Enter|Tab|Home|End|Arrow\w+|Bearer|Content-Type|Range-Unit|SHA-256|NFD|KQkq|Apple|Google|GitHub|Discord|Lichess|Chess\.com|PGN|MIT|Elo|OK|OLED|Ctrl|Alt|DOMContentLoaded)$/.test(s)) return false;
    if (/^[a-h][1-8]/.test(s) || /^[KQRBN]?[a-h]?x?[a-h][1-8]/.test(s)) return false;              // coups
    if (/\/\d+\/|^[rnbqkpRNBQKP1-8/]+ [wb]\b/.test(s)) return false;                                // FEN
    return true;
}

const seen = new Set();
const add = s => { if (looksLikeText(s)) seen.add(s); };

for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (f.endsWith('openingNames.js')) {                        // « Nom|coups » : le nom seul
        for (const l of literals(src)) { if (l.includes('|')) add(l.split('|')[0]); }
        continue;
    }
    for (const raw of literals(src)) {
        attrsOf(raw).forEach(a => fragments(a).forEach(add));
        fragments(raw).forEach(add);
    }
}
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '');
for (const m of html.matchAll(/>([^<>]+)</g)) add(m[1].replace(/\s+/g, ' ').trim());
for (const m of html.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]+)"/g)) add(m[1]);

// Accords écrits par du code : le chiffre se lit {n} (i18n.js).
const lines = [...seen];
fs.writeFileSync(path.join(ROOT, 'lang/source.txt'), lines.join('\n') + '\n');
console.log(lines.length, 'textes,', lines.join(' ').split(/\s+/).length, 'mots');
// Ce qui manque à chaque paquet (une clé absente reste en français à l'écran).
for (const f of fs.readdirSync(path.join(ROOT, 'lang')).filter(x => x.endsWith('.json') && x !== 'manifest.json')) {
    const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'lang', f), 'utf8'));
    const miss = lines.filter(l => !(l.replace(/^\{\d\}(?=[A-ZÀ-Ý<{])/, '') in pack));
    console.log(f, ':', miss.length, 'lignes sans traduction');
}
