/**
 * core/helpUI.js
 * ──────────────────────────────────────────────────────────────────────────
 * Fenêtre « Aide » (socle : panelKit.js), « Sommaire vivant » :
 *   Accueil (Premiers pas, tâches fréquentes, guides) · un guide par page · Raccourcis · Questions · À propos.
 * Un guide = un titre, la puce « ce qui est compté » (.vbadge), trois ou quatre points, puis UN bouton plein
 * « Ouvrir … » qui ferme l'Aide et ouvre l'endroit (HELP_TARGETS → action enregistrée par registerActions).
 * Recherche : tâches, guides, questions et raccourcis (KEYBOARD_SHORTCUTS, settingsUI.js), le premier résultat
 * présélectionné ; ↑ ↓ pour parcourir, Entrée pour ouvrir, Échap pour effacer (panelKit). Surlignage insensible
 * aux accents. Le champ a le focus à l'ouverture, sauf sur écran tactile (pointer: coarse) : pas de clavier imposé.
 * Styles : css/panels.css, « AIDE SOMMAIRE VIVANT (LOT 7) ».
 */

'use strict';

// ─── CONTENU ──────────────────────────────────────────────────────────────────

// Destinations des boutons : action déclarée par registerActions (data-action), argument facultatif.
const HELP_TARGETS = {
    play:       { label: 'Jouer',                action: 'helpTab', arg: 'play' },
    training:   { label: 'Entraînement',         action: 'helpTab', arg: 'training' },
    stats:      { label: 'Statistiques',         action: 'helpTab', arg: 'stats' },
    endgame:    { label: 'Finales',              action: 'helpTab', arg: 'endgame' },
    games:      { label: 'Analyser mes parties', action: 'helpGames' },
    analysis:   { label: 'Analyse',              action: 'helpAnalysis' },
    account:    { label: 'Compte',               action: 'helpAccount' },
    import:     { label: 'Importer',             action: 'homeImportPgn' },
    trash:      { label: 'Corbeille',            action: 'helpTrash' },
    onboarding: { label: 'la présentation',      action: 'helpOnboarding' }
};

// count : ce que l'endroit fait évoluer (tone = modificateur de .vbadge).
const HELP_GUIDES = [
    { id: 'play', icon: 'crown', title: 'Jouer', sub: 'Construire ses lignes en jouant', to: 'play',
      count: { label: 'Ne compte rien', tone: 'is-muted' },
      points: [
        'Choisissez un <strong>répertoire</strong> (puce en haut) et une couleur, puis jouez <strong>vos coups et ceux de l’adversaire</strong> : chaque coup adverse ouvre une branche.',
        'Position inconnue : votre coup devient l’<strong>unique réponse</strong> enregistrée. « Annuler », dans la barre d’état, la retire aussitôt.',
        'Position connue : retrouvez votre réponse. <kbd>Espace</kbd> montre la pièce, puis le coup.',
        'Onglets <strong>Coups</strong>, <strong>Arbre</strong> (remplacer ou supprimer une réponse) et <strong>Adversaire</strong>. Ici, rien n’est compté : statistiques et révisions n’évoluent qu’à l’Entraînement.'] },
    { id: 'training', icon: 'target', title: 'Entraînement', sub: 'Réviser au bon moment', to: 'training',
      count: { label: 'Compte', tone: 'is-ok' },
      points: [
        'Chaque position a une <strong>date de révision</strong> : elle s’éloigne à chaque réussite et revient vite après une erreur.',
        '<strong>Révision du jour</strong> (aussi « Commencer la révision » sur l’accueil), Points faibles, Ligne complète, À confirmer, Contre-la-montre et Mode libre.',
        'Chaque séance finit par un <strong>bilan</strong> ; une position ratée revient une fois en fin de séance.',
        'C’est le seul endroit qui fait évoluer <strong>statistiques et révisions</strong>.'] },
    { id: 'stats', icon: 'bar-chart', title: 'Statistiques', sub: 'Voir ce qui tient et ce qui flanche', to: 'stats',
      count: { label: 'Observe', tone: 'is-muted is-dashed' },
      points: [
        'Cinq niveaux de maîtrise par position ; « À confirmer » (moins de 3 essais) est montré à part. Toucher la barre ou la légende filtre la liste.',
        'Positions regroupées par <strong>ouverture nommée</strong> ; la régularité (série, calendrier) couvre tous les répertoires.',
        'Les boutons ouvrent l’exercice d’<strong>Entraînement</strong> déjà filtré, sans lancer de séance : les Statistiques observent, l’Entraînement agit.',
        'Aperçu d’une position : « S’entraîner » lance sa révision, « ‹ Statistiques » ramène au même endroit.'] },
    { id: 'endgame', icon: 'pawn', title: 'Finales', sub: 'Gagner, annuler, mater', to: 'endgame',
      count: { label: 'Finales réussies seulement', tone: 'is-muted' },
      points: [
        'Mats, pions, tours, Dame, pièces mineures : toucher un exercice ouvre son <strong>aperçu</strong>, et seul « Commencer » lance la séance.',
        'L’adversaire répond tout seul ; <strong>chaque coup est jugé</strong> par les tables de finales, sinon par le moteur (verdict « estimé »).',
        'Un coup qui laisse échapper le gain ou la nulle est signalé (« Nulle → Perte ») : « Annuler ce coup » le reprend. La théorie se déplie pendant la séance.',
        'Adversaire « Résistance maximale » ou « Humain » : Paramètres › Jeu et entraînement.'] },
    { id: 'games', icon: 'git-merge', title: 'Analyser mes parties', sub: 'Comparer ses parties au répertoire', to: 'games',
      count: { label: 'Erreur comptée une fois par partie', tone: 'is-warn' },
      points: [
        'Lichess, Chess.com ou PGN collé ; l’analyse s’arrête au <strong>premier coup hors répertoire</strong>.',
        '<span class="vbadge is-err">Erreur</span> votre coup diffère : comptée une fois par partie, répertoire et couleur.',
        '<span class="vbadge is-new">Nouveauté</span> coup adverse non couvert : rien n’est compté, il attend votre réponse dans « À traiter ».',
        '<span class="vbadge is-ok">Traitée depuis</span> réponse ajoutée après la partie : rien n’est compté, elle passe en tête des révisions.'] },
    { id: 'analysis', icon: 'microscope', title: 'Analyse', sub: 'Explorer avec Stockfish', to: 'analysis',
      count: { label: 'Ne compte rien', tone: 'is-muted' },
      points: [
        'Outil <strong>Analyse</strong> de l’écran de jeu : Stockfish évalue la position affichée, avec ses meilleures lignes et des flèches.',
        'Jouez librement les deux camps : vos essais forment un <strong>brouillon</strong> en arbre, gardé pendant la session.',
        '« Arrêter » suspend le calcul sur la position affichée ; la suivante est recalculée.',
        'Rien n’est écrit avant <strong>« Ajouter au répertoire »</strong> : chaque coup du brouillon porte sa marque (nouveau, connu, conflit), et un conflit n’est remplacé que si vous activez « Remplacer » dans l’aperçu.'] },
    { id: 'account', icon: 'cloud', title: 'Compte et synchronisation', sub: 'Les mêmes répertoires partout', to: 'account',
      count: { label: 'Facultatif', tone: 'is-muted is-dashed' },
      points: [
        'Sans compte, tout reste dans ce navigateur : téléchargez une sauvegarde (.json) depuis Paramètres › Données et sauvegarde.',
        'Avec un compte (Google ou e-mail), répertoires, statistiques, révisions, finales et préférences sont <strong>synchronisés entre vos appareils</strong>.',
        'Les modifications faites hors ligne partent au retour de la connexion.',
        'Les réglages propres à un appareil (sons, accessibilité, moteur…) portent le repère « appareil » dans les Paramètres ; l’état de la synchronisation est dans Compte › Synchronisation.'] }
];

// Tâches fréquentes : un verbe, les étapes, la destination.
const HELP_TASKS = [
    { id: 'build',  icon: 'crown',     title: 'Construire un répertoire',         steps: 'Jouer · Choisir une couleur · Jouer les deux camps', to: 'play' },
    { id: 'review', icon: 'target',    title: 'Réviser aujourd’hui',              steps: 'Entraînement · Révision du jour · Bilan',            to: 'training' },
    { id: 'pgn',    icon: 'upload',    title: 'Importer un PGN',                  steps: 'Jouer › Importer · Coller ou choisir le fichier · Vérifier l’aperçu, puis ajouter', to: 'import' },
    { id: 'games',  icon: 'git-merge', title: 'Comparer mes parties',             steps: 'Jouer › Analyser mes parties · Lichess, Chess.com ou PGN collé', to: 'games' },
    { id: 'sync',   icon: 'cloud',     title: 'Synchroniser mes appareils',       steps: 'Compte · Se connecter · Les données suivent', to: 'account' },
    { id: 'trash',  icon: 'trash',     title: 'Retrouver un répertoire supprimé', steps: 'Corbeille · 30 jours pour restaurer', to: 'trash' }
];

const HELP_FAQ = [
    ['Mes données sont-elles envoyées en ligne ?', 'Seulement si vous créez un compte. Sans compte, tout reste dans ce navigateur : téléchargez une sauvegarde (.json) de temps en temps, depuis Paramètres › Données et sauvegarde.'],
    ['Que se passe-t-il si je joue un autre coup que celui de mon répertoire ?', 'Le coup est refusé. En Entraînement, il compte comme une erreur et la position reviendra plus vite en révision ; dans Jouer, rien n’est compté. Pour changer de réponse, utilisez ⋯ sur ce coup dans l’Arbre.'],
    ['Comment comparer mes parties Lichess ou Chess.com à mon répertoire ?', 'Renseignez vos pseudos dans Compte › Profil, puis ouvrez « Analyser mes parties » dans la barre de l’accueil Jouer : chaque déviation est listée et ouvre la position concernée.'],
    ['Comment importer un PGN ?', 'Jouer › Importer. Variantes et numéros de coup qui reculent deviennent des branches ; un conflit avec votre réponse est montré avant d’écrire.'],
    ['L’application fonctionne-t-elle sans connexion ?', 'Oui, une fois installée (Paramètres › Données et sauvegarde › Installer). Avec un compte, les modifications faites hors ligne sont synchronisées au retour de la connexion.'],
    ['J’ai supprimé un répertoire par erreur.', 'Il reste 30 jours dans la corbeille, d’où il peut être restauré (menu ⋮ des répertoires, ou Paramètres › Données et sauvegarde).'],
    ['Comment s’entraîner sans voir les pièces ?', 'Activez « Pièces invisibles » dans Paramètres › Apparence : l’échiquier reste jouable, les pièces sont masquées.']
];

const HELP_SUGGEST = ['sauvegarde', 'révision', 'flèche', 'PGN'];

const HELP_SECTIONS = () => [
    { id: 'start', icon: 'flag', label: 'Premiers pas', desc: 'Trois étapes, tâches fréquentes' },
    ...HELP_GUIDES.map(g => ({ id: 'g-' + g.id, icon: g.icon, label: escapeHtml(g.title), desc: escapeHtml(g.sub) })),
    { id: 'keys',  icon: 'keyboard', label: 'Raccourcis',           desc: 'Clavier et souris' },
    { id: 'faq',   icon: 'help',     label: 'Questions fréquentes', desc: 'Données, erreurs, import' },
    { id: 'about', icon: 'info',     label: 'À propos et crédits',  desc: 'Version, licences' }
];

// ─── SURLIGNAGE (insensible aux accents et à la casse) ───────────────────────

const _hNorm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const _hStrip = html => html.replace(/<[^>]+>/g, '');

// Texte brut → HTML échappé, chaque occurrence de q dans <mark>.
function _hMarkText(text, q, raw = false) {
    const enc = raw ? s => s : escapeHtml;
    const nq = _hNorm(q || '').trim();
    if (!nq) return enc(text);
    let flat = '';
    const at = [];
    for (let i = 0; i < text.length; i++) for (const c of _hNorm(text[i])) { flat += c; at.push(i); }
    let out = '', from = 0, k = flat.indexOf(nq);
    while (k !== -1) {
        const a = at[k], b = at[k + nq.length - 1] + 1;
        if (a >= from) { out += enc(text.slice(from, a)) + '<mark>' + enc(text.slice(a, b)) + '</mark>'; from = b; }
        k = flat.indexOf(nq, k + nq.length);
    }
    return out + enc(text.slice(from));
}
// HTML écrit ici (sans entité) : seul le texte hors balises est surligné.
const _hMark = (html, q) => html.split(/(<[^>]+>)/).map(p => p.startsWith('<') ? p : _hMarkText(p, q, true)).join('');

// ─── BRIQUES ──────────────────────────────────────────────────────────────────

const _helpOpen = {};
let _helpResults = [], _helpSel = 0, _helpLastQ = '';

const _hGoBtn = (to, label) => `<button type="button" class="btn btn-primary hg-go" data-pn="act" data-key="go" data-v="${to}">${escapeHtml(label)}${ico('chevron-right')}</button>`;
const _hBadge = c => `<span class="vbadge ${c.tone}">${escapeHtml(c.label)}</span>`;
const _hKeys = ks => ks.map(x => x.startsWith('puis') ? `<small>${escapeHtml(x)}</small>` : `<kbd>${escapeHtml(x)}</kbd>`).join('');

function _hSteps() {
    return `<div class="hs-steps">
        <div class="hs-step"><em>1</em><span><b>Choisir un répertoire</b><small>Puce en haut de Jouer</small></span></div>
        <div class="hs-step"><em>2</em><span><b>Jouer les deux camps</b><small>Vos coups deviennent les réponses</small></span></div>
        <div class="hs-step"><em>3</em><span><b>Réviser chaque jour</b><small>Entraînement, quelques minutes</small></span></div></div>`;
}
const _hTasks = () => `<div class="hs-tasks">${HELP_TASKS.map(t =>
    `<button type="button" class="hs-task" data-pn="act" data-key="go" data-v="${t.to}"><span class="hs-ico">${ico(t.icon)}</span><b>${escapeHtml(t.title)}</b><span class="hs-to">${escapeHtml(HELP_TARGETS[t.to].label)}${ico('chevron-right')}</span></button>`).join('')}</div>`;

function _hHome() {
    return `<div class="hg-kicker">Premiers pas</div><h3 class="hg-t">Votre répertoire en trois étapes</h3>
        ${_hSteps()}
        <div class="hg-act">${_hGoBtn('play', 'Commencer à jouer')}<button type="button" class="btn hg-sec" data-pn="act" data-key="go" data-v="onboarding">${ico('play')}Revoir la présentation</button></div>
        <div class="hg-kicker">Je veux…</div>${_hTasks()}
        <div class="hg-kicker">Guides</div>
        <div class="hs-guides">${HELP_GUIDES.map(g => `<button type="button" class="hs-guide" data-pn="section" data-key="g-${g.id}"><span class="hs-ico">${ico(g.icon)}</span><span><b>${escapeHtml(g.title)}</b><small>${escapeHtml(g.sub)}</small></span>${ico('chevron-right')}</button>`).join('')}</div>`;
}

function _hGuide(id) {
    const i = HELP_GUIDES.findIndex(g => g.id === id), g = HELP_GUIDES[i], next = HELP_GUIDES[i + 1];
    return `<article class="hg">
        <div class="hg-kicker">Guide</div>
        <h3 class="hg-t">${escapeHtml(g.title)}</h3><p class="hg-s">${escapeHtml(g.sub)}</p>
        <div class="hg-cnt">${_hBadge(g.count)}</div>
        <ol class="hg-pts">${g.points.map(p => `<li>${p}</li>`).join('')}</ol>
        <div class="hg-act">${_hGoBtn(g.to, 'Ouvrir ' + HELP_TARGETS[g.to].label)}${next
            ? `<button type="button" class="hg-next" data-pn="section" data-key="g-${next.id}">Guide suivant : ${escapeHtml(next.title)}${ico('chevron-right')}</button>` : ''}</div>
    </article>`;
}

function _hFaq() {
    return `<div class="hg-kicker">Questions fréquentes</div>` + HELP_FAQ.map(([q, a], i) => {
        const open = !!_helpOpen['faq' + i];
        return `<div class="pn-acc${open ? ' is-open' : ''}" id="help-faq-${i}">
            <button type="button" aria-expanded="${open}" data-pn="act" data-key="acc" data-v="faq${i}">
                <span class="pn-acc-ico">${ico('help')}</span><span><b>${escapeHtml(q)}</b></span>${ico('chevron-down')}
            </button>
            <div class="pn-acc-body"><p style="margin:0">${escapeHtml(a)}</p></div></div>`;
    }).join('');
}

function _hKeysPage() {
    const groups = typeof KEYBOARD_SHORTCUTS !== 'undefined' ? KEYBOARD_SHORTCUTS : [];
    return `<div class="hg-kicker">Raccourcis</div><h3 class="hg-t">Clavier et souris</h3>
        <div class="hk-grid">${groups.map(([g, list]) => `<div class="hk-g"><h4 class="hk-h">${escapeHtml(g)}</h4>${list.map(([l, ks]) =>
            `<div class="pn-key"><span>${escapeHtml(l)}</span><span>${_hKeys(ks)}</span></div>`).join('')}</div>`).join('')}</div>`;
}

function _hAbout() {
    const sets = PIECE_SET_IDS.filter(id => id !== 'blindfold').map(id => PIECE_SETS[id]);
    return `
        <div class="pn-group"><div class="pn-row">${PanelKit.text('Chays Trainer', 'Entraîneur d’ouvertures et de finales, en révision espacée. Fonctionne hors ligne une fois installé.')}</div></div>
        <h3 class="pn-h">Jeux de pièces</h3>
        <div class="pn-group"><div class="pn-credits">${sets.map(s => `<div>${s.label}<span>${PanelKit.esc(s.author)} · ${PanelKit.esc(s.license)}</span></div>`).join('')}</div></div>
        <p class="pn-lede">Jeux issus du dépôt open source de lichess (dossier public/piece). Les textures d’échiquier (pierre, cuir, noyer) sont créées pour ce projet.</p>
        <h3 class="pn-h">Moteur d’analyse</h3>
        <div class="pn-group"><div class="pn-credits"><div>Stockfish${typeof Engine !== 'undefined' && Engine.info() ? ' ' + PanelKit.esc(Engine.info().version) : ''}<span>Stockfish developers · GPL v3</span></div><div>stockfish.js (WebAssembly)<span>Nathan Rugg, Chess.com · GPL v3</span></div></div></div>
        <p class="pn-lede">Logiciel libre : sources sur github.com/official-stockfish/Stockfish et github.com/nmrugg/stockfish.js ; licence jointe dans engine/.</p>
        <h3 class="pn-h">Polices</h3>
        <div class="pn-group"><div class="pn-credits"><div>Fraunces<span>SIL OFL 1.1</span></div><div>IBM Plex Mono<span>SIL OFL 1.1</span></div><div>Inter<span>SIL OFL 1.1</span></div></div></div>`;
}

// ─── RECHERCHE ────────────────────────────────────────────────────────────────

// Résultats dans l'ordre d'affichage : tâches, guides, questions, raccourcis. run() = action directe.
function _helpSearch(q) {
    const res = [];
    HELP_TASKS.filter(t => PanelKit.matches(q, t.title, t.steps, HELP_TARGETS[t.to].label)).forEach(t =>
        res.push({ group: 'Tâches', icon: t.icon, title: t.title, small: t.steps, go: true, run: () => _helpGo(t.to) }));
    HELP_GUIDES.forEach(g => {
        const pts = g.points.map(_hStrip);
        if (!PanelKit.matches(q, g.title, g.sub, g.count.label, ...pts)) return;
        res.push({ group: 'Guides', icon: g.icon, title: g.title, small: pts.find(p => PanelKit.matches(q, p)) || g.sub, run: () => _helpShow('g-' + g.id) });
    });
    HELP_FAQ.forEach(([fq, fa], i) => {
        if (PanelKit.matches(q, fq, fa)) res.push({ group: 'Questions', icon: 'help', title: fq, small: fa, run: () => { _helpOpen['faq' + i] = true; _helpShow('faq', 'help-faq-' + i); } });
    });
    (typeof KEYBOARD_SHORTCUTS !== 'undefined' ? KEYBOARD_SHORTCUTS : []).forEach(([grp, list]) => list.forEach(([l, ks]) => {
        if (PanelKit.matches(q, l, ks.join(' '), grp)) res.push({ group: 'Raccourcis', icon: 'keyboard', title: l, small: grp, keys: ks, run: () => _helpShow('keys') });
    }));
    return res;
}

function _hResults(q) {
    if (q !== _helpLastQ) { _helpSel = 0; _helpLastQ = q; }
    _helpResults = _helpSearch(q);
    if (_helpSel >= _helpResults.length) _helpSel = 0;
    if (!_helpResults.length) return `<div class="hr-empty" role="status"><span class="hr-eico">${ico('search')}</span><b>Rien sur « ${escapeHtml(q)} »</b>
        <div class="hr-sugg">${HELP_SUGGEST.map(s => `<button type="button" class="hr-chip" data-pn="act" data-key="q" data-v="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div></div>`;
    let html = `<p class="hr-sum" role="status"><b>${_helpResults.length} résultat${_helpResults.length > 1 ? 's' : ''}</b> pour « ${escapeHtml(q)} »</p>`, group = '';
    _helpResults.forEach((r, i) => {
        if (r.group !== group) { html += `${group ? '</div>' : ''}<div class="hr-g"><h3 class="hr-h">${r.group}</h3>`; group = r.group; }
        const tail = r.go ? `<span class="hr-go">Y aller${ico('chevron-right')}</span>`
                   : r.keys ? `<span class="hr-keys">${_hKeys(r.keys)}</span>` : ico('chevron-right', 'hr-chev');
        html += `<button type="button" class="hr-row${i === _helpSel ? ' is-sel' : ''}" id="help-res-${i}" data-pn="act" data-key="res" data-v="${i}"${i === _helpSel ? ' aria-current="true"' : ''}>
            <span class="hs-ico">${ico(r.icon)}</span><span class="hr-txt"><b>${_hMarkText(r.title, q)}</b><small>${_hMarkText(r.small, q)}</small></span>${tail}</button>`;
    });
    return html + `</div><p class="hr-kb"><kbd>↑</kbd><kbd>↓</kbd> parcourir · <kbd>Entrée</kbd> ouvrir · <kbd>Échap</kbd> effacer</p>`;
}

function _helpMove(d) {
    if (!_helpResults.length) return;
    _helpSel = (_helpSel + d + _helpResults.length) % _helpResults.length;
    HelpPanel.el.querySelectorAll('.hr-row').forEach((el, i) => {
        el.classList.toggle('is-sel', i === _helpSel);
        if (i === _helpSel) { el.setAttribute('aria-current', 'true'); el.scrollIntoView({ block: 'nearest' }); } else el.removeAttribute('aria-current');
    });
}

// ─── NAVIGATION ET ACTIONS ────────────────────────────────────────────────────

// Ferme l'Aide et ouvre l'endroit visé.
function _helpGo(to) {
    const t = HELP_TARGETS[to], fn = t && UI_ACTIONS[t.action];
    if (!fn) return;
    HelpPanel.close();
    fn(t.arg);
}

// Affiche une page de l'Aide (recherche vidée), éventuellement défilée jusqu'à un élément.
function _helpShow(section, anchor) {
    const st = HelpPanel.state, input = HelpPanel.el.querySelector('[data-pn="search"]');
    st.section = section; st.drill = true; st.q = '';
    if (input) input.value = '';
    HelpPanel.refresh(false);
    const content = HelpPanel.el.querySelector('.pn-content'), el = anchor && document.getElementById(anchor);
    if (el) el.scrollIntoView({ block: 'nearest' });
    if (content) content.focus({ preventScroll: true });
}

function _renderHelp(section, q) {
    if (q) return _hResults(q);
    _helpResults = [];
    if (section && section.startsWith('g-')) return _hGuide(section.slice(2));
    if (section === 'keys')  return _hKeysPage();
    if (section === 'faq')   return _hFaq();
    if (section === 'about') return _hAbout();
    return _hHome();
}

// Liste des rubriques : intertitres, et sur téléphone l'accueil (étapes, tâches) en tête, « Commencer » en bas.
function _hDecorateNav() {
    const nav = HelpPanel.el.querySelector('.pn-nav');
    if (!nav) return;
    const head = (key, label) => { const b = nav.querySelector(`[data-key="${key}"]`); if (b) b.insertAdjacentHTML('beforebegin', `<h3 class="hn-h">${label}</h3>`); };
    head('g-' + HELP_GUIDES[0].id, 'Guides');
    head('keys', 'Plus');
    nav.insertAdjacentHTML('afterbegin', `<div class="hn-home"><h3 class="hn-h">Premiers pas</h3>${_hSteps()}<h3 class="hn-h">Je veux…</h3>${_hTasks()}</div>`);
    nav.insertAdjacentHTML('beforeend', `<div class="hn-bottom">${_hGoBtn('play', 'Commencer à jouer')}</div>`);
}

const HelpPanel = PanelKit.create({
    id: 'help-overlay',
    title: 'Aide',
    search: 'Rechercher dans l’aide',
    sections: HELP_SECTIONS,
    render: _renderHelp,
    afterRender: _hDecorateNav,
    onControl: (kind, key, value) => {
        if (kind !== 'act') return;
        if (key === 'acc') { _helpOpen[value] = !_helpOpen[value]; HelpPanel.refresh(); return; }
        if (key === 'go') { _helpGo(value); return; }
        if (key === 'res') { const r = _helpResults[Number(value)]; if (r) r.run(); return; }
        if (key === 'q') {
            const input = HelpPanel.el.querySelector('[data-pn="search"]');
            input.value = value; HelpPanel.state.q = value; HelpPanel.refresh(false); input.focus();
        }
    }
});

// Clavier dans le champ de recherche : ↑ ↓ parcourent les résultats, Entrée ouvre le résultat choisi.
HelpPanel.el.addEventListener('keydown', e => {
    if (!e.target.matches || !e.target.matches('[data-pn="search"]') || !HelpPanel.state.q.trim()) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); _helpMove(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = _helpResults[_helpSel]; if (r) r.run(); }
});

registerActions({
    helpTab: tab => goHome(tab),
    helpGames: () => showGameReview(),
    helpAccount: () => AccountUI.open(),
    helpTrash: () => showTrash(),
    helpOnboarding: () => showOnboarding(),
    // Depuis Jouer ou un aperçu : la position affichée ; ailleurs, l'accueil puis la position de départ (ou le brouillon).
    helpAnalysis: () => {
        const inGame = !document.getElementById('game-screen').classList.contains('hidden');
        if (inGame && gameMode === 'analysis') return;
        if (inGame && (gameMode === 'play' || gameMode === 'preview')) { openAnalysis(); return; }
        goHome('play');
        openAnalysis([]);
    }
});

// Ouverture : l'accueil de l'Aide (ou la rubrique demandée). Focus dans la recherche, sauf au doigt.
function showHelp(section) {
    if (!section) HelpPanel.state.section = 'start';
    HelpPanel.open(section);
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const target = coarse ? '[data-pn="close"]' : section ? null : '[data-pn="search"]';
    const el = target && HelpPanel.el.querySelector(target);
    if (el) el.focus({ preventScroll: true });
}
function closeHelp() { HelpPanel.close(); }

// Raccourcis d'ouverture des fenêtres : « , » Paramètres, « ? » Aide (hors champs de saisie) ; « / » dans l'Aide : la recherche.
document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === '/' && HelpPanel.isOpen()) {
        const input = HelpPanel.el.querySelector('[data-pn="search"]');
        if (input) { e.preventDefault(); input.focus(); }
        return;
    }
    if (document.querySelector('.overlay:not(.hidden)')) return;
    if (e.key === ',') { e.preventDefault(); showSettings(); }
    else if (e.key === '?') { e.preventDefault(); showHelp(); }
});
