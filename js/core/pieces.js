/**
 * core/pieces.js
 * ──────────────────────────────────────────────────────────────────────────
 * Jeux de pièces : fichiers SVG dans assets/pieces/<jeu>/{w|b}{K|Q|R|B|N|P}.svg
 * (jeux issus du dépôt open source de lichess — crédits dans assets/pieces/CREDITS.md).
 *
 * Chaque pièce est affichée avec une balise <img> (et non du SVG en ligne) : les
 * identifiants, dégradés et styles internes de chaque fichier restent isolés et ne
 * peuvent pas entrer en collision entre pièces.
 *
 * Clés : majuscule = Blancs (K Q R B N P), minuscule = Noirs.
 * PIECE_SVG est l'objet du jeu actif, MUTÉ EN PLACE : toute référence reste valide.
 * Les clés de PIECE_SETS doivent correspondre à PIECE_SET_IDS (settings.js).
 */

'use strict';

const PIECE_DIR = 'assets/pieces';

function _imgSet(id) {
    const out = {};
    'KQRBNP'.split('').forEach(t => {
        out[t]                = `<img class="piece-svg" src="${PIECE_DIR}/${id}/w${t}.svg" alt="" draggable="false">`;
        out[t.toLowerCase()]  = `<img class="piece-svg" src="${PIECE_DIR}/${id}/b${t}.svg" alt="" draggable="false">`;
    });
    return out;
}

function _def(id, label, author, license) {
    return { label, author, license, svg: _imgSet(id) };
}

// Ordre = ordre d'affichage dans les Paramètres : Maestro (le défaut) d'abord, puis les classiques, les modernes, les fantaisies, les épurés.
const PIECE_SETS = {
    'maestro':        _def('maestro',        'Maestro',        'sadsnake1',                   'CC BY-NC-SA 4.0'),
    'merida':         _def('merida',         'Merida',         'Armando Hernandez Marroquin', 'GPLv2+'),
    'staunty':        _def('staunty',        'Staunty',        'sadsnake1',                   'CC BY-NC-SA 4.0'),
    'chrome':         _def('chrome',         'Chrome',         'Chrome — dérivé des silhouettes de Colin M.L. Burnett', 'GPLv2+'),
    'california':     _def('california',     'California',     'Jerry S.',                    'CC BY-NC-SA 4.0'),
    'chessnut':       _def('chessnut',       'Chessnut',       'Alexis Luengas',              'Apache 2.0'),
    'spatial':        _def('spatial',        'Spatial',        'Maurizio Monge',              'MIT'),
    'fantasy':        _def('fantasy',        'Fantasy',        'Maurizio Monge',              'MIT'),
    'minimal-warmth': _def('minimal-warmth', 'Minimal Warmth', 'blunder_reign',               'CC BY-NC-SA 4.0'),
    'kiwen-suwi':     _def('kiwen-suwi',     'Kiwen Suwi',     'neverRare',                   'CC BY 4.0'),
    'blindfold':      { label: 'Invisibles', author: 'Entraînement à l\'aveugle (pièces masquées)', license: '—', src: 'merida', svg: _imgSet('merida') }
};

const PIECE_SVG = {};

// Précharge les 12 images du jeu pour éviter tout clignotement au premier affichage.
const _preloaded = new Set();
function _preloadPieceSet(id) {
    if (_preloaded.has(id)) return;
    _preloaded.add(id);
    'wb'.split('').forEach(c => 'KQRBNP'.split('').forEach(t => {
        const im = new Image();
        im.src = `${PIECE_DIR}/${id}/${c}${t}.svg`;
    }));
}

function applyPieceSet() {
    const id  = PIECE_SETS[appSettings.pieceSet] ? appSettings.pieceSet : DEFAULT_PIECE_SET;
    const set = PIECE_SETS[id];
    Object.keys(PIECE_SVG).forEach(k => delete PIECE_SVG[k]);
    Object.assign(PIECE_SVG, set.svg);
    document.documentElement.setAttribute('data-piece', id);
    _preloadPieceSet(set.src || id);
    // Figurines de la notation (formatSan) : le dessin du jeu actif, une variable CSS par pièce.
    const root = document.documentElement.style;
    'wb'.split('').forEach(c => 'KQRBN'.split('').forEach(t => root.setProperty(`--fig-${c}${t}`, `url("${PIECE_DIR}/${set.src || id}/${c}${t}.svg")`)));

    const credit = document.getElementById('piece-credit');
    if (credit) credit.textContent = `${set.label} · ${set.author} · ${set.license}`;
}

applyPieceSet();

// Les coups sont stockés en notation anglaise (N B R Q K), affichés selon le réglage « Écriture des coups » :
// lettres françaises (C F T D R), anglaises, ou figurines.
//   formatSan(san, couleur)     → HTML (échappé) : en mode figurines, la pièce du jeu actif, à la couleur du camp
//                                 (<span class="fig">, image lue dans --fig-wN… écrites par applyPieceSet).
//   formatSanText(san, couleur) → texte simple (barre d'état, title, copie) : en mode figurines, lettres
//                                 françaises (les glyphes Unicode ♘♗ s'affichaient en emojis, sans rapport
//                                 avec le jeu de pièces). Toute liste affichée passe donc par formatSan.
// Le jeu « Invisibles » n'a pas de dessin de pièce : les figurines repassent aux lettres françaises.
const _FIG_NAMES = { N: 'Cavalier', B: 'Fou', R: 'Tour', Q: 'Dame', K: 'Roi' };

function _sanMode() {
    const s = typeof appSettings !== 'undefined' ? appSettings : { notation: 'en' };
    return s.notation === 'fig' && s.pieceSet === 'blindfold' ? 'fr' : s.notation || 'en';
}

function formatSanText(san, color) {
    const mode = _sanMode();
    if (!san || mode === 'en') return san || '';
    const L = typeof I18n !== 'undefined' ? I18n.letters() : 'CFTDR';     // lettres de la langue de l'interface
    return san.replace(/[NBRQK]/g, c => L['NBRQK'.indexOf(c)]);
}

function formatSan(san, color) {
    if (!san) return '';
    if (_sanMode() !== 'fig') return escapeHtml(formatSanText(san, color));
    const c = color === 'b' ? 'b' : 'w';
    return escapeHtml(san).replace(/[NBRQK]/g, p => `<span class="fig fig-${c}" style="--f:var(--fig-${c}${p})" role="img" aria-label="${_FIG_NAMES[p]}"></span>`);
}
