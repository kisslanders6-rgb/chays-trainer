/**
 * core/icons.js
 * ──────────────────────────────────────────────────────────────────────────
 * Jeu d'icônes vectorielles (style trait, 24×24, inspiré de Lucide — licence ISC)
 * remplaçant les emojis. Le sprite est injecté UNE FOIS dans le <body>.
 *
 *   HTML statique :  <svg class="ico"><use href="#i-lightbulb"/></svg>
 *   JS (innerHTML) :  ${ico('lightbulb')}   ou   ${ico('bar-chart', 'ico-xl')}
 *   Pièces         :  ${pieceGlyph('K')}    (suit le style de pièces choisi)
 *                     <span class="glyph" data-glyph="K"></span> + refreshGlyphs()
 *
 * À charger EN PREMIER dans <body> (avant le contenu), pour que le sprite existe
 * avant toute référence <use>.
 */

'use strict';

const _ICONS = {
    'lightbulb':     '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    'pencil':        '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    'rotate-ccw':    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    'arrow-up-down': '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    'database':      '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    'skip-forward':  '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
    'x':             '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'arrow-left':    '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'chevron-left':  '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-up':    '<path d="m18 15-6-6-6 6"/>',
    'chevron-down':  '<path d="m6 9 6 6 6-6"/>',
    'trash':         '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    'bar-chart':     '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
    'target':        '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    'git-branch':    '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    'download':      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    'upload':        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    'folder':        '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    'folder-open':   '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    'plus':          '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'alert-triangle':'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'check':         '<path d="M20 6 9 17l-5-5"/>',
    'info':          '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    'settings':      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    'shield-check':  '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    'shield-alert':  '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    'external-link':'<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    'more-horizontal':'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    'crown':        '<path d="M11.56 3.27a.5.5 0 0 1 .88 0l2.95 5.6a1 1 0 0 0 1.52.3l4.27-3.67a.5.5 0 0 1 .8.52l-2.83 10.25a1 1 0 0 1-.96.73H5.81a1 1 0 0 1-.96-.73L2.02 6.02a.5.5 0 0 1 .8-.52l4.27 3.67a1 1 0 0 0 1.52-.3z"/><path d="M5 21h14"/>',
    'shuffle':       '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="M2 6h1.6c1.4 0 2.8.8 3.5 2l.2.3"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/>',
    'arrow-left-right':'<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    'pawn':          '<circle cx="12" cy="6.5" r="3"/><path d="M9.5 11h5"/><path d="M10.2 11c0 3.2-2.7 4.2-2.7 9h9c0-4.8-2.7-5.8-2.7-9"/><path d="M6.5 20h11"/>'
};

// ─── SPRITE (injecté une seule fois) ──────────────────────────────────────────
(function injectIconSprite() {
    if (document.getElementById('icon-sprite')) return;
    const symbols = Object.keys(_ICONS)
        .map(n => `<symbol id="i-${n}" viewBox="0 0 24 24">${_ICONS[n]}</symbol>`).join('');
    document.body.insertAdjacentHTML('afterbegin',
        `<svg id="icon-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${symbols}</svg>`);
})();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// Icône en ligne pour les gabarits JS : ico('trash'), ico('bar-chart', 'ico-xl').
function ico(name, extraClass) {
    return `<svg class="ico${extraClass ? ' ' + extraClass : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// Pièce du style actif (pieces.js) enveloppée dans .glyph ; repli Unicode si indisponible.
function pieceGlyph(p) {
    const svg = (typeof PIECE_SVG !== 'undefined' && PIECE_SVG[p]) || (typeof PIECES !== 'undefined' && PIECES[p]) || '';
    return `<span class="glyph">${svg}</span>`;
}

// Remplit les emplacements statiques <span class="glyph" data-glyph="K"></span>.
// À rappeler après un changement de style de pièces.
function refreshGlyphs() {
    document.querySelectorAll('[data-glyph]').forEach(el => {
        el.innerHTML = (typeof PIECE_SVG !== 'undefined' && PIECE_SVG[el.dataset.glyph]) || '';
    });
}

// ─── AUTO-BRANCHEMENT DES GLYPHES DE PIÈCES ───────────────────────────────────
// Sans modifier app.js ni pieces.js :
//   1. à la fin du chargement (pieces.js est alors disponible), on remplit les emplacements ;
//   2. à chaque changement de style de pièces (applyPieceSet), on les redessine.
document.addEventListener('DOMContentLoaded', () => {
    refreshGlyphs();
    if (typeof applyPieceSet === 'function' && !applyPieceSet._glyphHooked) {
        const orig = applyPieceSet;
        const hooked = function () { orig(); refreshGlyphs(); };
        hooked._glyphHooked = true;
        window.applyPieceSet = hooked;
    }
});

// ─── LOGOS TEINTÉS ────────────────────────────────────────────────────────────
// <img data-tint> : le PNG sert de MASQUE (son canal alpha), la couleur vient de
// --logo-color (= couleur d'accent du thème). Les PNG ne sont jamais modifiés.
// Condition : logo d'une seule couleur sur fond TRANSPARENT.
// Ouvert en file://, le navigateur refuse un PNG local comme masque (logo invisible) :
// on charge alors les mêmes logos en data: URI (logoData.js, inutile en ligne).
function _tintLogos(srcOf) {
    document.querySelectorAll('img[data-tint]').forEach(img => {
        const src = srcOf(img);
        if (!src) return;
        img.style.setProperty('--tint-src', `url("${src}")`);
        img.classList.add('is-tinted');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (location.protocol !== 'file:') { _tintLogos(img => img.src); return; }
    const s = document.createElement('script');
    s.src = 'js/core/logoData.js';
    s.onload = () => _tintLogos(img => LOGO_DATA[img.getAttribute('src')]);
    document.head.appendChild(s);
});
