/**
 * modules/openings/annotations.js
 * ──────────────────────────────────────────────────────────────────────────
 * Flèches et cercles dessinés au clic droit, comme sur Lichess / chess.com :
 *   - clic droit glissé d'une case à une autre → flèche (en « L » pour un saut de cavalier)
 *   - clic droit sur une case                   → cercle
 *   - refaire le même tracé l'efface ; un clic gauche sur l'échiquier efface tout
 *   - couleur : orange par défaut, Maj = rouge, Alt = bleu, Ctrl/⌘ = vert
 * Les annotations sont liées à la position affichée : elles disparaissent dès qu'elle change.
 * Dessin : un calque SVG posé sur #board (8 × 8 unités, une unité = une case), redessiné par renderBoard().
 */

'use strict';

const ANNOT_COLORS = { orange: '#f0a830', red: '#e04848', blue: '#3c8ce0', green: '#3ca050' };

const annotations = { arrows: [], circles: [], position: null };
let _annotDraw = null;                       // tracé en cours : { from, to, color }

function _annotColor(e) {
    if (e.shiftKey) return 'red';
    if (e.altKey)   return 'blue';
    if (e.ctrlKey || e.metaKey) return 'green';
    return 'orange';
}

// Case (0..63) → coin haut-gauche à l'écran, en unités de case.
function _annotXY(idx) {
    const c = idx % 8, r = Math.floor(idx / 8);
    return boardFlipped ? [7 - c, r] : [c, 7 - r];
}

function clearAnnotations() {
    if (!annotations.arrows.length && !annotations.circles.length) return;
    annotations.arrows = []; annotations.circles = [];
    renderAnnotations();
}

function _toggleAnnotation(from, to, color) {
    if (from === to) {
        const i = annotations.circles.findIndex(a => a.sq === from);
        const same = i >= 0 && annotations.circles[i].color === color;
        if (i >= 0) annotations.circles.splice(i, 1);
        if (!same) annotations.circles.push({ sq: from, color });
    } else {
        const i = annotations.arrows.findIndex(a => a.from === from && a.to === to);
        const same = i >= 0 && annotations.arrows[i].color === color;
        if (i >= 0) annotations.arrows.splice(i, 1);
        if (!same) annotations.arrows.push({ from, to, color });
    }
}

// Flèche : tige (trait) + pointe (triangle), dans un groupe à opacité commune (aucune surépaisseur
// là où tige et pointe se chevauchent). Saut de cavalier : coude le long de l'axe le plus long d'abord.
function _arrowSVG(a, preview) {
    const [x1, y1] = _annotXY(a.from).map(v => v + .5);
    const [x2, y2] = _annotXY(a.to).map(v => v + .5);
    const dx = x2 - x1, dy = y2 - y1;
    const knight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
    const pts = [[x1, y1]];
    if (knight) pts.push(Math.abs(dy) > Math.abs(dx) ? [x1, y2] : [x2, y1]);
    pts.push([x2, y2]);

    const [px, py] = pts[pts.length - 2];
    const len = Math.hypot(x2 - px, y2 - py), ux = (x2 - px) / len, uy = (y2 - py) / len;
    const HEAD = .45, HALF = .3, W = .2;
    const bx = x2 - ux * HEAD, by = y2 - uy * HEAD;               // base de la pointe
    const shaft = pts.slice(0, -1).concat([[bx, by]]).map(p => p.join(',')).join(' ');
    const head = [[x2, y2], [bx - uy * HALF, by + ux * HALF], [bx + uy * HALF, by - ux * HALF]].map(p => p.join(',')).join(' ');
    const col = ANNOT_COLORS[a.color];
    return `<g opacity="${preview ? .55 : .8}"><polyline points="${shaft}" fill="none" stroke="${col}" stroke-width="${W}" stroke-linejoin="miter"/>` +
           `<polygon points="${head}" fill="${col}"/></g>`;
}

function _circleSVG(c) {
    const [x, y] = _annotXY(c.sq);
    return `<circle cx="${x + .5}" cy="${y + .5}" r=".44" fill="none" stroke="${ANNOT_COLORS[c.color]}" stroke-width=".08" opacity=".85"/>`;
}

// afterBoardRender : appel depuis renderBoard(), `board` est alors la position AFFICHÉE (y compris en navigation).
function renderAnnotations(afterBoardRender) {
    const b = document.getElementById('board');
    if (!b) return;
    if (afterBoardRender) {           // nouvelle position affichée : les annotations de l'ancienne n'ont plus de sens
        const pos = board.join(',');
        if (annotations.position !== pos) { annotations.position = pos; annotations.arrows = []; annotations.circles = []; }
    }

    let layer = b.querySelector('.annot-layer');
    if (!layer) {
        layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        layer.setAttribute('class', 'annot-layer');
        layer.setAttribute('viewBox', '0 0 8 8');
        layer.setAttribute('aria-hidden', 'true');
        b.appendChild(layer);
    }
    const d = _annotDraw;
    const preview = d && d.to !== null && d.to !== d.from ? _arrowSVG(d, true) : '';
    layer.innerHTML = annotations.circles.map(_circleSVG).join('') + annotations.arrows.map(a => _arrowSVG(a)).join('') + preview;
}

// ─── SOURIS ───────────────────────────────────────────────────────────────────
(function initAnnotations() {
    const b = document.getElementById('board');
    if (!b) return;

    b.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse') return;
        if (e.button === 0) { clearAnnotations(); return; }
        if (e.button !== 2) return;
        const sq = _squareAt(e.clientX, e.clientY);
        if (sq === null) return;
        _annotDraw = { from: sq, to: sq, color: _annotColor(e) };
        try { b.setPointerCapture(e.pointerId); } catch (err) {}
    });

    b.addEventListener('pointermove', e => {
        if (!_annotDraw) return;
        const sq = _squareAt(e.clientX, e.clientY);
        if (sq !== null && sq !== _annotDraw.to) { _annotDraw.to = sq; renderAnnotations(); }
    });

    b.addEventListener('pointerup', e => {
        const d = _annotDraw;
        if (!d || e.button !== 2) return;
        _annotDraw = null;
        const to = _squareAt(e.clientX, e.clientY);
        if (to !== null) _toggleAnnotation(d.from, to, _annotColor(e));
        renderAnnotations();
    });

    b.addEventListener('pointercancel', () => { if (_annotDraw) { _annotDraw = null; renderAnnotations(); } });
})();
