// Vérifie le catalogue des finales jugées (egExercises.js, exercices sans « kind ») et fige les verdicts.
//
//   node scripts/check-endgames.mjs          vérifie, puis réécrit le bloc ENDGAME_VERDICTS d'egExercises.js
//   node scripts/check-endgames.mjs --check  vérifie seulement (code de sortie 1 au moindre écart)
//
// Jusqu'à 7 pièces : tables Syzygy (API publique de Lichess, réseau requis). Au-delà : Stockfish embarqué
// (engine/manifest.json, variante mono-thread, profondeur 22), verdict estimé avec les seuils du juge
// (gain : éval ≥ +2,5 ou mat ; nulle : |éval| ≤ 0,6). Chaque FEN doit être légale, le joueur au trait,
// et le verdict doit correspondre à l'objectif (goal). endgameSelfTest() (npm test) relit ensuite le bloc.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'js/modules/endgame/egExercises.js');
const CHECK_ONLY = process.argv.includes('--check');
const CATEGORY = { win: 2, 'cursed-win': 1, 'maybe-win': 1, draw: 0, 'blessed-loss': -1, 'maybe-loss': -1, loss: -2 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Catalogue et noyau EG, sans DOM ─────────────────────────────────────────
const ctx = { console };
vm.createContext(ctx);
for (const f of ['js/modules/endgame/egCore.js', 'js/modules/endgame/egExercises.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: f });
const { EG, ENDGAME_EXERCISES } = ctx;
const sq = s => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
const uciOf = m => sq(EG.mFrom(m)) + sq(EG.mTo(m)) + (EG.mPromo(m) ? EG.LETTER[EG.mPromo(m)].toLowerCase() : '');

function legality(ex) {
    const st = EG.fromFen(ex.fen), problems = [];
    if (st.stm !== (ex.player === 'w' ? 1 : -1)) problems.push('le joueur n\'a pas le trait');
    if (EG.attacked(st.b, EG.kingSq(st.b, -st.stm), st.stm)) problems.push('roi adverse en échec');
    if (!EG.legalMoves(st).length) problems.push('aucun coup légal');
    return { st, problems };
}

// ─── Tables Syzygy ───────────────────────────────────────────────────────────
async function syzygy(fen) {
    for (let i = 0; i < 6; i++) {
        const r = await fetch('https://tablebase.lichess.ovh/standard?fen=' + encodeURIComponent(fen));
        if (r.status === 429) { console.log('   (limite de l\'API : pause d\'une minute)'); await sleep(61000); continue; }
        if (!r.ok) throw new Error(`API Syzygy : ${r.status} ${(await r.text()).slice(0, 120)}`);
        return r.json();
    }
    throw new Error('API Syzygy indisponible');
}

// ─── Stockfish (plus de 7 pièces) ────────────────────────────────────────────
function stockfish(fen, moves, depth = 22) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine/manifest.json'), 'utf8'));
    const v = manifest.variants.find(x => x.id === 'lite-single');
    const child = spawn(process.execPath, [path.join(ROOT, v.js.path)], { stdio: ['pipe', 'pipe', 'pipe'] });
    return new Promise((resolve, reject) => {
        let buf = '';
        const lines = {};
        const timer = setTimeout(() => { child.kill(); reject(new Error('moteur : délai dépassé')); }, 600000);
        child.stdout.on('data', d => {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const l = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                const m = l.match(/ multipv (\d+) score (cp|mate) (-?\d+)(?! (?:lower|upper)bound).* pv (\S+)/);
                if (m && !/bound/.test(l)) lines[m[4]] = m[2] === 'mate' ? { mate: +m[3] } : { cp: +m[3] };
                if (l.startsWith('bestmove')) { clearTimeout(timer); child.kill(); resolve(lines); }
            }
        });
        child.on('error', reject);
        child.stdin.write(`uci\nsetoption name Hash value 128\nsetoption name MultiPV value ${moves.length}\nposition fen ${fen}\ngo depth ${depth}\n`);
    });
}
const classify = s => (s.mate !== undefined ? (s.mate > 0 ? 2 : -2) : s.cp >= 250 ? 2 : s.cp <= -250 ? -2 : Math.abs(s.cp) <= 60 ? 0 : s.cp > 0 ? 1 : -1);

// ─── Vérification ────────────────────────────────────────────────────────────
const verdicts = {}, failures = [];
for (const ex of ENDGAME_EXERCISES.filter(e => !e.kind)) {
    const { st, problems } = legality(ex);
    const men = (ex.fen.split(' ')[0].match(/[a-z]/gi) || []).length;
    const target = ex.goal === 'win' ? 2 : 0;
    let v;
    if (!problems.length) {
        if (men <= 7) {
            const j = await syzygy(ex.fen);
            const good = j.moves.filter(m => (ex.goal === 'win' ? -CATEGORY[m.category] === 2 : -CATEGORY[m.category] >= 0)).map(m => m.uci);
            v = { fen: ex.fen, source: 'syzygy', wdl: CATEGORY[j.category], good };
            await sleep(400);
        } else {
            const moves = EG.legalMoves(st).map(uciOf);
            const ev = await stockfish(ex.fen, moves);
            const best = Object.values(ev).reduce((a, s) => Math.max(a, classify(s)), -2);
            const good = moves.filter(u => ev[u] && (ex.goal === 'win' ? classify(ev[u]) === 2 : classify(ev[u]) >= 0));
            v = { fen: ex.fen, source: 'engine', wdl: best, good };
        }
        if (v.wdl !== target) problems.push(`verdict ${v.source} ${v.wdl}, objectif ${ex.goal}`);
        if (!v.good.length) problems.push('aucun coup correct');
        if (ex.solution && !v.good.includes(ex.solution)) problems.push(`solution ${ex.solution} non confirmée`);
        if (ex.unique && v.good.length !== 1) problems.push(`${v.good.length} coups corrects, un seul attendu`);
    }
    console.log(`${problems.length ? '✗' : 'ok'}  ${ex.id.padEnd(24)} ${v ? `${v.source.padEnd(7)} ${String(v.wdl).padStart(2)}  ${v.good.length} coup(s) correct(s)` : ''}${problems.length ? '  ← ' + problems.join(' ; ') : ''}`);
    if (problems.length) failures.push(ex.id);
    if (v) verdicts[ex.id] = v;
}

if (failures.length) { console.error(`\n✗ ${failures.length} exercice(s) à corriger : ${failures.join(', ')}`); process.exit(1); }
if (CHECK_ONLY) { console.log('\n✓ Catalogue conforme.'); process.exit(0); }

// ─── Réécriture du bloc figé ─────────────────────────────────────────────────
const src = fs.readFileSync(FILE, 'utf8');
const body = Object.entries(verdicts).map(([id, v]) =>
    `    '${id}': { fen: '${v.fen}', source: '${v.source}', wdl: ${v.wdl}, good: [${v.good.map(u => `'${u}'`).join(', ')}] }`).join(',\n');
const out = src.replace(/const ENDGAME_VERDICTS = \{[\s\S]*?\};\n(?=\/\/ ─── FIN DES VERDICTS)/, `const ENDGAME_VERDICTS = {\n${body}\n};\n`);
if (out === src && !src.includes(body)) { console.error('Bloc ENDGAME_VERDICTS introuvable.'); process.exit(1); }
fs.writeFileSync(FILE, out);
console.log(`\n✓ ${Object.keys(verdicts).length} verdicts figés dans egExercises.js.`);
