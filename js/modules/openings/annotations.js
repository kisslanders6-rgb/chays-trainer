/**
 * modules/openings/annotations.js
 * ──────────────────────────────────────────────────────────────────────────
 * Flèches et cercles dessinés au clic droit, comme sur Lichess / chess.com :
 *   - clic droit glissé d'une case à une autre → flèche (en « L » pour un saut de cavalier)
 *   - clic droit sur une case                   → cercle
 *   - refaire le même tracé l'efface ; un clic gauche sur l'échiquier efface tout
 *   - couleur : celle du thème par défaut, Maj = rouge, Alt = bleu, Ctrl/⌘ = or
 * Les annotations sont liées à la position affichée : elles disparaissent dès qu'elle change.
 * Dessin : un calque SVG posé sur #board (8 × 8 unités, une unité = une case), redessiné par renderBoard().
 *
 * Trois styles (Paramètres → Style des flèches, appSettings.arrowStyle) :
 *   plume     trait effilé qui s'épaissit vers une pointe à encoche, dégradé de transparence (défaut)
 *   contour   silhouette pleine translucide cernée d'un liseré, point d'origine marqué
 *   pointille chapelet de points et pointe ouverte en chevron, anneau à l'origine
 */

'use strict';

// Couleurs : variables CSS (la couleur « accent » suit le thème de l'échiquier).
const ANNOT_COLORS = { accent: 'var(--annot-accent)', red: 'var(--annot-red)', blue: 'var(--annot-blue)', gold: 'var(--annot-gold)' };
const ARROW_STYLES = ARROW_STYLE_IDS;                    // settings.js
let _annotGradSeq = 0;

const annotations = { arrows: [], circles: [], position: null };
let _annotDraw = null;                       // tracé en cours : { from, to, color }

function _annotColor(e) {
    if (e.shiftKey) return 'red';
    if (e.altKey)   return 'blue';
    if (e.ctrlKey || e.metaKey) return 'gold';
    return 'accent';
}

const _arrowStyle = () => (typeof appSettings !== 'undefined' && ARROW_STYLES.includes(appSettings.arrowStyle)) ? appSettings.arrowStyle : 'plume';

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

// ─── DESSIN ───────────────────────────────────────────────────────────────────
const _f = n => Math.round(n * 1000) / 1000;
const _pts = list => list.map(p => `${_f(p[0])},${_f(p[1])}`).join(' ');

// Points du tracé (centres de cases) : saut de cavalier = coude le long de l'axe le plus long d'abord.
function _arrowPath(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const knight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
    return knight ? [[x1, y1], Math.abs(dy) > Math.abs(dx) ? [x1, y2] : [x2, y1], [x2, y2]] : [[x1, y1], [x2, y2]];
}

// Silhouette d'une flèche (un seul polygone) : tige de largeur w0 → w1 le long du tracé, pointe à encoche.
function _arrowOutline(pts, w0, w1, head, half, notch) {
    const n = pts.length, tip = pts[n - 1], prev = pts[n - 2];
    const L = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]), ux = (tip[0] - prev[0]) / L, uy = (tip[1] - prev[1]) / L;
    const base = [tip[0] - ux * head, tip[1] - uy * head];
    const line = pts.slice(0, -1).concat([base]);
    const seg = [];
    for (let i = 1; i < line.length; i++) seg.push(Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const total = seg.reduce((a, b) => a + b, 0) || 1;
    const normals = seg.map((d, i) => [-(line[i + 1][1] - line[i][1]) / d, (line[i + 1][0] - line[i][0]) / d]);
    const left = [], right = [];
    let run = 0;
    line.forEach((p, i) => {
        const w = (w0 + (w1 - w0) * run / total) / 2;
        let nx, ny, k = 1;
        if (i === 0) [nx, ny] = normals[0];
        else if (i === line.length - 1) [nx, ny] = normals[i - 1];
        else {                                                    // coude : jointure en onglet
            const a = normals[i - 1], b = normals[i];
            nx = a[0] + b[0]; ny = a[1] + b[1];
            const m = Math.hypot(nx, ny); nx /= m; ny /= m;
            k = 1 / (nx * a[0] + ny * a[1]);
        }
        left.push([p[0] + nx * w * k, p[1] + ny * w * k]);
        right.push([p[0] - nx * w * k, p[1] - ny * w * k]);
        if (i < seg.length) run += seg[i];
    });
    const back = [base[0] - ux * notch, base[1] - uy * notch];  // ailes en retrait : encoche à l'arrière de la pointe
    const wingL = [back[0] - uy * half, back[1] + ux * half], wingR = [back[0] + uy * half, back[1] - ux * half];
    return left.concat([wingL, tip, wingR]).concat(right.reverse());
}

function _arrowShape(pts, colorKey, style, preview) {
    const col = ANNOT_COLORS[colorKey] || ANNOT_COLORS.accent;
    const op = preview ? .55 : 1;
    if (style === 'pointille') {
        const tip = pts[pts.length - 1], prev = pts[pts.length - 2];
        const L = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]), ux = (tip[0] - prev[0]) / L, uy = (tip[1] - prev[1]) / L;
        const end = [tip[0] - ux * .12, tip[1] - uy * .12];
        const chev = [[end[0] - ux * .34 - uy * .28, end[1] - uy * .34 + ux * .28], end, [end[0] - ux * .34 + uy * .28, end[1] - uy * .34 - ux * .28]];
        const path = pts.slice(0, -1).concat([[end[0] - ux * .2, end[1] - uy * .2]]);
        return `<g class="annot" style="color:${col}" opacity="${op}">
            <circle cx="${_f(pts[0][0])}" cy="${_f(pts[0][1])}" r=".16" fill="none" stroke="currentColor" stroke-width=".06"/>
            <polyline points="${_pts(path)}" fill="none" stroke="currentColor" stroke-width=".13" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray=".001 .24" class="annot-halo-stroke"/>
            <polyline points="${_pts(chev)}" fill="none" stroke="currentColor" stroke-width=".13" stroke-linecap="round" stroke-linejoin="round" class="annot-halo-stroke"/></g>`;
    }
    if (style === 'contour') {
        const poly = _pts(_arrowOutline(pts, .2, .2, .42, .3, .08));
        return `<g class="annot" style="color:${col}" opacity="${op}">
            <circle cx="${_f(pts[0][0])}" cy="${_f(pts[0][1])}" r=".13" fill="currentColor" fill-opacity=".9"/>
            <polygon points="${poly}" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width=".055" stroke-linejoin="round" class="annot-halo-stroke"/></g>`;
    }
    // plume : dégradé de transparence de l'origine vers la pointe
    const id = 'ag' + (++_annotGradSeq);
    const s = pts[0], tip = pts[pts.length - 1];
    const poly = _pts(_arrowOutline(pts, .05, .24, .46, .33, .12));
    return `<g class="annot" style="color:${col}" opacity="${op}">
        <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${_f(s[0])}" y1="${_f(s[1])}" x2="${_f(tip[0])}" y2="${_f(tip[1])}">
          <stop offset="0" stop-color="currentColor" stop-opacity=".25"/><stop offset=".6" stop-color="currentColor" stop-opacity=".8"/><stop offset="1" stop-color="currentColor" stop-opacity=".95"/></linearGradient></defs>
        <polygon points="${poly}" fill="url(#${id})" class="annot-halo"/></g>`;
}

function _circleShape(x, y, colorKey, style) {
    const col = ANNOT_COLORS[colorKey] || ANNOT_COLORS.accent;
    if (style === 'pointille')
        return `<circle cx="${x}" cy="${y}" r=".4" fill="none" style="color:${col}" stroke="currentColor" stroke-width=".1" stroke-linecap="round" stroke-dasharray=".001 .2" class="annot-halo-stroke"/>`;
    if (style === 'contour')
        return `<circle cx="${x}" cy="${y}" r=".42" style="color:${col}" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width=".055" class="annot-halo-stroke"/>`;
    return `<circle cx="${x}" cy="${y}" r=".41" fill="none" style="color:${col}" stroke="currentColor" stroke-width=".09" stroke-opacity=".85" class="annot-halo-stroke"/>`;
}

function _arrowSVG(a, preview) {
    const [x1, y1] = _annotXY(a.from).map(v => v + .5);
    const [x2, y2] = _annotXY(a.to).map(v => v + .5);
    return _arrowShape(_arrowPath(x1, y1, x2, y2), a.color, _arrowStyle(), preview);
}

function _circleSVG(c) {
    const [x, y] = _annotXY(c.sq);
    return _circleShape(x + .5, y + .5, c.color, _arrowStyle());
}

// Aperçu d'un style (Paramètres) : 3 × 2 cases, une flèche coudée et un cercle.
function arrowStylePreview(style) {
    let sq = '';
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++)
        sq += `<rect x="${x}" y="${y}" width="1" height="1" fill="var(${(x + y) % 2 ? '--board-dark' : '--board-light'})"/>`;
    return `<svg class="arrow-preview" viewBox="0 0 3 2" aria-hidden="true">${sq}` +
           _arrowShape([[.5, 1.5], [.5, .5], [1.6, .5]], 'accent', style) +
           _circleShape(2.5, 1.5, 'red', style) + '</svg>';
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
