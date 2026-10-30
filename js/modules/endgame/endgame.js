/**
 * modules/endgame/endgame.js
 * ──────────────────────────────────────────────────────────────────────────
 * Module Finales : exercices de finales théoriques avec réponse automatique de l'adversaire.
 *
 *   1. EG                noyau pur (règles, recherche, base KPK exacte)   → egCore.js
 *   2. ENDGAME_EXERCISES catalogue : FEN + objectif + théorie              → egExercises.js
 *      EndgameJudge / EndgameOpponent : juge commun et adversaire calculé  → egJudge.js, egOpponent.js
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
//  4. ÉCRAN D'ACCUEIL « FINALES » (bibliothèque)
// ═══════════════════════════════════════════════════════════════════════════
// Objectif : libellé et icône du sprite.
const EG_GOALS = { mate: ['Mater', 'flag'], win: ['Gagner', 'target'], draw: ['Annuler', 'shield-check'] };

// Catalogue dans l'ordre des catégories, puis du fichier : ordre de « À suivre » et des sections.
const _egCatalogue = () => ENDGAME_CATEGORIES.flatMap(c => ENDGAME_EXERCISES.filter(e => e.cat === c.id));

const _egWon = (prog, e) => !!(prog[e.id] && prog[e.id].wins > 0);
const _egNext = prog => _egCatalogue().find(e => !_egWon(prog, e)) || null;

// État d'un exercice d'après la progression : 'perfect' | 'done' | 'tried' | 'todo'.
function _egState(prog, e) {
    const p = prog[e.id];
    return p && p.wins > 0 ? (p.perfect ? 'perfect' : 'done') : p && p.tries ? 'tried' : 'todo';
}
const _egTries = n => `${n} essai${n > 1 ? 's' : ''}`;

// Roi du jeu de pièces actif (comme ColorScope) ; data-glyph le fait redessiner au changement de jeu.
function _egKing(side) {
    const p = side === 'b' ? 'k' : 'K';
    return `<span class="glyph eg-king" data-glyph="${p}" aria-hidden="true">${(typeof PIECE_SVG !== 'undefined' && PIECE_SVG[p]) || ''}</span>`;
}
const _egDotsHTML = n => `<span class="eg-dots" role="img" aria-label="Difficulté ${n} sur 5">${[1, 2, 3, 4, 5].map(i => `<i${i <= n ? ' class="on"' : ''}></i>`).join('')}</span>`;
const _egGoalTag = ex => `<span class="eg-tag eg-goal-tag">${ico(EG_GOALS[ex.goal][1])}${EG_GOALS[ex.goal][0]}</span>`;
const _egSideTag = ex => `<span class="eg-tag">${_egKing(ex.player)}${EG_SIDE[ex.player]}</span>`;

// Limite de l'exercice : « 20 coups au plus », « tenir 12 coups », « 12 coups pour conclure ».
const _egBudgetText = ex => ex.maxMoves ? `${ex.maxMoves} coups au plus` : ex.hold ? `tenir ${ex.hold} coups` : ex.keep ? `${ex.keep} coups pour conclure` : '';

// État à droite d'une ligne : coche laiton (sans faute), coche verte (réussi), essais (en cours), difficulté sinon.
function _egStateHTML(prog, ex) {
    const st = _egState(prog, ex);
    if (st === 'perfect') return `<span class="eg-st is-perfect" role="img" aria-label="Réussi sans faute" title="Réussi sans faute">${ico('check')}</span>`;
    if (st === 'done')    return `<span class="eg-st is-done" role="img" aria-label="Réussi" title="Réussi">${ico('check')}</span>`;
    if (st === 'tried')   return `<span class="eg-st is-tried">${_egTries(prog[ex.id].tries)}</span>`;
    return _egDotsHTML(ex.level);
}

// Origine du jugement, annoncée avant la séance d'après le catalogue (le juge la confirme au premier verdict).
const _egMen = fen => fen.split(' ')[0].replace(/[\d/]/g, '');
function _egExpectedSource(ex) {
    if (ex.kind) return 'local';
    const men = _egMen(ex.fen);
    if (['Kkp', 'KPk'].includes(men.split('').sort().join(''))) return 'kpk';
    return men.length <= EndgameJudge.MAX_PIECES ? 'syzygy' : 'engine';
}

// Pastille d'origine du jugement. Syzygy hors ligne : la réponse vient forcément du cache (« Réponse gardée »).
function _egSourceBadge(source, exact) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (source === 'syzygy') return offline ? `<span class="vbadge is-muted eg-src">${ico('database')}Réponse gardée · exact</span>`
                                            : `<span class="vbadge is-muted eg-src">${ico('cloud')}Tables Syzygy · exact</span>`;
    if (source === 'engine' || exact === false) return `<span class="vbadge is-muted is-dashed eg-src">${ico('cpu')}Moteur · verdict estimé</span>`;
    return `<span class="vbadge is-muted eg-src">${ico('check')}Calcul exact</span>`;
}

function _egMini(ex, cls) {
    return typeof _miniBoardHTML === 'function' ? _miniBoardHTML({ side: ex.player, k: ex.fen }, false, { cls, label: ex.title }) : '';
}

// Filtre (barre de contexte) : 'all' | 'todo' (pas encore réussi) | 'done' (réussi).
let egFilter = 'all';
// Exercice choisi pour l'aperçu de la colonne de droite (bureau) ; null : « À suivre ».
let egSel = null;

const _egShown = (prog, e) => egFilter === 'all' || (egFilter === 'done') === _egWon(prog, e);

function _egVisible(prog) {
    return ENDGAME_EXERCISES.filter(e => _egShown(prog, e));
}

// Exercice au hasard parmi ceux qui sont affichés, en privilégiant ceux qui ne sont pas encore réussis sans faute.
function startRandomEndgame() {
    const prog = readEndgameProgress(), list = _egVisible(prog);
    if (!list.length) return;
    const fresh = list.filter(e => !(prog[e.id] && prog[e.id].perfect));
    const pool = fresh.length ? fresh : list;
    startEndgame(pool[Math.floor(Math.random() * pool.length)].id);
}

// Carte d'aperçu (Velours sombre) : « À suivre » par défaut, l'exercice choisi sinon. Son « Commencer » est la
// seule action pleine de l'écran. mode 'sheet' : même contenu dans le panneau du bas (téléphone).
function _egPreviewHTML(ex, prog, mode) {
    const cat = ENDGAME_CATEGORIES.find(c => c.id === ex.cat), p = prog[ex.id], st = _egState(prog, ex);
    const isNext = (_egNext(prog) || {}).id === ex.id;
    const tag = mode === 'sheet' ? 'Aperçu' : isNext ? 'À suivre' : 'Choisi';
    const progress = st === 'perfect' ? 'Réussi sans faute' : st === 'done' ? `Réussi · ${_egTries(p.tries || p.wins)}`
                   : st === 'tried' ? `${_egTries(p.tries)}, pas encore réussi` : 'Jamais tenté';
    const plan = (ex.plan || ex.tips || []).length;
    return `<section class="vel-card vel-dark eg-pv${mode === 'sheet' ? ' is-sheet' : ' edge-card'}" aria-label="${escapeHtml(`${tag} : ${ex.title}`)}">
        <span class="st-eyebrow">${escapeHtml(tag)} · ${escapeHtml(cat ? cat.label : '')}</span>
        <div class="eg-pv-row">
            ${_egMini(ex, 'eg-pos')}
            <div class="eg-pv-txt">
                <h3 class="eg-pv-title">${escapeHtml(ex.title)}</h3>
                <div class="eg-tags">${_egGoalTag(ex)}${_egSideTag(ex)}${_egBudgetText(ex) ? `<span class="eg-tag">${escapeHtml(_egBudgetText(ex))}</span>` : ''}</div>
                <span class="eg-pv-meta">${_egDotsHTML(ex.level)}<span class="eg-pv-prog is-${st}">${escapeHtml(progress)}</span></span>
            </div>
        </div>
        <ul class="eg-pv-facts">
            ${plan ? `<li>${ico('lightbulb')}${plan} étape${plan > 1 ? 's' : ''} de plan en indice</li>` : ''}
            <li>${_egSourceBadge(_egExpectedSource(ex), _egExpectedSource(ex) !== 'engine')}</li>
        </ul>
        <button type="button" class="btn btn-primary eg-go" data-action="startEndgame" data-arg="${escapeHtml(ex.id)}">Commencer ${ico('play')}</button>
    </section>`;
}

function _egDoneHTML(prog) {
    const all = ENDGAME_EXERCISES, perfect = all.filter(e => prog[e.id] && prog[e.id].perfect).length;
    return `<section class="vel-card vel-dark eg-pv edge-card" aria-label="Parcours terminé">
        <span class="st-eyebrow">Parcours terminé</span>
        <h3 class="eg-pv-title">Tout est réussi</h3>
        <span class="eg-pv-meta">${perfect} sur ${all.length} sans faute. Rejouez au hasard pour garder la main.</span>
        <button type="button" class="btn btn-primary eg-go" data-action="egRandom">${ico('shuffle')} Au hasard</button>
    </section>`;
}

// Bibliothèque :
//   - colonne de l'aperçu (en tête sur téléphone, à droite sur bureau) : « À suivre » ou l'exercice choisi ;
//   - puces de catégorie à anneau (réussis / total) qui font défiler jusqu'à la section ;
//   - une section par catégorie : lignes bord à bord sur téléphone, grille de cartes à partir de 720 px.
// Une ligne ou une carte ouvre l'aperçu (panneau du bas sous 920 px) : elle ne lance rien.
function initEndgame() {
    const panel = document.getElementById('endgame-panel');
    if (!panel) return;
    const prog = readEndgameProgress();
    const all = ENDGAME_EXERCISES, N = all.length;
    const done = all.filter(e => _egWon(prog, e)).length;
    const perfect = all.filter(e => prog[e.id] && prog[e.id].perfect).length;
    const tried = all.filter(e => _egState(prog, e) === 'tried').length;

    const seg = document.getElementById('endgame-seg');
    if (seg) seg.innerHTML = [['all', 'Toutes', N], ['todo', 'À faire', N - done], ['done', 'Réussies', done]].map(([f, label, n]) =>
        `<button class="seg-btn${egFilter === f ? ' active' : ''}" data-action="egFilter" data-arg="${f}" aria-pressed="${egFilter === f}">${label}<span class="egv-n"> · ${n}</span></button>`).join('');

    if (egSel && !ENDGAME_BY_ID[egSel]) egSel = null;
    const next = _egNext(prog), shown = egSel ? ENDGAME_BY_ID[egSel] : next;
    const tracks = ENDGAME_CATEGORIES.map(cat => ({ cat, list: _egCatalogue().filter(e => e.cat === cat.id) })).filter(t => t.list.length);
    const visible = tracks.map(t => ({ cat: t.cat, list: t.list.filter(e => _egShown(prog, e)) })).filter(t => t.list.length);
    const currentCat = shown ? shown.cat : '';

    const chips = `<nav class="eg-chips" aria-label="Catégories">${visible.map(({ cat }) => {
        const list = tracks.find(t => t.cat === cat).list;
        return Ring.chip({ value: list.filter(e => _egWon(prog, e)).length, max: list.length, text: cat.label, action: 'egJump', arg: cat.id, current: cat.id === currentCat });
    }).join('')}</nav>`;

    const sections = visible.map(({ cat, list }) => {
        const full = tracks.find(t => t.cat === cat).list, w = full.filter(e => _egWon(prog, e)).length;
        return `<section class="eg-sec" id="eg-sec-${escapeHtml(cat.id)}" aria-labelledby="eg-sec-h-${escapeHtml(cat.id)}">
            <div class="eg-sec-h"><h3 id="eg-sec-h-${escapeHtml(cat.id)}">${escapeHtml(cat.label)}</h3><span class="eg-sec-n">${w} / ${full.length}</span>
                <span class="eg-sec-bar" aria-hidden="true"><i style="width:${Math.round(100 * w / full.length)}%"></i></span></div>
            <p class="eg-sec-desc">${escapeHtml(cat.desc)}</p>
            <div class="eg-list">${list.map(ex => `<button type="button" class="eg-card${shown && ex.id === shown.id && egSel ? ' is-sel' : ''}" data-action="egPreview" data-arg="${escapeHtml(ex.id)}" aria-haspopup="dialog">
                ${_egMini(ex, 'eg-pos')}
                <span class="eg-card-txt"><b>${escapeHtml(ex.title)}</b>
                    <span class="eg-card-mt">${_egGoalTag(ex)}${_egKing(ex.player)}<span class="sr-only">${EG_SIDE[ex.player]}</span>${_egBudgetText(ex) ? `<span class="eg-card-budget">${escapeHtml(_egBudgetText(ex))}</span>` : ''}</span></span>
                <span class="eg-card-end">${_egStateHTML(prog, ex)}</span>
            </button>`).join('')}</div>
        </section>`;
    }).join('');

    const empty = visible.length ? '' : `<div class="eg-empty"><b>${egFilter === 'done' ? 'Aucune finale réussie' : 'Tout est réussi'}</b><span>${egFilter === 'done' ? `${N} à faire` : `${done} sur ${N}`}</span></div>`;
    const preview = shown ? _egPreviewHTML(shown, prog, 'aside') : _egDoneHTML(prog);
    const sum = `<section class="eg-sum" aria-label="Parcours"><span class="st-eyebrow">Parcours</span>
        <div class="eg-sum-big"><b>${done}</b><span>sur ${N} réussie${done > 1 ? 's' : ''}</span></div>
        <span class="eg-sum-sub">${perfect} sans faute · ${tried} en cours</span></section>`;

    panel.innerHTML = `<div class="egl">
        <aside class="egl-aside"><div id="eg-preview">${preview}</div>${sum}</aside>
        <div class="egl-main">${chips}${sections}${empty}</div>
    </div>`;

    // Précalcule la base KPK pendant que l'utilisateur choisit (≈ 0,25 s).
    const warm = () => { try { EG.buildKpk(); } catch (e) { reportError('finales : préparation de la base roi + pion', e); } };
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 1500 }); else setTimeout(warm, 400);
}

// ─── Aperçu : colonne de droite (bureau) ou panneau du bas ───────────────────
const _egWide = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(min-width: 920px)').matches;

function previewEndgame(id) {
    if (!ENDGAME_BY_ID[id]) return;
    if (!_egWide()) { _egOpenSheet(id); return; }
    egSel = id;
    const host = document.getElementById('eg-preview');
    if (!host) return;
    host.innerHTML = _egPreviewHTML(ENDGAME_BY_ID[id], readEndgameProgress(), 'aside');
    document.querySelectorAll('#endgame-panel .eg-card').forEach(c => c.classList.toggle('is-sel', c.dataset.arg === id));
    document.querySelectorAll('#endgame-panel .eg-chips .ring-chip').forEach(c => c.setAttribute('aria-current', String(c.dataset.arg === ENDGAME_BY_ID[id].cat)));
}

let _egSheetReturn = null;
function _egOpenSheet(id) {
    _egCloseSheet(false);
    _egSheetReturn = document.activeElement;
    const ex = ENDGAME_BY_ID[id];
    const wrap = document.createElement('div');
    wrap.id = 'eg-sheet';
    wrap.className = 'eg-sheet-wrap';
    wrap.innerHTML = `<div class="eg-sheet-bg" data-action="egCloseSheet"></div>
        <div class="eg-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml('Aperçu : ' + ex.title)}">
            <span class="eg-sheet-grab" aria-hidden="true"></span>
            <button type="button" class="eg-sheet-x" data-action="egCloseSheet" aria-label="Fermer l'aperçu">${ico('x')}</button>
            ${_egPreviewHTML(ex, readEndgameProgress(), 'sheet')}
        </div>`;
    wrap.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); _egCloseSheet(true); return; }
        if (e.key !== 'Tab') return;
        const f = [...wrap.querySelectorAll('button')], i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    document.body.appendChild(wrap);
    const go = wrap.querySelector('.eg-go');
    if (go) go.focus();
}

function _egCloseSheet(restore) {
    const el = document.getElementById('eg-sheet');
    if (el) el.remove();
    if (restore && _egSheetReturn && _egSheetReturn.isConnected) _egSheetReturn.focus();
    _egSheetReturn = null;
}

// Puce de catégorie : défile jusqu'à la section.
function jumpEndgameCategory(id) {
    const sec = document.getElementById('eg-sec-' + id);
    if (!sec) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sec.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    document.querySelectorAll('#endgame-panel .eg-chips .ring-chip').forEach(c => c.setAttribute('aria-current', String(c.dataset.arg === id)));
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

// Défense de Vancura (Noirs, pion blanc de la colonne a en 6e, Tour blanche devant lui) : règles canoniques
// + garde-fou par recherche, comme Philidor. null = coup correct.
//   - le roi noir reste dans le coin (g7, h7, g8, h8) : ailleurs, Th8 ! puis Th7+ enfile le roi et la Tour ;
//   - tant que le pion est en 6e, la Tour noire l'attaque de côté depuis la 6e rangée, sauf pour donner échec
//     (quand le roi blanc vient soutenir son pion, les échecs viennent par derrière) ;
//   - le pion en 7e : la Tour passe derrière lui, sur la colonne a.
const _VANCURA_KING = [54, 55, 62, 63];

// Règles seules (aucune recherche) : message, { capture: true }, ou null.
function _egVancuraBasic(st, m) {
    const ns = EG.make(st, m);
    const pawn = ns.b.indexOf(1), rook = ns.b.indexOf(-4);
    if (pawn < 0) {
        if (ns.b.indexOf(5) >= 0) return { msg: 'La nouvelle Dame doit être prise immédiatement, sinon la partie est perdue.' };
        return _egWinsRook(ns) ? { msg: 'Les Blancs prendraient votre Tour sans qu\'elle puisse être reprise.' } : { capture: true };
    }
    if (rook < 0) return { msg: 'Sans Tour, le pion passe : la partie est perdue.' };
    if (ns.b.indexOf(4) < 0) return { capture: true, note: 'La Tour blanche est tombée : nulle au moins !' };
    if (EG.attacked(ns.b, rook, 1) && !EG.attacked(ns.b, rook, -1)) return { msg: 'Votre Tour est en prise : elle serait perdue.' };
    const bk = EG.kingSq(ns.b, -1), pr = pawn >> 3, check = EG.inCheck(ns);
    if (!_VANCURA_KING.includes(bk)) return { msg: 'Vancura : le roi reste dans le coin (g7 ou h7). Ailleurs, Th8 ! puis Th7+ enfile votre roi et votre Tour.' };
    if (EG.mFrom(m) !== EG.kingSq(st.b, -1) && !check) {
        if (pr === 5 && (rook >> 3) !== 5) return { msg: 'Vancura : la Tour attaque le pion de côté, depuis la 6e rangée (ou donne échec).' };
        if (pr === 6 && (rook & 7) !== 0) return { msg: 'Le pion est en 7e : placez la Tour derrière lui, sur la colonne a.' };
    }
    return null;
}

function _egVancuraCheck(st, m) {
    const basic = _egVancuraBasic(st, m);
    if (basic) return basic;
    // Une réponse blanche ne doit pas vous laisser sans aucun coup conforme (Tour coincée loin de la colonne a…).
    const ns = EG.make(st, m);
    const stuck = EG.legalMoves(ns).some(r => {
        const n3 = EG.make(ns, r);
        if (n3.b.indexOf(1) < 0) return false;
        return !EG.legalMoves(n3).some(x => { const b = _egVancuraBasic(n3, x); return !b || b.capture; });
    });
    if (stuck) return { msg: 'Après la réponse des Blancs, vous n\'auriez plus de défense : gardez la Tour loin du roi blanc, prête à revenir sur la colonne a.' };
    if (EG.forcesPromotion(ns, 7)) return { msg: 'Ce coup perd : les Blancs peuvent forcer la promotion du pion.' };
    return null;
}

// Défenses à règles (ex.rules) : les exercices sont jugés par les tables ; les règles servent à expliquer
// une erreur et à donner un conseil quand le coup tient la nulle sans suivre la méthode.
const _EG_RULES = {
    philidor: { check: (st, m) => _egPhilidorCheck(st, m), name: 'la défense de Philidor' },
    vancura:  { check: (st, m) => _egVancuraCheck(st, m),  name: 'la défense de Vancura' }
};
const _egRules = ex => _EG_RULES[ex.rules || 'philidor'];

// ═══════════════════════════════════════════════════════════════════════════
//  5. SÉANCE D'EXERCICE
// ═══════════════════════════════════════════════════════════════════════════
const endgameState = {
    ex: null, busy: false, over: false, failed: null, timers: [],
    moves: 0, errors: 0, hints: 0, hintLevel: 0, budget: 0, seen: {}, tried: false,
    token: 0, source: null, exact: true, planStep: 0,
    verdict: null, theory: false                              // verdict dégradé [avant, après] (−1, 0, 1) ; théorie dépliée
};

// Exercice jugé par le juge commun (tables Syzygy, base KPK ou moteur) : pas de « kind » propre.
const _egJudged = ex => !ex.kind;
const _egFen = () => Chess.fen(Chess.snapshot());
const EG_OPPONENTS = [['max', 'Résistance maximale'], ['human', 'Humain']];

function _egLater(fn, ms) { endgameState.timers.push(setTimeout(fn, ms)); }

function stopEndgame() {
    endgameState.timers.forEach(clearTimeout);
    endgameState.timers = [];
    endgameState.busy = false;
    endgameState.ex   = null;
    endgameState.token++;                                     // un verdict ou une réponse en attente sont ignorés
}

const _egCur  = () => EG.fromGlobals(board, turn);
// Coup de la position affichée, écrit selon la préférence de notation (lettres françaises, anglaises ou figurines).
const _egSan = (from, to, promo) => formatSanText(toAlgebraic(from, to, promo), board[from] && board[from] === board[from].toLowerCase() ? 'b' : 'w');
const _egPromoCode = l => ({ Q: 5, R: 4, B: 3, N: 2 }[String(l).toUpperCase()] || 0);

function startEndgame(id) {
    const ex = ENDGAME_BY_ID[id];
    if (!ex) return;
    _egCloseSheet(false);
    stopEndgame();
    endgameState.ex = ex;
    playerColor = ex.player;
    gameMode    = 'endgame';
    endgameState.errors = 0; endgameState.hints = 0; endgameState.tried = false;
    showGameScreen(ex.player);          // la barre du haut affiche ex.title (renderGameRep)
    _egLoadPosition();
}

function _egLoadPosition() {
    const s = endgameState, ex = s.ex;
    s.timers.forEach(clearTimeout); s.timers = [];
    parseFEN(ex.fen);
    moveHistory = []; lastFrom = -1; lastTo = -1;
    selected = null; legalMoves = []; hintPiece = null; awaitingPromotion = null;
    boardFlipped = appSettings.autoFlip && ex.player === 'b';
    resetNavCursor();
    clearErrorFx();
    s.busy = false; s.over = false; s.failed = null; s.verdict = null; s.theory = false;
    s.moves = 0; s.hintLevel = 0; s.seen = {}; s.planStep = 0;
    s.token++;
    s.source = _egJudged(ex) ? null : 'local'; s.exact = true;   // mats, KPK, pions : juges locaux exacts
    if (_egJudged(ex)) {
        s.budget = ex.goal === 'win' ? ex.keep || ex.maxMoves : ex.hold;
        const token = s.token;
        EndgameJudge.probe(_egFen()).then(v => {                // verdict de départ : source affichée, cache rempli
            if (token !== s.token || !v) return;
            s.source = v.source; s.exact = v.exact;
            renderEndgameCard();
        }, () => {});
    } else if (ex.kind === 'kpk') {
        const pr = EG.kpkProbe(_egCur());
        s.budget = ex.goal === 'win' ? Math.ceil(pr.dtw / 2) + 3 : ex.hold;
    } else if (ex.kind === 'pawns')    s.budget = ex.goal === 'win' ? ex.maxMoves : ex.hold;
    else s.budget = ex.maxMoves;
    renderMoves();
    renderBoard();
    renderEndgameCard();
    setStatus(`${egObjective(ex)} — à vous de jouer.`, 'info');
    if (ex.kind === 'pawns') {                                   // précalcul pendant que le joueur réfléchit
        const st = _egCur(), warm = () => { try { EG.pawnValue(st, ex.horizon); } catch (e) { reportError('finales : préparation du calcul', e); } };
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

function setEndgameOpponent(policy) {
    if (!EG_OPPONENTS.some(([id]) => id === policy)) return;
    appSettings.egOpponent = policy;
    saveSettings();
    renderEndgameCard();
}

registerActions({ egFilter: f => { egFilter = f; initEndgame(); }, egRandom: () => startRandomEndgame(), egOpponent: p => setEndgameOpponent(p),
    egPreview: id => previewEndgame(id), egCloseSheet: () => _egCloseSheet(true), egJump: id => jumpEndgameCategory(id),
    egTheory: () => { endgameState.theory = !endgameState.theory; renderEndgameCard(); },
    startEndgame: id => startEndgame(id), nextEndgame: () => nextEndgame(), retryEndgame: () => retryEndgame(), undoEndgameMove: () => undoEndgameMove() });

// ─── CARTE D'OBJECTIF (panneau de jeu) ────────────────────────────────────────
const EG_OUTCOMES = { 1: 'Gain', 0: 'Nulle', '-1': 'Perte' };

// Jauge : une graduation par coup à tenir (hold, keep ou maxMoves ; budget calculé pour KPK), le coup fautif en rouge.
function _egMeterHTML(s, ex) {
    const n = Math.max(1, s.budget || 1), bad = s.failed && s.moves ? Math.min(s.moves, n) - 1 : -1;
    const ticks = Array.from({ length: n }, (_, i) =>
        `<i${i === bad ? ' class="bad"' : i < s.moves ? ` class="${s.over ? 'ok' : 'on'}"` : ''}></i>`).join('');
    const unit = ex.goal === 'draw' ? 'à tenir' : _egJudged(ex) && ex.keep ? 'pour conclure' : 'au plus';
    return `<div class="eg-meter">
        <div class="eg-ticks" style="--n:${n}" role="progressbar" aria-label="Coups joués" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${Math.min(s.moves, n)}">${ticks}</div>
        <div class="eg-meter-lg"><span>Coup <b>${s.moves}</b> / ${n} ${unit}</span><span${s.errors ? ' class="is-err"' : ''}><b>${s.errors}</b> erreur${s.errors > 1 ? 's' : ''}</span><span><b>${s.hints}</b> indice${s.hints > 1 ? 's' : ''}</span></div>
    </div>`;
}

// Verdict « avant → après » : le résultat attendu barré, puis le nouveau en rouge.
function _egVerdictHTML(v) {
    if (!v) return '';
    const [from, to] = v.map(x => EG_OUTCOMES[x]);
    return `<div class="eg-verdict" role="img" aria-label="${escapeHtml(`Verdict : ${from.toLowerCase()} devenue ${to.toLowerCase()}`)}">
        <span class="eg-vpill is-from">${from}</span>${ico('chevron-right')}<span class="eg-vpill is-to">${to}</span></div>`;
}

// Théorie : repliée pendant la séance (bouton « Théorie »), ouverte d'office à la fin.
function _egTheoryHTML(s, ex) {
    if (!ex.theory) return '';
    const open = s.over || s.theory;
    return `<div class="eg-theory-box">
        ${s.over ? `<span class="eg-theory-h">${ico('book')}Théorie</span>`
                 : `<button type="button" class="eg-theory-btn" data-action="egTheory" aria-expanded="${open}" aria-controls="eg-theory">${ico('book')}Théorie${ico('chevron-down')}</button>`}
        <p class="eg-theory" id="eg-theory"${open ? '' : ' hidden'}>${escapeHtml(ex.theory)}</p>
    </div>`;
}

function renderEndgameCard() {
    const el = document.getElementById('endgame-card');
    const s = endgameState, ex = s.ex;
    if (!el || !ex) return;
    const cat = ENDGAME_CATEGORIES.find(c => c.id === ex.cat);
    const src = s.source ? _egSourceBadge(s.source, s.exact) : '';
    const top = `<div class="eg-card-top"><span class="eg-cat">${escapeHtml(cat ? cat.label : '')}</span>${_egDotsHTML(ex.level)}</div>`;
    let body;
    if (s.over) {
        const i = ENDGAME_EXERCISES.indexOf(ex), nx = ENDGAME_EXERCISES[(i + 1) % ENDGAME_EXERCISES.length];
        body = `<div class="eg-win"><span class="eg-medal">${ico('check')}</span><div><b>Exercice réussi</b><span>${escapeHtml(s.over)}</span></div></div>
            <div class="eg-kpis"><div><b>${s.moves}</b><small>coup${s.moves > 1 ? 's' : ''}</small></div><div><b>${s.errors}</b><small>erreur${s.errors > 1 ? 's' : ''}</small></div><div><b>${s.hints}</b><small>indice${s.hints > 1 ? 's' : ''}</small></div></div>
            ${_egTheoryHTML(s, ex)}
            <div class="eg-nextup">${_egMini(nx, 'eg-pos')}<div><small>Suivant</small><b>${escapeHtml(nx.title)}</b></div></div>
            <div class="eg-actions"><button class="btn btn-primary" data-action="nextEndgame">${ico('skip-forward')} Suivant</button><button class="btn" data-action="retryEndgame">${ico('rotate-ccw')} Rejouer</button></div>`;
    } else {
        const goal = `<div class="eg-goalrow">${_egGoalTag(ex)}<span class="eg-side">${_egKing(ex.player)}avec les ${EG_SIDE[ex.player]}</span>${src}</div>`;
        let failed = '';
        if (s.failed) {
            const undo = s.failed.undoable;
            failed = `${_egVerdictHTML(s.verdict)}
                <div class="eg-rule">${ico('alert-triangle')}<span>${escapeHtml(s.failed.msg)}</span></div>
                <div class="eg-actions">${undo ? `<button class="btn btn-primary" data-action="undoEndgameMove">${ico('pencil')} Annuler ce coup</button>` : ''}<button class="btn${undo ? '' : ' btn-primary'}" data-action="retryEndgame">${ico('rotate-ccw')} Recommencer</button></div>`;
        }
        // Exercices jugés : choix de l'adversaire (tables, KPK ou moteur, cf. egOpponent.js).
        let opp = '';
        if (_egJudged(ex) && !s.failed) {
            const pol = appSettings.egOpponent || 'max';
            opp = `<div class="eg-opp"><span class="eg-opp-label" id="eg-opp-label">Adversaire</span>
                <div class="seg eg-opp-seg" role="radiogroup" aria-labelledby="eg-opp-label">${EG_OPPONENTS.map(([id, label]) =>
                    `<button class="seg-btn${pol === id ? ' active' : ''}" role="radio" aria-checked="${pol === id}" data-action="egOpponent" data-arg="${id}">${label}</button>`).join('')}</div></div>`;
        }
        body = `${goal}${failed}${_egMeterHTML(s, ex)}${opp}${_egTheoryHTML(s, ex)}`;
    }
    el.className = 'endgame-card' + (s.over ? ' is-ok' : s.failed ? ' is-err' : '');
    el.innerHTML = top + body;
}

// ─── COUP DU JOUEUR (appelé par executePlayerMove) ────────────────────────────
function _egJudge(ex, st, m) {
    const s = endgameState, n = s.moves + 1;                 // numéro de ce coup
    if (ex.kind === 'mate') {
        const j = EG.judgeMate(st, m);
        if (j.mate)      return { state: 'success', msg: 'Échec et mat ! Bien joué.' };
        if (j.stalemate) return { state: 'fail', undoable: true, verdict: [1, 0], msg: 'Pat ! La partie est nulle : laissez toujours une case libre au roi adverse (hors échec).' };
        if (j.hanging)   return { state: 'fail', undoable: true, verdict: [1, 0], msg: 'Votre pièce est abandonnée : le roi adverse la prend et le gain disparaît.' };
        if (n > ex.maxMoves) return { state: 'fail', undoable: false, msg: `Trop lent : le mat doit tomber en ${ex.maxMoves} coups maximum.` };
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
            return { state: 'fail', undoable: true, verdict: [1, 0], msg: why };
        }
        if (info.promoted || info.mate) return { state: 'success', msg: 'Promotion réussie : la position est gagnée.' };
        if (n > s.budget) return { state: 'fail', undoable: false, msg: 'Le gain théorique est conservé, mais vous perdez trop de temps : cherchez la ligne la plus directe.' };
        return { state: 'continue' };
    }
    if (info.win) return { state: 'fail', undoable: true, verdict: [0, -1], msg: 'Ce coup perd : le pion va se promouvoir. Il fallait garder la nulle.' };
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
        if (v !== 1) return { state: 'fail', undoable: true, verdict: [1, v < 0 ? -1 : 0], msg: promo
            ? 'Cette promotion ne gagne pas : la Dame est prise, ou l\'adversaire promeut aussitôt.'
            : 'Ce coup ne gagne pas, ou trop lentement : cherchez la ligne la plus directe.' };
        if (promo) return { state: 'success', msg: 'Promotion réussie : la position est gagnée.' };
        if (n > endgameState.budget) return { state: 'fail', undoable: false, msg: 'Le gain est toujours là, mais trop lent : cherchez la ligne la plus directe.' };
        return { state: 'continue' };
    }
    if (v === -1) return { state: 'fail', undoable: true, verdict: [0, -1], msg: 'Ce coup perd : l\'adversaire peut maintenant forcer la promotion de son pion.' };
    if (promo) return { state: 'success', msg: 'Vous promouvez à votre tour : nulle (au moins) !' };
    if (pc.n === 0) return { state: 'success', msg: 'Plus aucun pion : nulle !' };
    if (pc.n === 1 && !pc.pieces && !EG.kpkProbe(after).win && pc.side !== st.stm) return { state: 'success', msg: 'Il ne reste qu\'un pion adverse, et la position est nulle : bien défendu !' };
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
    if (_egJudged(ex)) { _egPlayJudged(from, to, promo); return; }
    const st  = _egCur();
    const m   = EG.mk(from, to, promo ? _egPromoCode(promo) : 0);
    const san = _egSan(from, to, promo);                 // avant application : board est encore la position d'origine
    const res = _egJudge(ex, st, m);

    if (!s.tried) { s.tried = true; _egBump(ex.id, p => { p.tries++; }); }
    s.moves++; s.hintLevel = 0;

    if (res.state === 'fail') {
        s.errors++; s.failed = res; s.verdict = res.verdict || null; s.busy = true;
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
    _egLater(_egAiReply, opponentDelay(550));
}

// ─── EXERCICES JUGÉS (tables Syzygy, base KPK ou moteur) ──────────────────────
// Camp adverse sans pion et sans matériel de mat (roi seul, ou roi + pièce mineure).
function _egCannotWin(st, side) {
    let minor = 0;
    for (let i = 0; i < 64; i++) {
        const v = st.b[i] * side;
        if (v <= 0 || v === EG.K) continue;
        if (v === EG.N || v === EG.B) minor++; else return false;
    }
    return minor <= 1;
}
const _egBare = (st, side) => { for (let i = 0; i < 64; i++) { const v = st.b[i] * side; if (v > 0 && v !== EG.K) return false; } return true; };

// Verdict d'un coup d'exercice jugé. v : { before, after } (juge commun) ou null si aucun verdict n'est disponible.
// st : position avant le coup (état EG), m : coup EG, n : numéro du coup. Pure : testée sans DOM.
function _egJudgedOutcome(ex, st, m, v, n) {
    const res = EndgameJudge.result, me = st.stm, ns = EG.make(st, m);
    const replies = EG.legalMoves(ns);
    const capture = st.b[EG.mTo(m)] !== 0, promo = !!EG.mPromo(m);
    if (v && res(v.after) < res(v.before)) {
        const rule = ex.rules ? _egRules(ex).check(st, m) : null;
        const msg = rule && rule.msg ? rule.msg
                  : ex.goal === 'win' ? (res(v.after) < 0 ? 'Ce coup perd : la position se retourne.' : 'Ce coup laisse échapper le gain : la position est maintenant nulle.')
                  : 'Ce coup perd : l\'adversaire peut maintenant forcer le gain.';
        return { state: 'fail', undoable: true, verdict: [res(v.before), res(v.after)], msg };
    }
    if (!replies.length) {
        if (EG.inCheck(ns)) return { state: 'success', msg: 'Échec et mat ! Bien joué.' };
        if (ex.goal === 'draw') return { state: 'success', msg: 'Pat : nulle !' };
        return { state: 'fail', undoable: true, verdict: [1, 0], msg: 'Pat ! La partie est nulle : laissez toujours une case libre au roi adverse.' };
    }
    const kept = !v || res(v.after) >= (ex.goal === 'win' ? 1 : 0);
    if (ex.goal === 'win') {
        if (kept && _egBare(ns, -me)) return { state: 'success', msg: 'Il ne reste que le roi adverse : le gain est acquis.' };
        if (kept && promo && ex.until !== 'capture') return { state: 'success', msg: 'Promotion réussie : la position est gagnée.' };
        if (kept && capture && ex.until !== 'promo') return { state: 'success', msg: 'Matériel gagné, gain conservé : la position est gagnée.' };
        if (ex.keep && n >= ex.keep) return { state: 'success', msg: `Gain conservé pendant ${ex.keep} coups : la méthode est acquise.` };
        if (ex.maxMoves && n >= ex.maxMoves) return { state: 'fail', undoable: false, msg: 'Le gain est toujours là, mais trop lent : cherchez la ligne la plus directe.' };
    } else {
        if (_egCannotWin(ns, -me)) return { state: 'success', msg: 'L\'adversaire n\'a plus de quoi gagner : nulle !' };
        if (kept && (capture || promo) && !ns.b.some(x => x === -me * EG.P)) return { state: 'success', msg: 'Le dernier pion adverse est tombé : nulle !' };
        if (n >= ex.hold) return { state: 'success', msg: `Nulle assurée : vous avez tenu ${ex.hold} coups sans céder.` };
    }
    // Coup juste qui s'écarte de la méthode (Philidor, Vancura) : conseil.
    const rule = ex.rules ? _egRules(ex).check(st, m) : null;
    return { state: 'continue', note: rule && rule.msg ? rule.msg : '' };
}

async function _egPlayJudged(from, to, promo) {
    const s = endgameState, ex = s.ex, token = s.token;
    const fen = _egFen(), st = _egCur();
    const m   = EG.mk(from, to, promo ? _egPromoCode(promo) : 0);
    const uci = moveToStr(from, to, promo);
    const san = _egSan(from, to, promo);
    if (!s.tried) { s.tried = true; _egBump(ex.id, p => { p.tries++; }); }
    s.moves++; s.hintLevel = 0; s.busy = true;
    _commitMove(from, to, promo, null, `${san} — vérification…`, 'info');
    renderEndgameCard();
    const v = await EndgameJudge.judgeMove(fen, uci).catch(() => null);
    if (token !== s.token) return;                              // exercice quitté ou recommencé entre-temps
    if (v) { s.source = v.source; s.exact = v.exact; }
    const res = _egJudgedOutcome(ex, st, m, v, s.moves);
    const est = v && !v.exact ? ' (verdict estimé)' : '';
    if (res.state === 'fail') {
        s.errors++; s.failed = res; s.verdict = res.verdict || null;
        setStatus(`✗ ${san} — ${res.msg}${est}`, 'err');
        playSound('error');
        renderEndgameCard();
        return;
    }
    if (res.state === 'success') { setStatus(`✓ ${san} — ${res.msg}`, 'ok'); _egFinish(res.msg); return; }
    setStatus(`✓ ${san}${v ? '' : ' — verdict indisponible (hors ligne, moteur absent)'}`, 'ok', res.note ? `Conseil : ${res.note}` : '');
    renderEndgameCard();
    // L'adversaire calcule pendant le délai de réponse.
    const pick = EndgameOpponent.pick(_egFen(), appSettings.egOpponent).catch(() => null);
    _egLater(async () => {
        const p = await pick;
        if (token !== s.token) return;
        if (!p) {
            s.failed = { msg: 'L\'adversaire ne peut pas répondre : connexion et moteur indisponibles. Réessayez plus tard.', undoable: false };
            setStatus('Adversaire indisponible.', 'err');
            renderEndgameCard();
            return;
        }
        _egReplyMove(_egParseUci(p.uci));
    }, opponentDelay(550));
}

// Indice d'un exercice jugé : pièce à jouer, puis une étape du plan, puis le coup exact.
async function _egJudgedHint() {
    const s = endgameState, ex = s.ex, token = s.token;
    s.busy = true;
    const p = await EndgameJudge.probe(_egFen()).catch(() => null);
    if (token !== s.token) return;
    s.busy = false;
    const best = p && p.moves && p.moves[0];
    const plan = ex.plan || ex.tips || [];
    let level = s.hintLevel;
    if (!best && level !== 1) level = plan.length ? 1 : -1;
    if (level === 1 && !plan.length) level = 2;
    if (level < 0) { setStatus('Aucun indice disponible hors ligne pour cette position.', 'info'); return; }
    s.hints++;
    const m = best && _egParseUci(best.uci), from = m != null ? EG.mFrom(m) : -1;
    if (level === 0) setStatus(`Indice : déplacez ${PIECE_HINT[(board[from] || '').toUpperCase()] || 'une pièce'}.`, 'hint', 'Appuyez encore pour une étape du plan.');
    else if (level === 1) { setStatus(`Plan : ${plan[s.planStep % plan.length]}`, 'hint'); s.planStep++; }
    else setStatus(`Solution : ${_egSan(from, EG.mTo(m), EG.promoLetter(m))}`, 'hint');
    s.hintLevel = Math.min(s.hintLevel + 1, 2);
    renderEndgameCard();
}

// ─── RÉPONSE AUTOMATIQUE DE L'ADVERSAIRE ──────────────────────────────────────
function _egAiReply() {
    const s = endgameState, ex = s.ex;
    if (!ex || s.over || s.failed) return;
    const st = _egCur();
    const me = ex.player === 'w' ? 1 : -1;
    let m;
    if (ex.kind === 'mate')       m = EG.searchBest(st, ex.defDepth || 4, me);      // défense du roi seul
    else if (ex.kind === 'pawns') m = _egPawnsReply(ex, st);                         // solveur de finales de pions
    else if (ex.goal === 'win')   m = EG.kpkDefense(st);                            // défense parfaite (base exacte)
    else                          m = EG.kpkTrapAttack(st);                         // attaque qui tend des pièges
    if (m == null) { _egFinish('Partie terminée.'); return; }
    _egReplyMove(m);
}

// Coup de l'adversaire joué sur l'échiquier, puis fin de partie éventuelle (mat, pat, répétition).
function _egReplyMove(m) {
    const s = endgameState, ex = s.ex;
    const from = EG.mFrom(m), to = EG.mTo(m), pr = EG.promoLetter(m);
    const san  = _egSan(from, to, pr);
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
    playSound('success');
    s.over = msg; s.busy = true; s.theory = true;
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
    s.failed = null; s.verdict = null; s.busy = false; s.hintLevel = 0;
    renderEndgameCard();
    setStatus('Coup annulé — cherchez un autre coup.', 'info');
}

// ─── INDICE (appelé par showHint) ─────────────────────────────────────────────
//   kpk, pions, exercices jugés : 1) type de pièce  2) étape du plan  3) coup exact
//   mate : conseils successifs de la fiche
function endgameHint() {
    const s = endgameState, ex = s.ex;
    if (!ex || s.busy || s.over) return;
    const st = _egCur();
    s.hints++;

    if (_egJudged(ex)) { _egJudgedHint(); return; }
    if (ex.kind === 'mate') {
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
        else                  setStatus(`Solution : ${_egSan(from, EG.mTo(good), EG.promoLetter(good))}`, 'hint');
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
        setStatus(`Solution : ${_egSan(from, EG.mTo(best.m), EG.promoLetter(best.m))}`, 'hint');
    }
    s.hintLevel = Math.min(s.hintLevel + 1, 2);
    renderEndgameCard();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { _egPhilidorCheck, _egVancuraCheck, _egJudgedOutcome };
}
