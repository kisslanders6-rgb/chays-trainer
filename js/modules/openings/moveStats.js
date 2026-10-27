/**
 * modules/openings/moveStats.js
 * ──────────────────────────────────────────────────────────────────────────
 * Fréquences réelles des coups adverses : quelles réponses préparer en priorité.
 * Deux sources, toutes deux facultatives (sans elles, l'application fonctionne comme avant) :
 *   - VOS PARTIES : Chess.com et Lichess (Données › Mes parties en ligne) et PGN collé (Analyser une partie).
 *     Chaque partie n'est comptée qu'UNE fois, même envoyée plusieurs fois (identifiant mémorisé, cf. gameId).
 *     Stockage local « chessTrainer_gameFreq » : { games: [id…], w: { clé: { uci: n } }, b: {…} }
 *     (clé = position adversaire au trait quand je joue cette couleur ; 30 premiers demi-coups).
 *   - L'EXPLORATEUR LICHESS (parties en ligne de joueurs du même niveau). Lichess exige un jeton personnel,
 *     sans aucune autorisation, mémorisé sur cet appareil seulement (jamais synchronisé). Réponses en cache
 *     7 jours. Chess.com ne publie pas d'explorateur : il compte par vos propres parties.
 * Utilisé par : l'onglet « Adversaire » du mode Jouer (renderFreqPanel) et le tirage de l'Entraînement
 * (freqFactor, si l'option Paramètres › Jeu › « Prioriser les lignes fréquentes » est active).
 */

'use strict';

const FREQ_KEY         = 'chessTrainer_gameFreq';
const FREQ_MAX_PLY     = 30;
const FREQ_KEEP_GAMES  = 3000;
const EXPLORER_TOKEN_KEY = 'chessTrainer_lichessToken';
const EXPLORER_CACHE_KEY = 'chessTrainer_explorerCache';
const EXPLORER_CACHE_MAX = 400;
const EXPLORER_TTL_MS    = 7 * 86400000;
const EXPLORER_BANDS     = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

// ─── VOS PARTIES ──────────────────────────────────────────────────────────────

function _readFreq() {
    const o = dataStore.getJSON(FREQ_KEY, null);
    const obj = x => (x && typeof x === 'object' && !Array.isArray(x)) ? x : {};
    return { games: o && Array.isArray(o.games) ? o.games : [], w: obj(o && o.w), b: obj(o && o.b) };
}

function _hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

// Identifiant d'une partie, le même quelle que soit la façon dont elle arrive (récupération en ligne ou PGN
// collé) : lien de la partie (Chess.com : Link, Lichess : Site), sinon empreinte des joueurs, date et coups.
function gameId(headers, sans) {
    const link = headers.Link || (/^https?:\/\//.test(headers.Site || '') ? headers.Site : '');
    if (link) return link.replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/(white|black)$/, '');
    return 'h' + _hash([headers.White, headers.Black, headers.Date || headers.UTCDate, headers.UTCTime || headers.EndTime || '', sans.slice(0, 60).join(' ')].join('|'));
}

// Ajoute les réponses adverses de parties { headers, sans } jouées avec la couleur `color` (fonction de la
// partie, null = ignorée). Renvoie { added, already }.
function recordGameFrequencies(games, colorOf) {
    const f = _readFreq(), seen = new Set(f.games);
    let added = 0, already = 0;
    games.forEach(g => {
        const color = colorOf(g);
        if (!color || !g.sans || !g.sans.length) return;
        if (g.headers.FEN && g.headers.FEN.split(' ')[0] !== INIT_FEN.split(' ')[0]) return;
        const id = gameId(g.headers, g.sans);
        if (seen.has(id)) { already++; return; }
        seen.add(id);
        f.games.push(id);
        added++;
        const table = f[color];
        Chess.isolated(() => {
            parseFEN(INIT_FEN);
            for (let ply = 0; ply < Math.min(g.sans.length, FREQ_MAX_PLY); ply++) {
                const uci = _resolveSan(g.sans[ply]);
                if (!uci) break;
                if (turn !== color) {
                    const k = positionKey(), row = table[k] || (table[k] = {});
                    row[uci] = (row[uci] || 0) + 1;
                }
                _applyUciRaw(uci);
            }
        });
    });
    if (added) {
        f.games = f.games.slice(-FREQ_KEEP_GAMES);
        dataStore.setJSON(FREQ_KEY, f);
        _freqMemo = null;
    }
    return { added, already };
}

let _freqMemo = null;
const _freqTable = color => (_freqMemo || (_freqMemo = _readFreq()))[color] || {};

// ─── EXPLORATEUR LICHESS ──────────────────────────────────────────────────────

const explorerToken = () => (dataStore.get(EXPLORER_TOKEN_KEY) || '').trim();

function _explorerRatings() {
    const elo = Number(typeof appSettings !== 'undefined' ? appSettings.elo : '') || 1800;
    const out = EXPLORER_BANDS.filter(b => b >= elo - 300 && b <= elo + 200);
    return (out.length ? out : [1600, 1800, 2000]).join(',');
}

const _explorerCache = () => dataStore.getJSON(EXPLORER_CACHE_KEY, null) || {};

function _explorerCached(key) {
    const c = _explorerCache()[key + '|' + _explorerRatings()];
    return c && Date.now() - c.at < EXPLORER_TTL_MS ? c : null;
}

// Coups joués sur Lichess dans la position `key` : [[uci, nombre]] (du plus joué au moins joué).
// Rejette avec 'token' (jeton absent ou refusé), 'offline' ou 'http'.
const _explorerPending = {};
function fetchExplorer(key) {
    const hit = _explorerCached(key);
    if (hit) return Promise.resolve(hit.moves);
    const token = explorerToken();
    if (!token) return Promise.reject(new Error('token'));
    if (typeof Net !== 'undefined' && !Net.online()) return Promise.reject(new Error('offline'));
    const ratings = _explorerRatings(), ck = key + '|' + ratings;
    if (_explorerPending[ck]) return _explorerPending[ck];
    const url = 'https://explorer.lichess.ovh/lichess?variant=standard&speeds=blitz,rapid,classical&topGames=0&recentGames=0&moves=12'
              + `&ratings=${ratings}&fen=${encodeURIComponent(key + ' 0 1')}`;
    return (_explorerPending[ck] = fetch(url, { headers: { Authorization: 'Bearer ' + token } })
        .then(res => {
            if (res.status === 401 || res.status === 403) throw new Error('token');
            if (!res.ok) throw new Error('http');
            return res.json();
        })
        .then(data => {
            const moves = (data.moves || []).map(m => [m.uci, (m.white || 0) + (m.draws || 0) + (m.black || 0)]).filter(m => m[1] > 0);
            const cache = _explorerCache();
            cache[ck] = { at: Date.now(), moves };
            const keys = Object.keys(cache);
            if (keys.length > EXPLORER_CACHE_MAX) keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, keys.length - EXPLORER_CACHE_MAX).forEach(k => delete cache[k]);
            dataStore.setJSON(EXPLORER_CACHE_KEY, cache);
            return moves;
        })
        .finally(() => { delete _explorerPending[ck]; }));
}

// ─── PART D'UNE RÉPONSE (ENTRAÎNEMENT) ────────────────────────────────────────

// Part (0 à 1) du coup adverse `uci` dans la position `key`, d'après vos parties puis le cache Lichess ;
// null si aucune donnée.
function freqShare(color, key, uci) {
    const own = _freqTable(color)[key];
    const ownTotal = own ? Object.values(own).reduce((s, n) => s + n, 0) : 0;
    if (ownTotal >= 3) return (own[uci] || 0) / ownTotal;
    const lich = _explorerCached(key);
    const lt = lich ? lich.moves.reduce((s, m) => s + m[1], 0) : 0;
    if (lt) return ((lich.moves.find(m => m[0] === uci) || [, 0])[1]) / lt;
    return ownTotal ? (own[uci] || 0) / ownTotal : null;
}

// Facteur de tirage d'une position du répertoire : de 0,6 (réponse adverse rare) à 2 (réponse la plus jouée) ;
// 1 sans donnée ou option désactivée. La position précédant le coup adverse est mémorisée par chemin.
const _prevKeyMemo = new Map();
function freqFactor(e, color) {
    if (typeof appSettings !== 'undefined' && !appSettings.freqWeight) return 1;
    if (!e.path || e.path.length < 2) return 1;
    const p = e.path, id = p.join(' ');
    let k = _prevKeyMemo.get(id);
    if (k === undefined) {
        try { k = Chess.key(Chess.replay(p.slice(0, -2))); } catch (err) { k = null; }
        _prevKeyMemo.set(id, k);
    }
    const share = k ? freqShare(color, k, p[p.length - 2]) : null;
    return share === null ? 1 : 0.6 + 1.4 * share;
}

// ─── ONGLET « ADVERSAIRE » (mode Jouer) ───────────────────────────────────────

let _freqLich = { key: null, moves: null, error: '' };

function _freqRows(key) {
    const own = _freqTable(playerColor)[key] || {};
    const ownTotal = Object.values(own).reduce((s, n) => s + n, 0);
    const lich = _freqLich.key === key && _freqLich.moves ? _freqLich.moves : [];
    const lt = lich.reduce((s, m) => s + m[1], 0);
    const ucis = new Set([...Object.keys(own), ...lich.map(m => m[0])]);
    const pos = Chess.fromFen(key);
    return [...ucis].map(uci => {
        const next = Chess.play(pos, uci);
        return { uci, san: Chess.san(pos, uci), own: own[uci] || 0, ownPct: ownTotal ? (own[uci] || 0) / ownTotal : 0,
                 lichPct: lt ? ((lich.find(m => m[0] === uci) || [, 0])[1]) / lt : null,
                 covered: !!openingDB[Chess.key(next)] };
    }).sort((a, b) => (b.lichPct ?? b.ownPct) - (a.lichPct ?? a.ownPct) || b.own - a.own).slice(0, 10);
}

const _pct = x => x < 0.01 && x > 0 ? '< 1 %' : `${Math.round(100 * x)} %`;

// Réponses fréquentes de VOS adversaires, dans des positions de votre répertoire, sans réponse préparée.
function _uncoveredFrequent() {
    const table = _freqTable(playerColor), out = [];
    const reach = {};                                                  // position adverse → chemin pour y arriver
    if (playerColor === 'b') reach[Chess.key(Chess.start())] = [];
    Object.values(openingDB).forEach(e => {
        if (!e.path) return;
        try { reach[Chess.key(Chess.replay(e.path))] = e.path; } catch (err) { /* chemin illisible : ignoré */ }
    });
    Object.keys(table).forEach(k => {
        if (!reach[k]) return;
        const pos = Chess.fromFen(k);
        Object.entries(table[k]).forEach(([uci, n]) => {
            if (n < 2) return;
            let next;
            try { next = Chess.play(pos, uci); } catch (err) { return; }
            if (openingDB[Chess.key(next)]) return;
            out.push({ path: reach[k], uci, n, label: formatLinePrefix(_pathToSans(reach[k].concat(uci)), true) });   // HTML
        });
    });
    return out.sort((a, b) => b.n - a.n).slice(0, 6);
}

function renderFreqPanel() {
    const box = document.getElementById('freq-view');
    if (!box || box.classList.contains('hidden') || gameMode !== 'play') return;
    const key = Chess.key(Chess.fromFen(displayedFen()));
    const oppTurn = key.split(' ')[1] !== playerColor;
    const games = (_freqMemo || (_freqMemo = _readFreq())).games.length;
    let html = '';

    if (!oppTurn) {
        html += `<p class="freq-note">${ico('info')} À vous de jouer : les fréquences portent sur les coups de l’adversaire. Jouez votre coup, ou revenez d’un coup (‹).</p>`;
    } else {
        if (explorerToken() && _freqLich.key !== key) _freqLoadLichess(key);
        const rows = _freqRows(key);
        if (!rows.length) html += `<p class="freq-note">${ico('info')} Aucune donnée pour cette position${games ? ' dans vos parties' : ''}.</p>`;
        else html += `<div class="freq-list" role="list">${rows.map(r => {
            const main = r.lichPct ?? r.ownPct;
            return `<button type="button" class="freq-row" role="listitem" data-action="freqPlay" data-arg="${r.uci}" title="Jouer ${escapeHtml(r.san)} pour l’adversaire">
                <b>${formatSan(r.san, playerColor === 'w' ? 'b' : 'w')}</b>
                <span class="freq-bar"><i style="width:${Math.max(2, Math.round(100 * main))}%"></i></span>
                <span class="freq-num">${r.lichPct !== null ? `Lichess ${_pct(r.lichPct)}` : ''}${r.own ? `${r.lichPct !== null ? ' · ' : ''}vous ${r.own}×` : ''}</span>
                <span class="freq-tag ${r.covered ? 'is-ok' : 'is-todo'}">${r.covered ? 'préparé' : 'à préparer'}</span>
              </button>`;
        }).join('')}</div>`;
        if (_freqLich.error && _freqLich.key === key) html += `<p class="freq-note is-err">${escapeHtml(_freqLich.error)}</p>`;
    }

    const todo = games ? _uncoveredFrequent() : [];
    if (todo.length) html += `<h4 class="freq-h">Réponses fréquentes de vos adversaires, pas encore préparées</h4><div class="freq-list">${todo.map((t, i) =>
        `<button type="button" class="freq-row is-line" data-action="freqOpenLine" data-arg="${i}"><span>${t.label}</span><span class="freq-num">${t.n} parties</span></button>`).join('')}</div>`;
    _freqTodo = todo;

    html += `<div class="freq-foot">
        <span>${games ? `${games} partie${games > 1 ? 's' : ''} analysée${games > 1 ? 's' : ''}` : 'Aucune de vos parties analysée'} · <button type="button" class="toast-link" data-action="freqFetchGames">Ajouter mes parties</button></span>
        ${explorerToken()
            ? `<span>Explorateur Lichess activé · <button type="button" class="toast-link" data-action="freqForgetToken">Retirer le jeton</button></span>`
            : `<form class="freq-token" data-freq-token><label>Statistiques Lichess : collez un <a href="https://lichess.org/account/oauth/token/create?description=Chays%20Trainer" target="_blank" rel="noopener">jeton personnel</a> (aucune autorisation à cocher), gardé sur cet appareil.</label>
               <span><input class="pn-input" type="password" autocomplete="off" spellcheck="false" placeholder="lip_…" aria-label="Jeton Lichess"><button class="btn" type="submit">Activer</button></span></form>`}
      </div>`;
    box.innerHTML = html;
    const form = box.querySelector('[data-freq-token]');
    if (form) form.onsubmit = ev => {
        ev.preventDefault();
        const v = form.querySelector('input').value.trim();
        if (!v) return;
        dataStore.set(EXPLORER_TOKEN_KEY, v);
        _freqLich = { key: null, moves: null, error: '' };
        renderFreqPanel();
    };
}

let _freqTodo = [];

function _freqLoadLichess(key) {
    _freqLich = { key, moves: null, error: '' };
    fetchExplorer(key).then(moves => {
        if (_freqLich.key === key) { _freqLich.moves = moves; renderFreqPanel(); }
    }, e => {
        if (_freqLich.key !== key) return;
        _freqLich.error = e.message === 'token' ? 'Lichess a refusé le jeton : vérifiez-le, ou retirez-le.'
                        : e.message === 'offline' ? 'Hors ligne : statistiques Lichess indisponibles.'
                        : 'Explorateur Lichess injoignable pour le moment.';
        renderFreqPanel();
    });
}

registerActions({
    freqPlay: uci => {
        if (navCursor !== -1) _syncEngineToNavCursor();
        if (turn === playerColor) return;
        const m = Chess.parseUci(uci);
        if (!getLegalMoves(m.from).includes(m.to)) return;
        executeOpponentMove(m.from, m.to, m.promo);
    },
    freqOpenLine: i => {
        const t = _freqTodo[Number(i)];
        if (!t) return;
        loadPositionFromPath(t.path.concat(t.uci));
        setStatus('Réponse fréquente à préparer', 'info', 'À vous : jouez le coup que vous voulez retenir.');
    },
    freqFetchGames: () => { showGameReview(); if (typeof setReviewTab === 'function') setReviewTab('online'); },
    freqForgetToken: () => { dataStore.remove(EXPLORER_TOKEN_KEY); _freqLich = { key: null, moves: null, error: '' }; renderFreqPanel(); }
});
