// Outils communs des tests : retrouver un script par son nom, démarrer l'application entière dans jsdom.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

// ─── SCRIPTS ──────────────────────────────────────────────────────────────────
// Un test désigne un script par son nom de fichier : le déplacer ne touche pas aux tests.
let _paths = null;
function scriptPath(name) {
    if (!_paths) {
        _paths = {};
        (function walk(d) {
            for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
                const p = d + '/' + e.name;
                if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) _paths[e.name] = p;
            }
        })('js');
    }
    if (!_paths[name]) throw new Error('script introuvable : ' + name);
    return _paths[name];
}

// Source d'un script dont les const / let de premier niveau deviennent lisibles depuis le contexte du test.
const readVars = file => fs.readFileSync(file, 'utf8').replace(/^(const|let) (\w+) =/gm, 'var $2 =');

// ─── APPLICATION ENTIÈRE ──────────────────────────────────────────────────────
// Lit index.html et ses scripts sur le disque, sans réseau. L'écran de lancement est sauté (tests/shell/splash.test.js le couvre).
//   storage    clés posées dans localStorage avant le premier script
//   onboarded  false : la présentation de premier lancement reste possible
//   before(w)  réglages propres au test, avant le premier script
// Renvoie { dom, w, errors } : errors liste les erreurs levées pendant et après le chargement.
async function bootApp({ storage = {}, onboarded = true, before } = {}) {
    const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');
    const fromDisk = requestInterceptor(async request => {
        const u = new URL(request.url);
        if (u.hostname !== 'localhost') return new Response('');                                // polices, CDN : ignorés
        const type = u.pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
        return new Response(await fs.promises.readFile(path.join(ROOT, decodeURIComponent(u.pathname))), { headers: { 'Content-Type': type } });
    });
    const errors = [], vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message + (e.detail ? ' ' + (e.detail.stack || e.detail) : '')); });
    vc.on('error', (...a) => errors.push('console.error ' + a.join(' ')));
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
        url: 'http://localhost/index.html', runScripts: 'dangerously', resources: { interceptors: [fromDisk] }, pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(w) {
            w.sessionStorage.setItem('chays_splash', '1');
            if (onboarded) w.localStorage.setItem('chessTrainer_onboarded', '1');
            Object.entries(storage).forEach(([k, v]) => w.localStorage.setItem(k, v));
            w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
            w.Element.prototype.getAnimations = () => [];
            w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
            w.Element.prototype.scrollIntoView = () => {};
            w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
            w.addEventListener('error', e => errors.push(e.message));
            if (before) before(w);
        }
    });
    await new Promise(r => dom.window.addEventListener('load', r));
    await new Promise(r => setTimeout(r, 120));                                        // minuteurs à zéro lancés au chargement
    return { dom, w: dom.window, errors };
}

// Feuilles principales (ancien style.css), dans l'ordre d'index.html : la cascade et les tests en dépendent.
const mainCss = () => ['base', 'layout', 'components', 'board', 'game'].map(n => fs.readFileSync(path.join(ROOT, `css/${n}.css`), 'utf8')).join('\n');

module.exports = { ROOT, scriptPath, readVars, bootApp, mainCss };
