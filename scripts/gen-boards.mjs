// Textures procédurales des échiquiers Érable, Marbre, Tournoi et Cerisier (assets/boards/<id>.webp, 800 × 800).
// Usage, depuis la racine du projet (sharp n'est pas une dépendance du projet) :
//   npm i --no-save sharp && node scripts/gen-boards.mjs [id…]
// Chaque case a son propre tirage (grain du bois orienté case par case, veines du marbre continues) ;
// les couleurs de base sont celles de --board-light / --board-dark (style.css).
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(process.cwd(), 'package.json'));
const sharp = require('sharp');
const SIZE = 800, SQ = SIZE / 8;

// ─── Bruit de valeur (déterministe) ───────────────────────────────────────────
function hash(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = t => t * t * (3 - 2 * t);
function noise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
function fbm(x, y, s, oct = 5) {
    let v = 0, amp = .5, f = 1;
    for (let i = 0; i < oct; i++) { v += amp * noise(x * f, y * f, s + i * 17); amp /= 2; f *= 2; }
    return v;
}
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));

// ─── Motifs ──────────────────────────────────────────────────────────────────
// Bois : cernes étirés dans le sens du fil, fibres fines, teinte par case ; le fil alterne d'une case à l'autre.
function wood(light, dark, opts) {
    const L = hex(light), D = hex(dark);
    return (x, y, sx, sy) => {
        const isLight = (sx + sy) % 2 === 0, seed = sx * 8 + sy + 1;
        const along = (sx + sy) % 2 ? x : y, across = (sx + sy) % 2 ? y : x;
        const warp = fbm(along / 140, across / 40, seed) * 6;
        const rings = Math.sin((across / opts.ring + warp) * Math.PI * 2) * .5 + .5;
        const fiber = fbm(along / 60, across / 1.6, seed + 99, 3);
        const tone = (hash(sx, sy, 7) - .5) * opts.vary;
        const base = isLight ? L : D;
        const t = (rings - .5) * opts.ringAmp + (fiber - .5) * opts.fiberAmp + tone;
        return base.map(v => v * (1 + t));
    };
}
// Marbre : veines par turbulence, continues sur tout l'échiquier ; grain fin.
function marble(light, dark, vein) {
    const L = hex(light), D = hex(dark), V = hex(vein);
    return (x, y, sx, sy) => {
        const isLight = (sx + sy) % 2 === 0, base = isLight ? L : D;
        const t = Math.abs(Math.sin((x * .9 + y * .6) / 90 + fbm(x / 120, y / 120, 3, 6) * 9));
        const v = Math.pow(1 - t, 10) * (isLight ? .55 : .35);
        const grain = (fbm(x / 6, y / 6, 11, 2) - .5) * .06;
        return mix(base, isLight ? V : L, v).map(c => c * (1 + grain));
    };
}
// Tournoi : vinyle mat d'échiquier de club, à peine grenu.
function tournament(light, dark) {
    const L = hex(light), D = hex(dark);
    return (x, y, sx, sy) => {
        const base = (sx + sy) % 2 === 0 ? L : D;
        const g = (noise(x / 1.3, y / 1.3, 5) - .5) * .05 + (fbm(x / 90, y / 90, 6, 3) - .5) * .04;
        return base.map(v => v * (1 + g));
    };
}

const BOARDS = {
    maple:      wood('#f0dcb4', '#c79a62', { ring: 14, ringAmp: .07, fiberAmp: .10, vary: .05 }),
    cherry:     wood('#ecc9a2', '#91493a', { ring: 18, ringAmp: .09, fiberAmp: .12, vary: .06 }),
    marble:     marble('#ece9e2', '#76807d', '#9a9d98'),
    tournament: tournament('#eeecd0', '#6b8f5a')
};

for (const id of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BOARDS)) {
    const px = BOARDS[id], buf = Buffer.alloc(SIZE * SIZE * 3);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const sx = Math.floor(x / SQ), sy = Math.floor(y / SQ);
        const c = px(x, y, sx, sy), i = (y * SIZE + x) * 3;
        buf[i] = clamp(c[0]); buf[i + 1] = clamp(c[1]); buf[i + 2] = clamp(c[2]);
    }
    const out = path.join(ROOT, 'assets/boards', id + '.webp');
    await sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp({ quality: 82 }).toFile(out);
    console.log('écrit', path.relative(ROOT, out));
}
