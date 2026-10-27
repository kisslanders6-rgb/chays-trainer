// Lancer : node tests/announce.test.js   — annonce des coups (js/core/sound.js) : phrase en toutes lettres,
// région aria-live écrite au tour suivant, synthèse vocale, ancien interrupteur converti.
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

function boot({ speech = false } = {}) {
    const nodes = {}, timers = [];
    const el = id => ({ id, textContent: '', className: '', setAttribute() {} });
    nodes['sr-moves'] = el('sr-moves');
    const spoken = [];
    const ctx = {
        console, appSettings: { announce: 'sr', sound: false, volume: 0 },
        document: { getElementById: id => nodes[id] || null, createElement: () => el(''), body: { appendChild() {} } },
        setTimeout: (fn, ms) => { timers.push(fn); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1] = null; },
        addEventListener() {}
    };
    if (speech) {
        ctx.SpeechSynthesisUtterance = function (text) { this.text = text; };
        ctx.speechSynthesis = { getVoices: () => [{ lang: 'fr-FR', localService: true, name: 'Thomas' }], addEventListener() {},
                                cancel() { spoken.push('cancel'); }, speak(u) { spoken.push(u.text); } };
    }
    vm.createContext(ctx);
    for (const f of ['js/core/chessEngine.js', 'js/core/sound.js'])
        vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 ='), ctx, { filename: f });
    ctx.run = s => vm.runInContext(s, ctx);
    ctx.flush = () => { timers.splice(0).forEach(fn => fn && fn()); };
    return { ctx, live: nodes['sr-moves'], spoken };
}

(async () => {
    await t('phrase : pièce, prise, case, roques, promotion, échec, mat', () => {
        const { ctx } = boot(), say = (san, w = true) => ctx.run(`spokenMove(${JSON.stringify(san)}, ${w})`);
        assert.strictEqual(say('Nf3'), 'Blancs : Cavalier f3');
        assert.strictEqual(say('exd5', false), 'Noirs : Pion prend d5');
        assert.strictEqual(say('Bxf7+'), 'Blancs : Fou prend f7, échec');
        assert.strictEqual(say('O-O'), 'Blancs : petit roque');
        assert.strictEqual(say('O-O-O+', false), 'Noirs : grand roque, échec');
        assert.strictEqual(say('e8=Q#'), 'Blancs : Pion e8, promotion en Dame, échec et mat');
        assert.strictEqual(say('Rad1'), 'Blancs : Tour d1');
    });

    await t('coup sur l\'échiquier : SAN calculée avant le coup (échec compris), région écrite au tour suivant', () => {
        const { ctx, live } = boot();
        ctx.run(`parseFEN('rnbqkbnr/ppppp2p/5p2/6p1/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3')`);
        ctx.run(`announceMove(squareToIdx('d1'), squareToIdx('h5'), false)`);
        assert.strictEqual(live.textContent, '');                     // vidée d'abord : un texte identique est relu
        ctx.flush();
        assert.strictEqual(live.textContent, 'Blancs : Dame h5, échec et mat');
    });

    await t('deux coups rapprochés : seule la dernière annonce reste', () => {
        const { ctx, live } = boot();
        ctx.run(`announceText('Blancs : Pion e4'); announceText('Noirs : Pion e5')`);
        ctx.flush();
        assert.strictEqual(live.textContent, 'Noirs : Pion e5');
    });

    await t('réglage « Non » : rien n\'est écrit ; « Voix » : la synthèse parle, la précédente est coupée', () => {
        const a = boot(); a.ctx.appSettings.announce = 'off';
        a.ctx.run(`announceText('x')`); a.ctx.flush(); assert.strictEqual(a.live.textContent, '');
        const b = boot({ speech: true }); b.ctx.appSettings.announce = 'voice';
        assert.strictEqual(b.ctx.run('Voice.available() && Voice.hasFrench()'), true);
        b.ctx.run(`announceText('Blancs : Cavalier f3')`);
        assert.deepStrictEqual(b.spoken, ['cancel', 'Blancs : Cavalier f3']);
        assert.strictEqual(b.live.textContent, '');                    // pas de double lecture
    });

    await t('ancien interrupteur (true / false) converti en « Lecteur d\'écran » / « Non » ; région déclarée dans index.html', () => {
        const mem = new Map([['chessTrainer_settings', JSON.stringify({ announce: true })]]);
        const sctx = { localStorage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), get length() { return mem.size; }, key: i => [...mem.keys()][i] },
                       document: { documentElement: { setAttribute() {} } }, Date, JSON };
        vm.createContext(sctx);
        ['js/core/storageAdapter.js', 'js/core/settings.js'].forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), sctx));
        assert.strictEqual(vm.runInContext('appSettings.announce', sctx), 'sr');
        assert.strictEqual(vm.runInContext(`(dataStore.set('chessTrainer_settings', '{"announce":false}'), loadSettings().announce)`, sctx), 'off');
        assert(/<div id="sr-moves" class="sr-only" aria-live="polite" aria-atomic="true"><\/div>/.test(fs.readFileSync('index.html', 'utf8')));
    });

    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error('ÉCHEC :', e); process.exit(1); });
