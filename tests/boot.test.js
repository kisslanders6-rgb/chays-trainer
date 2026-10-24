// Lancer : node tests/boot.test.js   — l'application démarre dans un vrai document (jsdom) : tous les scripts
// d'index.html se chargent dans l'ordre, sans erreur (nom global déclaré deux fois, fonction utilisée avant
// d'être chargée…), puis la présentation de premier lancement s'affiche.
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

const ROOT = path.join(__dirname, '..');

class DiskLoader extends ResourceLoader {
    fetch(url) {
        const u = new URL(url);
        if (u.hostname !== 'localhost') return Promise.resolve(Buffer.from(''));           // polices, CDN : ignorés
        return fs.promises.readFile(path.join(ROOT, decodeURIComponent(u.pathname)));
    }
}

async function boot(storage = {}) {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message + (e.detail ? ' ' + (e.detail.stack || e.detail) : '')); });
    vc.on('error', (...a) => errors.push('console.error ' + a.join(' ')));
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
        url: 'http://localhost/index.html', runScripts: 'dangerously', resources: new DiskLoader(), pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(w) {
            Object.entries(storage).forEach(([k, v]) => w.localStorage.setItem(k, v));
            w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
            w.Element.prototype.getAnimations = () => [];
            w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
            w.Element.prototype.scrollIntoView = () => {};
            w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
            w.addEventListener('error', e => errors.push(e.message));
        }
    });
    await new Promise(r => dom.window.addEventListener('load', r));
    await new Promise(r => setTimeout(r, 5000));                                   // écran de lancement (4,5 s au plus)
    return { w: dom.window, errors };
}

(async () => {
    await t('premier lancement : tous les scripts se chargent sans erreur, présentation affichée', async () => {
        const { w, errors } = await boot();
        assert.deepStrictEqual(errors, []);
        assert(!w.document.getElementById('onboarding-overlay').classList.contains('hidden'), 'présentation absente');
        assert(/Une seule réponse/.test(w.document.getElementById('onboarding-box').textContent));
        assert(w.document.querySelector('#home-stats .home-empty'), 'accueil vide : « Par où commencer ? » absent');
        w.close();
    });

    await t('appareil avec des données : pas de présentation, anciennes clés converties au démarrage', async () => {
        const legacy = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
        const { w, errors } = await boot({ 'openingDB_Général_w': JSON.stringify({ [legacy]: { move: 'e2e4', san: 'e4', attempts: 2, failures: 0 } }) });
        assert.deepStrictEqual(errors, []);
        assert(w.document.getElementById('onboarding-overlay').classList.contains('hidden'));
        assert.deepStrictEqual(Object.keys(JSON.parse(w.localStorage.getItem('openingDB_Général_w'))), [legacy + ' KQkq -']);
        w.close();
    });

    console.log(`\n${n} tests réussis.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
