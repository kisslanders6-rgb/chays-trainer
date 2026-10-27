// Lancer : node tests/splash.test.js   — écran de lancement : version longue une fois par jour (« la plume »),
// courte ensuite (« la gravure »). Seuls les scripts en ligne d'index.html tournent (aucune ressource chargée) ;
// requestAnimationFrame et la géométrie SVG sont simulés pour suivre la plume et l'encre.
const fs = require('fs'), assert = require('assert');
const { JSDOM } = require('jsdom');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const html = fs.readFileSync('index.html', 'utf8');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

function open(storage = {}) {
    const frames = [], anims = [];
    const dom = new JSDOM(html, {
        url: 'https://chays.test/app/', runScripts: 'dangerously',
        beforeParse(w) {
            Object.entries(storage).forEach(([k, v]) => w.localStorage.setItem(k, v));
            w.matchMedia = () => ({ matches: false, addEventListener() {} });
            w.requestAnimationFrame = cb => frames.push(cb);
            w.Element.prototype.animate = function (kf, opt) { anims.push({ el: this, kf, opt }); return { finished: Promise.resolve(), cancel() {} }; };
            w.SVGElement.prototype.getTotalLength = () => 100;
            w.SVGElement.prototype.getPointAtLength = l => ({ x: 200 + l, y: 100 });
            w.SVGElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 140, height: 320, right: 140, bottom: 320 });
        }
    });
    const w = dom.window, start = w.performance.now();
    const frame = ms => { const cbs = frames.splice(0); cbs.forEach(cb => cb(start + ms)); };
    return { w, d: w.document, anims, frame };
}

t('première ouverture du jour : version longue, jour noté sur l\'appareil', () => {
    const { w, d } = open();
    assert(d.documentElement.classList.contains('splashing') && !d.documentElement.classList.contains('splash-quick'));
    assert.strictEqual(w.localStorage.getItem('chessTrainer_splashDay'), today());
});

t('la plume : encre sous les contours, qui monte de la base vers la croix ; le point suit le trait', () => {
    const { d, frame } = open();
    const ink = d.querySelector('.sp-ink'), rect = d.querySelector('#sp-ink-clip rect'), nib = d.querySelector('.sp-nib');
    assert(ink && ink.querySelectorAll('path').length === 3, 'copie des trois parties pleines');
    assert(!ink.querySelector('[id]'), 'pas d\'identifiant en double');
    assert(d.getElementById('piece').classList.contains('sp-outline'), 'contours sans remplissage');
    frame(100);
    assert.strictEqual(+rect.getAttribute('y'), 354, 'encre pas encore montée à 0,1 s');
    assert.strictEqual(nib.style.opacity, '1', 'la plume trace le socle');
    frame(1050);
    const y = +rect.getAttribute('y');
    assert(y < 354 && y > 34, 'encre à mi-hauteur à 1,05 s');
    frame(1500);
    assert.strictEqual(+rect.getAttribute('y'), 34, 'encre en haut à 1,5 s');
    frame(1700);
    assert.strictEqual(nib.style.opacity, '1', 'la plume écrit la signature');
    frame(2100);
    assert.strictEqual(nib.style.opacity, '0', 'plume rangée après la signature');
});

t('ouvertures suivantes du jour : version courte, seule la gravure se réécrit en moins d\'une demi-seconde', () => {
    const { d, anims } = open({ chessTrainer_splashDay: today() });
    assert(d.documentElement.classList.contains('splash-quick'));
    assert(!d.querySelector('.sp-ink'), 'pas de tracé complet');
    const grav = anims.filter(a => a.el.id === 'gravure-trait');
    assert(grav.length && grav.every(a => (a.opt.delay || 0) + a.opt.duration <= 450));
    assert.strictEqual(anims.filter(a => a.el.id !== 'gravure-trait').length, 0);
});

t('sortie : courte plus rapide, un toucher écourte la suspension, signature de la plume recalée', () => {
    const splash = fs.readFileSync('js/core/splash.js', 'utf8'), css = fs.readFileSync('css/splash.css', 'utf8');
    assert(/const SPEED\s+= QUICK \? \.55 : 1;/.test(splash) && /IntroTimeline\.land\(splash, SPEED\)/.test(splash));
    assert(/\['pointerdown', 'keydown'\]/.test(splash) && /Promise\.race\(\[hold \?/.test(splash), 'toucher pour passer');
    assert(/\.splashing\.splash-quick \.splash \{ animation-duration: \.45s; \}/.test(css), 'suspension courte');
    assert(/\.ct-wm-1 \{ animation: spWrite \.42s linear 1\.56s both; \}/.test(css), 'signature au rythme de la plume (1,56 → 1,98 s)');
    assert(/function land\(splash, speed = 1\)/.test(fs.readFileSync('js/core/introTimeline.js', 'utf8')));
});

console.log(`\n${n} tests réussis.`);
