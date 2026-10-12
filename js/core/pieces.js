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

// Ordre = ordre d'affichage dans les Paramètres. Merida est le jeu par défaut.
const PIECE_SETS = {
    'merida':         _def('merida',         'Merida',         'Armando Hernandez Marroquin', 'GPLv2+'),
    'maestro':        _def('maestro',        'Maestro',        'sadsnake1',                   'CC BY-NC-SA 4.0'),
    'staunty':        _def('staunty',        'Staunty',        'sadsnake1',                   'CC BY-NC-SA 4.0'),
    'minimal-warmth': _def('minimal-warmth', 'Minimal Warmth', 'blunder_reign',               'CC BY-NC-SA 4.0'),
    'fantasy':        _def('fantasy',        'Fantasy',        'Maurizio Monge',              'MIT'),
    'chessnut':       _def('chessnut',       'Chessnut',       'Alexis Luengas',              'Apache 2.0'),
    'kiwen-suwi':     _def('kiwen-suwi',     'Kiwen Suwi',     'neverRare',                   'CC BY 4.0'),
    'chrome':         { label: 'Chrome',     author: 'Merida passé en métal — Armando Hernandez Marroquin', license: 'GPLv2+', src: 'merida', svg: _imgSet('merida') },
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

    const credit = document.getElementById('piece-credit');
    if (credit) credit.textContent = `${set.label} · ${set.author} · ${set.license}`;
}

applyPieceSet();
