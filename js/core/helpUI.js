/**
 * core/helpUI.js
 * ──────────────────────────────────────────────────────────────────────────
 * Fenêtre « Aide » (socle : panelKit.js) : Premiers pas · Guides · Raccourcis · Questions · À propos.
 * La recherche parcourt guides, questions et raccourcis, avec surlignage.
 */

'use strict';

const HELP_SECTIONS = [
    { id: 'start',  icon: 'flag',     label: 'Premiers pas',         desc: 'Trois étapes pour commencer' },
    { id: 'guides', icon: 'book',     label: 'Guides',               desc: 'Chaque onglet expliqué' },
    { id: 'keys',   icon: 'keyboard', label: 'Raccourcis',           desc: 'Clavier et souris' },
    { id: 'faq',    icon: 'help',     label: 'Questions fréquentes', desc: 'Données, erreurs, import' },
    { id: 'about',  icon: 'info',     label: 'À propos et crédits',  desc: 'Version, licences' }
];

// [id, icône, titre, résumé, paragraphes, action du bouton]
const HELP_GUIDES = [
    ['play', 'crown', 'Jouer', 'Construire et réviser un répertoire', [
        'Choisissez un <strong>répertoire</strong> et une <strong>couleur</strong>, ou <strong>reprenez</strong> la dernière partie.',
        'Jouez vos coups <strong>et</strong> ceux de l’adversaire pour explorer la branche voulue.',
        'Dans une position inconnue, votre coup devient l’<strong>unique réponse</strong> enregistrée. Ensuite, il faut la retrouver : un autre coup est refusé et compté comme erreur.',
        '<strong>Indice</strong> (Espace) montre la pièce à jouer ; un second appui dévoile le coup et compte une erreur.'], 'tab:play'],
    ['training', 'target', 'Entraînement', 'La séance du jour, en révision espacée', [
        'Chaque position a une <strong>date de révision</strong> : elle s’éloigne à chaque réussite et revient vite après une erreur. Les positions à réviser passent en premier.',
        '<strong>Départ</strong> : position ciblée (l’échiquier rejoue les trois coups précédents) ou début de partie.',
        '<strong>Profondeur</strong> et <strong>exercice</strong> (1, 3 ou 5 coups, ou toute la variante) se règlent sous la séance, ou dans Paramètres › Jeu et entraînement.'], 'tab:training'],
    ['stats', 'bar-chart', 'Statistiques', 'Ce que vous maîtrisez, ce qui reste fragile', [
        'Votre activité sur 30 jours : série de jours, réussites, erreurs, positions à réviser.',
        'Un <strong>taux d’erreur</strong> par position, classé en maîtrisé, fragile ou à retravailler.',
        'Les positions sont regroupées par ligne d’ouverture (les 4 premiers demi-coups) : ouvrez une ligne, touchez un coup pour revoir la position.'], 'tab:stats'],
    ['endgame', 'pawn', 'Finales', 'Des mats élémentaires aux finales de tours', [
        'Mats élémentaires, finales de pions (opposition, percée, étude de Réti) et de tours (Lucena, Philidor).',
        'L’adversaire répond tout seul et <strong>chaque coup est vérifié par le calcul</strong> : un coup qui laisse échapper le gain, ou qui perd, est signalé et peut être annulé.',
        'Filtrez par niveau ou lancez un exercice au hasard.'], 'tab:endgame'],
    ['tree', 'git-branch', 'Arbre et données', 'Voir, corriger et sauvegarder ses lignes', [
        'L’onglet <strong>Arbre</strong> de l’écran de jeu montre toutes vos lignes ; le bouton ⋯ d’un de vos coups permet de le <strong>remplacer</strong> ou de le <strong>supprimer</strong>.',
        'Le panneau <strong>Données</strong> regroupe la sauvegarde complète (.json : statistiques, planning, finales), l’import et l’export PGN, l’analyse d’une partie, vos parties en ligne et la corbeille (30 jours).'], 'data'],
    ['account', 'cloud', 'Compte et synchronisation', 'Retrouver ses répertoires sur tous ses appareils', [
        'Sans compte, tout reste dans ce navigateur.',
        'Avec un compte, répertoires, statistiques, révisions, finales et préférences (échiquier, pièces, jeu, profil…) sont enregistrés en ligne et <strong>synchronisés entre vos appareils</strong>.',
        'Le mode clair / sombre et les sons restent propres à chaque appareil, sauf si vous choisissez de les synchroniser (Compte › Appareils et synchro).'], 'account']
];

const HELP_FAQ = [
    ['Mes données sont-elles envoyées en ligne ?', 'Seulement si vous créez un compte. Sans compte, tout reste dans ce navigateur : téléchargez une sauvegarde (.json) de temps en temps, depuis Paramètres › Données et sauvegarde.'],
    ['Que se passe-t-il si je joue un autre coup que celui de mon répertoire ?', 'Le coup est refusé et compté comme une erreur sur cette position, qui reviendra plus vite en révision. Pour changer de coup de référence, utilisez ⋯ sur ce coup dans l’Arbre.'],
    ['Comment comparer mes parties Lichess ou Chess.com à mon répertoire ?', 'Renseignez vos pseudos dans Compte › Profil, puis ouvrez « Mes parties en ligne » dans le panneau Données : chaque déviation est listée et ouvre la position concernée.'],
    ['L’application fonctionne-t-elle sans connexion ?', 'Oui, une fois installée (Paramètres › Données et sauvegarde › Installer). Avec un compte, les modifications faites hors ligne sont synchronisées au retour de la connexion.'],
    ['J’ai supprimé un répertoire par erreur.', 'Il reste 30 jours dans la corbeille, d’où il peut être restauré (menu ⋮ des répertoires, ou Paramètres › Données et sauvegarde).'],
    ['Comment s’entraîner sans voir les pièces ?', 'Choisissez le style de pièces « Invisibles » dans Paramètres › Apparence : l’échiquier reste jouable, les pièces sont masquées.']
];

const _helpOpen = { play: true };

function _helpAcc(id, icon, title, sub, body, q) {
    const open = !!q || _helpOpen[id];
    return `<div class="pn-acc${open ? ' is-open' : ''}">
        <button type="button" aria-expanded="${open}" data-pn="act" data-key="acc" data-v="${id}">
            <span class="pn-acc-ico">${ico(icon)}</span><span><b>${PanelKit.mark(title, q)}</b>${sub ? `<small>${PanelKit.mark(sub, q)}</small>` : ''}</span>${ico('chevron-down')}
        </button>
        <div class="pn-acc-body">${PanelKit.mark(body, q)}</div></div>`;
}

const _guideHTML = (g, q) => _helpAcc(g[0], g[1], g[2], g[3],
    `<ul>${g[4].map(p => `<li>${p}</li>`).join('')}</ul><div class="pn-actions">${PanelKit.button(g[5] === 'data' ? 'Ouvrir Données' : g[5] === 'account' ? 'Ouvrir Compte' : `Ouvrir ${g[2]}`, 'go', { attrs: ` data-v="${g[5]}"`, icon: 'chevron-right' })}</div>`, q);
const _faqHTML = (f, i, q) => _helpAcc('faq' + i, 'help', f[0], '', `<p style="margin:0">${f[1]}</p>`, q);

function _renderHelp(section, q) {
    if (q) {
        const g = HELP_GUIDES.filter(x => PanelKit.matches(q, x[2], x[3], x[4].join(' ').replace(/<[^>]+>/g, '')));
        const f = HELP_FAQ.map((x, i) => [x, i]).filter(([x]) => PanelKit.matches(q, x[0], x[1]));
        const k = KEYBOARD_SHORTCUTS.flatMap(([, l]) => l).filter(([l, ks]) => PanelKit.matches(q, l, ks.join(' ')));
        if (!g.length && !f.length && !k.length) return `<div class="pn-empty">Rien sur « ${PanelKit.esc(q)} ». Essayez « sauvegarde », « flèche » ou « révision ».</div>`;
        return (g.length ? `<h3 class="pn-h">Guides</h3>${g.map(x => _guideHTML(x, q)).join('')}` : '')
             + (f.length ? `<h3 class="pn-h">Questions</h3>${f.map(([x, i]) => _faqHTML(x, i, q)).join('')}` : '')
             + (k.length ? `<h3 class="pn-h">Raccourcis</h3><div class="pn-group"><div class="pn-keys">${k.map(([l, ks]) =>
                 `<div class="pn-key"><span>${PanelKit.mark(l, q)}</span><span>${ks.map(x => `<kbd>${x}</kbd>`).join('')}</span></div>`).join('')}</div></div>` : '');
    }
    if (section === 'start') return `
        <p class="pn-lede">Chays Trainer vous fait construire votre répertoire d’ouvertures en jouant, puis vous le fait réviser au bon moment pour qu’il reste en mémoire.</p>
        <div class="pn-steps">
            <div class="pn-step"><em>1</em><b>Choisissez un répertoire</b><small>« Général » existe déjà. Créez-en un par ouverture si vous le souhaitez (menu ⋮ des répertoires).</small></div>
            <div class="pn-step"><em>2</em><b>Jouez les deux camps</b><small>Vos coups deviennent les réponses à retrouver ; les coups de l’adversaire ouvrent de nouvelles branches.</small></div>
            <div class="pn-step"><em>3</em><b>Révisez chaque jour</b><small>L’onglet Entraînement prépare la séance du jour : quelques minutes suffisent.</small></div>
        </div>
        <div class="pn-actions">${PanelKit.button('Commencer à jouer', 'go', { primary: true, attrs: ' data-v="tab:play"', icon: 'crown' })}${PanelKit.button('Lire les guides', 'section', { attrs: ' data-v="guides"', icon: 'book' })}</div>`;
    if (section === 'guides') return HELP_GUIDES.map(g => _guideHTML(g, '')).join('');
    if (section === 'keys')   return typeof _keysHTML === 'function' ? _keysHTML() : '';
    if (section === 'faq')    return HELP_FAQ.map((f, i) => _faqHTML(f, i, '')).join('');
    const sets = PIECE_SET_IDS.filter(id => id !== 'blindfold').map(id => PIECE_SETS[id]);
    return `
        <div class="pn-group"><div class="pn-row">${PanelKit.text('Chays Trainer', 'Entraîneur d’ouvertures et de finales, en révision espacée. Fonctionne hors ligne une fois installé.')}</div></div>
        <h3 class="pn-h">Jeux de pièces</h3>
        <div class="pn-group"><div class="pn-credits">${sets.map(s => `<div>${s.label}<span>${PanelKit.esc(s.author)} · ${PanelKit.esc(s.license)}</span></div>`).join('')}</div></div>
        <p class="pn-lede">Jeux issus du dépôt open source de lichess (dossier public/piece). Les textures d’échiquier (pierre, cuir, noyer) sont créées pour ce projet.</p>
        <h3 class="pn-h">Polices</h3>
        <div class="pn-group"><div class="pn-credits"><div>Fraunces<span>SIL OFL 1.1</span></div><div>IBM Plex Mono<span>SIL OFL 1.1</span></div><div>Inter<span>SIL OFL 1.1</span></div></div></div>`;
}

const HelpPanel = PanelKit.create({
    id: 'help-overlay',
    title: 'Aide',
    search: 'Rechercher dans l’aide',
    sections: () => HELP_SECTIONS,
    render: _renderHelp,
    onControl: (kind, key, value) => {
        if (kind !== 'act') return;
        if (key === 'acc') { _helpOpen[value] = !_helpOpen[value]; HelpPanel.refresh(); return; }
        if (key === 'section') { HelpPanel.open(value); return; }
        if (key === 'go') {
            HelpPanel.close();
            if (value.startsWith('tab:')) goHome(value.slice(4));
            else if (value === 'data') showData();
            else if (value === 'account' && typeof AccountUI !== 'undefined') AccountUI.open();
        }
    }
});

function showHelp(section) { HelpPanel.open(section); }
function closeHelp() { HelpPanel.close(); }

// Raccourcis d'ouverture des fenêtres : « , » Paramètres, « ? » Aide (hors champs de saisie).
document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (document.querySelector('.overlay:not(.hidden)')) return;
    if (e.key === ',') { e.preventDefault(); showSettings(); }
    else if (e.key === '?') { e.preventDefault(); showHelp(); }
});
