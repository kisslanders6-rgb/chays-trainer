// Lancer : node tests/engineQueue.test.js   — file de calcul du moteur (js/core/engine.js) avec un faux Worker :
// stop perdu, moteur muet, erreur ou silence au chargement. Horloge simulée, aucun réseau.
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

const FEN_A = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN_B = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

// behave(worker, cmd) répond comme stockfish.js ; par défaut : uciok, readyok, bestmove sur stop.
function boot(behave) {
    let now = 0;
    const timers = [];
    const workers = [];
    class FakeWorker {
        constructor(url) { this.url = url; this.sent = []; this.dead = false; workers.push(this); }
        postMessage(cmd) { this.sent.push(cmd); if (!this.dead) queueMicrotask(() => behave(this, cmd)); }
        say(line) { if (!this.dead && this.onmessage) this.onmessage({ data: line }); }
        terminate() { this.dead = true; }
    }
    const ctx = {
        Worker: FakeWorker, console, URL, Promise,
        Date: { now: () => now },
        setTimeout: (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); return timers.length; },
        clearTimeout: id => { if (id && timers[id - 1]) timers[id - 1].fn = null; },
        fetch: async () => ({ json: async () => ({ name: 'Stockfish', version: '19.0.1',
            variants: [{ id: 'lite-single', net: 'lite', threads: false, js: { path: 'engine/sf.js' }, wasm: {} }] }) })
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync('js/core/engine.js', 'utf8') + '\nglobalThis.Engine = Engine;', ctx, { filename: 'js/core/engine.js' });
    const advance = async ms => {
        const end = now + ms;
        for (;;) {
            const due = timers.filter(x => x.fn && x.at <= end).sort((a, b) => a.at - b.at)[0];
            if (!due) break;
            now = due.at; const fn = due.fn; due.fn = null; fn(); await flush();
        }
        now = end; await flush();
    };
    return { Engine: ctx.Engine, workers, advance };
}

const standard = (w, cmd) => {
    if (cmd === 'uci') w.say('uciok');
    else if (cmd === 'isready') w.say('readyok');
    else if (cmd === 'stop') w.say('bestmove e2e4');
};
const infoLine = 'info depth 12 seldepth 14 multipv 1 score cp 30 nodes 1000 nps 100000 pv e2e4 e7e5';
const positions = w => w.sent.filter(c => c.startsWith('position'));

(async () => {
    await t('déviation ordinaire : stop, bestmove, puis la nouvelle position part sur le même Worker', async () => {
        const { Engine, workers } = boot(standard);
        const a = Engine.analyse(FEN_A, { depth: 0 }); await flush();
        assert.strictEqual(Engine.status(), 'ready');
        Engine.analyse(FEN_B, { depth: 0 }); await flush();
        assert.strictEqual((await a.done).cancelled, false);
        assert.strictEqual(workers.length, 1);
        assert.deepStrictEqual(positions(workers[0]), [`position fen ${FEN_A}`, `position fen ${FEN_B}`]);
    });

    await t('stop perdu (go encore en file dans stockfish.js) : stop renvoyé tant que le calcul parle, sans recharger', async () => {
        let stops = 0;
        const { Engine, workers, advance } = boot((w, cmd) => {
            if (cmd === 'stop') { if (++stops >= 2) w.say('bestmove e2e4'); }   // le premier stop est « mangé »
            else standard(w, cmd);
        });
        Engine.analyse(FEN_A, { depth: 30 }); await flush();
        Engine.analyse(FEN_B, { depth: 30 }); await flush();
        assert.strictEqual(positions(workers[0]).length, 1);                     // B attend toujours
        await advance(150); workers[0].say(infoLine); await flush();             // le calcul continue de parler
        assert.strictEqual(stops, 2);
        assert.strictEqual(workers.length, 1);
        assert.deepStrictEqual(positions(workers[0]).pop(), `position fen ${FEN_B}`);
    });

    await t('moteur muet après stop : délai de garde, Worker recréé, la position voulue repart dessus', async () => {
        let silent = true;
        const { Engine, workers, advance } = boot((w, cmd) => { if (cmd === 'stop' && silent) return; standard(w, cmd); });
        const a = Engine.analyse(FEN_A, { depth: 0 }); await flush();
        const b = Engine.analyse(FEN_B, { depth: 0 }); await flush();
        await advance(2000);
        assert.strictEqual(positions(workers[0]).length, 1);                     // pas encore : 2,5 s en mono-thread
        await advance(600);
        assert.strictEqual((await a.done).cancelled, true);
        assert.strictEqual(workers.length, 2); assert.strictEqual(workers[0].dead, true);
        assert.deepStrictEqual(positions(workers[1]), [`position fen ${FEN_B}`]);
        silent = false; b.stop(); await flush();
        assert.strictEqual((await b.done).best, 'e2e4');
    });

    await t('moteur muet à répétition : erreur après 3 redémarrages, puis une nouvelle analyse recharge', async () => {
        let answer = false;
        const { Engine, workers, advance } = boot((w, cmd) => { if (cmd === 'stop' && !answer) return; standard(w, cmd); });
        Engine.analyse(FEN_A, { depth: 0 }); await flush();
        for (let i = 0; i < 3; i++) { Engine.analyse(i % 2 ? FEN_A : FEN_B, { depth: 0 }); await flush(); await advance(3000); }
        assert.strictEqual(Engine.status(), 'error'); assert.match(Engine.error(), /ne répond plus/);
        answer = true;
        const c = Engine.analyse(FEN_A, { depth: 0 }); await flush();
        assert.strictEqual(Engine.status(), 'ready'); assert.ok(workers.length >= 4);
        c.stop(); assert.strictEqual((await c.done).best, 'e2e4');
    });

    await t('erreur du Worker pendant le chargement : plus de chargement bloqué, la demande suivante réessaie', async () => {
        let crash = true;
        const { Engine, workers } = boot((w, cmd) => { if (cmd === 'uci' && crash) return w.onerror({ message: 'wasm introuvable' }); standard(w, cmd); });
        const a = Engine.analyse(FEN_A, { depth: 0 }); await flush();
        assert.strictEqual(Engine.status(), 'error'); assert.strictEqual((await a.done).cancelled, true);
        crash = false;
        Engine.analyse(FEN_B, { depth: 0 }); await flush();
        assert.strictEqual(Engine.status(), 'ready'); assert.strictEqual(workers.length, 2);
        assert.deepStrictEqual(positions(workers[1]), [`position fen ${FEN_B}`]);
    });

    await t('uciok qui n\'arrive jamais : erreur après le délai de chargement au lieu d\'un « chargement… » infini', async () => {
        const { Engine, advance } = boot((w, cmd) => { if (cmd !== 'uci') standard(w, cmd); });
        const a = Engine.analyse(FEN_A, { depth: 0 }); await flush();
        assert.strictEqual(Engine.status(), 'loading');
        await advance(30000);
        assert.strictEqual(Engine.status(), 'error'); assert.strictEqual((await a.done).cancelled, true);
    });

    await t('readyok absent avant un calcul : redémarrage, le calcul finit par partir', async () => {
        let mute = 0;
        const { Engine, workers, advance } = boot((w, cmd) => { if (cmd === 'isready' && mute-- === 1) return; standard(w, cmd); });
        Engine.analyse(FEN_A, { depth: 0 }); await flush();
        mute = 1;                                                                // le prochain isready reste sans réponse
        Engine.analyse(FEN_B, { depth: 0 }); await flush();
        await advance(15000);
        assert.strictEqual(workers.length, 2);
        assert.deepStrictEqual(positions(workers[1]), [`position fen ${FEN_B}`]);
    });

    await t('Worker tué en plein calcul : sondé, puis recréé, et le même calcul repart avec ses lignes', async () => {
        const { Engine, workers, advance } = boot(standard);
        const seen = [];
        const a = Engine.analyse(FEN_A, { depth: 0 }, lines => seen.push(lines.length)); await flush();
        workers[0].say(infoLine); await advance(200);
        assert.deepStrictEqual(seen, [1]);
        workers[0].dead = true;                                                  // le navigateur l'a arrêté, sans message
        await advance(4000);
        assert.strictEqual(workers[0].sent.at(-1), 'isready');                   // sonde d'abord
        assert.strictEqual(workers.length, 1);
        await advance(4000);
        assert.strictEqual(workers.length, 2);
        assert.deepStrictEqual(positions(workers[1]), [`position fen ${FEN_A}`]);
        workers[1].say(infoLine); await advance(200);
        a.stop(); assert.strictEqual((await a.done).best, 'e2e4');
        assert.strictEqual((await a.done).cancelled, false);
    });

    await t('calcul fini sans bestmove (mat en « go infinite ») : la sonde reçoit readyok, rien n\'est recréé', async () => {
        const { Engine, workers, advance } = boot(standard);
        Engine.analyse(FEN_A, { depth: 0 }); await flush();
        workers[0].say('info depth 0 score mate 0'); await flush();
        await advance(20000);
        assert.strictEqual(workers.length, 1);
        assert.ok(workers[0].sent.filter(c => c === 'isready').length >= 2);
    });

    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error('ÉCHEC :', e); process.exit(1); });
