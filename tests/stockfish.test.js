// Lancer : node tests/stockfish.test.js   — moteur Stockfish embarqué (engine/manifest.json) : fichiers intacts,
// protocole UCI, mats trouvés. Le moteur mono-thread tourne dans Node comme dans le navigateur (même fichier).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { spawn } = require('child_process');
let n = 0;
const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine/manifest.json'), 'utf8'));

// Lance le moteur, envoie les commandes, attend la première ligne qui satisfait `until`. Renvoie toutes les lignes.
function uci(commands, until, timeout = 60000) {
    const v = manifest.variants.find(x => !x.threads);
    const child = spawn(process.execPath, [path.join(ROOT, v.js.path)], { stdio: ['pipe', 'pipe', 'pipe'] });
    return new Promise((resolve, reject) => {
        const lines = [];
        let buf = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('délai dépassé :\n' + lines.slice(-5).join('\n'))); }, timeout);
        child.stdout.on('data', d => {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                lines.push(line);
                if (until(line)) { clearTimeout(timer); child.stdin.end('quit\n'); child.kill(); resolve(lines); return; }
            }
        });
        child.on('error', reject);
        child.stdin.write(commands.join('\n') + '\n');
    });
}

const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

(async () => {
    await t('manifeste : chaque fichier existe, taille et empreinte sha256 conformes', () => {
        assert(/^\d+\.\d+\.\d+$/.test(manifest.version));
        assert(manifest.variants.some(v => v.threads) && manifest.variants.some(v => !v.threads));
        manifest.variants.forEach(v => ['js', 'wasm'].forEach(ext => {
            const f = v[ext], data = fs.readFileSync(path.join(ROOT, f.path));
            assert.strictEqual(data.length, f.bytes, f.path);
            assert.strictEqual(crypto.createHash('sha256').update(data).digest('hex'), f.sha256, f.path);
        }));
        assert(fs.existsSync(path.join(ROOT, 'engine', manifest.version, 'COPYING.txt')), 'licence GPL jointe');
    });

    await t('UCI : identification, puis readyok', async () => {
        const lines = await uci(['uci', 'isready'], l => l === 'readyok');
        assert(lines.some(l => /^id name Stockfish/.test(l)), lines.slice(0, 5).join('\n'));
        assert(lines.includes('uciok'));
        assert(lines.some(l => /option name MultiPV/.test(l)));
    });

    await t('mat en 1 trouvé (Dh5xf7#)', async () => {
        const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
        const lines = await uci(['uci', `position fen ${fen}`, 'go depth 8'], l => l.startsWith('bestmove'));
        assert.strictEqual(lines.find(l => l.startsWith('bestmove')).split(' ')[1], 'h5f7');
        assert(lines.some(l => / score mate 1 /.test(l)));
    });

    await t('MultiPV 3 : trois lignes numérotées, scores et variantes', async () => {
        const lines = await uci(['uci', 'setoption name MultiPV value 3', 'position startpos', 'go depth 10'], l => l.startsWith('bestmove'));
        const last = k => lines.filter(l => new RegExp(`^info .*\\bmultipv ${k}\\b.* pv `).test(l)).pop();
        [1, 2, 3].forEach(k => assert(last(k), 'ligne ' + k + ' absente'));
        assert(/ score (cp|mate) -?\d+/.test(last(1)));
    });

    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
