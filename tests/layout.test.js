// Lancer : node tests/layout.test.js   — règles de mise en page lues dans style.css (jsdom ne calcule pas les tailles).
const fs = require('fs'), assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const css = fs.readFileSync('style.css', 'utf8');

// ─── Échiquier à la taille de l'écran (920px+) ───────────────────────────────
const start = css.indexOf("ÉCHIQUIER À LA TAILLE DE L'ÉCRAN");
const block = css.slice(start, css.indexOf('/* ─── MENU', start));

t('boutons du bas : barre fixée de la tablette et du téléphone en paysage, sans conteneur qui la retiendrait', () => {
    const i = css.indexOf('Tablette et téléphone en paysage'), bloc = css.slice(i, css.indexOf('/* Arabe', i));
    assert(i > 0 && /@media \(min-width: 600px\) and \(max-width: 919px\), \(orientation: landscape\) and \(max-height: 520px\) and \(min-width: 600px\) and \(max-width: 1100px\)/.test(bloc));
    assert(/\.board-controls \{\s+position: fixed; left: 0; right: 0; bottom: 0;/.test(bloc));
    assert(/\.game-screen-inner \{ padding-bottom: calc\(var\(--thumb-h\)/.test(bloc), 'le contenu ne passe pas sous la barre');
    assert(/\.game-main \{ container-type: normal;/.test(bloc), 'dès 920 px, .game-main est un conteneur');
    assert(/--bw: clamp\(180px, calc\(100dvh - 56px - var\(--thumb-h\)/.test(bloc), 'paysage : l\'échiquier laisse la place à la barre');
});

t("échiquier 920px+ : bloc présent, après la règle .sq de base (même spécificité, l'ordre décide)", () => {
    assert(start > 0, 'bloc « ÉCHIQUIER À LA TAILLE DE L\'ÉCRAN » introuvable');
    const base = css.search(/^\.sq \{ width: 64px/m);
    assert(base > 0 && base < start, 'le bloc doit suivre « .sq { width: 64px … } », sinon les cases restent à 64 px');
    assert(/\.sq \{ width: auto; height: auto; aspect-ratio: 1 \/ 1;/.test(block));
});

t('échiquier 920px+ : jamais plus petit que les 512 px d\'avant, plafonné, arrondi à des cases entières', () => {
    const bws = [...block.matchAll(/--bw: (.+);/g)].map(m => m[1]);
    assert.strictEqual(bws.length, 2, 'une valeur de --bw sans round(), une avec');
    bws.forEach(v => assert(/clamp\(512px, min\(100cqw - \d+px, 100dvh - var\(--topnav-h\) - var\(--board-chrome-h\)\), 960px\)/.test(v), v));
    assert(/^round\(down, .+, 8px\)$/.test(bws[1]), 'multiple de 8 : 8 cases de largeur entière');
    assert(/@supports \(width: round\(down, 100px, 8px\)\)/.test(block), 'round() derrière @supports, repli sans arrondi');
});

t('échiquier 920px+ : --board-chrome-h = marges, liseré et rangée unique des contrôles (48 px)', () => {
    // 28 (marge du haut) + 4 (marge de l'échiquier) + 4 (liseré) + 16 (sous l'échiquier) + 12 (ligne des pièces prises) + 48 (contrôles) + 16 (marge du bas)
    const expected = 28 + 4 + 4 + 16 + 12 + 48 + 16;
    assert(new RegExp(`--board-chrome-h: ${expected}px;`).test(block), `--board-chrome-h attendu : ${expected}px`);
    assert(new RegExp(`html\\[data-coords="out"\\] \\.board-col \\{ --board-chrome-h: ${expected + 18}px;`).test(block), 'coordonnées extérieures : + 18 px');
    assert(new RegExp(`html\\[data-captures="off"\\] \\.board-col \\{ --board-chrome-h: ${expected - 12}px;`).test(block), 'sans les pièces prises : 12 px de moins');
    assert(/\.cap-top \{ margin: -22px 0 0; \}/.test(css) && /\.cap-bot \{ margin: -12px 0 2px; \}/.test(css), 'lignes des pièces prises changées : revoir --board-chrome-h');
    assert(/\.board-col:has\(> \.tr-progress:not\(\[hidden\]\)\) \{ --board-chrome-h: 150px; \}/.test(css) && /> \.cap-top \{ margin: 0; \}/.test(css), 'en séance, la ligne du haut a sa place (22 px)');
    assert(/\.game-screen-inner \{ padding-bottom: 16px; \}/.test(block));
    const game = css.slice(css.indexOf('ÉCRAN DE JEU (LOT 7)'));
    assert(/\.board-controls \{ flex-direction: row; align-items: stretch; gap: 8px; height: 48px; \}/.test(game), 'rangée unique de 48 px');
    assert(/\.board-controls \.controls-main \.btn \{ min-height: 48px; height: 48px; \}/.test(game));
    assert(/\.board-controls \.btn-tool \{[^}]*height: 48px;/.test(game));
    assert(/^\.board-wrap \{ position: relative; margin-bottom: 16px; margin-top: 4px; \}/m.test(css), 'marges de .board-wrap changées : revoir --board-chrome-h');
    assert(/\.game-screen-inner \{[^}]*padding: 28px 24px 40px;/.test(css), 'marge du haut changée : revoir --board-chrome-h');
});

t('échiquier 920px+ : le liseré (2 × 2 px) et les coordonnées extérieures (18 px) s\'ajoutent à --bw', () => {
    assert(/\.board-wrap \{ width: calc\(var\(--bw\) \+ 4px\); \}/.test(block));
    assert(/html\[data-coords="out"\] \.board-wrap \{ width: calc\(var\(--bw\) \+ 22px\); \}/.test(block));
    assert(/data-coords="out".*\.board-wrap \{ padding: 0 0 18px 18px; \}/.test(fs.readFileSync('css/panels.css', 'utf8')), 'marge des coordonnées extérieures changée : revoir les 22 px');
});

// ─── Grilles de choix des Paramètres (PanelKit.balancedCols) ─────────────────
const vm = require('vm');
const ctx = { escapeHtml: s => s, document: { addEventListener() {} }, matchMedia: () => ({ matches: false }) };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/core/panelKit.js', 'utf8').replace(/^const PanelKit =/m, 'var PanelKit ='), ctx);
const cols = ctx.PanelKit.balancedCols;
const rows = (n, c) => Array.from({ length: Math.ceil(n / c) }, (_, i) => Math.min(c, n - i * c)).join('+');

t('grilles : pas de tuile seule en dernière ligne quand une autre répartition tient', () => {
    assert.strictEqual(rows(13, cols(13, 571)), '5+5+3');    // 13 échiquiers, Paramètres sur ordinateur
    assert.strictEqual(rows(12, cols(12, 571)), '4+4+4');    // 12 jeux de pièces
    assert.strictEqual(rows(6, cols(6, 571)), '3+3');        // 6 styles de flèches
    assert.strictEqual(rows(12, cols(12, 321)), '3+3+3+3');  // téléphone
});

t('grilles : jamais de tuiles plus étroites que 85 % du minimum, jamais moins de 3 colonnes si 3 tiennent', () => {
    for (let w = 240; w <= 900; w += 7) for (const n of [6, 12, 13]) {
        const c = cols(n, w), tile = (w - (c - 1) * 8) / c;
        assert(c === 1 || tile >= 112 * .85 - 1e-9, `${n} tuiles, ${w} px : ${c} colonnes de ${tile.toFixed(1)} px`);
        if ((w + 8) / 120 >= 3) assert(c >= 3, `${n} tuiles, ${w} px : ${c} colonnes`);
    }
});

t('grilles : colonnes posées par PanelKit (--cols), dernière ligne centrée, plus de règles #…-options mortes', () => {
    const panels = fs.readFileSync('css/panels.css', 'utf8');
    assert(/\.pn \.theme-options \{[^}]*justify-content: center/.test(panels));
    assert(/\.pn \.theme-opt \{[^}]*flex: 0 0 calc\(\(100% - \(var\(--cols\) - 1\) \* 8px\) \/ var\(--cols\)\)/.test(panels));
    assert(/const GRID_GAP = 8;/.test(fs.readFileSync('js/core/panelKit.js', 'utf8')), 'GRID_GAP doit rester égal au gap CSS');
    assert(!/#(piece|board|arrow)-options/.test(css));
});

t('« Invisibles » : interrupteur à part, absent de la grille des pièces', () => {
    const ui = fs.readFileSync('js/core/settingsUI.js', 'utf8');
    assert(/PIECE_SET_IDS\.filter\(id => id !== 'blindfold'\)/.test(ui), 'la grille des pièces exclut blindfold');
    assert(/kind: 'toggle', key: 'blindfold'/.test(ui), 'rangée « Pièces invisibles »');
    assert(/key === 'blindfold'[\s\S]{0,400}setPref\('pieceSet', 'blindfold'\)/.test(ui), 'l\'interrupteur écrit pieceSet');
});

// ─── Accueil Jouer : le répertoire ne s'affiche qu'une fois ──────────────────
t('accueil Jouer : barre de contexte (puce, pastilles, menu ⋮), plus de panneau « Mes répertoires »', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const play = html.slice(html.indexOf('<div id="home-tab-play"'), html.indexOf('<!-- Onglet Statistiques -->'));
    const scope = play.slice(play.indexOf('<div class="st-scope hp-scope">'), play.indexOf('<div id="looks-tip">'));
    ['id="repertoire-list"', 'id="hp-quick"', 'id="rep-menu-btn"'].forEach(s => assert(scope.includes(s), 'barre : ' + s));
    assert.strictEqual((play.match(/class="[^"]*\brepertoire-list\b/g) || []).length, 1, 'une seule puce de répertoire dans Jouer');
    assert(!/hp-reps|repertoire-select/.test(play), 'plus de panneau ni de sélecteur en double');
    assert(!/repsHTML|hp-reps/.test(fs.readFileSync('js/modules/openings/homePanels.js', 'utf8')));
    const app = fs.readFileSync('js/app.js', 'utf8');
    assert(/filter\(n => n !== currentRepertoire\)\.slice\(0, HP_QUICK_MAX\)/.test(app), 'pastilles : les autres répertoires seulement');
    assert(!/à réviser<\/span><span><b>\$\{streak\}/.test(app), '« Aujourd\'hui » ne répète plus les révisions du répertoire');
    const home = fs.readFileSync('css/home.css', 'utf8');
    assert(/@media \(max-width: 599px\) \{\s*\.hp-quick \{ display: none; \}/.test(home), 'téléphone : la puce seule');
    assert(/\.st-scope\.hp-scope \{ flex-wrap: nowrap; \}/.test(home), 'téléphone : ⋮ sur la ligne de la puce');
});

t('écran de jeu : Indice éteint jamais plein ; dock de cinq cases et ✕ en haut sur téléphone', () => {
    const css = fs.readFileSync('style.css', 'utf8');
    assert(/\.btn\.tb-hint:disabled \{ background: transparent;/.test(css), 'Indice indisponible sans fond plein');
    const thumb = css.slice(css.indexOf('/* Dock du téléphone (Ergonomie, lots 2 et 3) */'));
    ['tb-flip', 'tb-prev', 'dock-center', 'tb-next', 'dock-more'].forEach((c, i) =>
        assert(new RegExp(`\\.board-controls \\.${c} \\{ order: ${i + 1}; \\}`).test(thumb), 'dock : ' + c + ' en case ' + (i + 1)));
    assert(/\.topnav-exit \{\s+display: grid;/.test(thumb), 'Quitter : ✕ de la barre du haut, loin du ›');
    assert(/html\[data-hand="left"\] \.board-controls \.dock-more \{ order: 1; \}/.test(thumb) && /html\[data-hand="left"\] \.board-controls \.tb-flip \{ order: 5; \}/.test(thumb), 'gaucher : Plus à gauche');
    const home = fs.readFileSync('css/home.css', 'utf8');
    assert(/\.topnav-pill > \.theme-toggle:not\(#palette-btn\):not\(\.me-btn\) \{ display: none; \}/.test(home), 'téléphone : loupe et Moi seulement');
    assert(!/board-pill/.test(css + fs.readFileSync('index.html', 'utf8')), 'plus de pastille sur l\'échiquier');
});

t('téléphone : échiquier posé sur la barre, lecture au-dessus, glisser sur ‹ › (Ergonomie, lot 2)', () => {
    const css = fs.readFileSync('style.css', 'utf8');
    const i = css.indexOf('/* Dock du téléphone (Ergonomie, lots 2 et 3) */'), thumb = css.slice(i, css.indexOf('/* Tablette et téléphone en paysage', i));
    assert(/\.board-col \{ display: contents; \}/.test(thumb), 'les enfants de .board-col se rangent dans .game-main');
    assert(/\.board-col > \.tr-progress \{ order: -3; \}/.test(thumb), 'progression tout en haut');
    assert(/\.side-panel:not\(\.open\) \{\s+order: -2; flex: none; margin-top: auto;/.test(thumb), 'consigne et coups juste au-dessus de l\'échiquier');
    assert(/\.board-col > \.cap-top \{ order: 1; \}/.test(thumb) && /\.board-col > \.cap-bot \{ order: 3; \}/.test(thumb), 'échiquier et pièces prises en bas');
    assert(/\.game-main \{ padding-bottom: calc\(var\(--thumb-h\)/.test(thumb), 'l\'échiquier se pose sur la barre, jamais dessous');
    assert(/var\(--read-h\)\)\)\);/.test(thumb) && /data-mode="endgame"\] \{ --read-h:/.test(thumb), 'petit écran : l\'échiquier rétrécit selon la lecture du mode');
    assert(/\.game-main:has\(> \.side-panel\.open\) \.cap-top \{ margin-top: auto; \}/.test(thumb), 'fiche ouverte : l\'échiquier ne bouge pas');
    assert(/\.tb-prev, \.board-controls \.tb-next \{ touch-action: none; \}/.test(thumb));
    const app = fs.readFileSync('js/app.js', 'utf8');
    assert(/gs\.dataset\.mode = gameMode/.test(app), 'applyModeUI pose data-mode sur #game-screen');
    const mob = fs.readFileSync('js/core/mobile.js', 'utf8');
    assert(/function initNavSwipe\(\)[\s\S]{0,1200}\['btn-prev', 'btn-next'\][\s\S]{0,1200}x0 >= STEP\)  \{ x0 \+= STEP; navNext\(\); \}/.test(mob),
        'glisser vers la droite sur ‹ › avance');
});

t('pages et ordinateur (Ergonomie, lot 5)', () => {
    const scr = fs.readFileSync('css/screens.css', 'utf8'), css = fs.readFileSync('style.css', 'utf8'), home = fs.readFileSync('css/home.css', 'utf8');
    assert(/#home-tab-stats > \.st-scope, #home-tab-training > \.st-scope \{ flex-wrap: nowrap; \}/.test(scr), 'Statistiques et Entraînement : puce et capsule sur une ligne');
    assert(/#home-tab-stats \.st-go \{ display: none; \}/.test(scr), 'Statistiques : l\'action passe au centre du dock');
    assert(/\.eg-sec:not\(\.is-open\) :is\(\.eg-sec-desc, \.eg-list\) \{ display: none; \}/.test(scr), 'Finales : catégories repliables');
    assert(/#game-screen\.is-analysis \.side-panel:not\(\.open\) \.ab-line:nth-child\(n\+3\)/.test(css) && /data-mode="analysis"\] \{ --read-h:/.test(css), 'Analyse : deux lignes au-dessus');
    assert(/#game-rep:has\(> \.rp-chip:disabled\), #game-side:has\(> \.cs-locked\) \{ display: none; \}/.test(css), 'puce et capsule verrouillées cachées');
    assert(/\.board-controls \.controls-main \.btn\.tb-hint:disabled \{ flex: 0 0 48px;/.test(css), 'Indice éteint : icône');
    assert(/\.topnav:has\(#topnav-tabs-game:not\(\[style\*="none"\]\)\) \.topnav-pill > \.theme-toggle:not\(#palette-btn\):not\(\.me-btn\) \{ display: none; \}/.test(home), 'en partie : loupe et Moi');
    assert(/#review-overlay \{ align-items: flex-end;/.test(css) && /#review-overlay \.btn\.online-go \{ position: sticky; bottom: 0;/.test(css), 'Analyser mes parties : fiche du bas, action sous le pouce');
    const eg = fs.readFileSync('js/modules/endgame/endgame.js', 'utf8');
    assert(/egToggle: id => toggleEndgameCategory\(id\)/.test(eg) && /aria-expanded="\$\{open\}"/.test(eg));
});

t('accueil Jouer : Aujourd\'hui, Jouer, À traiter dans cet ordre ; une seule action qui lance la Révision du jour', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const play = html.slice(html.indexOf('<div id="home-tab-play"'), html.indexOf('<!-- Onglet Statistiques -->'));
    const at = id => play.indexOf(`id="${id}"`);
    assert(at('hp-today') > 0 && at('hp-today') < at('hp-play') && at('hp-play') < at('hp-news'), 'ordre téléphone : Aujourd\'hui, Jouer, À traiter');
    assert(!/home-card|home-stats|home-goal|hp-recent/.test(play), 'plus d\'anciens blocs (cartes, chiffres, objectif à part, Dernières parties à part)');
    const app = fs.readFileSync('js/app.js', 'utf8');
    assert(/homeReview: \(\) => startDailyReview\(\)/.test(app), '« Commencer la révision » → startDailyReview');
    assert.strictEqual((app.match(/class="btn btn-primary hp-cta"/g) || []).length, 3, 'une action pleine par état : dû, à jour, vide (tests/homeSummary.test.js)');
    const tr = fs.readFileSync('js/modules/training/trainingUI.js', 'utf8');
    assert(/function startDailyReview\(\) \{\s*_trColor = 'mix';\s*_trOpening = null;[\s\S]{0,120}startTrainingExercise\('due'\);/.test(tr),
        'Révision du jour : les deux couleurs, sans filtre d\'ouverture');
});

t('grilles : aucune transition sur la largeur des tuiles dans les fenêtres (pas de redimensionnement animé à chaque réglage)', () => {
    const panels = fs.readFileSync('css/panels.css', 'utf8');
    const m = panels.match(/\.pn \.theme-opt \{ transition-property: ([^;]+);/);
    assert(m, '.pn .theme-opt doit fixer transition-property (style.css a « transition: all »)');
    assert(!/\b(all|width|flex|flex-basis|max-width|min-width)\b/.test(m[1]), m[1]);
});

t('écran de jeu : « Recommencer » (resetGame) ne se confond plus avec « Corriger » (undoMove) ; plus de « Rejouer »', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const btn = fn => { const m = html.match(new RegExp('onclick="' + fn + '\\(\\)"[^>]*>[\\s\\S]*?<span class="btn-label">([^<]+)</span>')); return m && m[1]; };
    assert.strictEqual(btn('resetGame'), 'Recommencer');
    assert.strictEqual(btn('undoMove'), 'Corriger');
    assert(!/btn-label">Rejouer</.test(html), '« Rejouer » se lit « rejouer le coup »');
});

console.log(`\n${n} tests réussis.`);
