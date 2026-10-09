/**
 * modules/openings/treeView.js
 * ──────────────────────────────────────────────────────────────────────────
 * Visualiseur d'arbre du répertoire actif (onglet « 🌳 Arbre » du panneau latéral).
 *   ● mes coups (enregistrés)      ○ réponses adverses
 *   ⚠️ Non couvert : réponse adverse connue (jouée ou importée) sans réponse de mon camp.
 * Un clic sur un nœud charge la position APRÈS ce coup, avec la ligne complète dans
 * l'historique : sur un « non couvert », il suffit de jouer sa réponse pour l'enregistrer.
 * Indentation : elle n'augmente que lorsque l'adversaire a plusieurs réponses (variantes).
 *
 * Deux vues :
 *   « Depuis ici »   : seuls le chemin menant à la position affichée, la position elle-même
 *                      et ses suites restent dépliés ; les autres branches sont repliées
 *                      sur une ligne (▸ +N), dépliables à la demande.
 *   « Vue complète » : tout l'arbre.
 * La ligne de la position affichée est surlignée et recentrée automatiquement.
 */

'use strict';

let sideTab    = 'moves';        // préférence de l'utilisateur : 'moves' | 'tree'
let _treeRows  = [];
let _treeData  = null;           // arbre construit (invalidé par refreshTree)
let _treeTimer = null;
let _syncTimer = null;
const _expandedBranches = new Set();

const TREE_FOCUS_KEY = 'chessTrainer_treeFocus';
let _treeFocus = true;
try { _treeFocus = localStorage.getItem(TREE_FOCUS_KEY) !== '0'; } catch (e) {}

// ─── ONGLETS DU PANNEAU LATÉRAL ───────────────────────────────────────────────

function showSideTab(tab) { sideTab = tab; _applySideTab(); }

function _applySideTab() {
    const eff = gameMode === 'play' ? sideTab : 'moves';      // l'arbre n'existe qu'en mode Jouer
    document.getElementById('side-tab-moves').classList.toggle('active', eff === 'moves');
    document.getElementById('side-tab-tree').classList.toggle('active', eff === 'tree');
    document.getElementById('moves-bar').classList.toggle('hidden', eff !== 'moves');
    document.getElementById('tree-view').classList.toggle('hidden', eff !== 'tree');
    if (eff === 'tree' && document.getElementById('game-screen').style.display !== 'none') renderTree(true);
}

// Les données ont changé (coup enregistré, suppression, import…) : reconstruction différée.
function refreshTree() {
    if (sideTab !== 'tree' || gameMode !== 'play') return;
    clearTimeout(_treeTimer);
    _treeTimer = setTimeout(() => renderTree(true), 200);
}

// La position affichée a changé (coup, navigation, clic sur la barre de coups) :
// on re-surligne, replie et recentre à partir de l'arbre déjà construit.
function syncTreeToPosition() {
    if (sideTab !== 'tree' || gameMode !== 'play' || !_treeData) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => {
        if (_findCurrentIndex(_treeData.rows) >= 0) renderTree(false);
        // sinon : position nouvelle, pas encore dans l'arbre — refreshTree() prend le relais
    }, 30);
}

// ─── CONSTRUCTION DE L'ARBRE ──────────────────────────────────────────────────

function buildRepertoireTree() {
    const rows = [];
    const seen = new Set();                                   // entrées déjà développées (transpositions)
    let uncovered = 0;

    function keyAfter(path) {
        try {
            return _withEngineSnapshot(() => { parseFEN(INIT_FEN); path.forEach(_applyUciRaw); return positionKey(); });
        } catch (e) { return null; }
    }

    // Réponses adverses connues après `path` : déjà couvertes par ma base, ou jouées/importées.
    function repliesAfter(path) {
        try {
            return _withEngineSnapshot(() => {
                parseFEN(INIT_FEN);
                path.forEach(_applyUciRaw);
                const posKey = positionKey();
                const known  = oppSeen[posKey] || [];
                const list = [];
                _forEachChild((uci, san) => {
                    const childKey = positionKey();
                    const covered  = !!openingDB[childKey];
                    if (covered || known.includes(uci)) list.push({ uci, san, childKey, covered, posKey });
                });
                list.sort((a, b) => (b.covered - a.covered) || a.san.localeCompare(b.san));
                return { posKey, list };
            });
        } catch (e) { return { posKey: null, list: [] }; }
    }

    function addReplies(path, depth, list) {
        const branch = list.length > 1;
        const d      = depth + (branch ? 1 : 0);
        list.forEach(r => {
            const rp = path.concat(r.uci);
            rows.push({ kind: 'opp', san: r.san, ply: rp.length, depth: d, path: rp, key: r.childKey,
                        covered: r.covered, posKey: r.posKey, uci: r.uci, branch });
            if (r.covered) addMe(r.childKey, rp, d); else uncovered++;
        });
    }

    function addMe(key, path, depth) {
        const e  = openingDB[key];
        const mp = path.concat(e.move);
        const row = { kind: 'me', san: e.san, ply: mp.length, depth, path: mp, key: null,
                      attempts: e.attempts, failures: e.failures, ref: seen.has(key) };
        rows.push(row);
        if (row.ref) { row.key = keyAfter(mp); return; }      // transposition : déjà développée plus haut
        seen.add(key);
        const rr = repliesAfter(mp);
        row.key = rr.posKey;
        addReplies(mp, depth, rr.list);
    }

    const initKey = _withEngineSnapshot(() => { parseFEN(INIT_FEN); return positionKey(); });
    if (playerColor === 'w') { if (openingDB[initKey]) addMe(initKey, [], 0); }
    else addReplies([], 0, repliesAfter([]).list);            // Noirs : on part des premiers coups adverses

    const total = Object.keys(openingDB).length;
    return { rows, uncovered, total, isolated: total - seen.size };
}

// ─── POSITION AFFICHÉE ────────────────────────────────────────────────────────

function _displayedPath() {                                   // tient compte de la navigation ◀ ▶
    const n = navCursor === -1 ? moveHistory.length : (navCursor === NAV_START ? 0 : navCursor + 1);
    return moveHistory.slice(0, n).map(m => moveToStr(m.from, m.to, m.promo));
}

// Ligne de l'arbre correspondant à la position affichée : chemin identique, sinon même position
// (transposition) en préférant la ligne développée.
function _findCurrentIndex(rows) {
    const path = _displayedPath();
    const ps   = path.join(' ');
    let i = rows.findIndex(r => r.path.join(' ') === ps);
    if (i >= 0) return i;
    const key = _withEngineSnapshot(() => { parseFEN(INIT_FEN); path.forEach(_applyUciRaw); return positionKey(); });
    i = rows.findIndex(r => r.key === key && !r.ref);
    return i >= 0 ? i : rows.findIndex(r => r.key === key);
}

// ─── REPLI DES BRANCHES INACCESSIBLES ─────────────────────────────────────────

function _applyFocus(rows, curIdx) {
    rows.forEach(r => { r.reach = true; r.hide = false; r.fold = null; });
    if (!_treeFocus || curIdx < 0) return;

    const cp = rows[curIdx].path.join(' ');
    rows.forEach(r => {
        const p = r.path.join(' ');
        r.reach = p === cp || cp.startsWith(p + ' ') || p.startsWith(cp + ' ');   // ancêtre, courant ou suite
    });

    let i = 0;
    while (i < rows.length) {
        const r = rows[i];
        if (r.reach) { i++; continue; }
        const prefix = r.path.join(' ') + ' ';                // racine d'une branche inaccessible
        let j = i + 1;
        while (j < rows.length && rows[j].path.join(' ').startsWith(prefix)) j++;
        const expanded = _expandedBranches.has(prefix);
        r.fold = { count: j - i - 1, expanded, key: prefix };
        for (let k = i + 1; k < j; k++) rows[k].hide = !expanded;
        i = j;
    }
}

// ─── RENDU ────────────────────────────────────────────────────────────────────

function _treeLabel(r) {
    const n = Math.ceil(r.ply / 2);
    return r.ply % 2 === 1 ? `${n}. ${r.san}` : `${n}... ${r.san}`;
}

function renderTree(rebuild) {
    const el = document.getElementById('tree-view');
    if (!el) return;
    const scrollTop = el.scrollTop;
    if (rebuild !== false || !_treeData) _treeData = buildRepertoireTree();
    const t = _treeData;
    _treeRows = t.rows;

    if (!t.total) {
        el.innerHTML = '<div class="tree-empty">Répertoire vide — jouez des coups pour construire l\'arbre.</div>';
        return;
    }
    if (!t.rows.length) {
        el.innerHTML = `<div class="tree-empty">Aucune ligne rattachée à la position de départ (${t.total} coup(s) isolé(s)).</div>`;
        return;
    }

    const curIdx = _findCurrentIndex(t.rows);
    _applyFocus(t.rows, curIdx);

    let html = `<div class="tree-summary">
        <div class="tree-modes">
            <button class="tree-mode ${_treeFocus ? 'active' : ''}" data-mode="focus" title="Replie les branches inaccessibles depuis la position affichée">Depuis ici</button>
            <button class="tree-mode ${_treeFocus ? '' : 'active'}" data-mode="all" title="Affiche tout l'arbre">Vue complète</button>
        </div>
        <span><i class="tree-dot me"></i> mes coups</span><span><i class="tree-dot opp"></i> adversaire</span>
        ${t.uncovered ? `<span class="tree-warn-text">⚠️ ${t.uncovered} non couvert${t.uncovered > 1 ? 's' : ''}</span>` : '<span class="tree-ok-text">✓ Rien de non couvert</span>'}
        ${t.isolated > 0 ? `<span>${t.isolated} isolé${t.isolated > 1 ? 's' : ''}</span>` : ''}
    </div>`;

    t.rows.forEach((r, i) => {
        if (r.hide) return;
        const cls = ['tree-row', r.kind, r.branch ? 'branch' : '', r.covered === false ? 'uncovered' : '',
                     i === curIdx ? 'current' : '', (!r.reach && _treeFocus) ? 'unreach' : ''].filter(Boolean).join(' ');
        let lead = '', badges = '';
        if (r.fold && r.fold.count > 0) {
            lead   = `<button class="tree-caret" data-fold="${i}" aria-label="Replier ou déplier">${r.fold.expanded ? '▾' : '▸'}</button>`;
            if (!r.fold.expanded) badges += `<span class="tree-fold-count">+${r.fold.count}</span>`;
        }
        if (r.kind === 'me') {
            if (r.ref) badges += '<span class="tree-ref">↪ transposition</span>';
            if (r.attempts && r.failures) badges += `<span class="tree-err">${Math.round(100 * r.failures / r.attempts)}%</span>`;
        } else if (!r.covered) {
            badges += `<span class="tree-pill">⚠️ Non couvert</span><button class="tree-forget" data-forget="${i}" title="Oublier cette réponse adverse" aria-label="Oublier">✕</button>`;
        }
        html += `<div class="${cls}" style="--d:${r.depth}" data-i="${i}">${lead}<i class="tree-dot ${r.kind}"></i><span class="tree-move">${_treeLabel(r)}</span>${badges}</div>`;
    });
    el.innerHTML = html;

    const cur = el.querySelector('.tree-row.current');
    if (cur) _centerTreeRow(el, cur);
    else el.scrollTop = scrollTop;
}

// Centre la ligne courante dans la zone défilante de l'arbre (sans faire défiler la page).
function _centerTreeRow(el, row) {
    const top  = Math.max(0, row.offsetTop - (el.clientHeight - row.offsetHeight) / 2);
    const mv   = row.querySelector('.tree-move');
    const left = Math.max(0, (mv ? mv.offsetLeft : 0) - 32);
    if (el.scrollTo) el.scrollTo({ top, left, behavior: 'smooth' });
    else { el.scrollTop = top; el.scrollLeft = left; }
}

function openTreeNode(i) {
    const r = _treeRows[i];
    if (!r || gameMode !== 'play') return;
    loadPositionFromPath(r.path);
    if (r.kind === 'opp' && !r.covered) {
        setStatus('⚠️ Réponse adverse non couverte — jouez votre réponse pour l\'enregistrer.', 'hint');
    } else {
        setStatus(`Position chargée : ${_treeLabel(r)}.`, 'info');
    }
    syncTreeToPosition();
    if (window.innerWidth < 920) document.getElementById('board').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

document.getElementById('tree-view').addEventListener('click', e => {
    const mode = e.target.closest('[data-mode]');
    if (mode) {
        _treeFocus = mode.dataset.mode === 'focus';
        try { localStorage.setItem(TREE_FOCUS_KEY, _treeFocus ? '1' : '0'); } catch (err) {}
        renderTree(false);
        return;
    }
    const fold = e.target.closest('[data-fold]');
    if (fold) {
        const r = _treeRows[Number(fold.dataset.fold)];
        if (r && r.fold) {
            if (_expandedBranches.has(r.fold.key)) _expandedBranches.delete(r.fold.key); else _expandedBranches.add(r.fold.key);
            const el = document.getElementById('tree-view'), st = el.scrollTop;
            renderTree(false);
            el.scrollTop = st;                                  // on déplie sur place : pas de recentrage
        }
        return;
    }
    const f = e.target.closest('[data-forget]');
    if (f) {
        const r = _treeRows[Number(f.dataset.forget)];
        if (r && forgetOppReply(r.posKey, r.uci)) { saveOpp(); renderTree(true); }
        return;
    }
    const row = e.target.closest('.tree-row');
    if (row) openTreeNode(Number(row.dataset.i));
});
