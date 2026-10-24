/**
 * modules/openings/onlineGames.js
 * ──────────────────────────────────────────────────────────────────────────
 * « Mes parties en ligne » : récupère les dernières parties d'un pseudo Chess.com ou Lichess
 * (API publiques, sans compte ni clé), les compare au répertoire actif et liste les déviations.
 *   - la couleur jouée est déduite du pseudo (en-têtes White / Black) ;
 *   - chaque partie passe par detectDeviation (gameReview.js) avec la base de cette couleur ;
 *   - une erreur d'ouverture est comptée tout de suite, une seule fois par partie (recordReviewMistake) ;
 *   - un clic sur une partie ouvre « Jouer » sur la position après le coup déviant (showReviewResult).
 * Seules les parties d'échecs classiques depuis la position initiale sont retenues.
 * Le pseudo, le site et le nombre de parties sont mémorisés sur l'appareil.
 */

'use strict';

const ONLINE_PREFS_KEY = 'chessTrainer_onlineAccount';
const ONLINE_COUNTS    = [5, 10, 20, 50];

let _online = { busy: false, rows: null, summary: null, error: '' };

function _onlinePrefs() {
    const p = dataStore.getJSON(ONLINE_PREFS_KEY, null) || {};
    const site = p.site === 'lichess' ? 'lichess' : 'chesscom';
    const fromProfile = typeof appSettings !== 'undefined' ? (site === 'lichess' ? appSettings.lichessUser : appSettings.chesscomUser) : '';
    return { site, user: typeof p.user === 'string' && p.user ? p.user : fromProfile || '',      // repli : pseudo du profil (Compte)
             count: ONLINE_COUNTS.includes(p.count) ? p.count : 20 };
}

function _saveOnlinePrefs(p) { dataStore.setJSON(ONLINE_PREFS_KEY, p); }

// ─── RÉCUPÉRATION ─────────────────────────────────────────────────────────────

async function fetchLichessGames(user, n) {
    const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${n}`
              + '&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=false&evals=false&opening=false';
    const res = await fetch(url, { headers: { Accept: 'application/x-chess-pgn' } });
    if (res.status === 404) throw new Error('user');
    if (!res.ok) throw new Error('http');
    return pgnGames(await res.text()).slice(0, n);       // Lichess peut en renvoyer davantage que `max`
}

// Chess.com : archives mensuelles, de la plus récente à la plus ancienne, jusqu'à n parties (6 mois au plus).
async function fetchChesscomGames(user, n) {
    const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`);
    if (res.status === 404) throw new Error('user');
    if (!res.ok) throw new Error('http');
    const archives = ((await res.json()).archives || []).slice(-6).reverse();
    const out = [];
    for (const url of archives) {
        const r = await fetch(url);
        if (!r.ok) continue;                                 // mois en cours parfois absent (404)
        const games = ((await r.json()).games || []).filter(g => g.rules === 'chess' && g.pgn).sort((a, b) => b.end_time - a.end_time);
        games.forEach(g => { const m = pgnMainLine(g.pgn); if (m) out.push(m); });
        if (out.length >= n) break;
    }
    return out.slice(0, n);
}

// ─── ANALYSE ──────────────────────────────────────────────────────────────────

// Couleur jouée par `user` dans la partie ('w' | 'b'), ou null s'il n'y figure pas.
function _userColor(headers, user) {
    const u = user.trim().toLowerCase();
    if ((headers.White || '').toLowerCase() === u) return 'w';
    if ((headers.Black || '').toLowerCase() === u) return 'b';
    return null;
}

// Compare chaque partie au répertoire `rep` et compte les erreurs nouvelles. Renvoie { rows, summary }.
// Une ligne : { game, color, r (detectDeviation), counted, kind: 'mistake' | 'novelty' | 'out' | 'theory' }.
function analyzeOnlineGames(games, user, rep = currentRepertoire) {
    const bases = {};
    const base  = c => bases[c] || (bases[c] = { db: readDBFor(rep, c), opp: readOppFor(rep, c), dirty: false });
    const rows  = [];
    const summary = { games: 0, mistakes: 0, newMistakes: 0, novelties: 0, theory: 0, skipped: 0 };

    games.forEach(game => {
        const color = _userColor(game.headers, user);
        const fen   = game.headers.FEN;
        if (!color || (fen && fen.split(' ')[0] !== INIT_FEN.split(' ')[0]) || !game.sans.length) { summary.skipped++; return; }
        const b = base(color);
        const r = detectDeviation(game.sans, color, b.db, b.opp);
        if (!r.moves.length) { summary.skipped++; return; }
        const d = r.deviation;
        let counted = null, kind = 'theory';
        if (d && d.by === 'me') {
            counted = recordReviewMistake(d, _gameSignature(game.headers, game.sans, color), b.db, () => { b.dirty = true; });
            kind = counted === 'none' ? 'out' : 'mistake';
        } else if (d) kind = 'novelty';
        summary.games++;
        if (kind === 'mistake') { summary.mistakes++; if (counted === 'counted') summary.newMistakes++; }
        if (kind === 'novelty' || kind === 'out') summary.novelties++;
        if (kind === 'theory') summary.theory++;
        rows.push({ game, color, r, counted, kind });
    });
    Object.keys(bases).forEach(c => { if (bases[c].dirty) dataStore.set(dbKeyFor(rep, c), JSON.stringify(bases[c].db)); });
    return { rows, summary };
}

// ─── INTERFACE ────────────────────────────────────────────────────────────────

function setReviewTab(tab) {
    _reviewTab = tab;
    ['online', 'paste'].forEach(t => {
        document.getElementById('review-tab-' + t).classList.toggle('active', t === tab);
        document.getElementById('review-pane-' + t).classList.toggle('hidden', t !== tab);
    });
    if (tab === 'online') renderOnlinePane();
}

function setOnlineSite(site) {
    _saveOnlinePrefs({ ..._onlinePrefs(), site });
    renderOnlinePane();
}

function renderOnlinePane() {
    const p = _onlinePrefs();
    ['chesscom', 'lichess'].forEach(s => document.getElementById('online-site-' + s).classList.toggle('active', s === p.site));
    const u = document.getElementById('online-user');
    if (document.activeElement !== u) u.value = p.user;
    document.getElementById('online-count').value = String(p.count);
    const btn = document.getElementById('online-fetch-btn');
    btn.disabled = _online.busy;
    btn.innerHTML = _online.busy ? 'Récupération…' : `${ico('download')} Récupérer mes parties`;
    _renderOnlineResults();
}

async function runOnlineFetch() {
    if (_online.busy) return;
    const user  = document.getElementById('online-user').value.trim();
    const count = Number(document.getElementById('online-count').value) || 20;
    const p     = { ..._onlinePrefs(), user, count };
    if (!user) { _online.error = 'Entrez votre pseudo.'; _renderOnlineResults(); return; }
    if (typeof Net !== 'undefined' && !Net.online()) { _online.error = 'Hors ligne : la récupération des parties a besoin d\'Internet.'; _renderOnlineResults(); return; }
    _saveOnlinePrefs(p);
    _online = { busy: true, rows: null, summary: null, error: '' };
    renderOnlinePane();
    try {
        const games = p.site === 'lichess' ? await fetchLichessGames(user, count) : await fetchChesscomGames(user, count);
        const res   = analyzeOnlineGames(games, user);
        _online.rows = res.rows; _online.summary = res.summary;
        if (_gameScreenShown() && gameMode === 'play') loadDB();             // erreurs comptées : base active rechargée
        if (typeof refreshTree === 'function') refreshTree();
        if (!res.rows.length) _online.error = games.length ? 'Aucune de ces parties ne se compare au répertoire (variante, position personnalisée ou pseudo absent des en-têtes).' : 'Aucune partie trouvée pour ce pseudo.';
    } catch (e) {
        _online.error = e.message === 'user' ? `Pseudo introuvable sur ${p.site === 'lichess' ? 'Lichess' : 'Chess.com'}.`
                                             : 'Impossible de joindre le site. Vérifiez votre connexion et réessayez.';
    }
    _online.busy = false;
    renderOnlinePane();
}

const _ONLINE_KIND = {
    mistake: { cls: 'err',  label: 'Erreur d\'ouverture' },
    novelty: { cls: 'hint', label: 'Nouveauté adverse' },
    out:     { cls: 'hint', label: 'Hors répertoire' },
    theory:  { cls: 'ok',   label: '100 % théorique' }
};

// Squelette calqué sur .online-summary et .online-row (6 lignes au plus : la liste dépasse rarement l'écran).
function _onlineSkeleton(count) {
    const widths = [58, 44, 66, 50, 38, 62];
    const rows = widths.slice(0, Math.min(count, widths.length)).map(w => `<div class="online-row sk-row" aria-hidden="true">
            <span class="sk sk-glyph"></span>
            <span class="online-main"><span class="sk sk-line" style="width:${w}%"></span><span class="sk sk-line sk-small"></span></span>
            <span class="sk sk-pill"></span>
          </div>`).join('');
    return `<span class="sr-only">Récupération et analyse des parties…</span>
        <div class="online-summary" aria-hidden="true"><span class="sk sk-line" style="width:180px"></span></div>
        <div class="online-list">${rows}</div>`;
}

function _renderOnlineResults() {
    const box = document.getElementById('online-results');
    box.setAttribute('aria-busy', String(_online.busy));
    if (_online.busy) { box.innerHTML = _onlineSkeleton(Number(document.getElementById('online-count').value) || 20); return; }
    if (_online.error) { box.innerHTML = `<div class="pgn-note err">${escapeHtml(_online.error)}</div>`; return; }
    if (!_online.rows) { box.innerHTML = ''; return; }
    const s  = _online.summary, pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
    let html = `<div class="online-summary">
        <span><b>${pl(s.games, 'partie', 'parties')}</b></span>
        <span class="err">${pl(s.mistakes, 'erreur', 'erreurs')} d'ouverture${s.newMistakes !== s.mistakes ? ` (${s.newMistakes} nouvelle${s.newMistakes > 1 ? 's' : ''})` : ''}</span>
        <span class="hint">${pl(s.novelties, 'nouveauté', 'nouveautés')} adverse${s.novelties > 1 ? 's' : ''}</span>
        <span class="ok">${s.theory} théorique${s.theory > 1 ? 's' : ''}</span>
        ${s.skipped ? `<span>${s.skipped} ignorée${s.skipped > 1 ? 's' : ''}</span>` : ''}</div>`;
    const order = { mistake: 0, novelty: 1, out: 2, theory: 3 };
    const rows  = _online.rows.map((row, i) => ({ row, i })).sort((a, b) => order[a.row.kind] - order[b.row.kind]);
    html += '<div class="online-list">' + rows.map(({ row, i }) => {
        const h = row.game.headers, d = row.r.deviation, k = _ONLINE_KIND[row.kind];
        const opp  = row.color === 'w' ? h.Black : h.White;
        const date = (h.UTCDate || h.Date || '').replace(/\./g, '-');
        const res  = h.Result === '1/2-1/2' ? '½' : (h.Result === '1-0') === (row.color === 'w') ? 'gain' : h.Result === '*' ? '' : 'perte';
        const at   = d ? _plyLabel(d.ply, row.r.moves[d.ply].san) : '';
        return `<button class="online-row" data-action="openOnlineGame" data-arg="${i}">
            <span class="glyph" data-glyph="${row.color === 'w' ? 'K' : 'k'}"></span>
            <span class="online-main"><b>${escapeHtml(opp || '?')}</b><small>${escapeHtml(date)}${res ? ' · ' + res : ''}</small></span>
            <span class="online-verdict ${k.cls}">${k.label}${at ? ` · ${escapeHtml(at)}` : ''}${row.counted === 'counted' ? ' · comptée' : ''}</span>
          </button>`;
    }).join('') + '</div>';
    box.innerHTML = html;
    if (typeof refreshGlyphs === 'function') refreshGlyphs();
}

function openOnlineGame(i) {
    const row = _online.rows && _online.rows[Number(i)];
    if (!row) return;
    closeGameReview();
    closeData();
    openPlay(row.color);
    showReviewResult(row.r, row.counted);
}

registerActions({ openOnlineGame });
