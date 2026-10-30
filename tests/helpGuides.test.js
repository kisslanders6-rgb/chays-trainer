// Lancer : node tests/helpGuides.test.js   — fenêtre Aide « Sommaire vivant » (js/core/helpUI.js), dans index.html
// complet (jsdom) : un seul bouton plein par guide, vers une action enregistrée ; aucun guide ne dit que Jouer
// compte ; recherche groupée (tâches, guides, questions, raccourcis) au clavier ; focus selon le pointeur.
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
            w.__coarse = false;                                     // pointeur simulé : fin (souris) par défaut
            w.matchMedia = q => ({ matches: /pointer:\s*coarse/.test(q) ? w.__coarse : false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
            w.Element.prototype.getAnimations = () => [];
            w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
            w.Element.prototype.scrollIntoView = () => {};
            w.fetch = () => Promise.reject(new Error('réseau coupé (test)'));
            w.addEventListener('error', e => errors.push(e.message));
        }
    });
    await new Promise(r => dom.window.addEventListener('load', r));
    await new Promise(r => setTimeout(r, 5000));                   // écran de lancement
    const w = dom.window;
    w.eval('if (typeof closeOnboarding === "function") closeOnboarding()');
    return { w, errors };
}

const strip = s => s.replace(/<[^>]+>/g, '');

(async () => {
    const { w, errors } = await boot();
    const doc = w.document, $ = s => doc.querySelector(s);
    const overlay = () => $('#help-overlay'), content = () => $('#help-overlay .pn-content');
    const input = () => $('#help-overlay [data-pn="search"]');
    const guides = w.eval('HELP_GUIDES'), targets = w.eval('HELP_TARGETS'), tasks = w.eval('HELP_TASKS');
    const search = q => { input().value = q; input().dispatchEvent(new w.Event('input', { bubbles: true })); };
    const key = k => input().dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));

    await t('chargement sans erreur', () => assert.deepStrictEqual(errors, []));

    await t('guides attendus, dont Analyser mes parties, Analyse et Compte, avec la puce de comptage de la règle', () => {
        const ids = guides.map(g => g.id);
        ['play', 'training', 'stats', 'endgame', 'games', 'analysis', 'account'].forEach(id => assert(ids.includes(id), `guide ${id} absent`));
        const label = id => guides.find(g => g.id === id).count.label;
        assert.strictEqual(label('play'), 'Ne compte rien');
        assert.strictEqual(label('analysis'), 'Ne compte rien');
        assert.strictEqual(label('training'), 'Compte');
        assert.strictEqual(label('games'), 'Erreur comptée une fois par partie');
        assert.strictEqual(label('stats'), 'Observe');
        guides.forEach(g => assert(g.points.length >= 3 && g.points.length <= 4, `${g.id} : ${g.points.length} points`));
        assert(/Ajouter au répertoire/.test(guides.find(g => g.id === 'analysis').points.join(' ')), 'Analyse : rien avant « Ajouter au répertoire »');
    });

    await t('chaque guide : exactement un bouton plein, vers une action enregistrée, et « Guide suivant » sauf le dernier', () => {
        const icons = w.eval('_ICONS');
        guides.forEach((g, i) => {
            w.showHelp('g-' + g.id);
            const prim = content().querySelectorAll('.btn-primary');
            assert.strictEqual(prim.length, 1, `${g.id} : ${prim.length} boutons pleins`);
            assert.strictEqual(prim[0].textContent.trim(), 'Ouvrir ' + targets[g.to].label);
            const tg = targets[prim[0].dataset.v];
            assert(tg, `${g.id} : destination inconnue`);
            assert.strictEqual(w.eval(`typeof UI_ACTIONS[${JSON.stringify(tg.action)}]`), 'function', `${g.id} : action ${tg.action} non enregistrée`);
            assert(content().querySelector(`.vbadge`).textContent === g.count.label);
            assert.strictEqual(!!content().querySelector('.hg-next'), i < guides.length - 1);
            assert(icons[g.icon], `icône ${g.icon} absente du sprite`);
        });
        tasks.forEach(tk => { assert(targets[tk.to], tk.id); assert(icons[tk.icon], `icône ${tk.icon}`); });
        Object.values(targets).forEach(tg => assert.strictEqual(w.eval(`typeof UI_ACTIONS[${JSON.stringify(tg.action)}]`), 'function', tg.action));
        w.closeHelp();
    });

    await t('aucun texte de guide n’affirme que Jouer compte', () => {
        const negated = s => /\b(ne|rien|aucun|sans)\b|n’|n'|qu’à/i.test(s);
        guides.forEach(g => {
            const texts = [g.title, g.sub, g.count.label, ...g.points.map(strip)];
            texts.flatMap(x => x.split(/[.;:!?]\s/)).forEach(s => {
                const aboutPlay = g.id === 'play' || /\bJouer\b/.test(s);
                if (aboutPlay && /compt/i.test(s)) assert(negated(s), `« ${s} » (${g.id})`);
            });
        });
    });

    await t('ouverture : accueil (étapes, six tâches, guides), un seul bouton plein, focus dans la recherche (pointeur fin)', () => {
        w.__coarse = false;
        w.showHelp();
        assert(!overlay().classList.contains('hidden'));
        assert.strictEqual(doc.activeElement, input(), 'la recherche doit avoir le focus');
        assert.strictEqual(content().querySelectorAll('.hs-step').length, 3);
        assert.strictEqual(content().querySelectorAll('.hs-task').length, 6);
        assert.strictEqual(content().querySelectorAll('.hs-guide').length, guides.length);
        assert.strictEqual(content().querySelectorAll('.btn-primary').length, 1);
        assert(/Construire un répertoire[\s\S]*Réviser aujourd’hui[\s\S]*Importer un PGN[\s\S]*Comparer mes parties[\s\S]*Synchroniser mes appareils[\s\S]*Retrouver un répertoire supprimé/.test(content().textContent));
        w.closeHelp();
    });

    await t('écran tactile : la recherche ne prend pas le focus (pas de clavier imposé)', () => {
        w.__coarse = true;
        w.showHelp();
        assert.notStrictEqual(doc.activeElement, input());
        w.closeHelp();
        w.__coarse = false;
    });

    await t('recherche : un raccourci et un guide trouvés, groupés, le premier présélectionné, surlignage', () => {
        w.showHelp();
        search('retourner');
        const heads = [...content().querySelectorAll('.hr-h')].map(h => h.textContent);
        assert(heads.includes('Raccourcis'), heads.join());
        assert(/Retourner l’échiquier/.test(content().textContent));
        const rows = content().querySelectorAll('.hr-row');
        assert(rows[0].classList.contains('is-sel'));
        assert.strictEqual(content().querySelectorAll('.hr-row.is-sel').length, 1);
        assert(content().querySelector('mark'), 'surlignage');
        search('statistiques');
        assert([...content().querySelectorAll('.hr-h')].some(h => h.textContent === 'Guides'));
        search('revision');                                          // sans accent : trouve « révision », surligné
        assert(/révision/i.test(content().querySelector('mark').textContent));
        w.closeHelp();
    });

    await t('clavier : ↓ déplace la sélection, Entrée ouvre le premier résultat, Échap efface', () => {
        w.showHelp();
        search('finales');
        const first = w.eval('_helpResults[0].title');
        key('ArrowDown');
        assert(content().querySelectorAll('.hr-row')[1].classList.contains('is-sel'));
        key('ArrowUp');
        assert(content().querySelectorAll('.hr-row')[0].classList.contains('is-sel'));
        key('Enter');
        assert.strictEqual(input().value, '');
        assert.strictEqual(content().querySelector('.hg-t').textContent, first);

        search('retourner');
        key('Enter');                                                // premier résultat : un raccourci → page Raccourcis
        assert(/Clavier et souris/.test(content().textContent));

        search('pgn');
        doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.strictEqual(input().value, '');
        assert(!overlay().classList.contains('hidden'), 'Échap efface d’abord la recherche');
        w.closeHelp();
    });

    await t('action directe : Entrée sur une tâche ferme l’Aide et ouvre l’endroit (Corbeille)', () => {
        w.showHelp();
        search('corbeille');
        assert.strictEqual(w.eval('_helpResults[0].group'), 'Tâches');
        key('Enter');
        assert(overlay().classList.contains('hidden'));
        assert(!$('#trash-overlay').classList.contains('hidden'));
        w.closeTrash();
    });

    await t('« Ouvrir Statistiques » ferme l’Aide et affiche l’onglet', () => {
        w.showHelp('g-stats');
        content().querySelector('.btn-primary').click();
        assert(overlay().classList.contains('hidden'));
        const tab = doc.querySelector('#home-tab-stats:not(.hidden)');
        assert(tab, 'onglet Statistiques non affiché');
    });

    await t('aucune recherche vide : suggestions cliquables', () => {
        w.showHelp();
        search('roque long xyz');
        assert(/Rien sur « roque long xyz »/.test(content().textContent));
        content().querySelector('.hr-chip').click();
        assert.strictEqual(input().value, 'sauvegarde');
        assert(content().querySelector('.hr-row'));
        w.closeHelp();
    });

    w.close();
    console.log(`\n${n} tests réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
