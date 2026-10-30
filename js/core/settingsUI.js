/**
 * core/settingsUI.js
 * ──────────────────────────────────────────────────────────────────────────
 * Fenêtre « Paramètres » : six rubriques et une recherche (socle : panelKit.js).
 *   Apparence · Jeu et entraînement · Sons et vibrations · Accessibilité · Données et sauvegarde · Raccourcis
 * Les valeurs vivent dans appSettings (settings.js) ; setPref() enregistre et applique l'effet.
 * Les options du mode libre de l'Entraînement (départ, profondeur, coups enchaînés) sont réglées ici seulement.
 */

'use strict';

// Raccourcis clavier (aussi affichés dans l'Aide, helpUI.js).
const KEYBOARD_SHORTCUTS = [
    ['Échiquier', [['Retourner l’échiquier', ['F']], ['Indice, puis solution', ['Espace']], ['Coup précédent / suivant', ['←', '→']],
                   ['Flèches du répertoire (Jouer)', ['R']], ['Déplacer le curseur sur l’échiquier', ['Tab', 'puis ← ↑ → ↓']], ['Jouer la case sous le curseur', ['Entrée']]]],
    ['Annotations', [['Flèche', ['Clic droit glissé']], ['Cercle', ['Clic droit']], ['Rouge · bleu · or', ['Maj', 'Alt', 'Ctrl']], ['Tout effacer', ['Clic gauche']]]],
    ['Fenêtres', [['Paramètres', [',']], ['Aide', ['?']], ['Fermer', ['Échap']]]]
];

const SETTINGS_SECTIONS = [
    { id: 'apparence', icon: 'palette',  label: 'Apparence',             desc: 'Mode, échiquier, pièces, flèches' },
    { id: 'jeu',       icon: 'target',   label: 'Jeu et entraînement',   desc: 'Partie, révisions, mode libre, notation' },
    { id: 'moteur',    icon: 'cpu',      label: 'Moteur d’analyse',      desc: 'Réseau, lignes, profondeur' },
    { id: 'sons',      icon: 'volume',   label: 'Sons et vibrations',    desc: 'Effets sonores, volume, vibrations' },
    { id: 'access',    icon: 'eye',      label: 'Accessibilité',         desc: 'Animations, texte, contraste, annonce' },
    { id: 'donnees',   icon: 'database', label: 'Données et sauvegarde', desc: 'Sauvegarde, import, corbeille' },
    { id: 'clavier',   icon: 'keyboard', label: 'Raccourcis clavier',    desc: 'Toutes les touches utiles' }
];

// Position de l'aperçu et de l'exemple de notation : 1. e4 e5 2. Cf3 Cc6 3. Fb5.
const _NOTATION_SAMPLE = 'e4 e5 Nf3 Nc6 Bb5';
const _PREVIEW_ROWS = ['r.bqkbnr', 'pppp.ppp', '..n.....', '.B..p...', '....P...', '.....N..', 'PPPP.PPP', 'RNBQK..R'];
const _sq = name => ('abcdefgh'.indexOf(name[0])) + 8 * (Number(name[1]) - 1);      // case 0..63 de drawArrows (a1 = 0)
const DARK_BG_LABELS = { neutral: 'Gris neutre', night: 'Bleu nuit', oled: 'Noir OLED', green: 'Nocturne' };

// Réglage propre à l'appareil : sa clé est dans LOCAL_PREFS (settings.js), jamais une liste écrite ici.
const _isLocalPref = key => !!key && Object.prototype.hasOwnProperty.call(LOCAL_PREFS, key);

// ─── Description des rangées (sert au rendu ET à la recherche) ─────────────────
// kind : toggle | seg | range | custom ; key : nom dans appSettings (ou training:<option>) ; pref : clé d'une
// grille (custom). Pas de phrase d'aide à l'écran : tip devient l'infobulle du libellé ; search : mots-clés de la recherche.
function _settingRows() {
    const s = appSettings, k = typeof trainingSettings !== 'undefined' ? trainingSettings : {};
    const voice = typeof Voice !== 'undefined' && Voice.available();
    return {
        apparence: [
            { group: null, kind: 'custom', html: _previewHTML, search: 'aperçu échiquier', preview: true },
            { group: 'Interface', kind: 'seg', key: 'theme', label: 'Mode', tip: '« Système » suit le réglage clair / sombre de l’appareil.',
              opts: [['light', 'Clair'], ['dark', 'Sombre'], ['system', 'Système']], value: themeMode() },
            { group: 'Interface', kind: 'custom', pref: 'darkBg', label: 'Fond du mode sombre', tip: 'Les accents suivent toujours l’échiquier. Noir OLED : écran éteint derrière l’interface.',
              html: _darkBgHTML, col: true, search: Object.values(DARK_BG_LABELS).join(' ') },
            { group: 'Échiquier', kind: 'custom', pref: 'boardTheme', label: 'Échiquier', tip: 'Les couleurs de l’interface en dérivent.', html: _boardsHTML, col: true,
              search: 'thème ' + BOARD_THEMES.map(id => BOARD_LABELS[id]).join(' ') },
            { group: 'Échiquier', kind: 'toggle', key: 'coords', label: 'Coordonnées', tip: 'Lettres et chiffres des cases.' },
            { group: 'Échiquier', kind: 'seg', key: 'coordPos', label: 'Emplacement des coordonnées', opts: [['in', 'Dans les cases'], ['out', 'Autour']], off: !s.coords },
            { group: 'Échiquier', kind: 'toggle', key: 'lastMove', label: 'Dernier coup', search: 'surligner' },
            { group: 'Échiquier', kind: 'toggle', key: 'legalDots', label: 'Coups possibles', tip: 'Points sur les cases accessibles à la pièce choisie.' },
            { group: 'Échiquier', kind: 'seg', key: 'anim', label: 'Animation des pièces', opts: [['off', 'Aucune'], ['fast', 'Rapide'], ['normal', 'Normale']] },
            { group: 'Pièces et flèches', kind: 'custom', pref: 'pieceSet', label: 'Pièces', tip: () => _pieceCredit(), html: _piecesHTML, col: true,
              search: 'style ' + PIECE_SET_IDS.filter(id => id !== 'blindfold').map(id => (PIECE_SETS[id] || {}).label).join(' ') },
            { group: 'Pièces et flèches', kind: 'toggle', key: 'blindfold', pref: 'pieceSet', label: 'Pièces invisibles', value: s.pieceSet === 'blindfold',
              tip: 'Masque les pièces pour s’entraîner à l’aveugle ; les coups s’écrivent en lettres. Choisir un style de pièces le désactive.', search: 'invisibles aveugle' },
            { group: 'Pièces et flèches', kind: 'custom', pref: 'arrowStyle', label: 'Flèches', tip: 'Clic droit glissé sur l’échiquier : flèche ; clic droit : cercle.', html: _arrowsHTML, col: true,
              search: 'style ' + ARROW_STYLE_IDS.map(id => ARROW_STYLE_LABELS[id]).join(' ') },
            { group: 'Pièces et flèches', kind: 'toggle', key: 'knightArrows', label: 'Cavalier en L', tip: 'Un saut de cavalier est dessiné en équerre ; sinon en ligne droite. Vaut pour tous les styles.', search: 'flèches' }
        ],
        jeu: [
            { group: 'Pendant la partie', kind: 'seg', key: 'moveInput', label: 'Déplacer les pièces', opts: [['both', 'Glisser ou cliquer'], ['drag', 'Glisser'], ['click', 'Cliquer']] },
            { group: 'Pendant la partie', kind: 'toggle', key: 'autoQueen', label: 'Dame automatique', tip: 'Promotion en dame. Maintenez Alt en jouant le coup pour choisir une autre pièce.', search: 'promouvoir promotion' },
            { group: 'Pendant la partie', kind: 'seg', key: 'oppDelay', label: 'Réponse de l’adversaire', tip: 'Entraînement et finales.', opts: [['instant', 'Immédiate'], ['normal', 'Normale'], ['calm', 'Posée']] },
            { group: 'Pendant la partie', kind: 'toggle', key: 'autoFlip', label: 'Orienter selon ma couleur', search: 'retourner orientation échiquier', tip: 'Avec les Noirs, vos pièces sont en bas. La touche F retourne toujours l’échiquier.' },
            { group: 'Pendant la partie', kind: 'seg', key: 'hintAfter', label: 'Indice après', search: 'proposer erreurs', tip: 'Affiche la pièce à jouer après plusieurs erreurs sur la même position.',
              opts: [[0, 'Jamais'], [1, '1 erreur'], [2, '2'], [3, '3']] },
            { group: 'Pendant la partie', kind: 'seg', key: 'egOpponent', label: 'Adversaire des finales', tip: 'Résistance maximale : la défense la plus longue, le gain le plus rapide. Humain : un coup au hasard parmi ceux qui gardent le même résultat.',
              opts: [['max', 'Résistance max.'], ['human', 'Humain']] },
            { group: 'Révisions', kind: 'range', key: 'dailyGoal', label: 'Objectif quotidien', search: 'révision jour', tip: 'Positions à réviser chaque jour, et nombre de nouvelles positions ajoutées chaque jour à la révision (les autres attendent les jours suivants) ; la progression s’affiche sur l’accueil.',
              min: 5, max: 50, step: 5, out: v => `${v} positions` },
            { group: 'Révisions', kind: 'seg', key: 'rhythm', label: 'Rythme', search: 'révision espacée', tip: 'Doux : les positions réussies reviennent moins souvent. Intensif : plus souvent.',
              opts: [['soft', 'Doux'], ['std', 'Standard'], ['intense', 'Intensif']] },
            { group: 'Révisions', kind: 'toggle', key: 'freqWeight', label: 'Lignes fréquentes d’abord', search: 'prioriser fréquence', tip: 'Les positions où vos adversaires (ou les joueurs Lichess) vous amènent le plus souvent sortent plus souvent. Sans données, rien ne change.' },
            { group: 'Mode libre', kind: 'seg', key: 'training:fromStart', label: 'Départ', tip: 'Juste avant la position tirée, ou du premier coup de la ligne.', opts: [[0, 'Position ciblée'], [1, 'Début de partie']], value: k.fromStart },
            { group: 'Mode libre', kind: 'seg', key: 'training:maxPlies', label: 'Profondeur max.', tip: 'Seules les positions jusqu’à ce coup sont tirées.', opts: [[0, 'Toutes'], [5, '≤ 5'], [10, '≤ 10'], [20, '≤ 20']], value: k.maxPlies },
            { group: 'Mode libre', kind: 'seg', key: 'training:seqLen', label: 'Coups enchaînés', tip: 'Après votre coup, l’adversaire répond et vous continuez.', opts: [[1, '1'], [3, '3'], [5, '5'], [999, 'Variante']], value: k.seqLen },
            { group: 'Notation', kind: 'seg', key: 'notation', label: 'Écriture des coups', tip: 'Barre des coups, arbre, statistiques.',
              opts: [['fr', 'Française'], ['en', 'Anglaise'], ['fig', 'Figurines']], search: 'C F T D R N B Q K' },
            { group: 'Notation', kind: 'custom', html: () => `<span class="pn-sample">${_sampleLine()}</span>`, search: 'exemple notation' }
        ],
        moteur: [
            { group: null, kind: 'custom', html: _engineInfoHTML, search: 'stockfish moteur version licence', col: true },
            { group: 'Moteur', kind: 'seg', key: 'engineNet', label: 'Réseau neuronal', tip: 'Complet : nettement plus fort, mais 99 Mo à télécharger une fois et plus de mémoire.',
              opts: [['lite', 'Léger · 1,8 Mo'], ['full', 'Complet · 99 Mo']] },
            { group: 'Moteur', kind: 'custom', html: _fullEngineHTML, search: 'télécharger moteur complet supprimer', col: true },
            { group: 'Calcul', kind: 'seg', key: 'engineLines', label: 'Lignes', tip: 'Meilleurs coups affichés en même temps (MultiPV).', opts: [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']] },
            { group: 'Calcul', kind: 'seg', key: 'engineDepth', label: 'Profondeur', tip: 'Le calcul s’arrête à cette profondeur (en demi-coups). ∞ : sans limite.', opts: [[20, '20'], [25, '25'], [30, '30'], [40, '40'], [0, '∞']] },
            { group: 'Calcul', kind: 'seg', key: 'engineTime', label: 'Temps par position', tip: 'Arrêt au bout de ce temps, même si la profondeur n’est pas atteinte. ∞ : sans limite.', opts: [[0, '∞'], [5, '5 s'], [10, '10 s'], [30, '30 s']] },
            { group: 'Calcul', kind: 'toggle', key: 'engineAuto', label: 'Calcul automatique', search: 'analyse ouverture', tip: 'Le calcul démarre dès l’ouverture de l’Analyse ; sinon, avec le bouton du panneau.' },
            { group: 'Calcul', kind: 'toggle', key: 'cloudEval', label: 'Évaluation Lichess', search: 'cloud en ligne immédiate', tip: 'Pour les positions connues, affiche tout de suite l’évaluation déjà calculée sur Lichess (en ligne).' },
            { group: 'Affichage', kind: 'seg', key: 'engineEval', label: 'Évaluation', opts: [['cp', 'En pions'], ['wdl', 'Chances de gain']] },
            { group: 'Affichage', kind: 'seg', key: 'engineArrows', label: 'Flèches', opts: [[0, 'Aucune'], [1, 'Meilleur coup'], [5, 'Toutes']] },
            { group: 'Cet appareil', kind: 'seg', key: 'engineThreads', label: 'Fils de calcul', search: 'threads cœurs', tip: 'Plus de fils : plus rapide, plus gourmand. « Auto » : la moitié des cœurs.', opts: [[0, 'Auto'], [1, '1'], [2, '2'], [4, '4'], [8, '8']] },
            { group: 'Cet appareil', kind: 'seg', key: 'engineHash', label: 'Mémoire', search: 'hash table', tip: 'Table de transposition du moteur.', opts: [[16, '16 Mo'], [64, '64 Mo'], [128, '128 Mo'], [256, '256 Mo'], [512, '512 Mo']] }
        ],
        sons: [
            { group: null, kind: 'toggle', key: 'sound', label: 'Effets sonores' },
            { group: null, kind: 'range', key: 'volume', label: 'Volume', min: 0, max: 100, step: 5, scale: 100, out: v => `${v} %`, off: !s.sound },
            { group: 'Quels sons ?', kind: 'toggle', key: 'sMove', label: 'Coup joué', off: !s.sound },
            { group: 'Quels sons ?', kind: 'toggle', key: 'sCapture', label: 'Capture', off: !s.sound },
            { group: 'Quels sons ?', kind: 'toggle', key: 'sError', label: 'Coup refusé', off: !s.sound },
            { group: 'Quels sons ?', kind: 'toggle', key: 'sSuccess', label: 'Exercice réussi', search: 'son', tip: 'Fin d’un exercice d’entraînement ou d’une finale.', off: !s.sound },
            { group: 'Vibrations', kind: 'toggle', key: 'haptic', label: 'Vibration au toucher', search: 'téléphone', tip: 'Téléphones compatibles : coup refusé, exercice réussi.' }
        ],
        access: [
            { group: null, kind: 'seg', key: 'motion', label: 'Animations', opts: [['system', 'Selon l’appareil'], ['reduced', 'Réduites'], ['full', 'Complètes']] },
            { group: null, kind: 'seg', key: 'textSize', label: 'Taille du texte', opts: [['s', 'Petite'], ['m', 'Normale'], ['l', 'Grande']] },
            { group: null, kind: 'toggle', key: 'contrast', label: 'Contraste renforcé', search: 'bordures lisibilité', tip: 'Bordures et textes secondaires plus marqués.' },
            { group: null, kind: 'seg', key: 'announce', label: 'Annoncer les coups', search: 'voix lecteur d’écran son',
              tip: voice ? 'Lecteur d’écran : lu par VoiceOver ou TalkBack. Voix : la synthèse vocale de l’appareil' + (Voice.hasFrench() ? '.' : ' (aucune voix française trouvée : accent étranger possible).')
                         : 'Lu par les lecteurs d’écran (VoiceOver, TalkBack). Ce navigateur n’a pas de synthèse vocale.',
              opts: [['off', 'Non'], ['sr', 'Lecteur d’écran']].concat(voice ? [['voice', 'Voix']] : []) }
        ],
        donnees: [
            { group: null, kind: 'custom', html: () => '<div id="backup-status" class="pn-backup"></div>', search: 'sauvegarde restaurer télécharger fichier', col: true },
            { group: null, kind: 'seg', key: 'backupReminder', label: 'Rappel de sauvegarde', tip: 'Pastille sur Paramètres et rappel au lancement, sans compte.',
              opts: [['never', 'Jamais'], ['weekly', 'Chaque semaine'], ['monthly', 'Chaque mois']] },
            { group: null, kind: 'custom', label: 'Autres données', tip: 'PGN, analyse d’une partie, parties en ligne, corbeille de 30 jours.', search: 'pgn corbeille',
              html: () => `<div class="pn-actions">${PanelKit.button('Ouvrir Données', 'openData', { icon: 'folder-open' })}${PanelKit.button('Corbeille', 'openTrash', { icon: 'trash' })}</div>` },
            // #install-hint : état de l'installation (écrit par updateInstallRow, mobile.js), pas une phrase d'aide.
            { group: null, kind: 'custom', label: 'Installer l’application', hint: '<span id="install-hint"></span>', attrs: ' id="install-section"',
              html: () => `<button class="btn" id="install-btn" type="button" onclick="installApp()">${ico('download')}Installer</button>` }
        ],
        clavier: [
            { group: null, kind: 'custom', html: _keysHTML, search: KEYBOARD_SHORTCUTS.map(g => g[0] + ' ' + g[1].map(x => x[0] + ' ' + x[1].join(' ')).join(' ')).join(' '), col: true, bare: true }
        ]
    };
}

// Clé de préférence d'une rangée (repère local, data-pref) : la clé du contrôle, sinon celle de la grille.
const _rowPref = r => r.pref || r.key || '';
// Une rubrique est locale quand chacun de ses réglages l'est (au moins un réglage).
function _sectionLocal(rows) {
    const keys = rows.map(_rowPref).filter(Boolean);
    return keys.length > 0 && keys.every(_isLocalPref);
}

// ─── Rendus spécifiques ───────────────────────────────────────────────────────
function _pieceCredit() {
    const set = PIECE_SETS[appSettings.pieceSet] || PIECE_SETS[DEFAULT_PIECE_SET];
    return `${set.label} · ${set.author} · ${set.license}.`;
}

// Aperçu en direct, position après 3. Fb5 : dernier coup Ff1-b5, case choisie b5 et ses coups possibles,
// flèche verte Fb5 → c6, flèche rouge en L Cf3 → e5 et cercle or sur e5 (drawArrows, annotations.js).
function _previewHTML() {
    const s = appSettings, out = s.coords && s.coordPos === 'out', blind = s.pieceSet === 'blindfold';
    const at = name => [8 - Number(name[1]), 'abcdefgh'.indexOf(name[0])];
    const has = (list, r, c) => list.some(([a, b]) => a === r && b === c);
    const lastMove = s.lastMove ? ['f1', 'b5'].map(at) : [];
    const legal = s.legalDots ? ['a6', 'a4', 'c4', 'd3', 'e2'].map(at) : [];
    const sel = s.legalDots ? at('b5') : null;
    let html = '';
    _PREVIEW_ROWS.forEach((line, r) => line.split('').forEach((ch, c) => {
        const cls = [(r + c) % 2 ? 'd' : '', has(lastMove, r, c) ? 'lm' : '', sel && r === sel[0] && c === sel[1] ? 'sel' : '',
                     ch === '.' && has(legal, r, c) ? 'lg' : ''].filter(Boolean).join(' ');
        let inner = ch !== '.' && !blind ? pieceHTML(ch).replace('class="piece-svg"', '') : '';
        if (s.coords && r === 7) inner += `<b class="f">${'abcdefgh'[c]}</b>`;
        if (s.coords && c === 0) inner += `<b class="r">${8 - r}</b>`;
        html += `<i${cls ? ` class="${cls}"` : ''}>${inner}</i>`;
    }));
    const set = PIECE_SETS[s.pieceSet] || PIECE_SETS[DEFAULT_PIECE_SET];
    const arrows = typeof drawArrows !== 'function' ? '' : `<svg class="pn-arrows" viewBox="0 0 8 8">${drawArrows({
        style: s.arrowStyle, flipped: false, knight: s.knightArrows,
        arrows: [{ from: _sq('b5'), to: _sq('c6'), color: 'green' }, { from: _sq('f3'), to: _sq('e5'), color: 'red' }],
        circles: [{ sq: _sq('e5'), color: 'gold' }] })}</svg>`;
    const credit = blind ? '' : `<small>${PanelKit.esc(`${set.author} · ${set.license}`)}</small>`;
    return `<div class="pn-preview" data-preview>
        <div class="pn-board${out ? ' is-out' : ''}" role="img" aria-label="Aperçu : position après 3. Fb5">${html}${arrows}</div>
        <div class="pn-preview-notes"><b>${PanelKit.esc(BOARD_LABELS[s.boardTheme] || '')} · ${PanelKit.esc(blind ? 'Invisibles' : set.label)}</b>
            <span class="pn-preview-meta">Flèches ${PanelKit.esc(ARROW_STYLE_LABELS[s.arrowStyle] || '')}${s.knightArrows ? ' · cavalier en L' : ''}</span>
            <span class="pn-sample">${_sampleLine()}</span>${credit}</div></div>`;
}

const BOARD_LABELS = { classic: 'Sauge', leather: 'Cuir vert', wood: 'Bois chaud', ice: 'Bleu glace', night: 'Bleu nuit', violet: 'Violet', walnut: 'Noyer', stone: 'Pierre', hache: 'Hachuré',
                       maple: 'Érable', marble: 'Marbre', tournament: 'Tournoi', cherry: 'Cerisier' };
// Grilles : data-min (largeur minimale d'une tuile) et data-max (colonnes au plus) règlent PanelKit.balancedCols.
// 13 échiquiers : 5 + 5 + 3 au téléphone, 7 + 6 sur ordinateur ; 12 pièces : 4 × 3 ou 6 × 2 ; 6 flèches : 3 × 2 ou 6 ; 4 fonds : 4.
const SETTINGS_GRIDS = { boardTheme: { min: 60, max: 7 }, pieceSet: { min: 76, max: 6 }, arrowStyle: { min: 70, max: 6 }, darkBg: { min: 70, max: 4 } };
const _grid = (pref, tiles) => `<div class="theme-options" data-grid="${pref}" data-min="${SETTINGS_GRIDS[pref].min}" data-max="${SETTINGS_GRIDS[pref].max}">${tiles}</div>`;
const _boardsHTML = () => _grid('boardTheme', BOARD_THEMES.map(id =>
    `<button type="button" class="theme-opt${appSettings.boardTheme === id ? ' active' : ''}" data-board="${id}" data-pn="seg" data-key="boardTheme" data-v="${id}" aria-pressed="${appSettings.boardTheme === id}"><span class="theme-swatch"></span>${BOARD_LABELS[id]}</button>`).join(''));
// « Invisibles » n'est pas un style mais un mode : interrupteur à part (clé blindfold, qui écrit pieceSet).
const _piecesHTML = () => _grid('pieceSet', PIECE_SET_IDS.filter(id => id !== 'blindfold').map(id => { const s = PIECE_SETS[id];
    return `<button type="button" class="theme-opt piece-opt${appSettings.pieceSet === id ? ' active' : ''}" data-piece="${id}" data-pn="seg" data-key="pieceSet" data-v="${id}" aria-pressed="${appSettings.pieceSet === id}"><span class="piece-preview"><span>${s.svg.K}</span><span>${s.svg.n}</span></span>${s.label}</button>`; }).join(''));
const _arrowsHTML = () => typeof arrowStylePreview !== 'function' ? '' : _grid('arrowStyle', ARROW_STYLE_IDS.map(id =>
    `<button type="button" class="theme-opt arrow-opt${appSettings.arrowStyle === id ? ' active' : ''}" data-arrow="${id}" data-pn="seg" data-key="arrowStyle" data-v="${id}" aria-pressed="${appSettings.arrowStyle === id}">${arrowStylePreview(id)}${ARROW_STYLE_LABELS[id]}</button>`).join(''));
// Fond du mode sombre : vignette fond + carte aux couleurs du fond (bloc du fond dans style.css).
const _darkBgHTML = () => _grid('darkBg', DARK_BGS.map(id =>
    `<button type="button" class="theme-opt pn-bg-opt${appSettings.darkBg === id ? ' active' : ''}" data-bg="${id}" data-pn="seg" data-key="darkBg" data-v="${id}" aria-pressed="${appSettings.darkBg === id}"><span class="pn-bg-sw"><i></i><i></i></span>${DARK_BG_LABELS[id]}</button>`).join(''));
// Moteur complet : état du téléchargement (gardé hors de la fenêtre : il continue si on la ferme).
const _fullDl = { state: null, job: null, got: 0, total: 0, error: '' };       // state : null (inconnu) | 'absent' | 'ready'
const _mo = n => `${Math.round(n / 1e6)} Mo`;                         // mégaoctets décimaux, comme « 99 Mo » ailleurs

function _fullEngineHTML() {
    if (typeof Engine === 'undefined') return '';
    if (_fullDl.state === null) { Engine.full.status().then(s => { _fullDl.state = s; if (SettingsPanel.isOpen()) SettingsPanel.refresh(); }).catch(() => {}); return ''; }
    const err = _fullDl.error ? `<p class="pn-dl-err">${PanelKit.esc(_fullDl.error)}</p>` : '';
    if (_fullDl.job) {
        const pct = _fullDl.total ? Math.round(100 * _fullDl.got / _fullDl.total) : 0;
        return `<div class="pn-dl"><b>Téléchargement du moteur complet</b>
            <progress id="full-dl-bar" max="100" value="${pct}"></progress>
            <small id="full-dl-text">${_mo(_fullDl.got)} sur ${_mo(_fullDl.total)}</small>
            <div class="pn-actions">${PanelKit.button('Annuler', 'fullCancel', { icon: 'x' })}</div></div>`;
    }
    if (_fullDl.state === 'ready') {
        return `<div class="pn-dl"><b>Moteur complet téléchargé (${_mo(_fullDl.total || 99e6)}), disponible hors ligne.</b>
            <small>${appSettings.engineNet === 'full' ? 'Il est utilisé pour l’analyse.' : 'Choisissez « Complet » ci-dessus pour l’utiliser.'}</small>
            <div class="pn-actions">${PanelKit.button('Supprimer le moteur complet', 'fullRemove', { icon: 'trash' })}</div>${err}</div>`;
    }
    if (appSettings.engineNet !== 'full') return err;
    const save = typeof navigator !== 'undefined' && navigator.connection && navigator.connection.saveData;
    return `<div class="pn-dl"><b>Pas encore téléchargé : l’analyse utilise le réseau léger en attendant.</b>
        <small>Environ 99 Mo, une seule fois, depuis unpkg.com ; le fichier est vérifié avant d’être gardé.${save ? ' Votre appareil économise les données : préférez le Wi-Fi.' : ''}</small>
        <div class="pn-actions">${PanelKit.button('Télécharger (99 Mo)', 'fullDownload', { primary: true, icon: 'download' })}</div>${err}</div>`;
}

function _fullDownload() {
    if (_fullDl.job || typeof Engine === 'undefined') return;
    _fullDl.error = '';
    _fullDl.got = 0;
    let last = 0;
    _fullDl.job = Engine.full.download((got, total) => {
        _fullDl.got = got; _fullDl.total = total;
        if (Date.now() - last < 200) return;
        last = Date.now();
        const bar = document.getElementById('full-dl-bar'), txt = document.getElementById('full-dl-text');
        if (bar) bar.value = Math.round(100 * got / total);
        if (txt) txt.textContent = `${_mo(got)} sur ${_mo(total)}`;
    });
    Engine.full.size().then(n => { _fullDl.total = n; });
    _fullDl.job.done
        .then(() => { _fullDl.state = 'ready'; if (typeof analysisSettingsChanged === 'function') analysisSettingsChanged('engineNet'); })
        .catch(e => { _fullDl.error = e.message === 'annulé' ? '' : `Téléchargement impossible : ${e.message}. Le réseau léger reste utilisé.`; })
        .finally(() => { _fullDl.job = null; if (SettingsPanel.isOpen()) SettingsPanel.refresh(); });
    SettingsPanel.refresh();
}

// Moteur : version et mode de calcul une fois chargé, sinon ce qui se passera au premier usage.
function _engineInfoHTML() {
    const i = typeof Engine !== 'undefined' ? Engine.info() : null;
    const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
    const what = i ? `${i.name} ${i.version} · réseau léger · ${i.threads > 1 ? `${i.threads} fils de calcul` : '1 fil de calcul'}`
                   : `Stockfish, téléchargé au premier usage (environ 1,8 Mo), puis disponible hors ligne.`;
    const how = isolated ? 'Calcul sur plusieurs fils disponible sur cet appareil.' : 'Ce navigateur limite le moteur à un seul fil de calcul.';
    return `<div class="pn-engine"><b>${PanelKit.esc(what)}</b><small>${how} Logiciel libre, licence GPL v3 : <a href="https://github.com/official-stockfish/Stockfish" target="_blank" rel="noopener">Stockfish</a>, compilé en WebAssembly par <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">stockfish.js</a>.</small></div>`;
}
const _keysHTML = () => KEYBOARD_SHORTCUTS.map(([g, list]) => `<h3 class="pn-h">${g}</h3><div class="pn-group"><div class="pn-keys">${list.map(([l, ks]) =>
    `<div class="pn-key"><span>${l}</span><span>${ks.map(x => x.startsWith('puis') ? `<small>${x}</small>` : `<kbd>${x}</kbd>`).join('')}</span></div>`).join('')}</div></div>`).join('');

function _sampleLine() {
    const m = _NOTATION_SAMPLE.split(' ');
    let out = '';
    m.forEach((san, i) => { if (i % 2 === 0) out += `${i / 2 + 1}. `; out += formatSan(san, i % 2 ? 'b' : 'w') + ' '; });
    return out.trim();
}

// ─── Rendu d'une rangée et d'une rubrique ─────────────────────────────────────
const _plain = t => String(t || '').replace(/<[^>]+>/g, '');
const SEARCH_SUGGESTIONS = ['flèche', 'son', 'révision', 'moteur'];

function _rowHTML(r, fromSection) {
    const s = appSettings, pref = _rowPref(r), local = _isLocalPref(pref);
    const tip = typeof r.tip === 'function' ? r.tip() : r.tip;
    const from = fromSection ? `<span class="pn-from">${fromSection}</span>` : '';
    const label = r.label ? `${from}<span class="pn-lbl"><span${tip ? ` title="${PanelKit.esc(_plain(tip))}"` : ''}>${r.label}</span>${local ? PanelKit.localMark() : ''}</span>` : '';
    const attrs = (r.attrs || '') + (pref ? ` data-pref="${pref}"` : '');
    if (r.kind === 'custom') {
        const body = r.html();
        if (r.bare) return body;
        if (!r.label) return `<div class="pn-row is-col"${attrs}>${body}</div>`;
        return PanelKit.row(label, r.hint, body, { col: r.col, attrs });
    }
    const value = r.value !== undefined ? r.value : s[r.key];
    let control = '';
    if (r.kind === 'toggle') control = PanelKit.toggle(r.key, value, r.label);
    if (r.kind === 'seg')    control = PanelKit.seg(r.key, r.opts, value, r.label);
    if (r.kind === 'range') {
        const v = r.scale ? Math.round(value * r.scale) : value;
        control = PanelKit.range(r.key, v, r.min, r.max, r.step, r.out(v), r.label);
    }
    return PanelKit.row(label, '', control, { off: r.off, attrs });
}

function _groupsHTML(rows) {
    const groups = [];
    rows.forEach(r => {
        const g = groups.find(x => x.title === r.group);
        if (g) g.rows.push(r); else groups.push({ title: r.group, rows: [r] });
    });
    return groups.map(g => g.rows.length === 1 && g.rows[0].bare ? g.rows[0].html() : PanelKit.group(g.title, g.rows.map(r => _rowHTML(r)))).join('');
}

// Recherche : chaque résultat porte son contrôle, réglable sur place ; le terme est surligné.
function _searchHTML(all, q) {
    const hits = [];
    SETTINGS_SECTIONS.forEach(sec => all[sec.id].forEach(r => {
        if (r.preview) return;
        // Texte visible seulement (libellé, options, mots-clés) : un résultat trouvé par son infobulle ne montrerait pas le terme.
        const txt = _plain([r.label, r.search, (r.opts || []).map(o => o[1]).join(' ')].filter(Boolean).join(' '));
        if (PanelKit.matches(q, txt) && (r.label || r.search)) hits.push([sec, r]);
    }));
    if (!hits.length) return `<div class="pn-empty pn-noresult">${ico('search')}<b>Rien sur « ${PanelKit.esc(q)} »</b>
        <span class="pn-suggest">${SEARCH_SUGGESTIONS.map(w => `<button type="button" class="pn-chip" data-pn="query" data-key="${w}">${w}</button>`).join('')}</span></div>`;
    const bare = hits.filter(([, r]) => r.bare), rows = hits.filter(([, r]) => !r.bare);
    return (rows.length ? PanelKit.group(`${hits.length} résultat${hits.length > 1 ? 's' : ''}`, rows.map(([sec, r]) => PanelKit.mark(_rowHTML(r, sec.label), q))) : '')
         + bare.map(([, r]) => PanelKit.mark(r.html(), q)).join('');
}

function _renderSettings(section, q) {
    const all = _settingRows();
    if (q) return _searchHTML(all, q);
    const rows = all[section] || [];
    const preview = rows.find(r => r.preview);
    if (!preview) return _groupsHTML(rows);
    // Apparence : l'aperçu à droite (ordinateur) ou en tête, à plat et collant (téléphone).
    return `<div class="pn-etabli"><aside class="pn-etabli-aside" aria-label="Aperçu">${preview.html()}</aside>
        <div class="pn-etabli-main">${_groupsHTML(rows.filter(r => r !== preview))}</div></div>`;
}

// ─── Application d'un réglage ─────────────────────────────────────────────────
function _redrawBoardViews() {
    if (typeof refreshPieces === 'function') refreshPieces();
}

function setPref(key, value) {
    if (key === 'theme') { setThemeMode(value); return; }
    if (key.startsWith('training:')) { if (typeof setTrainingOption === 'function') setTrainingOption(key.slice(9), value); return; }
    const d = SYNCED_PREFS[key] || LOCAL_PREFS[key];
    if (!d) return;
    if (typeof d.def === 'number' && typeof value !== 'number') value = Number(value);
    if (!d.ok(value)) return;
    appSettings[key] = value;
    saveSettings();
    switch (key) {
        case 'boardTheme': applyBoardTheme(); break;
        case 'pieceSet':
            applyPieceSet(); _redrawBoardViews();
            refreshNotation();                                      // figurines du jeu actif (« Invisibles » : lettres)
            if (typeof initTraining === 'function') initTraining();
            if (typeof initEndgame === 'function') initEndgame();
            break;
        case 'arrowStyle': case 'knightArrows': if (typeof renderAnnotations === 'function') renderAnnotations(); break;
        case 'coords': case 'coordPos': case 'legalDots': case 'textSize': case 'contrast': case 'motion': case 'darkBg':
            applyDisplayPrefs(); break;
        case 'lastMove': _redrawBoardViews(); break;
        case 'notation': refreshNotation(); break;
        case 'dailyGoal': if (typeof renderHomeSummary === 'function') renderHomeSummary(); if (typeof initTraining === 'function') initTraining(); break;
        case 'sound': case 'volume': _copyLooksToPrefs(); break;
        case 'backupReminder': if (typeof updateBackupIndicators === 'function') updateBackupIndicators(); break;
        case 'engineNet': if (typeof Engine !== 'undefined') Engine.reload();
            if (typeof analysisSettingsChanged === 'function') analysisSettingsChanged(key); break;
        case 'engineLines': case 'engineDepth': case 'engineTime': case 'engineEval': case 'engineArrows': case 'engineThreads': case 'engineHash': case 'cloudEval':
            if (typeof analysisSettingsChanged === 'function') analysisSettingsChanged(key); break;
    }
}

// Notation changée : tout ce qui affiche des coups est redessiné.
function refreshNotation() {
    const gs = document.getElementById('game-screen');
    if (gs && gs.style.display !== 'none' && typeof _paintMovesBar === 'function') _paintMovesBar(navCursor === -1 ? moveHistory.length - 1 : navCursor);
    if (typeof refreshTree === 'function') refreshTree();
    if (typeof renderResumeCard === 'function') renderResumeCard();
    if (typeof HomePanels !== 'undefined') HomePanels.render();             // Nouveautés à traiter, Dernières parties
    if (typeof _online !== 'undefined' && _online.rows && document.getElementById('online-results')) _renderOnlineResults();
    const stats = document.getElementById('home-tab-stats');
    if (stats && !stats.classList.contains('hidden') && typeof initStats === 'function') initStats();
}

// ─── Fenêtre ──────────────────────────────────────────────────────────────────
const SettingsPanel = PanelKit.create({
    id: 'settings-overlay',
    title: 'Paramètres',
    search: 'Rechercher un réglage',
    sections: () => { const all = _settingRows(); return SETTINGS_SECTIONS.map(s => s.id === 'donnees' && typeof getBackupStatus === 'function' && _backupAlert() ? Object.assign({}, s, { badge: '!' })
                                                    : _sectionLocal(all[s.id] || []) ? Object.assign({}, s, { local: true }) : s); },
    render: _renderSettings,
    afterRender: section => {
        if (document.getElementById('backup-status') && typeof renderBackupStatus === 'function') {
            renderBackupStatus();
            // Une seule action pleine dans Données : la sauvegarde (backup.js ne la remplit qu'en cas d'urgence).
            const save = document.querySelector('#backup-status [data-action="backupExport"]');
            if (save) save.classList.add('btn-primary');
        }
        if (document.getElementById('install-section') && typeof updateInstallRow === 'function') updateInstallRow();
    },
    onControl: (kind, key, value, el) => {
        if (kind === 'act') {
            if (key === 'openData')  { SettingsPanel.close(); showData(); }
            if (key === 'openTrash') { SettingsPanel.close(); showTrash(); }
            if (key === 'fullDownload') _fullDownload();
            if (key === 'fullCancel' && _fullDl.job) _fullDl.job.cancel();
            if (key === 'fullRemove') Engine.full.remove().then(() => { _fullDl.state = 'absent'; SettingsPanel.refresh(); if (typeof analysisSettingsChanged === 'function') analysisSettingsChanged('engineNet'); });
            return;
        }
        if (kind === 'range' || kind === 'range-commit') {
            const r = Object.values(_settingRows()).flat().find(x => x.key === key);
            const v = r && r.scale ? value / r.scale : value;
            if (kind === 'range') {
                setPref(key, v);
                const out = el.parentElement.querySelector('output');
                if (out && r) out.textContent = r.out(value);
                if (key === 'volume') { /* l'aperçu sonore se joue au relâchement */ }
            } else if (key === 'volume') playSound('move');
            return;
        }
        if (key === 'blindfold') {
            // Le jeu de pièces quitté est retenu pour la séance ; sinon (rechargement) retour au jeu par défaut.
            if (value) { SettingsPanel.state.piecesBefore = appSettings.pieceSet; setPref('pieceSet', 'blindfold'); }
            else setPref('pieceSet', PIECE_SETS[SettingsPanel.state.piecesBefore] && SettingsPanel.state.piecesBefore !== 'blindfold' ? SettingsPanel.state.piecesBefore : DEFAULT_PIECE_SET);
            return SettingsPanel.refresh();
        }
        setPref(key, value);
        if (key === 'sound' && value) playSound('move');
        SettingsPanel.refresh();
    }
});

function _backupAlert() {
    const st = getBackupStatus();
    return backupReminderDue(st);
}

// showSettings('moteur') ouvre directement la rubrique Moteur (depuis l'Analyse) ; un bloc précis de la rubrique
// (data-pref, ex. 'engineNet') peut être amené à l'écran.
function showSettings(section, pref) {
    SettingsPanel.open(section);
    const el = pref && SettingsPanel.el.querySelector(`.pn-content [data-pref="${pref}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
}
function closeSettings() { SettingsPanel.close(); }
PanelKit.jump({ id: 'settings-overlay', label: 'Paramètres', icon: 'settings', order: 1, open: () => showSettings() });
