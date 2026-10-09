/**
 * core/pieces.js
 * ──────────────────────────────────────────────────────────────────────────
 * Jeu de pièces vectorielles (SVG inline) — rendu identique sur tous les systèmes.
 * Pièces « Cburnett » de Colin M. L. Burnett (Wikimedia Commons), distribuées sous
 * licences GFDL / GPL / BSD / CC BY-SA 3.0 : l'attribution à l'auteur est à conserver.
 * Clés : majuscule = Blancs (K Q R B N P), minuscule = Noirs.
 */

'use strict';

const _CBURNETT_SVG = {
  "K": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path stroke-linejoin=\"miter\" d=\"M22.5 11.63V6M20 8h5\"/><path fill=\"#fff\" stroke-linecap=\"butt\" stroke-linejoin=\"miter\" d=\"M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5\"/><path fill=\"#fff\" d=\"M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10z\"/><path d=\"M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0\"/></g></svg>",
  "Q": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"#fff\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M8 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0m16.5-4.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M41 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0M16 8.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M33 9a2 2 0 1 1-4 0 2 2 0 1 1 4 0\"/><path stroke-linecap=\"butt\" d=\"M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14z\"/><path stroke-linecap=\"butt\" d=\"M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z\"/><path fill=\"none\" d=\"M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0\"/></g></svg>",
  "R": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"#fff\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path stroke-linecap=\"butt\" d=\"M9 39h27v-3H9zm3-3v-4h21v4zm-1-22V9h4v2h5V9h5v2h5V9h4v5\"/><path d=\"m34 14-3 3H14l-3-3\"/><path stroke-linecap=\"butt\" stroke-linejoin=\"miter\" d=\"M31 17v12.5H14V17\"/><path d=\"m31 29.5 1.5 2.5h-20l1.5-2.5\"/><path fill=\"none\" stroke-linejoin=\"miter\" d=\"M11 14h23\"/></g></svg>",
  "B": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><g fill=\"#fff\" stroke-linecap=\"butt\"><path d=\"M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.94 3-2 3-2z\"/><path d=\"M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z\"/><path d=\"M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z\"/></g><path stroke-linejoin=\"miter\" d=\"M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5\"/></g></svg>",
  "N": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path fill=\"#fff\" d=\"M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21\"/><path fill=\"#fff\" d=\"M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3\"/><path fill=\"#000\" d=\"M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.433-9.75a.5 1.5 30 1 1-.866-.5.5 1.5 30 1 1 .866.5\"/></g></svg>",
  "P": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><path fill=\"#fff\" stroke=\"#000\" stroke-linecap=\"round\" stroke-width=\"1.5\" d=\"M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z\"/></svg>",
  "k": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path stroke-linejoin=\"miter\" d=\"M22.5 11.6V6\"/><path fill=\"#000\" stroke-linecap=\"butt\" stroke-linejoin=\"miter\" d=\"M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5\"/><path fill=\"#000\" d=\"M11.5 37a22.3 22.3 0 0 0 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10z\"/><path stroke-linejoin=\"miter\" d=\"M20 8h5\"/><path stroke=\"#ececec\" d=\"M32 29.5s8.5-4 6-9.7C34.1 14 25 18 22.5 24.6v2.1-2.1C20 18 9.9 14 7 19.9c-2.5 5.6 4.8 9 4.8 9\"/><path stroke=\"#ececec\" d=\"M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0\"/></g></svg>",
  "q": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><g stroke=\"none\"><circle cx=\"6\" cy=\"12\" r=\"2.75\"/><circle cx=\"14\" cy=\"9\" r=\"2.75\"/><circle cx=\"22.5\" cy=\"8\" r=\"2.75\"/><circle cx=\"31\" cy=\"9\" r=\"2.75\"/><circle cx=\"39\" cy=\"12\" r=\"2.75\"/></g><path stroke-linecap=\"butt\" d=\"M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5z\"/><path stroke-linecap=\"butt\" d=\"M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z\"/><path fill=\"none\" stroke-linecap=\"butt\" d=\"M11 38.5a35 35 1 0 0 23 0\"/><path fill=\"none\" stroke=\"#ececec\" d=\"M11 29a35 35 1 0 1 23 0m-21.5 2.5h20m-21 3a35 35 1 0 0 22 0m-23 3a35 35 1 0 0 24 0\"/></g></svg>",
  "r": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path stroke-linecap=\"butt\" d=\"M9 39h27v-3H9zm3.5-7 1.5-2.5h17l1.5 2.5zm-.5 4v-4h21v4z\"/><path stroke-linecap=\"butt\" stroke-linejoin=\"miter\" d=\"M14 29.5v-13h17v13z\"/><path stroke-linecap=\"butt\" d=\"M14 16.5 11 14h23l-3 2.5zM11 14V9h4v2h5V9h5v2h5V9h4v5z\"/><path fill=\"none\" stroke=\"#ececec\" stroke-linejoin=\"miter\" stroke-width=\"1\" d=\"M12 35.5h21m-20-4h19m-18-2h17m-17-13h17M11 14h23\"/></g></svg>",
  "b": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><g fill=\"#000\" stroke-linecap=\"butt\"><path d=\"M9 36c3.4-1 10.1.4 13.5-2 3.4 2.4 10.1 1 13.5 2 0 0 1.6.5 3 2-.7 1-1.6 1-3 .5-3.4-1-10.1.5-13.5-1-3.4 1.5-10.1 0-13.5 1-1.4.5-2.3.5-3-.5 1.4-2 3-2 3-2z\"/><path d=\"M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z\"/><path d=\"M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z\"/></g><path stroke=\"#ececec\" stroke-linejoin=\"miter\" d=\"M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5\"/></g></svg>",
  "n": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path fill=\"#000\" d=\"M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21\"/><path fill=\"#000\" d=\"M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.04-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-1-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-2 2.5-3c1 0 1 3 1 3\"/><path fill=\"#ececec\" stroke=\"#ececec\" d=\"M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.43-9.75a.5 1.5 30 1 1-.86-.5.5 1.5 30 1 1 .86.5\"/><path fill=\"#ececec\" stroke=\"none\" d=\"m24.55 10.4-.45 1.45.5.15c3.15 1 5.65 2.49 7.9 6.75S35.75 29.06 35.25 39l-.05.5h2.25l.05-.5c.5-10.06-.88-16.85-3.25-21.34s-5.79-6.64-9.19-7.16z\"/></g></svg>",
  "p": "<svg class=\"piece-svg\" draggable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><path stroke=\"#000\" stroke-linecap=\"round\" stroke-width=\"1.5\" d=\"M22.5 9a4 4 0 0 0-3.22 6.38 6.48 6.48 0 0 0-.87 10.65c-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47a6.46 6.46 0 0 0-.87-10.65A4.01 4.01 0 0 0 22.5 9z\"/></svg>"
};



// ─── CONSTRUCTEUR DE SETS « MAISON » ─────────────────────────────────────────
// Chaque pièce = { body : formes remplies/contournées, detail : traits fins }.
// Les couleurs viennent d'une palette (blancs / noirs), la géométrie est commune.

function _buildSet(shapes, pal) {
    const out = {};
    'KQRBNP'.split('').forEach(t => {
        const s = shapes[t];
        ['w', 'b'].forEach(c => {
            const p = pal[c];
            out[c === 'w' ? t : t.toLowerCase()] =
                '<svg class="piece-svg" draggable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">' +
                `<g fill="${p.fill}" stroke="${p.stroke}" stroke-width="${pal.sw}" stroke-linejoin="round" stroke-linecap="round">${s.body}</g>` +
                (s.detail ? `<g fill="none" stroke="${p.detail}" stroke-width="${pal.dw}" stroke-linejoin="round" stroke-linecap="round">${s.detail}</g>` : '') +
                '</svg>';
        });
    });
    return out;
}

// Style « Moderne » : silhouettes arrondies, aplats, contour franc.
const _MODERN_SHAPES = {
    P: { body: '<rect x="12" y="35.5" width="21" height="4" rx="2"/><path d="M15 36c0-6 2.5-9.5 5.5-11.2l-.5-3.3h5l-.5 3.3c3 1.7 5.5 5.2 5.5 11.2z"/><circle cx="22.5" cy="15" r="6"/>' },
    R: { body: '<path d="M11 38.5h23v-4H11zM13.5 34.5l1.5-17h15l1.5 17zM11.5 17.5V9.5h4.5v3h3.5v-3h6v3h3.5v-3h4.5v8z"/>',
         detail: '<path d="M15 22h15"/>' },
    B: { body: '<path d="M11.5 38.5h22l-1.5-4.5h-19z"/><ellipse cx="22.5" cy="20.5" rx="6.8" ry="10.5"/><rect x="15" y="30.5" width="15" height="4" rx="2"/><circle cx="22.5" cy="8.5" r="3"/>',
         detail: '<path d="M22.5 14v6.5M19.2 17.3h6.6"/>' },
    N: { body: '<rect x="11" y="35.5" width="23" height="4" rx="2"/><path d="M13 36c0-9 2-15 7.5-19L16 15l3.5-5.5L23 7l1.5 2.5C32 10.5 37 17 36 36z"/>',
         detail: '<path d="M21.5 13.5h1.6M26 14.5c3 2.5 5 6.5 5.5 12"/>' },
    Q: { body: '<path d="M11.5 38.5h22l.5-4.5H11z"/><path d="M11 34L7 15l8 10V11.5l6 12.5 1.5-14.5L24 24l6-12.5V25l8-10-4 19z"/>' +
               '<circle cx="7" cy="13.2" r="2.3"/><circle cx="15" cy="9.8" r="2.3"/><circle cx="22.5" cy="8" r="2.3"/><circle cx="30" cy="9.8" r="2.3"/><circle cx="38" cy="13.2" r="2.3"/>',
         detail: '<path d="M12.5 36.2h20"/>' },
    K: { body: '<path d="M11.5 38.5h22l.5-4.5H11z"/><path d="M13 34.5c-1.5-8 .5-13.5 5-17h9c4.5 3.5 6.5 9 5 17z"/>' +
               '<rect x="20.8" y="4.5" width="3.4" height="13" rx="1"/><rect x="17" y="8" width="11" height="3.4" rx="1"/>',
         detail: '<path d="M16 27h13"/>' }
};

// Style « Épuré » : géométrique, angles vifs, trait fin.
const _MINIMAL_SHAPES = {
    P: { body: '<path d="M13 39v-3.5h19V39z"/><path d="M22.5 20L29 35.5H16z"/><circle cx="22.5" cy="14" r="4.8"/>' },
    R: { body: '<path d="M13 39v-4h19v4zM15.5 35V17h14v18zM13 17V9h4v3.5h3.5V9h4v3.5H28V9h4v8z"/>',
         detail: '<path d="M15.5 22h14"/>' },
    B: { body: '<path d="M13 39v-3.5h19V39z"/><path d="M16 35.5L19.5 23.5h6L29 35.5z"/><path d="M22.5 5.5l7 11-7 7.5-7-7.5z"/>',
         detail: '<path d="M22.5 11v6M19.5 14h6"/>' },
    N: { body: '<path d="M13 39v-3.5h19V39z"/><path d="M14.5 35.5L17 22.5l-3.5-3L20 8l3.5 3L31 22v13.5z"/>',
         detail: '<path d="M20 15h1.6"/>' },
    Q: { body: '<path d="M13 39v-4h19v4z"/><path d="M15 35L11 14l7 8 4.5-13 4.5 13 7-8-4 21z"/>' +
               '<circle cx="11" cy="12.4" r="1.9"/><circle cx="22.5" cy="7.4" r="1.9"/><circle cx="34" cy="12.4" r="1.9"/>' },
    K: { body: '<path d="M13 39v-3.5h19V39z"/><path d="M14 35.5L16 22h13l2 13.5z"/><path d="M16 22l1.5-7h10l1.5 7z"/>' +
               '<rect x="21" y="4.5" width="3" height="10"/><rect x="18" y="7.5" width="9" height="3"/>' }
};

const _MODERN_PAL = {
    sw: 1.6, dw: 1.3,
    w: { fill: '#f6f2e9', stroke: '#26231f', detail: '#26231f' },
    b: { fill: '#3a3d45', stroke: '#0d0e11', detail: '#d5d8df' }
};
const _MINIMAL_PAL = {
    sw: 1.2, dw: 1.1,
    w: { fill: '#ffffff', stroke: '#30343b', detail: '#30343b' },
    b: { fill: '#23262c', stroke: '#000000', detail: '#c2c6ce' }
};

// ─── REGISTRE DES STYLES ─────────────────────────────────────────────────────
// Les clés doivent correspondre à PIECE_SET_IDS (settings.js).

const PIECE_SETS = {
    cburnett: { label: 'Classique', svg: _CBURNETT_SVG },
    modern:   { label: 'Moderne',   svg: _buildSet(_MODERN_SHAPES,  _MODERN_PAL) },
    minimal:  { label: 'Épuré',     svg: _buildSet(_MINIMAL_SHAPES, _MINIMAL_PAL) }
};

// Set actif. Objet MUTÉ EN PLACE : toute référence existante à PIECE_SVG reste valide.
const PIECE_SVG = {};

function applyPieceSet() {
    const set = (PIECE_SETS[appSettings.pieceSet] || PIECE_SETS[DEFAULT_PIECE_SET]).svg;
    Object.keys(PIECE_SVG).forEach(k => delete PIECE_SVG[k]);
    Object.assign(PIECE_SVG, set);
}

applyPieceSet();
