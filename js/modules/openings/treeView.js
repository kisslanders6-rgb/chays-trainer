/**
 * modules/openings/treeView.js
 * ──────────────────────────────────────────────────────────────────────────
 * Visualiseur d'arbre du répertoire actif (onglet « 🌳 Arbre » du panneau latéral).
 *   ● mes coups (enregistrés)      ○ réponses adverses
 *   ⚠️ Non couvert : réponse adverse connue (jouée ou importée) sans réponse de mon camp.
 * Un clic sur un nœud charge la position APRÈS ce coup, avec la ligne complète dans
 * l'historique : sur un « non couvert », il suffit de jouer sa réponse pour l'enregistrer.
 * Indentation : elle n'augmente que lorsque l'adversaire a plusieurs réponses (variantes).
 * Édition : le bouton ⋯ d'un de mes coups ouvre « Remplacer » (le coup part à la corbeille et
 * l'échiquier se place juste avant : le prochain coup joué devient la référence) et « Supprimer ».
 * Les coups « isolés » (non rattachés à la position de départ) peuvent être envoyés à la corbeille.
 * Maîtrise : mes coups sont colorés selon leur niveau (mêmes seuils que les Statistiques) et chaque
 * départ de variante porte une petite barre : part de coups maîtrisés / fragiles / à retravailler en aval.
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
let _treeActionsFor = null;      // chemin (texte) de la ligne dont les actions ⋯ sont ouvertes

const TREE_FOCUS_KEY = 'chessTrainer_treeFocus';
let _treeFocus = true;
_treeFocus = dataStore.get(TREE_FOCUS_KEY) !== '0';

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
        const row = { kind: 'me', san: e.san, ply: mp.length, depth, path: mp, key: null, entryKey: key,
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

    const isolatedKeys = Object.keys(openingDB).filter(k => !seen.has(k));
    return { rows, uncovered, total: Object.keys(openingDB).length, isolated: isolatedKeys.length, isolatedKeys };
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

// ─── ÉDITION DEPUIS L'ARBRE ───────────────────────────────────────────────────

// Remplacer : le coup (et, au choix, ses suites devenues inaccessibles) part à la corbeille, puis
// l'échiquier se place juste avant : le prochain coup joué devient la nouvelle référence.
function replaceTreeMove(r) {
    confirmDeleteEntry(r.entryKey, `Remplacer ${_treeLabel(r)} ? L'ancien coup est conservé 30 jours dans la corbeille ; vous jouerez ensuite le nouveau.`, extra => {
        _treeActionsFor = null;
        loadPositionFromPath(r.path.slice(0, -1));
        renderTree(true);
        setStatus(`Remplacement de ${formatSan(r.san, r.ply % 2 === 1 ? 'w' : 'b')}`, 'new', 'Jouez le nouveau coup.' + (extra ? ` ${extra} coup(s) orphelin(s) nettoyé(s).` : ''));
    });
}

function deleteTreeMove(r) {
    confirmDeleteEntry(r.entryKey, `Placer ${_treeLabel(r)} dans la corbeille ? Il restera restaurable pendant 30 jours.`, extra => {
        _treeActionsFor = null;
        renderTree(true);
        setStatus(`${_treeLabel(r)} supprimé`, 'info', (extra ? `Avec ${extra} coup(s) orphelin(s). ` : '') + 'Restaurable 30 jours depuis la corbeille.');
    });
}

// Ouvre la réponse non couverte suivante (dans l'ordre de l'arbre, après la position affichée ; on boucle).
function gotoNextUncovered() {
    const rows = _treeRows, cur = _findCurrentIndex(rows);
    const list = rows.map((r, i) => i).filter(i => rows[i].kind === 'opp' && !rows[i].covered);
    if (!list.length) return;
    const i = list.find(i => i > cur) ?? list[0];
    openTreeNode(i);
    setStatus(`Non couvert ${list.indexOf(i) + 1}/${list.length} : ${_treeLabel(rows[i])}`, 'hint', 'Jouez votre réponse pour l\'enregistrer.');
}

function cleanIsolatedMoves() {
    const keys = (_treeData && _treeData.isolatedKeys) || [];
    if (!keys.length) return;
    askConfirm(`Placer ${keys.length} coup${keys.length > 1 ? 's isolés' : ' isolé'} dans la corbeille ? Ces coups ne sont rattachés à aucune ligne partant de la position de départ. Ils restent restaurables pendant 30 jours.`, () => {
        if (_deleteEntries(keys)) renderTree(true);
    });
}

// ─── RENDU ────────────────────────────────────────────────────────────────────

// Niveau de chaque coup (r.lv) et, pour les départs de variantes, répartition des niveaux en aval (r.mix).
function _computeMastery(rows) {
    const lvOf = r => !r.attempts ? 'mastered' : typeof _level === 'function' ? _level(r) : (r.failures ? 'weak' : 'mastered');
    const ps = rows.map(r => r.path.join(' '));
    rows.forEach(r => { if (r.kind === 'me' && !r.ref) r.lv = lvOf(r); });
    rows.forEach((r, i) => {
        if (!(i === 0 || r.branch)) return;
        const mix = { mastered: 0, fragile: 0, weak: 0 };
        for (let j = i; j < rows.length && (j === i || ps[j].startsWith(ps[i] + ' ')); j++) if (rows[j].lv) mix[rows[j].lv]++;
        if (mix.mastered + mix.fragile + mix.weak > 1) r.mix = mix;
    });
}

function _masteryBar(mix) {
    const n = mix.mastered + mix.fragile + mix.weak, pct = Math.round(100 * mix.mastered / n);
    const segs = ['mastered', 'fragile', 'weak'].filter(l => mix[l]).map(l => `<i class="${l}" style="flex:${mix[l]}"></i>`).join('');
    return `<span class="tree-mbar" title="Cette variante : ${pct} % de coups maîtrisés (${n} coups${mix.weak ? `, ${mix.weak} à retravailler` : ''})">${segs}</span>`;
}

function _treeLabel(r) {
    const n = Math.ceil(r.ply / 2);
    const san = formatSan(r.san, r.ply % 2 === 1 ? 'w' : 'b');
    return r.ply % 2 === 1 ? `${n}. ${san}` : `${n}... ${san}`;
}

function renderTree(rebuild) {
    const el = document.getElementById('tree-view');
    if (!el) return;
    const scrollTop = el.scrollTop;
    if (rebuild !== false || !_treeData) { _treeData = buildRepertoireTree(); _computeMastery(_treeData.rows); }
    const t = _treeData;
    _treeRows = t.rows;

    if (!t.total) {
        el.innerHTML = '<div class="tree-empty">Répertoire vide — jouez des coups pour construire l\'arbre.</div>';
        return;
    }
    if (!t.rows.length) {
        el.innerHTML = `<div class="tree-empty">Aucune ligne rattachée à la position de départ (${t.total} coup(s) isolé(s)).
            <br><button class="tree-clean" data-clean="1">${ico('trash')} Mettre à la corbeille</button></div>`;
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
        ${t.uncovered ? `<button class="tree-warn-text tree-goto" data-goto-uncovered="1" title="Aller à la prochaine réponse non couverte">${ico('alert-triangle')} ${t.uncovered} non couvert${t.uncovered > 1 ? 's' : ''} ${ico('chevron-right')}</button>` : `<span class="tree-ok-text">${ico('check')} Rien de non couvert</span>`}
        ${t.isolated > 0 ? `<span title="Coups non rattachés à la position de départ">${t.isolated} isolé${t.isolated > 1 ? 's' : ''} <button class="tree-clean" data-clean="1">Nettoyer</button></span>` : ''}
    </div>`;

    t.rows.forEach((r, i) => {
        if (r.hide) return;
        const cls = ['tree-row', r.kind, r.branch ? 'branch' : '', r.covered === false ? 'uncovered' : '', r.lv ? 'lv-' + r.lv : '',
                     i === curIdx ? 'current' : '', (!r.reach && _treeFocus) ? 'unreach' : ''].filter(Boolean).join(' ');
        let lead = '', badges = '';
        if (r.fold && r.fold.count > 0) {
            lead   = `<button class="tree-caret" data-fold="${i}" aria-label="Replier ou déplier">${r.fold.expanded ? '▾' : '▸'}</button>`;
            if (!r.fold.expanded) badges += `<span class="tree-fold-count">+${r.fold.count}</span>`;
        }
        const open = r.kind === 'me' && _treeActionsFor === r.path.join(' ');
        if (r.kind === 'me') {
            if (r.ref) badges += '<span class="tree-ref">↪ transposition</span>';
            if (r.attempts && r.failures) badges += `<span class="tree-err">${Math.round(100 * r.failures / r.attempts)}%</span>`;
            badges += `<button class="tree-more ${open ? 'open' : ''}" data-more="${i}" title="Remplacer ou supprimer ce coup" aria-label="Actions sur ce coup" aria-expanded="${open}">${ico('more-horizontal')}</button>`;
        } else if (!r.covered) {
            badges += `<span class="tree-pill">${ico('alert-triangle')} Non couvert</span><button class="tree-forget" data-forget="${i}" title="Oublier cette réponse adverse" aria-label="Oublier">${ico('x')}</button>`;
        }
        html += `<div class="${cls}" style="--d:${r.depth}" data-i="${i}">${lead}<i class="tree-dot ${r.kind}"></i><span class="tree-move">${escapeHtml(_treeLabel(r))}</span>${r.mix ? _masteryBar(r.mix) : ''}${badges}</div>`;
        if (open) html += `<div class="tree-actions" style="--d:${r.depth}">
            <button class="btn btn-tool" data-replace="${i}">${ico('pencil')} Remplacer</button>
            <button class="btn btn-tool is-danger" data-delete="${i}">${ico('trash')} Supprimer</button></div>`;
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
        setStatus('Réponse non couverte', 'hint', 'Jouez votre réponse pour l\'enregistrer.');
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
        dataStore.set(TREE_FOCUS_KEY, _treeFocus ? '1' : '0');
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
    const more = e.target.closest('[data-more]');
    if (more) {
        const r = _treeRows[Number(more.dataset.more)], p = r && r.path.join(' ');
        _treeActionsFor = _treeActionsFor === p ? null : p;
        const el = document.getElementById('tree-view'), st = el.scrollTop;
        renderTree(false);
        el.scrollTop = st;
        return;
    }
    const act = e.target.closest('[data-replace],[data-delete]');
    if (act) {
        const r = _treeRows[Number(act.dataset.replace ?? act.dataset.delete)];
        if (r) (act.dataset.replace !== undefined ? replaceTreeMove : deleteTreeMove)(r);
        return;
    }
    if (e.target.closest('[data-clean]')) { cleanIsolatedMoves(); return; }
    if (e.target.closest('[data-goto-uncovered]')) { gotoNextUncovered(); return; }
    const f = e.target.closest('[data-forget]');
    if (f) {
        const r = _treeRows[Number(f.dataset.forget)];
        if (r && forgetOppReply(r.posKey, r.uci)) { saveOpp(); renderTree(true); }
        return;
    }
    const row = e.target.closest('.tree-row');
    if (row) openTreeNode(Number(row.dataset.i));
});
