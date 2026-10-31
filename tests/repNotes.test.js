// Lancer : node tests/repNotes.test.js   — description d'un répertoire (point 9) : saisie par le menu ⋮,
// affichage sous « Jouer » et dans la liste des répertoires, suivie au renommage, à la corbeille et à la restauration.
// Charge index.html entier dans jsdom, comme boot.test.js.
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const ROOT = path.join(__dirname, '..');

class DiskLoader extends ResourceLoader {
    fetch(url) {
        const u = new URL(url);
        if (u.hostname !== 'localhost') return Promise.resolve(Buffer.from(''));
        return fs.promises.readFile(path.join(ROOT, decodeURIComponent(u.pathname)));
    }
}

async function boot() {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
        url: 'http://localhost/index.html', runScripts: 'dangerously', resources: new DiskLoader(), pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(w) {
            w.localStorage.setItem('chessTrainer_onboarded', '1');
            w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
            w.Element.prototype.getAnimations = () => [];
            w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
            w.Element.prototype.scrollIntoView = () => {};
            w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
            w.addEventListener('error', e => errors.push(e.message));
        }
    });
    await new Promise(r => dom.window.addEventListener('load', r));
    await new Promise(r => setTimeout(r, 4000));
    return { w: dom.window, errors, $: s => dom.window.document.querySelector(s) };
}

(async () => {
    const { w, errors, $ } = await boot();
    const desc = () => $('#hp-play-desc');
    const submit = text => {
        $('#text-input').value = text;
        $('#text-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    };

    await t('sans description : rien sous « Jouer », menu « Ajouter une description »', () => {
        assert(desc().hidden);
        w.toggleRepMenu();
        assert.strictEqual($('#rep-menu-note-label').textContent, 'Ajouter une description');
        w.closeRepMenu();
    });

    await t('saisie par le menu ⋮ : affichée sous « Jouer », dans la liste et en infobulle de la puce, texte échappé', () => {
        w.repMenuAction('note');
        assert(!$('#text-overlay').classList.contains('hidden'));
        assert.strictEqual($('#text-input').maxLength, w.eval('REP_NOTE_MAX'));
        submit('  Najdorf   <b>Noirs</b>  ');
        assert.strictEqual(desc().hidden, false);
        assert.strictEqual(desc().textContent, 'Najdorf <b>Noirs</b>');
        assert(!desc().querySelector('b'), 'texte, pas du HTML');
        assert.strictEqual(w.repertoireNote('Général'), 'Najdorf <b>Noirs</b>');
        assert(/Najdorf/.test($('.rp-chip').title));
        const stored = JSON.parse(w.localStorage.getItem('chessTrainer_repNotes'));
        assert(stored['Général'].at > 0, 'datée pour la synchronisation');
        w.toggleRepMenu();
        assert.strictEqual($('#rep-menu-note-label').textContent, 'Modifier la description');
        w.closeRepMenu();
    });

    await t('texte vide : la description est effacée', () => {
        desc().click();                                     // toucher la description la modifie
        assert.strictEqual($('#text-input').value, 'Najdorf <b>Noirs</b>');
        submit('');
        assert($('#text-overlay').classList.contains('hidden'), 'vide accepté');
        assert(desc().hidden);
        assert.strictEqual(w.repertoireNote('Général'), '');
    });

    await t('renommage, corbeille et restauration : la description suit le répertoire', () => {
        w.addRepertoire('Sicile');
        w.setRepertoireNote('Sicile', 'Contre 1. e4');
        assert.strictEqual(w.renameRepertoire('Sicile', 'Sicilienne'), 'Sicilienne');
        assert.strictEqual(w.repertoireNote('Sicilienne'), 'Contre 1. e4');
        assert.strictEqual(w.repertoireNote('Sicile'), '');
        assert(w.deleteRepertoire('Sicilienne'));
        assert.strictEqual(w.repertoireNote('Sicilienne'), '');
        const item = w.loadTrash().find(it => it.type === 'repertoire' && it.rep === 'Sicilienne');
        assert(w.restoreTrashItem(item.id).ok);
        assert.strictEqual(w.repertoireNote('Sicilienne'), 'Contre 1. e4');
        w.selectRepertoire('Sicilienne');
        assert.strictEqual(desc().textContent, 'Contre 1. e4');
        w.selectRepertoire('Général');
    });

    assert.deepStrictEqual(errors, []);
    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
