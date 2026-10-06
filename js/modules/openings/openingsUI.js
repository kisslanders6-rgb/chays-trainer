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
                pc.textContent = PIECES[p];
                sq.appendChild(pc);
            }

            sq.addEventListener('click', () => handleClick(idx));
            el.appendChild(sq);
        });
    });
}

// ─── BARRE DE COUPS ───────────────────────────────────────────────────────────

function renderMoves() {
    const bar = document.getElementById('moves-bar');
    if (!moveHistory.length) {
        bar.innerHTML = '<span style="color:#5a4020">Aucun coup joué</span>';
        return;
    }
    let html = '';
    moveHistory.forEach((m, i) => {
        if (i % 2 === 0) html += `<span class="move-num">${Math.floor(i / 2) + 1}.</span> `;
        html += `<span class="move-token">${m.san}</span> `;
    });
    bar.innerHTML = html;
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

function updateNavButtons() {
    const prevBtn   = document.getElementById('btn-prev');
    const nextBtn   = document.getElementById('btn-next');
    if (!prevBtn || !nextBtn) return;
    const len        = moveHistory.length;
    const cursorPos  = navCursor === -1 ? len : navCursor;
    prevBtn.disabled = (cursorPos === 0);
    prevBtn.style.opacity = prevBtn.disabled ? '0.4' : '';
    nextBtn.disabled = (navCursor === -1);
    nextBtn.style.opacity = nextBtn.disabled ? '0.4' : '';
}

function navPrev() {
    const len = moveHistory.length;
    if (len === 0) return;
    if (navCursor === -1) navCursor = len - 1;
    else if (navCursor > 0) navCursor--;
    else return;
    renderNavBoard();
    updateNavButtons();
}

function navNext() {
    if (navCursor === -1) return;
    const len = moveHistory.length;
    if (navCursor < len - 1) {
        navCursor++;
        renderNavBoard();
    } else {
        navCursor = -1;
        renderBoard();
        renderMoves();
        setStatus('Retour à la position actuelle.', 'info');
    }
    updateNavButtons();
}

function renderNavBoard() {
    if (navCursor === -1) { renderBoard(); return; }
    const snap = moveHistory[navCursor];

    // Sauvegarde des globaux pour restauration après rendu
    const savedBoard    = board;
    const savedTurn     = turn;
    const savedLastFrom = lastFrom;
    const savedLastTo   = lastTo;
    const savedSelected = selected;
    const savedLegal    = legalMoves;

    // Reconstruction du plateau après ce coup à partir du snapshot boardBefore
    const tempBoard = snap.boardBefore.slice();
    const from = snap.from, to = snap.to, promo = snap.promo;
    const p = tempBoard[from];
    tempBoard[to]   = p;
    tempBoard[from] = '';

    if (promo) {
        tempBoard[to] = snap.turnBefore === 'w' ? promo.toUpperCase() : promo.toLowerCase();
    }
    // En passant
    if (p && p.toUpperCase() === 'P' && to === snap.epBefore) {
        const epRow = Math.floor(from / 8);
        const epCol = to % 8;
        tempBoard[epRow * 8 + epCol] = '';
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
    const bar = document.getElementById('moves-bar');
    let html  = '';
    moveHistory.forEach((m, i) => {
        if (i % 2 === 0) html += `<span class="move-num">${Math.floor(i / 2) + 1}.</span> `;
        const isActive = (i === navCursor);
        html += `<span class="move-token" style="${isActive ? 'background:var(--accent);color:var(--accent-text);border-radius:4px;padding:0 3px;' : ''}">${m.san}</span> `;
    });
    bar.innerHTML = html || '<span style="color:#5a4020">Aucun coup joué</span>';
    setStatus(`Navigation — coup ${navCursor + 1}/${moveHistory.length} : ${snap.san}`, 'info');
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
        btn.textContent   = PIECES[pc];
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

function flashWrong(toIdx) {
    const sq = document.querySelector(`#board .sq[data-idx="${toIdx}"]`);
    if (sq) sq.classList.add('hl-wrong');
    const b = document.getElementById('board');
    b.classList.remove('shake');
    void b.offsetWidth;            // relance l'animation
    b.classList.add('shake');
}

// ─── FLIP BOARD ───────────────────────────────────────────────────────────────

function flipBoard() {
    boardFlipped = !boardFlipped;
    renderBoard();
}