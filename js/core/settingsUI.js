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
    { id: 'jeu',       icon: 'target',   label: 'Jeu et entraînement',   desc: 'Échiquier, révisions, notation' },
    { id: 'moteur',    icon: 'cpu',      label: 'Moteur d’analyse',      desc: 'Stockfish : lignes, profondeur, fils' },
    { id: 'sons',      icon: 'volume',   label: 'Sons et vibrations',    desc: 'Effets sonores, volume, vibrations' },
    { id: 'access',    icon: 'eye',      label: 'Accessibilité',         desc: 'Animations, texte, contraste' },
    { id: 'donnees',   icon: 'database', label: 'Données et sauvegarde', desc: 'Sauvegarde, import, corbeille' },
    { id: 'clavier',   icon: 'keyboard', label: 'Raccourcis clavier',    desc: 'Toutes les touches utiles' }
];

const _NOTATION_SAMPLE = 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O';

// ─── Description des rangées (sert au rendu ET à la recherche) ─────────────────
// kind : toggle | seg | range | custom ; key : nom dans appSettings (ou training:<option>).
function _settingRows() {
    const s = appSettings, k = typeof trainingSettings !== 'undefined' ? trainingSettings : {};
    return {
        apparence: [
            { group: null, kind: 'custom', html: _previewHTML, search: 'aperçu échiquier' },
            { group: 'Interface', kind: 'seg', key: 'theme', label: 'Mode', hint: '« Système » suit le réglage clair / sombre de l’appareil.',
              opts: [['light', 'Clair'], ['dark', 'Sombre'], ['system', 'Système']], value: themeMode() },
            { group: 'Interface', kind: 'seg', key: 'darkBg', label: 'Fond du mode sombre', hint: 'Les accents suivent toujours l’échiquier. Noir OLED : écran éteint derrière l’interface.',
              opts: [['neutral', 'Gris neutre'], ['night', 'Bleu nuit'], ['oled', 'Noir OLED'], ['green', 'Vert Nocturne']] },
            { group: 'Échiquier', kind: 'custom', label: 'Thème de l’échiquier', hint: 'Les couleurs de l’interface en dérivent.', html: _boardsHTML, col: true },
            { group: 'Échiquier', kind: 'toggle', key: 'coords', label: 'Coordonnées', hint: 'Lettres et chiffres des cases.' },
            { group: 'Échiquier', kind: 'seg', key: 'coordPos', label: 'Emplacement des coordonnées', opts: [['in', 'Dans les cases'], ['out', 'Autour de l’échiquier']], off: !s.coords },
            { group: 'Échiquier', kind: 'toggle', key: 'lastMove', label: 'Surligner le dernier coup' },
            { group: 'Échiquier', kind: 'toggle', key: 'legalDots', label: 'Montrer les coups possibles', hint: 'Points sur les cases accessibles à la pièce choisie.' },
            { group: 'Échiquier', kind: 'seg', key: 'anim', label: 'Animation des pièces', opts: [['off', 'Aucune'], ['fast', 'Rapide'], ['normal', 'Normale']] },
            { group: 'Pièces et flèches', kind: 'custom', label: 'Style des pièces', hint: () => _pieceCredit(), html: _piecesHTML, col: true },
            { group: 'Pièces et flèches', kind: 'toggle', key: 'blindfold', label: 'Pièces invisibles', value: s.pieceSet === 'blindfold',
              hint: 'Masque les pièces pour s’entraîner à l’aveugle ; les coups s’écrivent en lettres. Choisir un style de pièces le désactive.', search: 'invisibles aveugle' },
            { group: 'Pièces et flèches', kind: 'custom', label: 'Style des flèches', hint: 'Clic droit glissé sur l’échiquier : flèche ; clic droit : cercle.', html: _arrowsHTML, col: true },
            { group: 'Pièces et flèches', kind: 'toggle', key: 'knightArrows', label: 'Flèches en L pour le cavalier', hint: 'Un saut de cavalier est dessiné en équerre ; sinon en ligne droite. Vaut pour tous les styles.' }
        ],
        jeu: [
            { group: 'Pendant la partie', kind: 'seg', key: 'moveInput', label: 'Déplacer les pièces', opts: [['both', 'Glisser ou cliquer'], ['drag', 'Glisser'], ['click', 'Cliquer']] },
            { group: 'Pendant la partie', kind: 'toggle', key: 'autoQueen', label: 'Promouvoir automatiquement en dame', hint: 'Maintenez <kbd>Alt</kbd> en jouant le coup pour choisir une autre pièce.' },
            { group: 'Pendant la partie', kind: 'seg', key: 'oppDelay', label: 'Réponse de l’adversaire', hint: 'Entraînement et finales.', opts: [['instant', 'Immédiate'], ['normal', 'Normale'], ['calm', 'Posée']] },
            { group: 'Pendant la partie', kind: 'toggle', key: 'autoFlip', label: 'Orienter l’échiquier selon ma couleur', hint: 'Avec les Noirs, vos pièces sont en bas. La touche <kbd>F</kbd> retourne toujours l’échiquier.' },
            { group: 'Pendant la partie', kind: 'seg', key: 'hintAfter', label: 'Proposer un indice', hint: 'Affiche la pièce à jouer après plusieurs erreurs sur la même position.',
              opts: [[0, 'Jamais'], [1, 'Après 1 erreur'], [2, 'Après 2'], [3, 'Après 3']] },
            { group: 'Pendant la partie', kind: 'seg', key: 'egOpponent', label: 'Adversaire des finales', hint: 'Résistance maximale : la défense la plus longue, le gain le plus rapide. Humain : un coup au hasard parmi ceux qui gardent le même résultat.',
              opts: [['max', 'Résistance maximale'], ['human', 'Humain']] },
            { group: 'Révision espacée', kind: 'range', key: 'dailyGoal', label: 'Objectif quotidien', hint: 'Positions à réviser chaque jour ; la progression s’affiche sur l’accueil.',
              min: 5, max: 50, step: 5, out: v => `${v} positions` },
            { group: 'Révision espacée', kind: 'seg', key: 'rhythm', label: 'Rythme des révisions', hint: 'Doux : les positions réussies reviennent moins souvent. Intensif : plus souvent.',
              opts: [['soft', 'Doux'], ['std', 'Standard'], ['intense', 'Intensif']] },
            { group: 'Révision espacée', kind: 'toggle', key: 'freqWeight', label: 'Prioriser les lignes fréquentes', hint: 'Les positions où vos adversaires (ou les joueurs Lichess) vous amènent le plus souvent sortent plus souvent. Sans données, rien ne change.' },
            { group: 'Mode libre (Entraînement)', kind: 'seg', key: 'training:fromStart', label: 'D’où partir', hint: 'Juste avant la position tirée, ou du premier coup de la ligne.', opts: [[0, 'Position ciblée'], [1, 'Début de partie']], value: k.fromStart },
            { group: 'Mode libre (Entraînement)', kind: 'seg', key: 'training:maxPlies', label: 'Jusqu’où dans l’ouverture', hint: 'Seules les positions jusqu’à ce coup sont tirées.', opts: [[0, 'Toutes'], [5, '≤ 5'], [10, '≤ 10'], [20, '≤ 20']], value: k.maxPlies },
            { group: 'Mode libre (Entraînement)', kind: 'seg', key: 'training:seqLen', label: 'Coups à enchaîner', hint: 'Après votre coup, l’adversaire répond et vous continuez.', opts: [[1, '1 coup'], [3, '3 coups'], [5, '5 coups'], [999, 'Variante']], value: k.seqLen },
            { group: 'Notation', kind: 'seg', key: 'notation', label: 'Écriture des coups', hint: 'Barre des coups, arbre, statistiques.',
              opts: [['fr', 'C F T D R'], ['en', 'N B R Q K'], ['fig', 'Figurines']] },
            { group: 'Notation', kind: 'custom', label: 'Exemple', html: () => `<span class="pn-sample">${_sampleLine()}</span>`, search: 'exemple notation' }
        ],
        moteur: [
            { group: null, kind: 'custom', html: _engineInfoHTML, search: 'stockfish moteur version licence', col: true },
            { group: 'Moteur', kind: 'seg', key: 'engineNet', label: 'Réseau neuronal', hint: 'Complet : nettement plus fort, mais 99 Mo à télécharger une fois et plus de mémoire. Réglage propre à cet appareil.',
              opts: [['lite', 'Léger · 1,8 Mo'], ['full', 'Complet · 99 Mo']] },
            { group: 'Moteur', kind: 'custom', html: _fullEngineHTML, search: 'télécharger moteur complet supprimer', col: true },
            { group: 'Calcul', kind: 'seg', key: 'engineLines', label: 'Lignes calculées', hint: 'Meilleurs coups affichés en même temps (MultiPV).', opts: [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']] },
            { group: 'Calcul', kind: 'seg', key: 'engineDepth', label: 'Profondeur', hint: 'Le calcul s’arrête à cette profondeur (en demi-coups).', opts: [[20, '20'], [25, '25'], [30, '30'], [40, '40'], [0, 'Sans limite']] },
            { group: 'Calcul', kind: 'seg', key: 'engineTime', label: 'Temps par position', hint: 'Arrêt au bout de ce temps, même si la profondeur n’est pas atteinte.', opts: [[0, 'Sans limite'], [5, '5 s'], [10, '10 s'], [30, '30 s']] },
            { group: 'Calcul', kind: 'toggle', key: 'engineAuto', label: 'Calculer dès l’ouverture de l’Analyse', hint: 'Sinon, le calcul se lance avec le bouton du panneau.' },
            { group: 'Calcul', kind: 'toggle', key: 'cloudEval', label: 'Évaluation Lichess immédiate', hint: 'Pour les positions connues, affiche tout de suite l’évaluation déjà calculée sur Lichess (en ligne).' },
            { group: 'Affichage', kind: 'seg', key: 'engineEval', label: 'Évaluation', opts: [['cp', 'En pions (+0,4)'], ['wdl', 'Chances de gain']] },
            { group: 'Affichage', kind: 'seg', key: 'engineArrows', label: 'Flèches sur l’échiquier', opts: [[0, 'Aucune'], [1, 'Meilleur coup'], [5, 'Toutes les lignes']] },
            { group: 'Cet appareil', kind: 'seg', key: 'engineThreads', label: 'Fils de calcul', hint: 'Plus de fils : plus rapide, plus gourmand. « Auto » : la moitié des cœurs.', opts: [[0, 'Auto'], [1, '1'], [2, '2'], [4, '4'], [8, '8']] },
            { group: 'Cet appareil', kind: 'seg', key: 'engineHash', label: 'Mémoire', hint: 'Table de transposition du moteur.', opts: [[16, '16 Mo'], [64, '64 Mo'], [128, '128 Mo'], [256, '256 Mo'], [512, '512 Mo']] }
        ],
        sons: [
            { group: null, kind: 'toggle', key: 'sound', label: 'Effets sonores' },
            { group: null, kind: 'range', key: 'volume', label: 'Volume', min: 0, max: 100, step: 5, scale: 100, out: v => `${v} %`, off: !s.sound },
            { group: 'Quels sons ?', kind: 'toggle', key: 'sMove', label: 'Coup joué', off: !s.sound },
            { group: 'Quels sons ?', kind: 'toggle', key: 'sCapture', label: 'Capture', off: !s.sound },
            { group: 'Quels sons ?', kind: 'toggle', key: 'sError', label: 'Coup refusé', off: !s.sound },
            { group: 'Quels sons ?', kind: 'toggle', key: 'sSuccess', label: 'Exercice réussi', hint: 'Fin d’un exercice d’entraînement ou d’une finale.', off: !s.sound },
            { group: 'Vibrations', kind: 'toggle', key: 'haptic', label: 'Vibration au toucher', hint: 'Téléphones compatibles : coup refusé, exercice réussi.' }
        ],
        access: [
            { group: null, kind: 'seg', key: 'motion', label: 'Animations', opts: [['system', 'Selon l’appareil'], ['reduced', 'Réduites'], ['full', 'Complètes']] },
            { group: null, kind: 'seg', key: 'textSize', label: 'Taille du texte', opts: [['s', 'Petite'], ['m', 'Normale'], ['l', 'Grande']] },
            { group: null, kind: 'toggle', key: 'contrast', label: 'Contraste renforcé', hint: 'Bordures et textes secondaires plus marqués.' },
            { group: null, kind: 'seg', key: 'announce', label: 'Annoncer les coups',
              hint: typeof Voice !== 'undefined' && Voice.available()
                  ? 'Lecteur d’écran : lu par VoiceOver ou TalkBack. Voix : la synthèse vocale de l’appareil' + (Voice.hasFrench() ? '.' : ' (aucune voix française trouvée : accent étranger possible).')
                  : 'Lu par les lecteurs d’écran (VoiceOver, TalkBack). Ce navigateur n’a pas de synthèse vocale.',
              opts: [['off', 'Non'], ['sr', 'Lecteur d’écran']].concat(typeof Voice !== 'undefined' && Voice.available() ? [['voice', 'Voix']] : []) }
        ],
        donnees: [
            { group: null, kind: 'custom', html: () => '<div id="backup-status" class="pn-backup"></div>', search: 'sauvegarde restaurer télécharger json', col: true },
            { group: null, kind: 'seg', key: 'backupReminder', label: 'Rappel de sauvegarde', hint: 'Pastille sur Paramètres et rappel au lancement, sans compte.',
              opts: [['never', 'Jamais'], ['weekly', 'Chaque semaine'], ['monthly', 'Chaque mois']] },
            { group: null, kind: 'custom', label: 'Autres données', hint: 'PGN, analyse d’une partie, parties en ligne, corbeille de 30 jours.',
              html: () => `<div class="pn-actions">${PanelKit.button('Ouvrir Données', 'openData', { icon: 'folder-open' })}${PanelKit.button('Corbeille', 'openTrash', { icon: 'trash' })}</div>` },
            { group: null, kind: 'custom', label: 'Installer l’application', hint: '<span id="install-hint"></span>', attrs: ' id="install-section"',
              html: () => `<button class="btn btn-primary" id="install-btn" type="button" onclick="installApp()">${ico('download')}Installer</button>` }
        ],
        clavier: [
            { group: null, kind: 'custom', html: _keysHTML, search: KEYBOARD_SHORTCUTS.map(g => g[0] + ' ' + g[1].map(x => x[0] + ' ' + x[1].join(' ')).join(' ')).join(' '), col: true, bare: true }
        ]
    };
}

// ─── Rendus spécifiques ───────────────────────────────────────────────────────
function _pieceCredit() {
    const set = PIECE_SETS[appSettings.pieceSet] || PIECE_SETS[DEFAULT_PIECE_SET];
    return `${set.label} · ${set.author} · ${set.license}.`;
}

function _previewHTML() {
    const s = appSettings, out = s.coords && s.coordPos === 'out';
    const rows = ['rnbqkb.r', 'pppp.ppp', '.....n..', '....p...', '....P...', '.....N..', 'PPPP.PPP', 'RNBQKB.R'];
    // Dernier coup (Cg1-f3), case choisie (f3) et ses coups possibles, flèche verte, flèche rouge (saut de cavalier) et cercle.
    const lastMove = s.lastMove ? [[5, 5], [7, 6]] : [];
    const legal = s.legalDots ? [[4, 7], [3, 6], [7, 6]] : [];
    const sel = [5, 5];
    let html = '';
    rows.forEach((line, r) => line.split('').forEach((ch, c) => {
        const cls = [(r + c) % 2 ? 'd' : '', lastMove.some(([a, b]) => a === r && b === c) ? 'lm' : '', r === sel[0] && c === sel[1] ? 'sel' : '',
                     ch === '.' && legal.some(([a, b]) => a === r && b === c) ? 'lg' : ''].filter(Boolean).join(' ');
        let inner = ch !== '.' ? pieceHTML(ch === ch.toUpperCase() ? ch : ch.toLowerCase()).replace('class="piece-svg"', '') : '';
        if (s.pieceSet === 'blindfold') inner = '';
        if (s.coords && r === 7) inner += `<b class="f">${'abcdefgh'[c]}</b>`;
        if (s.coords && c === 0) inner += `<b class="r">${8 - r}</b>`;
        html += `<i${cls ? ` class="${cls}"` : ''}>${inner}</i>`;
    }));
    const set = PIECE_SETS[s.pieceSet] || PIECE_SETS[DEFAULT_PIECE_SET];
    const board = BOARD_LABELS[s.boardTheme] || '';
    const arrows = typeof drawArrows !== 'function' ? '' : `<svg class="pn-arrows" viewBox="0 0 8 8">${drawArrows({
        style: s.arrowStyle, knight: s.knightArrows,
        arrows: [{ from: 5, to: 26, color: 'green' }, { from: 45, to: 28, color: 'red' }], circles: [{ sq: 36, color: 'gold' }] })}</svg>`;
    return `<div class="pn-preview"><div class="pn-board${out ? ' is-out' : ''}" aria-hidden="true">${html}${arrows}</div>
        <div class="pn-preview-notes"><b>${board} · ${set.label}</b><span>L’aperçu suit chacun des réglages de cette rubrique.</span>
        <span>Les couleurs de l’interface sont tirées des cases de l’échiquier.</span></div></div>`;
}

const BOARD_LABELS = { classic: 'Sauge', leather: 'Cuir vert', wood: 'Bois chaud', ice: 'Bleu glace', night: 'Bleu nuit', violet: 'Violet', walnut: 'Noyer', stone: 'Pierre', hache: 'Hachuré',
                       maple: 'Érable', marble: 'Marbre', tournament: 'Tournoi', cherry: 'Cerisier' };
const _boardsHTML = () => `<div class="theme-options">${BOARD_THEMES.map(id =>
    `<button type="button" class="theme-opt${appSettings.boardTheme === id ? ' active' : ''}" data-board="${id}" data-pn="seg" data-key="boardTheme" data-v="${id}" aria-pressed="${appSettings.boardTheme === id}"><span class="theme-swatch"></span>${BOARD_LABELS[id]}</button>`).join('')}</div>`;
// « Invisibles » n'est pas un style mais un mode : interrupteur à part (clé blindfold, qui écrit pieceSet).
const _piecesHTML = () => `<div class="theme-options">${PIECE_SET_IDS.filter(id => id !== 'blindfold').map(id => { const s = PIECE_SETS[id];
    return `<button type="button" class="theme-opt piece-opt${appSettings.pieceSet === id ? ' active' : ''}" data-piece="${id}" data-pn="seg" data-key="pieceSet" data-v="${id}" aria-pressed="${appSettings.pieceSet === id}"><span class="piece-preview"><span>${s.svg.K}</span><span>${s.svg.n}</span></span>${s.label}</button>`; }).join('')}</div>`;
const _arrowsHTML = () => typeof arrowStylePreview !== 'function' ? '' : `<div class="theme-options">${ARROW_STYLE_IDS.map(id =>
    `<button type="button" class="theme-opt arrow-opt${appSettings.arrowStyle === id ? ' active' : ''}" data-arrow="${id}" data-pn="seg" data-key="arrowStyle" data-v="${id}" aria-pressed="${appSettings.arrowStyle === id}">${arrowStylePreview(id)}${ARROW_STYLE_LABELS[id]}</button>`).join('')}</div>`;
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
function _rowHTML(r, fromSection) {
    const s = appSettings, from = fromSection ? `<span class="pn-from">${fromSection}</span>` : '';
    const hint = typeof r.hint === 'function' ? r.hint() : r.hint;
    const label = r.label ? from + r.label : '';
    if (r.kind === 'custom') {
        const body = r.html();
        if (r.bare) return body;
        if (!r.label) return `<div class="pn-row is-col"${r.attrs || ''}>${body}</div>`;
        return PanelKit.row(label, hint, body, { col: r.col, attrs: r.attrs });
    }
    const value = r.value !== undefined ? r.value : s[r.key];
    let control = '';
    if (r.kind === 'toggle') control = PanelKit.toggle(r.key, value, r.label);
    if (r.kind === 'seg')    control = PanelKit.seg(r.key, r.opts, value, r.label);
    if (r.kind === 'range') {
        const v = r.scale ? Math.round(value * r.scale) : value;
        control = PanelKit.range(r.key, v, r.min, r.max, r.step, r.out(v), r.label);
    }
    return PanelKit.row(label, hint, control, { off: r.off });
}

function _renderSettings(section, q) {
    const all = _settingRows();
    if (q) {
        const hits = [];
        SETTINGS_SECTIONS.forEach(sec => all[sec.id].forEach(r => {
            const hint = typeof r.hint === 'function' ? r.hint() : r.hint || '';
            const txt = [r.label, hint, r.search, (r.opts || []).map(o => o[1]).join(' ')].filter(Boolean).join(' ').replace(/<[^>]+>/g, '');
            if (PanelKit.matches(q, txt) && (r.label || r.search)) hits.push([sec, r]);
        }));
        if (!hits.length) return `<div class="pn-empty">Aucun réglage pour « ${PanelKit.esc(q)} ».</div>`;
        const bare = hits.filter(([, r]) => r.bare), rows = hits.filter(([, r]) => !r.bare);
        return (rows.length ? PanelKit.group(`${hits.length} résultat${hits.length > 1 ? 's' : ''}`, rows.map(([sec, r]) => PanelKit.mark(_rowHTML(r, sec.label), q))) : '')
             + bare.map(([, r]) => PanelKit.mark(r.html(), q)).join('');
    }
    const rows = all[section] || [];
    const groups = [];
    rows.forEach(r => {
        const g = groups.find(x => x.title === r.group);
        if (g) g.rows.push(r); else groups.push({ title: r.group, rows: [r] });
    });
    return groups.map(g => g.rows.length === 1 && g.rows[0].bare ? g.rows[0].html() : PanelKit.group(g.title, g.rows.map(r => _rowHTML(r)))).join('');
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
    sections: () => SETTINGS_SECTIONS.map(s => s.id === 'donnees' && typeof getBackupStatus === 'function' && _backupAlert() ? Object.assign({}, s, { badge: '!' }) : s),
    render: _renderSettings,
    afterRender: section => {
        if (document.getElementById('backup-status') && typeof renderBackupStatus === 'function') renderBackupStatus();
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

function showSettings(section)  { SettingsPanel.open(section); }
function closeSettings() { SettingsPanel.close(); }
