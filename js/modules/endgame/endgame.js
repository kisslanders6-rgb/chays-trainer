/**
 * modules/endgame/endgame.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Finales : exercices de finales théoriques avec réponse automatique de l'adversaire.
 *
 *   1. EG                noyau pur (règles, recherche, base KPK exacte)   → egCore.js
 *   2. ENDGAME_EXERCISES catalogue : FEN + objectif + théorie              → egExercises.js
 *   3. progression       stockage « chessTrainer_endgames »               (ce fichier)
 *   4. initEndgame()     écran d'accueil (appelé par switchHomeTab('endgame'))
 *   5. startEndgame(id)  séance : jugement du coup, réponse de l'adversaire, indices, retenter
 *
 * S'appuie sur l'écran de jeu existant (gameMode = 'endgame').
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  3. PROGRESSION (localStorage)
// ═══════════════════════════════════════════════════════════════════════════
const ENDGAME_PROGRESS_KEY = 'chessTrainer_endgames';

function readEndgameProgress() {
    const o = dataStore.getJSON(ENDGAME_PROGRESS_KEY, null);
    return o && typeof o === 'object' ? o : {};
}
function _egSaveProgress(p) { dataStore.setJSON(ENDGAME_PROGRESS_KEY, p); }

function _egBump(id, fn) {
    const p = readEndgameProgress();
    const cur = p[id] || { tries: 0, wins: 0, perfect: false, best: 0, last: 0 };
    fn(cur);
    cur.last = Date.now();
    p[id] = cur;
    _egSaveProgress(p);
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. ÉCRAN D'ACCUEIL « FINALES »
// ═══════════════════════════════════════════════════════════════════════════
function egMiniBoard(ex) {
    const rows  = ex.fen.split(' ')[0].split('/');
    const cells = new Array(64).fill('');
    for (let r = 0; r < 8; r++) {
        let c = 0;
        for (const ch of rows[r]) { if (ch >= '1' && ch <= '8') c += Number(ch); else cells[(7 - r) * 8 + c++] = ch; }
    }
    const flip  = ex.player === 'b';
    const ranks = flip ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    const files = flip ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    let html = '';
    ranks.forEach(r => files.forEach(c => {
        const p = cells[r * 8 + c];
        html += `<i class="eg-sq ${(r + c) % 2 === 1 ? 'l' : 'd'}">${p ? pieceHTML(p) : ''}</i>`;
    }));
    return `<div class="eg-mini" aria-hidden="true">${html}</div>`;
}

const _egDots = n => '●'.repeat(n) + '○'.repeat(3 - n);

// Filtre du catalogue : 'all' | 'todo' (pas encore réussi sans faute) | '1' | '2' | '3' (niveau).
let egFilter = 'all';

function _egVisible(prog) {
    return ENDGAME_EXERCISES.filter(e =>
        egFilter === 'all' ? true
      : egFilter === 'todo' ? !(prog[e.id] && prog[e.id].perfect)
      : e.level === Number(egFilter));
}

// Exercice au hasard parmi ceux qui sont affichés, en privilégiant ceux qui ne sont pas encore réussis sans faute.
function startRandomEndgame() {
    const prog = readEndgameProgress(), list = _egVisible(prog);
    if (!list.length) return;
    const fresh = list.filter(e => !(prog[e.id] && prog[e.id].perfect));
    const pool = fresh.length ? fresh : list;
    startEndgame(pool[Math.floor(Math.random() * pool.length)].id);
}

function initEndgame() {
    const panel = document.getElementById('endgame-panel');
    if (!panel) return;
    const prog = readEndgameProgress();
    const done    = ENDGAME_EXERCISES.filter(e => prog[e.id] && prog[e.id].wins > 0).length;
    const perfect = ENDGAME_EXERCISES.filter(e => prog[e.id] && prog[e.id].perfect).length;
    const tries   = ENDGAME_EXERCISES.reduce((s, e) => s + ((prog[e.id] && prog[e.id].tries) || 0), 0);

    let html = `<div class="stats-kpis">
        <div class="stats-kpi"><span class="stats-kpi-n">${done}/${ENDGAME_EXERCISES.length}</span><span class="stats-kpi-l">réussis</span></div>
        <div class="stats-kpi"><span class="stats-kpi-n">${perfect}</span><span class="stats-kpi-l">sans faute ni indice</span></div>
        <div class="stats-kpi"><span class="stats-kpi-n">${tries}</span><span class="stats-kpi-l">tentative${tries > 1 ? 's' : ''}</span></div>
    </div>`;

    const fb = (id, label) => `<button class="tr-seg-btn ${egFilter === id ? 'active' : ''}" role="radio" aria-checked="${egFilter === id}" data-action="egFilter" data-arg="${id}">${label}</button>`;
    const visible = _egVisible(prog);
    html += `<div class="eg-toolbar">
        <div class="tr-seg" role="radiogroup" aria-label="Filtrer les exercices">${fb('all', 'Tous')}${fb('todo', 'À faire')}${fb('1', 'Niveau 1')}${fb('2', 'Niveau 2')}${fb('3', 'Niveau 3')}</div>
        <button class="btn btn-primary eg-random" data-action="egRandom" ${visible.length ? '' : 'disabled'}>${ico('skip-forward')} Au hasard</button>
    </div>`;
    if (!visible.length) html += '<div class="empty-tab">Tous les exercices de ce filtre sont réussis sans faute. Bravo !</div>';

    ENDGAME_CATEGORIES.forEach(cat => {
        const list = visible.filter(e => e.cat === cat.id);
        if (!list.length) return;
        html += `<section class="eg-section"><div class="eg-section-head"><div class="eg-section-title">${escapeHtml(cat.label)}</div><div class="eg-section-desc">${escapeHtml(cat.desc)}</div></div><div class="eg-grid">`;
        list.forEach(ex => {
            const p = prog[ex.id];
            const badge = p && p.perfect ? `<span class="eg-badge ok">${ico('check')} Sans faute</span>`
                        : p && p.wins     ? `<span class="eg-badge ok">${ico('check')} Réussi</span>`
                        : p && p.tries    ? '<span class="eg-badge">En cours</span>' : '';
            html += `<button class="eg-card" data-action="startEndgame" data-arg="${escapeHtml(ex.id)}">
                ${egMiniBoard(ex)}
                <div class="eg-card-body">
                    <div class="eg-card-title">${escapeHtml(ex.title)}${ex.beta ? ' <span class="eg-badge beta">Bêta</span>' : ''}</div>
                    <div class="eg-card-goal">${egObjective(ex)}</div>
                    <div class="eg-card-meta"><span class="eg-lvl" title="Niveau ${ex.level}/3">${_egDots(ex.level)}</span>${badge}</div>
                </div></button>`;
        });
        html += '</div></section>';
    });
    panel.innerHTML = html;

    // Précalcule la base KPK pendant que l'utilisateur choisit (≈ 0,25 s).
    const warm = () => { try { EG.buildKpk(); } catch (e) {} };
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 1500 }); else setTimeout(warm, 400);
}


// ─── Outils des finales de tours ──────────────────────────────────────────────
const _egSqName = s => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
const _egUci = m => _egSqName(EG.mFrom(m)) + _egSqName(EG.mTo(m)) + (EG.mPromo(m) ? EG.LETTER[EG.mPromo(m)].toLowerCase() : '');
function _egParseUci(u) {
    const sq = n => 'abcdefgh'.indexOf(n[0]) + 8 * (Number(n[1]) - 1);
    return EG.mk(sq(u.slice(0, 2)), sq(u.slice(2, 4)), u[4] ? { q: 5, r: 4, b: 3, n: 2 }[u[4]] : 0);
}

// Défense de Philidor (Noirs) : règles canoniques + garde-fou par recherche (les Blancs ne doivent pas
// pouvoir forcer la promotion en 9 demi-coups). Renvoie null si le coup est correct, sinon le message.
function _egPhilBasic(ns) {                                 // règles + Tour non abandonnée (aucune recherche)
    let pawn = -1, rook = -1;
    for (let i = 0; i < 64; i++) { if (ns.b[i] === 1) pawn = i; if (ns.b[i] === -4) rook = i; }
    if (pawn < 0 || rook < 0) return null;
    if (EG.attacked(ns.b, rook, 1) && !EG.attacked(ns.b, rook, -1)) return 'Votre Tour est en prise : elle serait perdue.';
    const bk = EG.kingSq(ns.b, -1), pr = pawn >> 3;
    if (pr <= 4) {
        if ((rook >> 3) !== 5) return 'Philidor : tant que le pion n\'est pas en 6e, la Tour reste sur la 6e rangée.';
        if ((bk >> 3) < 6) return 'Philidor : gardez le roi noir sur sa dernière rangée (ou la 7e), devant le pion.';
    } else if (pr === 5 && (rook >> 3) !== 0) {
        return 'Le pion est en 6e : la Tour doit passer derrière, sur la 1re rangée, pour donner des échecs par derrière.';
    }
    return null;
}

// Défense de Philidor (Noirs) : règles canoniques, anticipation de la poussée e5-e6, et garde-fou par
// recherche (les Blancs ne doivent pas forcer la promotion en 9 demi-coups). null = coup correct.
// Pion (ou Dame issue de la promotion) éliminé, Blancs au trait : gagnent-ils la Tour noire en la prenant
// sans que la pièce preneuse soit reprise ? (Tour contre Tour, ou Tour reprise par le roi : nulle.)
function _egWinsRook(ns) {
    return EG.legalMoves(ns).some(r => {
        if (ns.b[EG.mTo(r)] !== -4) return false;
        const n2 = EG.make(ns, r);
        return !EG.legalMoves(n2).some(x => EG.mTo(x) === EG.mTo(r));
    });
}

function _egPhilidorCheck(st, m) {
    const ns = EG.make(st, m);
    const pawn = ns.b.indexOf(1);
    if (pawn < 0) {
        // Le pion a été pris, ou vient d'être promu : la nouvelle Dame doit disparaître sur-le-champ,
        // et l'échange qui suit ne doit pas coûter la Tour (ex. …Txe8 Txe8 Rxe8 : nulle).
        if (ns.b.indexOf(5) >= 0) return { msg: 'La nouvelle Dame doit être prise immédiatement, sinon la partie est perdue.' };
        return _egWinsRook(ns) ? { msg: 'Les Blancs prendraient votre Tour sans qu\'elle puisse être reprise.' } : { capture: true };
    }
    const basic = _egPhilBasic(ns);
    if (basic) return { msg: basic };
    if ((pawn >> 3) <= 4 && !EG.inCheck(st) && ns.b.indexOf(-6) !== 60)
        return { msg: 'Philidor : sans échec à parer, le roi reste sur e8 devant le pion ; jouez avec la Tour sur la 6e rangée.' };
    if ((pawn >> 3) === 4) {                                  // les Blancs peuvent-ils pousser, et aurez-vous alors une défense ?
        const push = EG.legalMoves(ns).find(x => EG.mFrom(x) === pawn && EG.mTo(x) === pawn + 8);
        if (push) {
            const n2 = EG.make(ns, push);
            const ok = EG.legalMoves(n2).some(r => {
                const n3 = EG.make(n2, r);
                if (n3.b.indexOf(1) < 0) return n3.b.indexOf(5) < 0 && !_egWinsRook(n3);      // pion éliminé sans perdre la Tour
                return !_egPhilBasic(n3) && !EG.forcesPromotion(n3, 5);
            });
            if (!ok) return { msg: 'Après e6, vous n\'auriez plus de défense : placez la Tour et le roi autrement.' };
        }
    }
    if (EG.forcesPromotion(ns, 7)) return { msg: 'Ce coup perd : les Blancs peuvent forcer la promotion du pion.' };
    return null;
}

// Les Blancs poussent, doublent sur la 7e, donnent échec : un adversaire qui « essaie » vraiment.
function _egPhilidorWhite(st) {
    let best = null, bs = -1e9;
    for (const m of EG.legalMoves(st)) {
        const ns = EG.make(st, m), from = EG.mFrom(m), to = EG.mTo(m), t = Math.abs(st.b[from]);
        let sc = 0;
        if (st.b[to] < 0) sc += 500;
        if (t === 1) { sc += 60; if (EG.attacked(ns.b, to, -1) && !EG.attacked(ns.b, to, 1)) sc -= 300; }
        if (t === 4) { const rk = to >> 3; if (rk === 6) sc += 30; if (rk === 7) sc += 25; if (EG.attacked(ns.b, to, -1) && !EG.attacked(ns.b, to, 1)) sc -= 400; }
        if (t === 6) sc += 6 * (to >> 3);
        if (EG.inCheck(ns)) sc += 15;
        const ps = ns.b.indexOf(1);
        if (ps >= 0 && EG.attacked(ns.b, ps, -1) && !EG.attacked(ns.b, ps, 1)) sc -= 500;      // ne jamais laisser le pion en prise
        if (ps >= 0 && !EG.attacked(ns.b, ps, 1)) sc -= 150;                                   // garder le pion protégé
        if (ps >= 0) {                                                                         // prise du pion non reprise ?
            for (const r of EG.legalMoves(ns)) {
                if (EG.mTo(r) !== ps) continue;
                const n2 = EG.make(ns, r);
                if (!EG.legalMoves(n2).some(x => EG.mTo(x) === ps)) { sc -= 600; break; }
            }
        }
        if (sc > bs) { bs = sc; best = m; }
    }
    return best;
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. SÉANCE D'EXERCICE
// ═══════════════════════════════════════════════════════════════════════════
const endgameState = {
    ex: null, busy: false, over: false, failed: null, timers: [],
    moves: 0, errors: 0, hints: 0, hintLevel: 0, budget: 0, seen: {}, tried: false
};

function _egLater(fn, ms) { endgameState.timers.push(setTimeout(fn, ms)); }

function stopEndgame() {
    endgameState.timers.forEach(clearTimeout);
    endgameState.timers = [];
    endgameState.busy = false;
    endgameState.ex   = null;
}

const _egCur  = () => EG.fromGlobals(board, turn);
const _egPromoCode = l => ({ Q: 5, R: 4, B: 3, N: 2 }[String(l).toUpperCase()] || 0);

function startEndgame(id) {
    const ex = ENDGAME_BY_ID[id];
    if (!ex) return;
    stopEndgame();
    endgameState.ex = ex;
    playerColor = ex.player;
    gameMode    = 'endgame';
    endgameState.errors = 0; endgameState.hints = 0; endgameState.tried = false;
    showGameScreen(ex.player);
    const pill = document.getElementById('repertoire-pill');
    if (pill) pill.textContent = ex.title;
    _egLoadPosition();
}

function _egLoadPosition() {
    const s = endgameState, ex = s.ex;
    s.timers.forEach(clearTimeout); s.timers = [];
    parseFEN(ex.fen);
    moveHistory = []; lastFrom = -1; lastTo = -1;
    selected = null; legalMoves = []; hintPiece = null; awaitingPromotion = null;
    boardFlipped = ex.player === 'b';
    resetNavCursor();
    clearErrorFx();
    s.busy = false; s.over = false; s.failed = null;
    s.moves = 0; s.hintLevel = 0; s.seen = {};
    if (ex.kind === 'kpk') {
        const pr = EG.kpkProbe(_egCur());
        s.budget = ex.goal === 'win' ? Math.ceil(pr.dtw / 2) + 3 : ex.hold;
    } else if (ex.kind === 'script') s.budget = Math.ceil(ex.line.length / 2);
    else if (ex.kind === 'rules')    s.budget = ex.hold;
    else if (ex.kind === 'pawns')    s.budget = ex.goal === 'win' ? ex.maxMoves : ex.hold;
    else s.budget = ex.maxMoves;
    renderMoves();
    renderBoard();
    renderEndgameCard();
    setStatus(`${egObjective(ex)} — à vous de jouer.`, 'info');
    if (ex.kind === 'pawns') {                                   // précalcul pendant que le joueur réfléchit
        const st = _egCur(), warm = () => { try { EG.pawnValue(st, ex.horizon); } catch (e) {} };
        if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 800 }); else setTimeout(warm, 200);
    }
}

function retryEndgame() {
    if (!endgameState.ex) return;
    endgameState.errors = 0; endgameState.hints = 0; endgameState.tried = false;
    _egLoadPosition();
}

function nextEndgame() {
    const ex = endgameState.ex;
    if (!ex) return;
    const i = ENDGAME_EXERCISES.indexOf(ex);
    startEndgame(ENDGAME_EXERCISES[(i + 1) % ENDGAME_EXERCISES.length].id);
}

registerActions({ egFilter: f => { egFilter = f; initEndgame(); }, egRandom: () => startRandomEndgame(),
    startEndgame: id => startEndgame(id), nextEndgame: () => nextEndgame(), retryEndgame: () => retryEndgame(), undoEndgameMove: () => undoEndgameMove() });

// ─── CARTE D'OBJECTIF (panneau de jeu) ────────────────────────────────────────
function renderEndgameCard() {
    const el = document.getElementById('endgame-card');
    const s = endgameState, ex = s.ex;
    if (!el || !ex) return;
    const cat = ENDGAME_CATEGORIES.find(c => c.id === ex.cat);
    const unit = ex.kind === 'script' ? 'au total' : ex.goal === 'draw' ? 'à tenir' : 'max';
    const meter = `<div class="eg-meter"><span>Coup <b>${s.moves}</b> / ${s.budget} ${unit}</span><span>${s.errors} erreur${s.errors > 1 ? 's' : ''}</span><span>${s.hints} indice${s.hints > 1 ? 's' : ''}</span></div>`;

    let result = '';
    if (s.over) {
        result = `<div class="eg-result ok">${ico('check')} <span>${escapeHtml(s.over)}</span></div>
            <div class="eg-theory">${escapeHtml(ex.theory)}</div>
            <div class="eg-actions"><button class="btn btn-primary" data-action="nextEndgame">${ico('skip-forward')} Suivant</button><button class="btn" data-action="retryEndgame">${ico('rotate-ccw')} Rejouer</button></div>`;
    } else if (s.failed) {
        result = `<div class="eg-result err">${ico('alert-triangle')} <span>${escapeHtml(s.failed.msg)}</span></div>
            <div class="eg-actions">${s.failed.undoable ? `<button class="btn btn-primary" data-action="undoEndgameMove">${ico('pencil')} Annuler ce coup</button>` : ''}<button class="btn" data-action="retryEndgame">${ico('rotate-ccw')} Recommencer</button></div>`;
    }
    el.className = 'endgame-card' + (s.over ? ' is-ok' : s.failed ? ' is-err' : '');
    el.innerHTML = `<div class="eg-card-top"><span class="eg-cat">${escapeHtml(cat ? cat.label : '')}</span><span class="eg-lvl">${_egDots(ex.level)}</span></div>
        <div class="eg-title">${escapeHtml(ex.title)}${ex.beta ? ' <span class="eg-badge beta">Bêta</span>' : ''}</div>
        <div class="eg-goal">${egObjective(ex)}</div>
        ${meter}${result}`;
}

// ─── COUP DU JOUEUR (appelé par executePlayerMove) ────────────────────────────
function _egJudge(ex, st, m) {
    const s = endgameState, n = s.moves + 1;                 // numéro de ce coup
    if (ex.kind === 'mate') {
        const j = EG.judgeMate(st, m);
        if (j.mate)      return { state: 'success', msg: 'Échec et mat ! Bien joué.' };
        if (j.stalemate) return { state: 'fail', undoable: true,  msg: 'Pat ! La partie est nulle : laissez toujours une case libre au roi adverse (hors échec).' };
        if (j.hanging)   return { state: 'fail', undoable: true,  msg: 'Votre pièce est abandonnée : le roi adverse la prend et le gain disparaît.' };
        if (n > ex.maxMoves) return { state: 'fail', undoable: false, msg: `Trop lent : le mat doit tomber en ${ex.maxMoves} coups maximum.` };
        return { state: 'continue' };
    }
    if (ex.kind === 'script') {
        const i = 2 * (n - 1);
        if (_egUci(m) !== ex.line[i]) return { state: 'fail', undoable: true, msg: 'Ce coup sort de la méthode théorique : cherchez le plan de la leçon (utilisez l\'indice).' };
        if (i === ex.line.length - 1) return { state: 'success', msg: 'Pion promu : position gagnée !' };
        return { state: 'continue' };
    }
    if (ex.kind === 'rules') {
        const r = _egPhilidorCheck(st, m);
        if (r && r.capture) return { state: 'success', msg: 'Le pion est éliminé : nulle !' };
        if (r) return { state: 'fail', undoable: true, msg: r.msg };
        if (n >= ex.hold) return { state: 'success', msg: `Nulle assurée : vous avez tenu ${ex.hold} coups avec la défense de Philidor.` };
        return { state: 'continue' };
    }
    if (ex.kind === 'pawns') return _egJudgePawns(ex, st, m, n);
    const info = EG.kpkAfter(st, m);
    if (ex.goal === 'win') {
        if (!info.win) {
            const why = { capture: 'Le pion est perdu : c\'est nulle.', stalemate: 'Pat ! C\'est nulle (en cas de pat, promouvez plutôt en Tour).',
                          underpromo: 'Promotion en pièce mineure : roi + cavalier ou fou ne peut pas mater, c\'est nulle.',
                          hanging: 'La pièce promue est prise ou le roi adverse est pat : le gain disparaît.' }[info.why]
                      || 'Ce coup laisse échapper le gain : la position est maintenant nulle.';
            return { state: 'fail', undoable: true, msg: why };
        }
        if (info.promoted || info.mate) return { state: 'success', msg: 'Promotion réussie : la position est gagnée.' };
        if (n > s.budget) return { state: 'fail', undoable: false, msg: 'Le gain théorique est conservé, mais vous perdez trop de temps : cherchez la ligne la plus directe.' };
        return { state: 'continue' };
    }
    if (info.win) return { state: 'fail', undoable: true, msg: 'Ce coup perd : le pion va se promouvoir. Il fallait garder la nulle.' };
    if (info.why === 'capture')   return { state: 'success', msg: 'Pion capturé : nulle !' };
    if (info.why === 'stalemate') return { state: 'success', msg: 'Pat : nulle !' };
    if (n >= s.budget) return { state: 'success', msg: `Nulle assurée : vous avez tenu ${s.budget} coups sans céder.` };
    return { state: 'continue' };
}

// Horizon de calcul d'une finale de pions. Exercice de gain : le gain doit tomber dans l'horizon de
// départ, donc l'horizon restant diminue de deux demi-coups par coup joué (calcul plus court, et un
// gain trop lent est refusé). Exercice de nulle : horizon constant.
const _egHorizon = ex => ex.goal === 'win' ? Math.max(3, ex.horizon - 2 * endgameState.moves) : ex.horizon;

// Finales de pions (solveur borné, cf. EG.pawnValue). Gain : le coup doit garder un gain que l'horizon
// restant suffit à prouver. Nulle : seul un coup dont la perte est PROUVÉE est refusé.
function _egJudgePawns(ex, st, m, n) {
    const v = EG.pawnMoveValue(st, m, _egHorizon(ex)), promo = EG.mPromo(m);
    const after = EG.make(st, m), pc = EG.pawnCount(after.b);
    if (ex.goal === 'win') {
        if (v !== 1) return { state: 'fail', undoable: true, msg: promo
            ? 'Cette promotion ne gagne pas : la Dame est prise, ou l\'adversaire promeut aussitôt.'
            : 'Ce coup ne gagne pas, ou trop lentement : cherchez la ligne la plus directe.' };
        if (promo) return { state: 'success', msg: 'Promotion réussie : la position est gagnée.' };
        if (n > endgameState.budget) return { state: 'fail', undoable: false, msg: 'Le gain est toujours là, mais trop lent : cherchez la ligne la plus directe.' };
        return { state: 'continue' };
    }
    if (v === -1) return { state: 'fail', undoable: true, msg: 'Ce coup perd : l\'adversaire peut maintenant forcer la promotion de son pion.' };
    if (promo) return { state: 'success', msg: 'Vous promouvez à votre tour : nulle (au moins) !' };
    if (pc.n === 0) return { state: 'success', msg: 'Plus aucun pion : nulle !' };
    if (pc.n === 1 && !EG.kpkProbe(after).win && pc.side !== st.stm) return { state: 'success', msg: 'Il ne reste qu\'un pion adverse, et la position est nulle : bien défendu !' };
    if (n >= endgameState.budget) return { state: 'success', msg: `Nulle assurée : vous avez tenu ${endgameState.budget} coups sans céder.` };
    return { state: 'continue' };
}

// Coups « utiles » d'une finale de pions : promotions en Dame seulement (les sous-promotions n'apportent rien ici).
const _egPawnMoves = st => EG.legalMoves(st).filter(m => !EG.mPromo(m) || EG.mPromo(m) === EG.Q);

// Réponse de l'ordinateur en finale de pions.
//   Le joueur doit gagner : défense la plus tenace (nulle si elle existe, sinon la perte la plus lointaine).
//   Le joueur doit annuler : gain s'il existe, sinon le coup qui laisse au joueur le plus de réponses perdantes.
function _egPawnsReply(ex, st) {
    const H = _egHorizon(ex), moves = _egPawnMoves(st);
    if (!moves.length) return null;
    const scored = moves.map(m => ({ m, v: EG.pawnMoveValue(st, m, H) }));
    if (ex.goal === 'win') {
        const hold = scored.filter(x => x.v >= 0);
        if (hold.length) return hold[0].m;
        // Perte la plus lointaine ; à deux demi-coups près, une prise (la défense « naturelle ») est préférée.
        const depth = scored.map(x => ({ m: x.m, d: EG.pawnMoveLossDepth(st, x.m, H), cap: st.b[EG.mTo(x.m)] !== 0 }));
        const maxD = Math.max(...depth.map(x => x.d));
        const near = depth.filter(x => x.d >= maxD - 2);
        return (near.find(x => x.cap) || near.find(x => x.d === maxD)).m;
    }
    const wins = scored.filter(x => x.v === 1);
    if (wins.length) {
        let best = wins[0].m, bestD = Infinity;
        for (const x of wins) { const d = EG.pawnMoveWinDepth(st, x.m, H); if (d < bestD) { bestD = d; best = x.m; } }
        return best;
    }
    let best = scored[0].m, bestScore = -Infinity;
    for (const x of scored) {
        if (x.v < 0) continue;
        const ns = EG.make(st, x.m);
        let traps = 0;
        for (const r of _egPawnMoves(ns)) if (EG.pawnMoveValue(ns, r, H - 1) === -1) traps++;
        const push = Math.abs(st.b[EG.mFrom(x.m)]) === EG.P ? 1 : 0;
        const score = 10 * traps + push;
        if (score > bestScore) { bestScore = score; best = x.m; }
    }
    return best;
}

function answerEndgameMove(from, to, promo) {
    const s = endgameState, ex = s.ex;
    if (!ex || s.busy || s.over) return;
    const st  = _egCur();
    const m   = EG.mk(from, to, promo ? _egPromoCode(promo) : 0);
    const san = toAlgebraic(from, to, promo);                 // avant application : board est encore la position d'origine
    const res = _egJudge(ex, st, m);

    if (!s.tried) { s.tried = true; _egBump(ex.id, p => { p.tries++; }); }
    s.moves++; s.hintLevel = 0;

    if (res.state === 'fail') {
        s.errors++; s.failed = res; s.busy = true;
        _commitMove(from, to, promo, null, `✗ ${san} — ${res.msg}`, 'err');
        playSound('error');
        renderEndgameCard();
        return;
    }
    if (res.state === 'success') {
        _commitMove(from, to, promo, null, `✓ ${san} — ${res.msg}`, 'ok');
        _egFinish(res.msg);
        return;
    }
    s.busy = true;
    _commitMove(from, to, promo, null, `✓ ${san}`, 'ok');
    renderEndgameCard();
    _egLater(_egAiReply, 550);
}

// ─── RÉPONSE AUTOMATIQUE DE L'ADVERSAIRE ──────────────────────────────────────
function _egAiReply() {
    const s = endgameState, ex = s.ex;
    if (!ex || s.over || s.failed) return;
    const st = _egCur();
    const me = ex.player === 'w' ? 1 : -1;
    let m;
    if (ex.kind === 'script')     m = _egParseUci(ex.line[2 * s.moves - 1]);        // réponse de la ligne théorique
    else if (ex.kind === 'rules') m = _egPhilidorWhite(st);                         // Blancs qui cherchent à gagner
    else if (ex.kind === 'mate')  m = EG.searchBest(st, ex.defDepth || 4, me);      // défense du roi seul
    else if (ex.kind === 'pawns') m = _egPawnsReply(ex, st);                         // solveur de finales de pions
    else if (ex.goal === 'win')   m = EG.kpkDefense(st);                            // défense parfaite (base exacte)
    else                          m = EG.kpkTrapAttack(st);                         // attaque qui tend des pièges
    if (m == null) { _egFinish('Partie terminée.'); return; }

    const from = EG.mFrom(m), to = EG.mTo(m), pr = EG.promoLetter(m);
    const san  = toAlgebraic(from, to, pr);
    _commitMove(from, to, pr, null, `Adversaire : ${san} — à vous.`, 'info');

    // Le joueur est-il maté / pat ? Répétition ?
    const st2 = _egCur(), replies = EG.legalMoves(st2);
    if (!replies.length) {
        if (EG.inCheck(st2)) { s.failed = { msg: 'Vous êtes mat.', undoable: false }; s.busy = true; s.errors++; renderEndgameCard(); setStatus('✗ Vous êtes mat.', 'err'); return; }
        if (ex.goal === 'draw') { _egFinish('Pat : nulle !'); return; }
        s.failed = { msg: 'Pat : la partie est nulle.', undoable: false }; s.busy = true; s.errors++; renderEndgameCard(); setStatus('✗ Pat.', 'err'); return;
    }
    const key = positionKey();
    s.seen[key] = (s.seen[key] || 0) + 1;
    if (ex.goal === 'draw' && s.seen[key] >= 3) { _egFinish('Nulle par répétition de position.'); return; }

    s.busy = false;
    renderEndgameCard();
}

// ─── FIN D'EXERCICE ───────────────────────────────────────────────────────────
function _egFinish(msg) {
    const s = endgameState, ex = s.ex;
    s.over = msg; s.busy = true;
    const perfect = s.errors === 0 && s.hints === 0;
    _egBump(ex.id, p => {
        p.wins++;
        if (perfect) p.perfect = true;
        if (!p.best || s.moves < p.best) p.best = s.moves;
    });
    renderEndgameCard();
    setStatus(`✓ ${msg}`, 'ok');
}

// ─── ANNULER UN COUP FAUTIF ───────────────────────────────────────────────────
function undoEndgameMove() {
    const s = endgameState;
    if (!s.failed || !s.failed.undoable || !moveHistory.length) return;
    performUndo();                                           // openingsLogic.js : restaure position, trait, surbrillance
    s.moves = Math.max(0, s.moves - 1);
    s.failed = null; s.busy = false; s.hintLevel = 0;
    renderEndgameCard();
    setStatus('Coup annulé — cherchez un autre coup.', 'info');
}

// ─── INDICE (appelé par showHint) ─────────────────────────────────────────────
//   kpk  : 1) type de pièce  2) idée  3) coup exact
//   mate : conseils successifs de la fiche
function endgameHint() {
    const s = endgameState, ex = s.ex;
    if (!ex || s.busy || s.over) return;
    const st = _egCur();
    s.hints++;

    if (ex.kind === 'script') {
        const want = _egParseUci(ex.line[2 * s.moves]), from = EG.mFrom(want);
        if (s.hintLevel === 0) setStatus(`Indice : déplacez ${PIECE_HINT[(board[from] || '').toUpperCase()] || 'une pièce'}.`, 'hint');
        else if (s.hintLevel === 1 && ex.tips.length) setStatus(`Indice : ${ex.tips[Math.min(s.moves ? 1 : 0, ex.tips.length - 1)]}`, 'hint');
        else setStatus(`Solution : ${toAlgebraic(from, EG.mTo(want), EG.promoLetter(want))}`, 'hint');
        s.hintLevel = Math.min(s.hintLevel + 1, 2);
        renderEndgameCard();
        return;
    }
    if (ex.kind === 'mate' || ex.kind === 'rules') {
        const tip = ex.tips[Math.min(s.hintLevel, ex.tips.length - 1)];
        s.hintLevel++;
        setStatus(`Indice : ${tip}`, 'hint');
        renderEndgameCard();
        return;
    }
    if (ex.kind === 'pawns') {
        const H = _egHorizon(ex), moves = _egPawnMoves(st);
        let good;
        if (ex.goal === 'win') {
            const wins = moves.filter(m => EG.pawnMoveValue(st, m, H) === 1);
            let bestD = Infinity;
            for (const m of wins) { const d = EG.pawnMoveWinDepth(st, m, H); if (d < bestD) { bestD = d; good = m; } }
        } else good = moves.find(m => EG.pawnMoveValue(st, m, H) >= 0);
        if (good == null) { s.hints--; return; }
        const from = EG.mFrom(good), tips = ex.tips || [];
        let level = s.hintLevel;
        if (level === 1 && !tips.length) level = 2;
        if (level === 0)      setStatus(`Indice : déplacez ${PIECE_HINT[(board[from] || '').toUpperCase()] || 'une pièce'}.`, 'hint');
        else if (level === 1) setStatus(`Indice : ${tips[Math.min(s.moves ? 1 : 0, tips.length - 1)]}`, 'hint');
        else                  setStatus(`Solution : ${toAlgebraic(from, EG.mTo(good), EG.promoLetter(good))}`, 'hint');
        s.hintLevel = Math.min(s.hintLevel + 1, 2);
        renderEndgameCard();
        return;
    }
    let best;
    if (ex.goal === 'win') best = EG.kpkBestAttack(st);
    else {
        const ok = EG.kpkMoves(st).filter(x => !x.info.win);
        best = ok.find(x => x.info.why === 'capture') || ok[0];
    }
    if (!best) { s.hints--; return; }
    const from = EG.mFrom(best.m);
    const tips = ex.tips || [];
    let level = s.hintLevel;
    if (level === 1 && !tips.length) level = 2;
    if (level === 0) {
        setStatus(`Indice : déplacez ${PIECE_HINT[(board[from] || '').toUpperCase()] || 'une pièce'}.`, 'hint');
    } else if (level === 1) {
        setStatus(`Indice : ${tips[0]}`, 'hint');
    } else {
        setStatus(`Solution : ${toAlgebraic(from, EG.mTo(best.m), EG.promoLetter(best.m))}`, 'hint');
    }
    s.hintLevel = Math.min(s.hintLevel + 1, 2);
    renderEndgameCard();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { _egPhilidorCheck, _egPhilidorWhite };
}
