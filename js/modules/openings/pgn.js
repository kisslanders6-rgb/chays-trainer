/**
 * modules/openings/pgn.js
 * ──────────────────────────────────────────────────────────────────────────
 * Import PGN (variantes comprises) dans le répertoire actif, et export PGN du répertoire.
 */

'use strict';

// ─── IMPORT PGN ───────────────────────────────────────────────────────────────
// Lecture d'un PGN (ligne principale + variantes imbriquées) et fusion dans la base
// du répertoire/couleur actifs :
//   - coup de MON camp : créé s'il n'existe pas (attempts 1, failures 0, lastReviewed now) ;
//     identique → rien ; différent → CONFLIT : l'entrée existante est conservée et le reste
//     de cette ligne est ignoré (il dépendrait d'un coup que le répertoire n'a pas retenu).
//   - coup ADVERSE : jamais stocké — il ouvre simplement une branche (la position suivante).
//   - une « branche » = une ligne (principale ou variante) ayant apporté au moins un nouveau coup.

function _pgnTokenize(text) {
    const toks = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
        const c = text[i];
        if (c === '{') { const j = text.indexOf('}', i); i = j < 0 ? n : j + 1; continue; }
        if (c === ';' || (c === '%' && (i === 0 || text[i - 1] === '\n'))) {
            const j = text.indexOf('\n', i); i = j < 0 ? n : j + 1; continue;
        }
        if (c === '[') {                                          // tag : [Nom "valeur"]
            let j = i + 1, inQ = false;
            while (j < n && (inQ || text[j] !== ']')) { if (text[j] === '"') inQ = !inQ; j++; }
            toks.push({ type: 'tag', text: text.slice(i + 1, j) });
            i = j + 1; continue;
        }
        if (c === '(') { toks.push({ type: '(' }); i++; continue; }
        if (c === ')') { toks.push({ type: ')' }); i++; continue; }
        if (/\s/.test(c)) { i++; continue; }
        let j = i;
        while (j < n && !/[\s(){};\[]/.test(text[j])) j++;
        let w = text.slice(i, j);
        i = j;
        if (/^\$\d+$/.test(w)) continue;                          // NAG
        if (['1-0', '0-1', '1/2-1/2', '*'].includes(w)) { toks.push({ type: 'result' }); continue; }
        w = w.replace(/^\d+(\.{1,3}|…)/, '').replace(/^\.+/, '').replace(/[!?]+$/, '');
        if (w.length >= 2 && /^[A-Za-z0-9-]/.test(w)) toks.push({ type: 'move', san: w });
    }
    return toks;
}

function _pgnSplitGames(toks) {
    const games = [];
    let cur = { headers: {}, toks: [] };
    const flush = () => { if (cur.toks.some(t => t.type === 'move')) games.push(cur); cur = { headers: {}, toks: [] }; };
    toks.forEach(t => {
        if (t.type === 'tag') {
            if (cur.toks.length) flush();                         // un tag après du texte de coups = nouvelle partie
            const m = /^(\w+)\s+"(.*)"$/.exec(t.text.trim());
            if (m) cur.headers[m[1]] = m[2];
        } else {
            cur.toks.push(t);
            if (t.type === 'result') flush();
        }
    });
    flush();
    return games;
}

// Arbre : une ligne = [{ san, vars: [ligne, ...] }] ; vars = alternatives au coup concerné.
function _pgnParseLine(toks, ptr, top) {
    const moves = [];
    while (ptr.i < toks.length) {
        const t = toks[ptr.i++];
        if (t.type === 'move') moves.push({ san: t.san, vars: [] });
        else if (t.type === '(') {
            const sub = _pgnParseLine(toks, ptr, false);
            if (moves.length) moves[moves.length - 1].vars.push(sub);
        } else if (t.type === ')' && !top) return moves;
    }
    return moves;
}

// SAN → UCI dans la position courante du moteur (null si illisible, illégal ou ambigu).
function _resolveSan(raw) {
    const san  = raw.replace(/[+#!?]+$/g, '').trim();
    const side = turn;

    const castle = /^[O0]-[O0](-[O0])?$/.exec(san);
    if (castle) {
        const kingFrom = board.indexOf(side === 'w' ? 'K' : 'k');
        if (kingFrom < 0) return null;
        const to = kingFrom + (castle[1] ? -2 : 2);
        return getLegalMoves(kingFrom).includes(to) ? moveToStr(kingFrom, to, '') : null;
    }

    const m = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=?([QRBN]))?$/.exec(san);
    if (!m) return null;
    const type = m[1] || 'P', dest = squareToIdx(m[5]), capture = !!m[4];
    const cands = [];
    for (let from = 0; from < 64; from++) {
        const p = board[from];
        if (!p || p.toUpperCase() !== type || isWhite(p) !== (side === 'w')) continue;
        if (m[2] && 'abcdefgh'[from % 8] !== m[2]) continue;
        if (m[3] && Math.floor(from / 8) + 1 !== Number(m[3])) continue;
        if (type === 'P' && !m[2] && ((from % 8 === dest % 8) === capture)) continue;
        if (!getRawMoves(from).includes(dest) || !getLegalMoves(from).includes(dest)) continue;
        cands.push(from);
    }
    if (cands.length !== 1) return null;
    const from = cands[0];
    let promo = isPromotion(from, dest) ? (m[6] ? m[6].toLowerCase() : 'q') : '';
    return moveToStr(from, dest, promo);
}

function _engineState()    { return { board: board.slice(), turn, castlingRights: { ...castlingRights }, enPassant }; }
function _restoreEngine(s) { board = s.board.slice(); turn = s.turn; castlingRights = { ...s.castlingRights }; enPassant = s.enPassant; }

// Traite un coup AVANT son application. Renvoie 'new' | 'same' | 'conflict' | 'opp'.
function _importPgnMove(uci, path, ctx) {
    if (turn !== playerColor) {                                  // coup adverse : jamais stocké dans la base,
        if (recordOppReply(positionKey(), uci)) ctx.oppAdded = true;   // mais mémorisé comme réponse connue
        return 'opp';
    }
    const key = positionKey();
    const e   = openingDB[key];
    const { from, to, promo } = _parseUci(uci);
    const san = toAlgebraic(from, to, promo);

    if (!e) {
        const np = path.concat(uci);
        openingDB[key] = { move: uci, san, attempts: 1, failures: 0, path: np, ply: np.length, lastReviewed: Date.now() };
        ctx.added++;
        return 'new';
    }
    if (e.move === uci) {
        if (!e.path) { e.path = path.concat(uci); e.ply = e.path.length; ctx.healed = true; }
        ctx.same++;
        return 'same';
    }
    const ck = key + '|' + uci;
    if (!ctx.conflictKeys.has(ck)) {
        ctx.conflictKeys.add(ck);
        ctx.conflicts.push({ path: path.slice(), pgnSan: san, keptSan: e.san });
    }
    return 'conflict';
}

function _walkPgnLine(line, startPath, ctx) {
    let path = startPath.slice();
    let own  = 0;
    for (const mv of line) {
        const before = _engineState();
        const uci    = _resolveSan(mv.san);
        let stop = false, after = null, nextPath = path;

        if (!uci) {
            ctx.errors.push({ path: path.slice(), san: mv.san });
            stop = true;
        } else {
            const res = _importPgnMove(uci, path, ctx);
            if (res === 'new') own++;
            if (res === 'conflict') stop = true;
            else { _applyUciRaw(uci); nextPath = path.concat(uci); after = _engineState(); }
        }
        // Variantes : alternatives à CE coup, jouées depuis la position d'avant.
        mv.vars.forEach(v => { _restoreEngine(before); _walkPgnLine(v, path, ctx); });
        if (stop) break;
        _restoreEngine(after);
        path = nextPath;
    }
    if (own) ctx.branches++;
}

function importPgnText(text) {
    const ctx = { added: 0, same: 0, branches: 0, conflicts: [], conflictKeys: new Set(), errors: [], skipped: 0, games: 0, healed: false };
    const games = _pgnSplitGames(_pgnTokenize(text));
    _withEngineSnapshot(() => {
        games.forEach(g => {
            const fen = g.headers.FEN;
            if (fen && fen.split(' ')[0] !== INIT_FEN.split(' ')[0]) { ctx.skipped++; return; }   // position de départ personnalisée
            ctx.games++;
            parseFEN(INIT_FEN);
            _walkPgnLine(_pgnParseLine(g.toks, { i: 0 }, true), [], ctx);
        });
    });
    ctx.totalGames = games.length;
    if (ctx.added || ctx.healed) saveDB();
    if (ctx.oppAdded) saveOpp();
    if (ctx.added) noteChange(ctx.added);
    return ctx;
}

// ─── IMPORT PGN : MODALE ──────────────────────────────────────────────────────

let _pgnColor = 'w';

function showPgnImport() {
    document.getElementById('pgn-target').textContent = currentRepertoire;
    setPgnColor(playerColor);
    document.getElementById('pgn-text').value = '';
    document.getElementById('pgn-file-name').textContent = '';
    document.getElementById('pgn-result').innerHTML = '';
    document.getElementById('pgn-overlay').classList.remove('hidden');
}

function setPgnColor(c) {
    _pgnColor = c;
    ['w', 'b'].forEach(k => {
        const b = document.getElementById('pgn-seg-' + k);
        b.classList.toggle('active', k === c);
        b.setAttribute('aria-pressed', k === c);
    });
}

function closePgnImport() {
    document.getElementById('pgn-overlay').classList.add('hidden');
}

function onPgnFileChosen(event) {
    const file = event.target.files[0];
    if (!file) return;
    document.getElementById('pgn-file-name').textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => { document.getElementById('pgn-text').value = e.target.result; };
    reader.readAsText(file);
}

function _pgnLineLabel(path, extra) {
    return formatLinePrefix(_pathToSans(path)) + (path.length ? ' ' : '') + extra;
}

function runPgnImport() {
    const out  = document.getElementById('pgn-result');
    const text = document.getElementById('pgn-text').value.trim();
    if (!text) { out.innerHTML = '<div class="pgn-note warn">Collez du PGN ou choisissez un fichier .pgn.</div>'; return; }

    useRepertoireColor(_pgnColor);                     // la base du répertoire / de la couleur visés est chargée
    const r = importPgnText(text);
    const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
    let html = '';

    if (!r.totalGames) {
        html = '<div class="pgn-note err">Aucune partie reconnue dans ce texte.</div>';
    } else if (r.added) {
        html = `<div class="pgn-note ok">✓ Import PGN réussi : ${pl(r.added, 'nouveau coup ajouté', 'nouveaux coups ajoutés')}, ${pl(r.branches, 'branche créée', 'branches créées')}.</div>`;
    } else if (r.same || r.conflicts.length) {
        html = `<div class="pgn-note info">${ico('info')} Rien de nouveau : tous les coups de ce PGN sont déjà dans le répertoire (ou en conflit).</div>`;
    } else {
        html = '<div class="pgn-note err">Aucun coup valide trouvé dans ce PGN.</div>';
    }
    if (r.same)    html += `<div class="pgn-line">${pl(r.same, 'coup déjà connu', 'coups déjà connus')} (ignoré${r.same > 1 ? 's' : ''}).</div>`;
    if (r.skipped) html += `<div class="pgn-line">${pl(r.skipped, 'partie ignorée', 'parties ignorées')} (position de départ personnalisée).</div>`;
    if (r.conflicts.length) {
        html += `<div class="pgn-note warn">${ico('alert-triangle')} ${pl(r.conflicts.length, 'conflit', 'conflits')} : votre coup déjà enregistré a été conservé, la suite de la ligne n'a pas été importée.</div><ul class="pgn-list">`;
        r.conflicts.slice(0, 10).forEach(c => {
            html += `<li>${escapeHtml(_pgnLineLabel(c.path, ''))}<br>PGN : <strong>${escapeHtml(c.pgnSan)}</strong> · conservé : <strong>${escapeHtml(c.keptSan)}</strong></li>`;
        });
        if (r.conflicts.length > 10) html += `<li>… et ${r.conflicts.length - 10} autre(s)</li>`;
        html += '</ul>';
    }
    if (r.errors.length) {
        html += `<div class="pgn-note warn">${ico('alert-triangle')} ${pl(r.errors.length, 'coup illisible ou illégal', 'coups illisibles ou illégaux')} (ligne abandonnée à cet endroit) :</div><ul class="pgn-list">`;
        r.errors.slice(0, 8).forEach(e => { html += `<li>${escapeHtml(_pgnLineLabel(e.path, ''))}<strong>${escapeHtml(e.san)}</strong></li>`; });
        if (r.errors.length > 8) html += `<li>… et ${r.errors.length - 8} autre(s)</li>`;
        html += '</ul>';
    }
    out.innerHTML = html;
    if (typeof refreshTree === 'function') refreshTree();
}

// ─── EXPORT PGN ───────────────────────────────────────────────────────────────
// Le répertoire actif devient un fichier .pgn : une « partie » par couleur (si elle n'est pas vide),
// toutes les lignes en variantes. Ligne principale = la branche la plus développée.
// Les entrées sans chemin connu (anciennes entrées non rattachées) ne peuvent pas être exportées.

function _pgnTree(db) {
    const root = { kids: new Map(), size: 0 };
    let skipped = 0;
    Object.values(db).forEach(e => {
        if (!e.path || !e.path.length) { skipped++; return; }
        let n = root;
        e.path.forEach(u => {
            if (!n.kids.has(u)) n.kids.set(u, { kids: new Map(), size: 0 });
            n = n.kids.get(u);
        });
    });
    const size = n => (n.size = [...n.kids.values()].reduce((s, k) => s + 1 + size(k), 0));
    size(root);
    return { root, skipped };
}

const _pgnNum = (ply, force) => ply % 2 === 0 ? `${ply / 2 + 1}. ` : (force ? `${Math.floor(ply / 2) + 1}... ` : '');

// Coups depuis `node` (le moteur est dans la position de `node`), au format PGN avec variantes.
function _pgnMovetext(node, ply, forceNum) {
    const kids = [...node.kids.entries()].sort((a, b) => b[1].size - a[1].size);
    if (!kids.length) return '';
    const before = _engineState();
    const [mainUci, mainNode] = kids[0];
    const out = _pgnNum(ply, forceNum) + _applyUciRaw(mainUci);
    const afterMain = _engineState();
    let vars = '';
    kids.slice(1).forEach(([uci, child]) => {
        _restoreEngine(before);
        const san  = _applyUciRaw(uci);
        const rest = _pgnMovetext(child, ply + 1, false);
        vars += ` (${_pgnNum(ply, true)}${san}${rest ? ' ' + rest : ''})`;
    });
    _restoreEngine(afterMain);
    const rest = _pgnMovetext(mainNode, ply + 1, !!vars);
    return out + vars + (rest ? ' ' + rest : '');
}

function _pgnWrap(text, width = 80) {
    const lines = [];
    let cur = '';
    text.split(' ').forEach(w => {
        if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; }
        else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) lines.push(cur);
    return lines.join('\n');
}

// Texte PGN d'un répertoire ; { pgn, games, skipped }.
function repertoirePgn(rep) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const tag  = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    let pgn = '', games = 0, skipped = 0;
    ['w', 'b'].forEach(color => {
        const t = _pgnTree(readDBFor(rep, color));
        skipped += t.skipped;
        if (!t.root.kids.size) return;
        const moves = _withEngineSnapshot(() => { parseFEN(INIT_FEN); return _pgnMovetext(t.root, 0, false); });
        const side  = color === 'w' ? 'Blancs' : 'Noirs';
        pgn += `[Event "${tag(`Répertoire ${rep} (${side})`)}"]\n[Site "Chays Trainer"]\n[Date "${date}"]\n` +
               `[White "${color === 'w' ? tag(rep) : '?'}"]\n[Black "${color === 'b' ? tag(rep) : '?'}"]\n[Result "*"]\n\n` +
               _pgnWrap(moves + ' *') + '\n\n';
        games++;
    });
    return { pgn, games, skipped };
}

function exportPgn() {
    const { pgn, games, skipped } = repertoirePgn(currentRepertoire);
    if (!games) { alert(`Le répertoire « ${currentRepertoire} » ne contient aucune ligne exportable.`); return; }
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `Repertoire_${currentRepertoire.replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${new Date().toISOString().slice(0, 10)}.pgn`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (skipped) setTimeout(() => alert(`${skipped} coup(s) sans ligne connue depuis la position de départ n'ont pas pu être exportés.`), 50);
}
