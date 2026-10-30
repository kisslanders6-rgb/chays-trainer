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

// ─── ACCESSIBILITÉ : nom des cases et navigation au clavier ─────────────────
// Une seule case est atteignable par Tab (« tabindex mobile ») ; les flèches déplacent le focus,
// Entrée / Espace équivalent à un clic. Chaque case porte un libellé lisible (« e4, pion blanc »).
const _PIECE_NAMES = { K: 'roi', Q: 'dame', R: 'tour', B: 'fou', N: 'cavalier', P: 'pion' };
let _kbFocus = null;

function _squareLabel(idx, p) {
    if (!p) return squareToName(idx);
    const t = p.toUpperCase(), fem = t === 'Q' || t === 'R';
    return `${squareToName(idx)}, ${_PIECE_NAMES[t]} ${isWhite(p) ? (fem ? 'blanche' : 'blanc') : (fem ? 'noire' : 'noir')}`;
}

function renderBoard() {
    clearErrorFx();         // un réaffichage ne doit jamais rejouer la secousse d'une erreur passée
    const el        = document.getElementById('board');
    const focused   = el.contains(document.activeElement) && document.activeElement.dataset.idx !== undefined
                    ? Number(document.activeElement.dataset.idx) : null;
    el.innerHTML    = '';
    if (_kbFocus === null) _kbFocus = boardFlipped ? 52 : 12;

    const ranks = boardFlipped ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];
    const files = boardFlipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];

    ranks.forEach((r, row) => {
        files.forEach((c, col) => {
            const idx    = r * 8 + c;
            const sq     = document.createElement('div');
            const isLight = (r + c) % 2 === 1;
            sq.className  = 'sq ' + (isLight ? 'light' : 'dark');
            sq.dataset.idx = idx;
            sq.setAttribute('role', 'button');
            sq.tabIndex = idx === _kbFocus ? 0 : -1;
            sq.setAttribute('aria-label', _squareLabel(idx, board[idx]) + (selected === idx ? ', sélectionnée' : '') + (legalMoves.includes(idx) ? ', coup possible' : ''));

            if (appSettings.lastMove && idx === lastFrom) sq.classList.add('hl-from');   // Paramètres › Apparence
            if (appSettings.lastMove && idx === lastTo)   sq.classList.add('hl-to');
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

            // Coordonnées intégrées aux cases du bord : chiffre en haut à gauche, lettre en bas à droite.
            if (col === 0) sq.insertAdjacentHTML('beforeend', `<span class="coord coord-rank">${r + 1}</span>`);
            if (row === 7) sq.insertAdjacentHTML('beforeend', `<span class="coord coord-file">${'abcdefgh'[c]}</span>`);

            sq.addEventListener('click', () => {
                if (_dragJustEnded() || appSettings.moveInput === 'drag') return;     // « Glisser » seulement : pas de clic
                handleClick(idx);
            });
            el.appendChild(sq);
        });
    });

    if (focused !== null) { const f = el.querySelector(`.sq[data-idx="${focused}"]`); if (f) f.focus({ preventScroll: true }); }
    if (typeof renderAnnotations === 'function') renderAnnotations(true);
    if (typeof renderFreqPanel === 'function') renderFreqPanel();          // onglet « Adversaire » : position affichée
    if (typeof renderOppSuites === 'function') renderOppSuites();          // suites adverses sous la barre d'état (Jouer)
    if (typeof _syncHintBtn === 'function') _syncHintBtn();
    if (moveAnim) { const a = moveAnim; moveAnim = null; _runMoveAnim(a); }
    else if (_liveAnim) _resumeMoveAnim();
}

// ─── PIÈCES VECTORIELLES & ANIMATION DE DÉPLACEMENT ──────────────────────────

function pieceHTML(p) {
    return (typeof PIECE_SVG !== 'undefined' && PIECE_SVG[p]) || PIECES[p];   // repli Unicode
}

let moveAnim = null;
let _liveAnim = null;      // animation en cours : { from, to, t0, ms, pos }, reprise si l'échiquier est redessiné

// Demande une animation (case de départ → case d'arrivée) au prochain renderBoard().
// Ignorée après un glisser-déposer (la pièce a déjà été déplacée à la main), si l'animation des
// pièces est coupée ou si les animations sont réduites (Paramètres, ou réglage de l'appareil).
function animateNextMove(from, to) {
    moveAnim = (!moveAnimMs() || _dragJustEnded() || from < 0 || to < 0) ? null : { from, to };
}

// Facteur de `zoom` CSS hérité par `el` (réglage « Taille du texte » : body { zoom }). Les longueurs
// CSS y sont multipliées par ce facteur, alors que clientX / getBoundingClientRect sont en px écran.
function _zoomOf(el, cssWidth = el.offsetWidth) {
    return el.getBoundingClientRect().width / cssWidth || 1;
}

// `elapsed` : temps déjà écoulé (ms) quand l'animation est reprise après un nouveau rendu.
function _runMoveAnim(a, elapsed = 0) {
    const b  = document.getElementById('board');
    const f  = b.querySelector(`.sq[data-idx="${a.from}"]`);
    const t  = b.querySelector(`.sq[data-idx="${a.to}"]`);
    const pc = t && t.querySelector('.piece');
    if (!f || !pc || !pc.animate) { _liveAnim = null; return; }
    const fr = f.getBoundingClientRect(), tr = t.getBoundingClientRect();
    const z  = _zoomOf(t);
    const ms = elapsed ? a.ms : moveAnimMs();
    t.style.zIndex = 5;                                   // la pièce passe au-dessus des autres cases
    const anim = pc.animate(
        [{ transform: `translate(${(fr.left - tr.left) / z}px, ${(fr.top - tr.top) / z}px)` }, { transform: 'translate(0, 0)' }],
        { duration: ms, easing: 'cubic-bezier(.22,.8,.3,1)' });
    if (elapsed) anim.currentTime = elapsed;
    const live = _liveAnim = { from: a.from, to: a.to, t0: performance.now() - elapsed, ms, pos: board.join() };
    anim.onfinish = anim.oncancel = () => { t.style.zIndex = ''; if (_liveAnim === live) _liveAnim = null; };
}

// renderBoard() reconstruit les cases et couperait net une animation en cours (par exemple un clic
// sur une pièce pendant que le coup adverse glisse encore) : elle reprend là où elle en était,
// pourvu que la position affichée n'ait pas changé.
function _resumeMoveAnim() {
    const a = _liveAnim, elapsed = performance.now() - a.t0;
    if (elapsed >= a.ms || board.join() !== a.pos) { _liveAnim = null; return; }
    _runMoveAnim(a, elapsed);
}

// ─── BARRE DE COUPS ───────────────────────────────────────────────────────────

function _paintMovesBar(active) {
    const bar = document.getElementById('moves-bar');
    bar.classList.toggle('locked', gameMode === 'training' || gameMode === 'endgame');   // non cliquable en entraînement
    if (!moveHistory.length) {
        bar.innerHTML = '<span style="color:#5a4020">Aucun coup joué</span>';
        return;
    }
    let html = '';
    moveHistory.forEach((m, i) => {
        if (i % 2 === 0) html += `<span class="move-num">${Math.floor(i / 2) + 1}.</span> `;
        html += `<span class="move-token${i === active ? ' active' : ''}" data-i="${i}">${formatSan(m.san, i % 2 ? 'b' : 'w')}</span> `;
    });
    bar.innerHTML = html;
    const cur = bar.querySelector('.move-token.active');
    if (cur && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = cur.offsetLeft - bar.clientWidth / 2;   // ligne défilante (mobile)
    if (typeof syncTreeToPosition === 'function') syncTreeToPosition();     // l'arbre suit la position affichée
}

function renderMoves() {
    _paintMovesBar(navCursor === -1 ? moveHistory.length - 1 : navCursor);
    if (typeof saveLastPlay === 'function') saveLastPlay();
}

// ─── BARRE DE STATUT ──────────────────────────────────────────────────────────

// Barre d'état : un titre court, et éventuellement un détail grisé sur une seconde ligne.
// opts = { action, run, icon?, title? } : bouton facultatif à droite (« reçu » d'un coup enregistré, par exemple),
// créé en DOM (textContent) ; tout nouvel appel à setStatus le retire. Sans opts, rendu inchangé.
function setStatus(msg, type = 'info', detail = '', opts = null) {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    dot.className  = 'status-dot ' + { ok: 'dot-ok', err: 'dot-err', info: 'dot-info', new: 'dot-new', hint: 'dot-hint' }[type];
    text.replaceChildren(Object.assign(document.createElement('span'), { className: 'status-title', textContent: msg }));
    if (detail) text.append(Object.assign(document.createElement('span'), { className: 'status-detail', textContent: detail }));
    const bar = document.getElementById('status-bar');
    if (!bar) return;
    const old = bar.querySelector('.status-act');
    if (old) old.remove();
    bar.classList.toggle('has-act', !!(opts && opts.action));
    if (!opts || !opts.action) return;
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-soft status-act' });
    if (opts.title) btn.title = opts.title;
    if (opts.icon && typeof ico === 'function') btn.innerHTML = ico(opts.icon);      // icône du sprite, sans texte inséré
    btn.append(Object.assign(document.createElement('span'), { textContent: opts.action }));
    btn.addEventListener('click', () => { if (typeof opts.run === 'function') opts.run(); });
    bar.append(btn);
}

// ─── PASTILLE SUR L'ÉCHIQUIER ─────────────────────────────────────────────────
// Message court posé sur l'échiquier, hors du flux (aucune hauteur ajoutée) : « Toucher pour passer » pendant
// la mise en situation de l'Entraînement, par exemple. onTap facultatif : un toucher sur la pastille l'appelle.

function showBoardPill(text, onTap) {
    const pill = document.getElementById('board-pill');
    if (!pill) return;
    pill.textContent = text;
    pill.onclick = typeof onTap === 'function' ? () => onTap() : null;
    pill.classList.toggle('is-tap', typeof onTap === 'function');
    pill.hidden = false;
}

function hideBoardPill() {
    const pill = document.getElementById('board-pill');
    if (!pill) return;
    pill.hidden = true;
    pill.onclick = null;
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
    const len = moveHistory.length, was = _navPos();
    // Un pas en avant rejoue le coup, un pas en arrière le défait : animés comme un coup joué.
    if (p === was + 1 && moveHistory[p]) animateNextMove(moveHistory[p].from, moveHistory[p].to);
    else if (p === was - 1 && moveHistory[was]) animateNextMove(moveHistory[was].to, moveHistory[was].from);
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
    if (gameMode === 'analysis' && typeof analysisPositionChanged === 'function') analysisPositionChanged();
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
                      : `Navigation — coup ${navCursor + 1}/${moveHistory.length} : ${formatSanText(snap.san, snap.turnBefore)}`, 'info');
}

function resetNavCursor() {
    navCursor = -1;
    updateNavButtons();
}

// ─── FEN DE LA POSITION AFFICHÉE ET ANALYSE SUR LICHESS ──────────────────────

// FEN complet de la position affichée (position courante, ou position passée en navigation).
function displayedFen() {
    let b = board, t = turn, cr = castlingRights, ep = enPassant;
    if (navCursor !== -1 && moveHistory.length) {
        const s = moveHistory[navCursor === NAV_START ? 0 : navCursor + 1];
        b = s.boardBefore; t = s.turnBefore; cr = s.castlingBefore; ep = s.epBefore;
    }
    return Chess.fen({ board: b, turn: t, castling: cr, ep });
}

function openLichessAnalysis() {
    const url = `https://lichess.org/analysis/standard/${encodeURI(displayedFen().replace(/ /g, '_'))}?color=${boardFlipped ? 'black' : 'white'}`;
    window.open(url, '_blank', 'noopener');
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
    if (gameMode === 'training' || gameMode === 'endgame') return;
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
    if (gameMode === 'endgame' && endgameState.busy) return false;
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
    d.zoom = _zoomOf(g, d.size);                        // ramène px écran → px CSS sous body { zoom }
    g.style.width = g.style.height = d.size / d.zoom + 'px';
    document.body.classList.add('dragging');
    try { _boardEl.setPointerCapture(d.pid); } catch (e) { /* pointeur déjà relâché */ }

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
    try { _boardEl.releasePointerCapture(d.pid); } catch (err) { /* déjà relâché */ }
    document.querySelectorAll('#board .drag-source, #board .hl-drop')
        .forEach(el => el.classList.remove('drag-source', 'hl-drop'));
    _lastDragEnd = performance.now();
    if (cancelled) return;

    const to = _squareAt(e.clientX, e.clientY);
    if (to === null)         handleClick(d.from);   // relâché hors de l'échiquier : désélection
    else if (to !== d.from)  handleClick(to);       // joue / refuse / change de pièce (comme un clic)
    // relâché sur sa propre case : la pièce reste sélectionnée
}

// Alt maintenu pendant le coup : choix de la pièce de promotion malgré la promotion automatique.
let altHeld = false;
['keydown', 'keyup'].forEach(t => window.addEventListener(t, e => { altHeld = e.altKey; }, true));
['pointerdown', 'pointerup'].forEach(t => window.addEventListener(t, e => { altHeld = e.altKey; }, true));

_boardEl.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary || !_canInteract()) return;
    if (appSettings.moveInput === 'click') return;                     // « Cliquer » seulement : pas de glisser
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
    const z = d.zoom;
    d.ghost.style.transform = `translate(${(e.clientX - d.size / 2) / z}px, ${(e.clientY - d.size / 2) / z}px) scale(1.12)`;
    const over = _squareAt(e.clientX, e.clientY);
    if (over !== d.over) { _setOver(d.over, false); _setOver(over, true); d.over = over; }
});

// Mobile : un toucher sur le plateau ne doit ni faire défiler la page, ni déclencher le
// pull-to-refresh, ni ouvrir le menu contextuel (appui long). Complète `touch-action: none` (CSS)
// pour les navigateurs qui l'appliquent mal (écouteur non passif obligatoire sur iOS).
_boardEl.addEventListener('touchmove',   e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
_boardEl.addEventListener('contextmenu', e => e.preventDefault());

_boardEl.addEventListener('pointerup',     e => _endDrag(e, false));

// Clavier : flèches = déplacer le focus (dans le sens d'affichage), Entrée / Espace = cliquer la case.
_boardEl.addEventListener('keydown', e => {
    const sq = e.target.closest && e.target.closest('.sq');
    if (!sq || e.ctrlKey || e.metaKey || e.altKey) return;
    const idx = Number(sq.dataset.idx);
    const dir = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (dir) {
        e.preventDefault(); e.stopPropagation();             // pas de navigation dans l'historique
        const s = boardFlipped ? -1 : 1, c = idx % 8 + dir[0] * s, r = Math.floor(idx / 8) + dir[1] * s;
        if (c < 0 || c > 7 || r < 0 || r > 7) return;
        const next = r * 8 + c, el = _boardEl.querySelector(`.sq[data-idx="${next}"]`);
        sq.tabIndex = -1; _kbFocus = next;
        if (el) { el.tabIndex = 0; el.focus(); }
    } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation();             // pas d'indice (Espace) quand le focus est sur l'échiquier
        _kbFocus = idx;
        if (_canInteract()) handleClick(idx);
    }
});
_boardEl.addEventListener('focusin', e => { const sq = e.target.closest && e.target.closest('.sq'); if (sq) _kbFocus = Number(sq.dataset.idx); });
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
    return ['data-overlay', 'confirm-overlay', 'promo-overlay', 'help-overlay', 'pgn-overlay', 'review-overlay', 'settings-overlay', 'trash-overlay', 'text-overlay']
        .every(id => document.getElementById(id).classList.contains('hidden'));
}

document.addEventListener('keydown', e => {
    if (!_keyboardAllowed(e)) return;
    switch (e.key) {
        case 'ArrowLeft':
            if (gameMode === 'training' || gameMode === 'endgame') return;
            e.preventDefault(); navPrev(); break;
        case 'ArrowRight':
            if (gameMode === 'training' || gameMode === 'endgame') return;
            e.preventDefault(); navNext(); break;
        case ' ':
            if (e.repeat) return;
            e.preventDefault();
            if (e.target && e.target.tagName === 'BUTTON') e.target.blur();   // évite le clic fantôme au keyup
            showHint(); break;
        case 'f': case 'F':
            if (e.repeat) return;
            flipBoard(); break;
        case 'r': case 'R':
            if (e.repeat || gameMode !== 'play') return;
            toggleBookArrows(); break;
    }
});
