/**
 * modules/openings/openingsUI.js
 * ──────────────────────────────────────────────────────────────────────────
 * Affichage de l'échiquier, barre de coups, barre de statut,
 * navigation Précédent/Suivant, overlay de promotion.
 */

'use strict';

// ─── ÉTAT D'AFFICHAGE ─────────────────────────────────────────────────────────

let boardFlipped = false;

// Curseur de navigation visuelle.
// -1 = position courante (fin de l'historique).
// ≥ 0 = indice dans moveHistory du coup affiché.
let navCursor = -1;

// ─── RENDU DU PLATEAU ─────────────────────────────────────────────────────────

function renderBoard() {
    clearErrorFx();         // un réaffichage ne doit jamais rejouer la secousse d'une erreur passée
    const el        = document.getElementById('board');
    el.innerHTML    = '';
    const colCoords = document.getElementById('coords-col');
    const rowCoords = document.getElementById('coords-row');

    const ranks = boardFlipped ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];
    const files = boardFlipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];

    colCoords.innerHTML = ranks.map(r => `<span>${r + 1}</span>`).join('');
    rowCoords.innerHTML = files.map(c => `<span>${'abcdefgh'[c]}</span>`).join('');

    ranks.forEach(r => {
        files.forEach(c => {
            const idx    = r * 8 + c;
            const sq     = document.createElement('div');
            const isLight = (r + c) % 2 === 1;
            sq.className  = 'sq ' + (isLight ? 'light' : 'dark');
            sq.dataset.idx = idx;

            if (idx === lastFrom)             sq.classList.add('hl-from');
            if (idx === lastTo)               sq.classList.add('hl-to');
            if (selected === idx)             sq.classList.add('hl-selected');
            if (legalMoves.includes(idx)) {
                sq.classList.add('hl-legal');
                if (board[idx]) sq.classList.add('has-piece');
            }

            const p = board[idx];
            if (p) {
                const pc      = document.createElement('div');
                pc.className  = 'piece ' + (isWhite(p) ? 'piece-w' : 'piece-b');
                pc.innerHTML   = pieceHTML(p);
                sq.appendChild(pc);
            }

            sq.addEventListener('click', () => { if (_dragJustEnded()) return; handleClick(idx); });
            el.appendChild(sq);
        });
    });

    if (moveAnim) { const a = moveAnim; moveAnim = null; _runMoveAnim(a); }
}

// ─── PIÈCES VECTORIELLES & ANIMATION DE DÉPLACEMENT ──────────────────────────

function pieceHTML(p) {
    return (typeof PIECE_SVG !== 'undefined' && PIECE_SVG[p]) || PIECES[p];   // repli Unicode
}

let moveAnim = null;

// Demande une animation (case de départ → case d'arrivée) au prochain renderBoard().
// Ignorée après un glisser-déposer (la pièce a déjà été déplacée à la main) et si
// l'utilisateur préfère réduire les animations.
function animateNextMove(from, to) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    moveAnim = (reduce || _dragJustEnded()) ? null : { from, to };
}

function _runMoveAnim(a) {
    const b  = document.getElementById('board');
    const f  = b.querySelector(`.sq[data-idx="${a.from}"]`);
    const t  = b.querySelector(`.sq[data-idx="${a.to}"]`);
    const pc = t && t.querySelector('.piece');
    if (!f || !pc || !pc.animate) return;
    const fr = f.getBoundingClientRect(), tr = t.getBoundingClientRect();
    t.style.zIndex = 5;                                   // la pièce passe au-dessus des autres cases
    const anim = pc.animate(
        [{ transform: `translate(${fr.left - tr.left}px, ${fr.top - tr.top}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 170, easing: 'cubic-bezier(.22,.8,.3,1)' });
    anim.onfinish = anim.oncancel = () => { t.style.zIndex = ''; };
}

// ─── BARRE DE COUPS ───────────────────────────────────────────────────────────

function _paintMovesBar(active) {
    const bar = document.getElementById('moves-bar');
    bar.classList.toggle('locked', gameMode === 'training');   // non cliquable en entraînement
    if (!moveHistory.length) {
        bar.innerHTML = '<span style="color:#5a4020">Aucun coup joué</span>';
        return;
    }
    let html = '';
    moveHistory.forEach((m, i) => {
        if (i % 2 === 0) html += `<span class="move-num">${Math.floor(i / 2) + 1}.</span> `;
        html += `<span class="move-token${i === active ? ' active' : ''}" data-i="${i}">${m.san}</span> `;
    });
    bar.innerHTML = html;
    if (typeof syncTreeToPosition === 'function') syncTreeToPosition();     // l'arbre suit la position affichée
}

function renderMoves() {
    _paintMovesBar(navCursor === -1 ? moveHistory.length - 1 : navCursor);
}

// ─── BARRE DE STATUT ──────────────────────────────────────────────────────────

function setStatus(msg, type = 'info') {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    dot.className  = 'status-dot ' + { ok: 'dot-ok', err: 'dot-err', info: 'dot-info', new: 'dot-new', hint: 'dot-hint' }[type];
    text.textContent = msg;
}

// ─── NAVIGATION VISUELLE (Précédent / Suivant) ────────────────────────────────
// Ces boutons n'affectent jamais la base ni l'état de jeu réel.

// navCursor : -1 = position actuelle · 0..n-2 = après le coup i · NAV_START = position initiale.
const NAV_START = -2;

// Index (dans moveHistory) du dernier coup joué dans la position AFFICHÉE ; -1 = position initiale.
function _navPos() {
    if (navCursor === -1)         return moveHistory.length - 1;
    if (navCursor === NAV_START)  return -1;
    return navCursor;
}

function _navSide() {                       // camp au trait dans la position affichée
    if (navCursor === -1)         return turn;
    if (navCursor === NAV_START)  return moveHistory[0].turnBefore;
    return moveHistory[navCursor].turnBefore === 'w' ? 'b' : 'w';
}

function updateNavButtons() {
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    if (!prevBtn || !nextBtn) return;
    prevBtn.disabled = (moveHistory.length === 0 || _navPos() <= -1);
    prevBtn.style.opacity = prevBtn.disabled ? '0.4' : '';
    nextBtn.disabled = (navCursor === -1);
    nextBtn.style.opacity = nextBtn.disabled ? '0.4' : '';
}

// Affiche la position après le coup d'indice p (p = -1 : position initiale).
function navGo(p) {
    const len = moveHistory.length;
    if (p >= len - 1) {
        navCursor = -1;
        renderBoard();
        renderMoves();
        setStatus('Retour à la position actuelle.', 'info');
    } else {
        navCursor = (p < 0) ? NAV_START : p;
        renderNavBoard();
    }
    updateNavButtons();
}

function navPrev() {
    if (moveHistory.length === 0) return;
    const p = _navPos();
    if (p <= -1) return;
    navGo(p - 1);
}

function navNext() {
    if (navCursor === -1) return;
    navGo(_navPos() + 1);
}

function renderNavBoard() {
    if (navCursor === -1) { renderBoard(); return; }
    const atStart = navCursor === NAV_START;
    const snap    = atStart ? null : moveHistory[navCursor];

    // Sauvegarde des globaux pour restauration après rendu
    const savedBoard    = board;
    const savedTurn     = turn;
    const savedLastFrom = lastFrom;
    const savedLastTo   = lastTo;
    const savedSelected = selected;
    const savedLegal    = legalMoves;

    // Reconstruction du plateau après ce coup à partir du snapshot boardBefore
    // (ou position initiale : boardBefore du tout premier coup)
    let tempBoard, from = -1, to = -1;
    if (atStart) {
        tempBoard = moveHistory[0].boardBefore.slice();
    } else {
        tempBoard = snap.boardBefore.slice();
        from = snap.from; to = snap.to;
        const promo = snap.promo;
        const p = tempBoard[from];
        tempBoard[to]   = p;
        tempBoard[from] = '';

        if (promo) {
            tempBoard[to] = snap.turnBefore === 'w' ? promo.toUpperCase() : promo.toLowerCase();
        }
        // En passant
        if (p && p.toUpperCase() === 'P' && to === snap.epBefore) {
            tempBoard[Math.floor(from / 8) * 8 + (to % 8)] = '';
        }
        // Roque : déplacement de la tour
        if (p && p.toUpperCase() === 'K') {
            const dc = (to % 8) - (from % 8);
            if (Math.abs(dc) === 2) {
                const rr = Math.floor(from / 8);
                if (dc > 0) { tempBoard[rr*8+5] = tempBoard[rr*8+7]; tempBoard[rr*8+7] = ''; }
                else        { tempBoard[rr*8+3] = tempBoard[rr*8+0]; tempBoard[rr*8+0] = ''; }
            }
        }
    }

    // Permutation temporaire des globaux pour l'affichage
    board      = tempBoard;
    lastFrom   = from;
    lastTo     = to;
    selected   = null;
    legalMoves = [];

    renderBoard();

    // Restauration
    board      = savedBoard;
    turn       = savedTurn;
    lastFrom   = savedLastFrom;
    lastTo     = savedLastTo;
    selected   = savedSelected;
    legalMoves = savedLegal;

    // Barre de coups avec surbrillance du coup courant
    _paintMovesBar(navCursor);
    setStatus(atStart ? 'Navigation — position initiale.'
                      : `Navigation — coup ${navCursor + 1}/${moveHistory.length} : ${snap.san}`, 'info');
}

function resetNavCursor() {
    navCursor = -1;
    updateNavButtons();
}

// ─── OVERLAY DE PROMOTION ─────────────────────────────────────────────────────

function showPromotion() {
    const overlay = document.getElementById('promo-overlay');
    overlay.classList.remove('hidden');
    const promotingColor = turn; // turn pas encore inversé
    const pieces  = promotingColor === 'w' ? ['Q','R','B','N'] : ['q','r','b','n'];
    const piecesEl = document.getElementById('promo-pieces');
    piecesEl.innerHTML = '';
    pieces.forEach(pc => {
        const btn         = document.createElement('div');
        btn.className     = 'promo-piece';
        btn.innerHTML     = pieceHTML(pc);
        btn.onclick = () => {
            overlay.classList.add('hidden');
            if (awaitingPromotion) {
                const { from, to, isOpponent } = awaitingPromotion;
                awaitingPromotion = null;
                const p = pc.toUpperCase();
                if (isOpponent) executeOpponentMove(from, to, p);
                else            executePlayerMove(from, to, p);
            }
        };
        piecesEl.appendChild(btn);
    });
}

// ─── RETOUR VISUEL D'UN COUP REFUSÉ ───────────────────────────────────────────
// La secousse ne doit se jouer qu'UNE fois, au moment du coup faux. Elle est retirée :
//   - par un minuteur juste après la fin des animations (sinon, quand l'écran de jeu repasse de
//     display:none à display:flex, le navigateur relance les animations CSS encore présentes) ;
//   - à chaque renderBoard() (position rechargée, nouvel exercice, retour à l'accueil…).

let _wrongTimer = null;

// Retire toute trace de l'effet d'erreur (secousse + flash de case).
function clearErrorFx() {
    clearTimeout(_wrongTimer);
    _wrongTimer = null;
    const b = document.getElementById('board');
    if (b) b.classList.remove('shake');
    document.querySelectorAll('#board .hl-wrong').forEach(el => el.classList.remove('hl-wrong'));
}

function flashWrong(toIdx) {
    clearErrorFx();
    const b  = document.getElementById('board');
    const sq = document.querySelector(`#board .sq[data-idx="${toIdx}"]`);
    if (sq) sq.classList.add('hl-wrong');
    void b.offsetWidth;                            // relance l'animation
    b.classList.add('shake');
    _wrongTimer = setTimeout(clearErrorFx, 750);   // > durée des animations (.45 s / .7 s)
}

// ─── FLIP BOARD ───────────────────────────────────────────────────────────────

function flipBoard() {
    boardFlipped = !boardFlipped;
    if (navCursor === -1) renderBoard(); else renderNavBoard();
}

// ─── CHANGEMENT DE STYLE DE PIÈCES ────────────────────────────────────────────
// Redessine ce qui affiche des pièces, sans toucher à l'état de jeu.

function refreshPieces() {
    const gs = document.getElementById('game-screen');
    if (gs && gs.style.display !== 'none' && !gs.classList.contains('hidden')) {
        if (navCursor === -1) renderBoard(); else renderNavBoard();
    }
    const promo = document.getElementById('promo-overlay');
    if (promo && !promo.classList.contains('hidden') && awaitingPromotion) showPromotion();
}

// ─── BARRE DE COUPS CLIQUABLE ─────────────────────────────────────────────────
// Un clic sur le coup i affiche la position exacte après ce coup
// (même mécanisme que Précédent / Suivant ; désactivé en entraînement).

function goToMove(i) {
    if (gameMode === 'training') return;
    const len = moveHistory.length;
    if (i < 0 || i >= len) return;
    if (i === len - 1) {
        navCursor = -1;
        renderBoard();
        renderMoves();
        setStatus('Retour à la position actuelle.', 'info');
    } else {
        navCursor = i;
        renderNavBoard();
    }
    updateNavButtons();
}

// ─── GLISSER-DÉPOSER ──────────────────────────────────────────────────────────
// Le glisser s'appuie sur handleClick() : le début du glisser sélectionne la
// pièce (cases légales affichées), le dépôt joue ou refuse le coup exactement
// comme le ferait un second clic. Un simple clic reste géré par le système actuel.

const _boardEl       = document.getElementById('board');
const DRAG_THRESHOLD = 6;      // px avant de considérer un glisser
let _drag            = null;
let _lastDragEnd     = 0;

function _dragJustEnded() { return performance.now() - _lastDragEnd < 60; }

function _canInteract() {
    if (gameMode === 'preview') return false;
    if (gameMode === 'training' && trainingState.busy) return false;
    return document.getElementById('promo-overlay').classList.contains('hidden');
}

function _squareAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const sq = el && el.closest ? el.closest('#board .sq') : null;
    return sq ? Number(sq.dataset.idx) : null;
}

function _setOver(idx, on) {
    if (idx === null) return;
    const sq = document.querySelector(`#board .sq[data-idx="${idx}"]`);
    if (sq) sq.classList.toggle('hl-drop', on);
}

function _beginDrag(d) {
    // Seules les pièces du camp au trait sont déplaçables (jamais de capture « par accident »).
    const side = _navSide();
    if ((d.cls.includes('piece-w') ? 'w' : 'b') !== side) return false;

    if (navCursor !== -1) _syncEngineToNavCursor();      // glisser depuis une position passée = nouvelle variante
    if (selected !== d.from) handleClick(d.from);
    if (selected !== d.from) return false;

    const src = document.querySelector(`#board .sq[data-idx="${d.from}"]`);
    if (src) src.classList.add('drag-source');

    const g = document.createElement('div');
    g.className = 'drag-ghost ' + d.cls;
    g.innerHTML = d.html;
    g.style.cssText = `width:${d.size}px;height:${d.size}px;font-size:${d.font};`;
    document.body.appendChild(g);
    document.body.classList.add('dragging');
    try { _boardEl.setPointerCapture(d.pid); } catch (e) {}

    d.ghost  = g;
    d.active = true;
    return true;
}

function _endDrag(e, cancelled) {
    const d = _drag;
    _drag = null;
    if (!d || !d.active) return;

    if (d.ghost) d.ghost.remove();
    document.body.classList.remove('dragging');
    try { _boardEl.releasePointerCapture(d.pid); } catch (err) {}
    document.querySelectorAll('#board .drag-source, #board .hl-drop')
        .forEach(el => el.classList.remove('drag-source', 'hl-drop'));
    _lastDragEnd = performance.now();
    if (cancelled) return;

    const to = _squareAt(e.clientX, e.clientY);
    if (to === null)         handleClick(d.from);   // relâché hors de l'échiquier : désélection
    else if (to !== d.from)  handleClick(to);       // joue / refuse / change de pièce (comme un clic)
    // relâché sur sa propre case : la pièce reste sélectionnée
}

_boardEl.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary || !_canInteract()) return;
    const pieceEl = e.target.closest('.piece');
    if (!pieceEl) return;
    const sq = pieceEl.closest('.sq');
    _drag = {
        from: Number(sq.dataset.idx), x: e.clientX, y: e.clientY, pid: e.pointerId,
        active: false, ghost: null, over: null,
        cls: pieceEl.className, html: pieceEl.innerHTML,
        size: sq.getBoundingClientRect().width, font: getComputedStyle(sq).fontSize
    };
});

_boardEl.addEventListener('pointermove', e => {
    const d = _drag;
    if (!d || e.pointerId !== d.pid) return;
    if (!d.active) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
        if (!_beginDrag(d)) { _drag = null; return; }
    }
    d.ghost.style.transform = `translate(${e.clientX - d.size / 2}px, ${e.clientY - d.size / 2}px) scale(1.12)`;
    const over = _squareAt(e.clientX, e.clientY);
    if (over !== d.over) { _setOver(d.over, false); _setOver(over, true); d.over = over; }
});

// Mobile : un toucher sur le plateau ne doit ni faire défiler la page, ni déclencher le
// pull-to-refresh, ni ouvrir le menu contextuel (appui long). Complète `touch-action: none` (CSS)
// pour les navigateurs qui l'appliquent mal (écouteur non passif obligatoire sur iOS).
_boardEl.addEventListener('touchmove',   e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
_boardEl.addEventListener('contextmenu', e => e.preventDefault());

_boardEl.addEventListener('pointerup',     e => _endDrag(e, false));
_boardEl.addEventListener('pointercancel', e => _endDrag(e, true));

// ─── CLIC SUR LA BARRE DE COUPS ───────────────────────────────────────────────

document.getElementById('moves-bar').addEventListener('click', e => {
    const tok = e.target.closest('[data-i]');
    if (tok) goToMove(Number(tok.dataset.i));
});

// ─── RACCOURCIS CLAVIER ───────────────────────────────────────────────────────
//   ←  navPrev   →  navNext   Espace  indice   F  retourner l'échiquier

function _keyboardAllowed(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return false;
    const gs = document.getElementById('game-screen');
    if (!gs || gs.style.display === 'none' || gs.classList.contains('hidden')) return false;
    return ['admin-overlay', 'confirm-overlay', 'promo-overlay', 'help-overlay', 'pgn-overlay', 'settings-overlay', 'trash-overlay']
        .every(id => document.getElementById(id).classList.contains('hidden'));
}

document.addEventListener('keydown', e => {
    if (!_keyboardAllowed(e)) return;
    switch (e.key) {
        case 'ArrowLeft':
            if (gameMode === 'training') return;
            e.preventDefault(); navPrev(); break;
        case 'ArrowRight':
            if (gameMode === 'training') return;
            e.preventDefault(); navNext(); break;
        case ' ':
            if (e.repeat) return;
            e.preventDefault();
            if (e.target && e.target.tagName === 'BUTTON') e.target.blur();   // évite le clic fantôme au keyup
            showHint(); break;
        case 'f': case 'F':
            if (e.repeat) return;
            flipBoard(); break;
    }
});
