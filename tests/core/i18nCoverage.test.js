// Lancer : node tests/core/i18nCoverage.test.js   — aucune phrase française sur les écrans principaux dans une autre langue,
// pluriels selon la langue, paquets alignés. Échoue si un texte affiché échappe à la traduction (TOLERATED : noms et coups).
const { bootApp } = require('../_app.js');
const fs = require('fs'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

// Ce qui reste légitimement tel quel : marques, lettres seules, coups, noms donnés par l'utilisateur, jeux de pièces.
const TOLERATED = [/^.$/, /^(Chays|Trainer|Chays Trainer|Lichess|Chess\.com|OK|li|c|⌘F|Ctrl F)$/, /^Général$|^test$|^Mathis$/, /^[\d.… ]*([KQRBNO][\w+#=x-]*|[a-h][\w+#=x-]*)( |$)/, /^\d+\. /, /^Italienne/];
const pack = l => JSON.parse(fs.readFileSync(`lang/${l}.json`, 'utf8'));

async function boot(lang) {
    const { dom, errors } = await bootApp({ storage: { chessTrainer_settings: JSON.stringify({ lang, pseudo: 'Mathis' }), chays_langPack: JSON.stringify({ id: lang, dict: pack(lang) }) }, before(w) { w.scrollTo = () => {}; } });
    const w = dom.window;
    w.eval(`(() => {
        const p = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4 e5d4 c3d4 c5b4'.split(' '), db = {}, now = Date.now();
        for (let k = 0; k < p.length; k += 2) {
            const path = p.slice(0, k + 1), pos = Chess.replay(path.slice(0, -1));
            db[Chess.key(pos)] = { move: path[k], san: Chess.san(pos, path[k]), attempts: k ? 10 : 0, failures: k % 4 ? 5 : 8, path, ply: path.length, due: now - 864e5, interval: 3, created: now };
        }
        dataStore.set(dbKeyFor(currentRepertoire, 'w'), JSON.stringify(db));
        const act = {}; for (let i = 0; i < 40; i++) if (i % 3) act[dayStamp(now - i * 864e5)] = { a: 2 + i, f: 1 };
        dataStore.setJSON('chessTrainer_activity', act);
        renderHomeSummary(); switchHomeTab('stats'); initStats();
        document.querySelector('.st-weak .st-link')?.click();
        document.querySelector('#stats-weak-all .st-back')?.click();
    })()`);
    await new Promise(r => setTimeout(r, 50));     // l'observateur traduit après le rendu
    // Onglet Parties rempli : archive simulée, 12 parties d'une même ligne.
    w.eval(`(() => {
        const g = i => ({ rules: 'chess', uuid: 'u' + i, end_time: 1790000000 + i * 86400, time_class: 'blitz', rated: true, accuracies: { white: 80, black: 80 },
            pgn: '[White "Moi"]\\n\\n1. e4 e5 2. Nf3 Nf6 3. Nxe5 ' + (i % 2 ? '1-0' : '0-1'), url: 'x',
            white: { username: 'Moi', rating: 1500 + i, result: i % 2 ? 'win' : 'checkmated' }, black: { username: 'Lui', rating: 1400 + i * 30, result: i % 2 ? 'resigned' : 'win' } });
        window.fetch = async url => /archives$/.test(url)
            ? { status: 200, ok: true, json: async () => ({ archives: ['https://api.chess.com/pub/player/moi/games/2026/10'] }) }
            : { status: 200, ok: true, json: async () => ({ games: Array.from({ length: 12 }, (_, i) => g(i)) }) };
        appSettings.chesscomUser = 'Moi';
        initStats();
        document.querySelector('#stats-games [data-action="statsGamesSync"]').click();
    })()`);
    await new Promise(r => setTimeout(r, 400));
    return { w, errors, $: s => w.document.querySelector(s) };
}

(async () => {
    const { w, errors, $ } = await boot('en');

    await t('accueil en anglais : salutation avec pseudo et ligne du jour entièrement traduites', () => {
        assert(/^Good (evening|morning|day|afternoon)|^Hello/.test($('.hp-over').textContent), $('.hp-over').textContent);
        assert(/Mathis/.test($('.hp-over').textContent));
        const sub = $('.hp-sub').textContent;
        assert(!/Environ|Blancs|Noirs|dont|encore|objectif/.test(sub), sub);
    });

    await t('légende du calendrier et initiales des jours : plus de « at most »', () => {
        assert(/^Few/.test($('.st-heat-leg').textContent.trim()) && /Many$/.test($('.st-heat-leg').textContent.trim()), $('.st-heat-leg').textContent);
        assert.strictEqual($('.st-heat-d').textContent, 'M', 'lundi, d\'après la langue');
    });

    await t('aucun texte français non reconnu sur l\'accueil et les Statistiques', () => {
        const left = JSON.parse(w.eval('JSON.stringify(I18n.missing())')).filter(s => !TOLERATED.some(re => re.test(s)));
        assert.deepStrictEqual(left, []);
    });

    await t('pluriels : russe (une, quelques, beaucoup) et arabe (six formes)', () => {
        const tr = (l, s) => w.eval(`I18n.install(${JSON.stringify(l)}, ${JSON.stringify(pack(l))}); I18n.t(${JSON.stringify(s)})`);
        const ru = pack('ru')['{n} positions'].split('|');
        assert.strictEqual(tr('ru', '1 position'), ru[0].replace('{n}', '1'));
        assert.strictEqual(tr('ru', '3 positions'), ru[1].replace('{n}', '3'));
        assert.strictEqual(tr('ru', '7 positions'), ru[2].replace('{n}', '7'));
        const ar = pack('ar')['{n} positions'].split('|');
        assert.strictEqual(ar.length, 6);
        assert.strictEqual(tr('ar', '5 positions'), ar[3].replace('{n}', '5'));
        assert.strictEqual(tr('ar', '11 positions'), ar[4].replace('{n}', '11'));
    });

    await t('chaque phrase à nombre de l\'anglais existe dans tous les paquets', () => {
        const en = Object.keys(pack('en')).filter(k => k.includes('{n}'));
        assert(en.length >= 20);
        ['es', 'zh-Hans', 'de', 'pt-PT', 'pt-BR', 'ru', 'ja', 'hi', 'ar'].forEach(l => {
            const p = pack(l);
            assert.deepStrictEqual(en.filter(k => !(k in p)), [], l);
        });
    });

    assert.deepStrictEqual(errors, []);
    w.close();
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
