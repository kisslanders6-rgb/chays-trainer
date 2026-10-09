/**
 * modules/openings/treeView.js
 * ──────────────────────────────────────────────────────────────────────────
 * Visualiseur d'arbre du répertoire actif (onglet « 🌳 Arbre » du panneau latéral).
 *   ● mes coups (enregistrés)      ○ réponses adverses
 *   ⚠️ Non couvert : réponse adverse connue (jouée ou importée) sans réponse de mon camp.
 * Un clic sur un nœud charge la position APRÈS ce coup, avec la ligne complète dans
 * l'historique : sur un « non couvert », il suffit de jouer sa réponse pour l'enregistrer.
 * Indentation : elle n'augmente que lorsque l'adversaire a plusieurs réponses (variantes).
 */

'use strict';

let sideTab   = 'moves';        // préférence de l'utilisateur : 'moves' | 'tree'
let _treeRows = [];
let _treeTimer = null;

// ─── ONGLETS DU PANNEAU LATÉRAL ───────────────────────────────────────────────

function showSideTab(tab) { sideTab = tab; _applySideTab(); }

function _applySideTab() {
    const eff = gameMode === 'play' ? sideTab : 'moves';      // l'arbre n'existe qu'en mode Jouer
    document.getElementById('side-tab-moves').classList.toggle('active', eff === 'moves');
    document.getElementById('side-tab-tree').classList.toggle('active', eff === 'tree');
    document.getElementById('moves-bar').classList.toggle('hidden', eff !== 'moves');
    document.getElementById('tree-view').classList.toggle('hidden', eff !== 'tree');
    if (eff === 'tree' && document.getElementById('game-screen').style.display !== 'none') renderTree();
}

function refreshTree() {                                      // rafraîchissement différé, seulement si visible
    if (sideTab !== 'tree' || gameMode !== 'play') return;
    clearTimeout(_treeTimer);
    _treeTimer = setTimeout(renderTree, 200);
}

// ─── CONSTRUCTION DE L'ARBRE ──────────────────────────────────────────────────

function buildRepertoireTree() {
    const rows = [];
    const seen = new Set();                                   // entrées déjà développées (transpositions)
    let uncovered = 0;

    // Réponses adverses connues après `path` : déjà couvertes par ma base, ou jouées/importées.
    function repliesAfter(path) {
        try {
            return _withEngineSnapshot(() => {
                parseFEN(INIT_FEN);
                path.forEach(_applyUciRaw);
                const posKey = positionKey();
                const known  = oppSeen[posKey] || [];
                const out = [];
                _forEachChild((uci, san) => {
                    const childKey = positionKey();
                    const covered  = !!openingDB[childKey];
                    if (covered || known.includes(uci)) out.push({ uci, san, childKey, covered, posKey });
                });
                return out.sort((a, b) => (b.covered - a.covered) || a.san.localeCompare(b.san));
            });
        } catch (e) { return []; }
    }

    function addReplies(path, depth) {
        const reps   = repliesAfter(path);
        const branch = reps.length > 1;
        const d      = depth + (branch ? 1 : 0);
        reps.forEach(r => {
            const rp = path.concat(r.uci);
            rows.push({ kind: 'opp', san: r.san, ply: rp.length, depth: d, path: rp,
                        covered: r.covered, posKey: r.posKey, uci: r.uci, branch });
            if (r.covered) addMe(r.childKey, rp, d); else uncovered++;
        });
    }

    function addMe(key, path, depth) {
        const e  = openingDB[key];
        const mp = path.concat(e.move);
        const row = { kind: 'me', san: e.san, ply: mp.length, depth, path: mp,
                      attempts: e.attempts, failures: e.failures, ref: seen.has(key) };
        rows.push(row);
        if (row.ref) return;                                  // transposition : déjà développée plus haut
        seen.add(key);
        addReplies(mp, depth);
    }

    const initKey = _withEngineSnapshot(() => { parseFEN(INIT_FEN); return positionKey(); });
    if (playerColor === 'w') { if (openingDB[initKey]) addMe(initKey, [], 0); }
    else addReplies([], 0);                                   // Noirs : on part des premiers coups adverses

    const total = Object.keys(openingDB).length;
    return { rows, uncovered, total, isolated: total - seen.size };
}

// ─── RENDU ────────────────────────────────────────────────────────────────────

function _treeLabel(r) {
    const n = Math.ceil(r.ply / 2);
    return r.ply % 2 === 1 ? `${n}. ${r.san}` : `${n}... ${r.san}`;
}

function _currentPathStr() {
    return moveHistory.map(m => moveToStr(m.from, m.to, m.promo)).join(' ');
}

function renderTree() {
    const el = document.getElementById('tree-view');
    if (!el) return;
    const scroll = el.scrollTop;
    const t = buildRepertoireTree();
    _treeRows = t.rows;

    if (!t.total) {
        el.innerHTML = '<div class="tree-empty">Répertoire vide — jouez des coups pour construire l\'arbre.</div>';
        return;
    }
    if (!t.rows.length) {
        el.innerHTML = `<div class="tree-empty">Aucune ligne rattachée à la position de départ (${t.total} coup(s) isolé(s)).</div>`;
        return;
    }

    let html = `<div class="tree-summary">
        <span><i class="tree-dot me"></i> mes coups</span><span><i class="tree-dot opp"></i> adversaire</span>
        ${t.uncovered ? `<span class="tree-warn-text">⚠️ ${t.uncovered} non couvert${t.uncovered > 1 ? 's' : ''}</span>` : '<span class="tree-ok-text">✓ Rien de non couvert</span>'}
        ${t.isolated > 0 ? `<span>${t.isolated} isolé${t.isolated > 1 ? 's' : ''}</span>` : ''}
    </div>`;

    const cur = _currentPathStr();
    t.rows.forEach((r, i) => {
        const cls = ['tree-row', r.kind, r.branch ? 'branch' : '', r.covered === false ? 'uncovered' : '',
                     r.path.join(' ') === cur ? 'current' : ''].filter(Boolean).join(' ');
        let badges = '';
        if (r.kind === 'me') {
            if (r.ref) badges += '<span class="tree-ref">↪ transposition</span>';
            if (r.attempts && r.failures) badges += `<span class="tree-err">${Math.round(100 * r.failures / r.attempts)}%</span>`;
        } else if (!r.covered) {
            badges += `<span class="tree-pill">⚠️ Non couvert</span><button class="tree-forget" data-forget="${i}" title="Oublier cette réponse adverse" aria-label="Oublier">✕</button>`;
        }
        html += `<div class="${cls}" style="--d:${r.depth}" data-i="${i}"><i class="tree-dot ${r.kind}"></i><span class="tree-move">${_treeLabel(r)}</span>${badges}</div>`;
    });
    el.innerHTML = html;
    el.scrollTop = scroll;
}

function _markTreeCurrent() {
    const cur = _currentPathStr();
    document.querySelectorAll('#tree-view .tree-row').forEach(row => {
        const r = _treeRows[Number(row.dataset.i)];
        row.classList.toggle('current', !!r && r.path.join(' ') === cur);
    });
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
    _markTreeCurrent();
    if (window.innerWidth < 920) document.getElementById('board').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

document.getElementById('tree-view').addEventListener('click', e => {
    const f = e.target.closest('[data-forget]');
    if (f) {
        const r = _treeRows[Number(f.dataset.forget)];
        if (r && forgetOppReply(r.posKey, r.uci)) { saveOpp(); renderTree(); }
        return;
    }
    const row = e.target.closest('.tree-row');
    if (row) openTreeNode(Number(row.dataset.i));
});
