/**
 * modules/openings/onlineGames.js
 * ──────────────────────────────────────────────────────────────────────────
 * « Analyser mes parties », boîte de réception (lot 7) : récupère les dernières parties d'un pseudo Chess.com
 * ou Lichess (API publiques, sans compte ni clé), les compare au répertoire actif et liste les déviations.
 *   - la couleur jouée est déduite du pseudo (en-têtes White / Black) ;
 *   - chaque partie passe par reviewGame (gameReview.js) avec la base de cette couleur : verdict noté au
 *     journal des parties, erreur d'ouverture comptée tout de suite, une seule fois par partie ;
 *   - les parties déjà analysées sont masquées par défaut (un bouton les affiche) ;
 *   - un clic sur une partie ouvre « Jouer » sur la position après le coup déviant (showReviewResult) ;
 *     dès 920 px, le clic choisit d'abord la partie, montrée à droite (position, extrait de la ligne, verdict) ;
 *   - la source est un segment Lichess / Chess.com / PGN collé ; après l'analyse, le formulaire se replie en
 *     une ligne de source, et des compteurs (Erreurs, Nouveautés, Traitées, Théoriques) filtrent la liste ;
 *   - les réponses adverses alimentent les fréquences de l'onglet « Adversaire » (moveStats.js).
 * Seules les parties d'échecs classiques depuis la position initiale sont retenues.
 * Le pseudo, le site et le nombre de parties sont mémorisés sur l'appareil ; la dernière analyse ne vit que dans
 * la variable du module (_online), le temps de la session.
 */

'use strict';

const ONLINE_PREFS_KEY = 'chessTrainer_onlineAccount';
const ONLINE_COUNTS    = [5, 10, 20, 50];

// Dernière analyse, en mémoire de session seulement.
//   error / errKind : message et nature ('user' sous le champ, 'net' réseau, 'empty' aucune partie)
//   filter : compteur choisi (clé de ONLINE_FILTERS) ou null · sel : partie montrée à droite (indice dans rows)
//   formOpen : formulaire déplié · src : { site, user, count } de la dernière récupération · fetched : parties reçues
let _online = { busy: false, rows: null, summary: null, error: '', errKind: '', showSeen: false,
                filter: null, sel: -1, formOpen: true, src: null, fetched: 0 };

function _onlinePrefs() {
    const p = dataStore.getJSON(ONLINE_PREFS_KEY, null) || {};
    const site = p.site === 'lichess' ? 'lichess' : 'chesscom';
    const fromProfile = typeof appSettings !== 'undefined' ? (site === 'lichess' ? appSettings.lichessUser : appSettings.chesscomUser) : '';
    return { site, user: typeof p.user === 'string' && p.user ? p.user : fromProfile || '',      // repli : pseudo du profil (Compte)
             count: ONLINE_COUNTS.includes(p.count) ? p.count : 20 };
}

function _saveOnlinePrefs(p) { dataStore.setJSON(ONLINE_PREFS_KEY, p); }

// ─── RÉCUPÉRATION ─────────────────────────────────────────────────────────────

// Export Lichess : opening=true ajoute les en-têtes Opening et ECO (nom d'ouverture de la liste).
function lichessExportUrl(user, n) {
    return `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${n}`
         + '&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=false&evals=false&opening=true';
}

async function fetchLichessGames(user, n) {
    const res = await fetch(lichessExportUrl(user, n), { headers: { Accept: 'application/x-chess-pgn' } });
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
// Une ligne : { game, color, r (detectDeviation), counted, kind, res (reviewGame) } ;
// kind : 'mistake' | 'novelty' | 'out' | 'treated' | 'theory'.
function analyzeOnlineGames(games, user, rep = currentRepertoire) {
    const bases = {};
    const base  = c => bases[c] || (bases[c] = { db: readDBFor(rep, c), opp: readOppFor(rep, c), dirty: false, save() { this.dirty = true; } });
    const ledger = readLedger();
    const rows  = [];
    const summary = { games: 0, mistakes: 0, newMistakes: 0, novelties: 0, treated: 0, theory: 0, skipped: 0, seen: 0 };

    games.forEach(game => {
        const color = _userColor(game.headers, user);
        const fen   = game.headers.FEN;
        if (!color || (fen && fen.split(' ')[0] !== INIT_FEN.split(' ')[0]) || !game.sans.length) { summary.skipped++; return; }
        const res = reviewGame(game, color, rep, base(color), ledger);
        if (!res.kind) { summary.skipped++; return; }
        summary.games++;
        if (res.prev) summary.seen++;
        if (res.kind === 'mistake') { summary.mistakes++; if (res.counted === 'counted') summary.newMistakes++; }
        if (res.kind === 'novelty' || res.kind === 'out') summary.novelties++;
        if (res.kind === 'treated') summary.treated++;
        if (res.kind === 'theory') summary.theory++;
        rows.push({ game, color, r: res.r, counted: res.counted, kind: res.kind, res });
    });
    Object.keys(bases).forEach(c => { if (bases[c].dirty) dataStore.set(dbKeyFor(rep, c), JSON.stringify(bases[c].db)); });
    writeLedger(ledger);
    return { rows, summary };
}

// ─── VERDICTS ET COMPTEURS ────────────────────────────────────────────────────

// Libellé et teinte (.vbadge) de chaque verdict affiché. « Sans réponse » : nouveauté déjà repérée
// lors d'une analyse précédente (deviation.known), toujours sans réponse.
const ONLINE_VERDICTS = {
    mistake:  { cls: 'is-err',   label: 'Erreur d\'ouverture' },
    out:      { cls: 'is-muted', label: 'Hors répertoire' },
    novelty:  { cls: 'is-warn',  label: 'Nouveauté adverse' },
    noanswer: { cls: 'is-new',   label: 'Sans réponse' },
    treated:  { cls: 'is-ok',    label: 'Traitée depuis' },
    theory:   { cls: 'is-muted', label: 'Théorique' }
};

// Compteurs filtrants du résumé : un toucher ne garde que les verdicts du compteur.
const ONLINE_FILTERS = [
    { key: 'err',     label: 'Erreurs',    cls: 'is-err',   kinds: ['mistake'] },
    { key: 'new',     label: 'Nouveautés', cls: 'is-warn',  kinds: ['novelty', 'out'] },
    { key: 'treated', label: 'Traitées',   cls: 'is-ok',    kinds: ['treated'] },
    { key: 'theory',  label: 'Théoriques', cls: 'is-muted', kinds: ['theory'] }
];

const _ONLINE_ORDER = { mistake: 0, novelty: 1, out: 2, treated: 3, theory: 4 };
const _SITE_NAME    = { lichess: 'Lichess', chesscom: 'Chess.com' };

// Clé de ONLINE_VERDICTS d'une ligne de analyzeOnlineGames.
function onlineVerdictKey(row) {
    const d = row.r && row.r.deviation;
    return row.kind === 'novelty' && d && d.known ? 'noanswer' : row.kind;
}

function _onlineBadge(row) {
    const v = ONLINE_VERDICTS[onlineVerdictKey(row)] || ONLINE_VERDICTS.theory;
    return `<span class="vbadge ${v.cls}">${v.label}</span>`;
}

// « comptée » : l'erreur vient d'être comptée par cette analyse ; « déjà » : elle l'était au journal.
function _onlineTag(row) {
    if (row.counted === 'counted') return '<span class="online-tag is-counted">comptée</span>';
    if (row.counted === 'already') return '<span class="online-tag">déjà</span>';
    return '';
}

// ─── FAITS D'UNE PARTIE ───────────────────────────────────────────────────────

// Nom d'ouverture : en-tête Opening (Lichess avec opening=true), sinon l'adresse ECOUrl de Chess.com
// (« Italian-Game-Two-Knights-Defense-4.d3 » → « Italian Game Two Knights Defense »), sinon le code ECO.
function onlineOpening(h) {
    if (h.Opening && h.Opening !== '?') return h.Opening;
    const m = /\/openings\/([^?#]+)/.exec(h.ECOUrl || '');
    if (m) {
        let words = [];
        try { words = decodeURIComponent(m[1]).split('-'); } catch (e) { words = m[1].split('-'); }
        const cut = words.findIndex(w => /^\d/.test(w));
        const name = (cut < 0 ? words : words.slice(0, cut)).join(' ').trim();
        if (name) return name;
    }
    return h.ECO && h.ECO !== '?' ? h.ECO : '';
}

function _onlineFacts(row) {
    const h = row.game.headers, at = gamePlayedAt(h);
    const opp = (row.color === 'w' ? h.Black : h.White) || '?';
    const res = h.Result === '1/2-1/2' ? '½' : h.Result === '*' || !h.Result ? '' : (h.Result === '1-0') === (row.color === 'w') ? 'gain' : 'perte';
    const dev = row.kind !== 'theory' && row.res.ply >= 0;
    return { opp, res, at, opening: onlineOpening(h), dev,
             date: at ? _shortDate(at) : '',
             longDate: at ? new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
             move: dev ? _plyLabel(row.res.ply, row.r.moves[row.res.ply].san, true) : '' };
}

// Position montrée : après le coup déviant ; partie théorique : sa dernière position.
function _onlinePath(row) {
    const moves = row.r.moves, end = row.kind !== 'theory' && row.res.ply >= 0 ? row.res.ply + 1 : moves.length;
    return moves.slice(0, end).map(m => m.uci);
}

function _onlineMini(row, cls, label) {
    return typeof _miniBoardHTML === 'function' ? _miniBoardHTML({ side: row.color, path: _onlinePath(row) }, true, { cls, label }) : '';
}

// Extrait de la ligne autour de la déviation (5 demi-coups avant, 5 après), coups en figurines du jeu actif.
function _onlineExcerpt(row) {
    const moves = row.r.moves, ply = row.kind !== 'theory' && row.res.ply >= 0 ? row.res.ply : moves.length - 1;
    const from = Math.max(0, ply - 5), to = Math.min(moves.length, ply + 6);
    let html = from > 0 ? '… ' : '';
    for (let i = from; i < to; i++) {
        const num = i % 2 === 0 ? `${i / 2 + 1}. ` : i === from ? `${Math.floor(i / 2) + 1}... ` : '';
        const mv = num + formatSan(moves[i].san, i % 2 ? 'b' : 'w');
        html += (i === ply && row.kind !== 'theory' ? `<mark class="online-x">${mv}</mark>` : i > ply ? `<span class="online-fut">${mv}</span>` : mv) + ' ';
    }
    return html + (to < moves.length ? '…' : '');
}

// ─── INTERFACE ────────────────────────────────────────────────────────────────

const _onlineWide = () => typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 920px)').matches;
const _onlinePl   = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Onglet « online » (Lichess, Chess.com) ou « paste » (PGN collé) : gardé pour les appels existants.
function setReviewTab(tab) {
    _reviewTab = tab === 'paste' ? 'paste' : 'online';
    renderOnlinePane();
}

// Segment de source : Lichess et Chess.com sont mémorisés (chessTrainer_onlineAccount), PGN collé ne l'est pas.
function setOnlineSite(site) {
    if (site === 'pgn') { _reviewTab = 'paste'; renderOnlinePane(); return; }
    _reviewTab = 'online';
    if (_online.errKind === 'user') { _online.error = ''; _online.errKind = ''; }
    _saveOnlinePrefs({ ..._onlinePrefs(), site: site === 'lichess' ? 'lichess' : 'chesscom' });
    renderOnlinePane();
}

function setOnlineCount(n) {
    const count = Number(n);
    if (!ONLINE_COUNTS.includes(count)) return;
    _saveOnlinePrefs({ ..._onlinePrefs(), user: _onlineTypedUser(), count });
    renderOnlinePane();
}

// Pseudo en cours de saisie (pas encore mémorisé), sinon celui des préférences.
function _onlineTypedUser() {
    const u = document.getElementById('online-user');
    return u ? u.value.trim() : _onlinePrefs().user;
}

function _paintSeg(host, isOn) {
    host.querySelectorAll('.tr-seg-btn').forEach(b => {
        const on = isOn(b);
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
    });
}

function renderOnlinePane() {
    const p = _onlinePrefs(), paste = _reviewTab === 'paste', siteName = _SITE_NAME[p.site];
    const offline = typeof Net !== 'undefined' && !Net.online();
    _paintSeg(document.querySelector('#online-form .online-sites'), b => b.dataset.arg === (paste ? 'pgn' : p.site));
    document.getElementById('online-site-pgn').classList.toggle('is-suggest', offline && !paste);   // hors ligne : le PGN collé reste possible
    document.getElementById('review-pane-online').classList.toggle('hidden', paste);
    document.getElementById('review-pane-paste').classList.toggle('hidden', !paste);

    const u = document.getElementById('online-user');
    if (document.activeElement !== u && !u.value) u.value = p.user;
    u.placeholder = `pseudo ${siteName}`;
    u.setAttribute('aria-label', `Pseudo ${siteName}`);
    const userErr = _online.errKind === 'user';
    u.setAttribute('aria-invalid', String(userErr));
    u.closest('.online-field').classList.toggle('is-bad', userErr);
    const err = document.getElementById('online-user-err');
    err.hidden = !userErr;
    err.textContent = userErr ? _online.error : '';
    _paintSeg(document.getElementById('online-count'), b => Number(b.dataset.arg) === p.count);

    const btn = document.getElementById('online-fetch-btn');
    btn.disabled = _online.busy;
    btn.innerHTML = _online.busy ? 'Récupération…' : `${ico('download')} Analyser ${p.count} parties`;

    // Formulaire replié en une ligne de source dès qu'une analyse est lancée.
    const collapsed = !paste && !_online.formOpen && !!_online.src;
    document.getElementById('online-form').hidden = collapsed;
    _renderOnlineDone(collapsed);
    _renderOnlineLast(!paste && !collapsed);
    _renderOnlineResults();
}

// Ligne de source repliée : « evan_h · Lichess · 20 parties · 14 nouvelles », Relancer et Changer de source.
function _renderOnlineDone(show) {
    const box = document.getElementById('online-done');
    box.hidden = !show;
    if (!show) { box.innerHTML = ''; return; }
    const src = _online.src, s = _online.summary;
    const facts = [_SITE_NAME[src.site]];
    if (_online.busy) facts.push('récupération…');
    else if (_online.rows) {
        facts.push(_onlinePl(_online.fetched, 'partie', 'parties'));
        if (s.games) facts.push(_onlinePl(s.games - s.seen, 'nouvelle', 'nouvelles'));
    } else facts.push(_onlinePl(src.count, 'partie', 'parties'));
    box.innerHTML = `<span class="online-site ${src.site === 'lichess' ? 'lc' : 'cc'} is-lg" aria-hidden="true">${src.site === 'lichess' ? 'li' : 'c'}</span>
        <span class="online-who"><b>${escapeHtml(src.user)}</b><small> · ${escapeHtml(facts.join(' · '))}</small></span>
        <button type="button" class="online-icon" data-action="onlineRefetch" data-needs-network title="Relancer l'analyse" aria-label="Relancer l'analyse"${_online.busy ? ' disabled aria-busy="true"' : ''}>${ico('rotate-ccw')}</button>
        <button type="button" class="online-icon" data-action="onlineEditSource" title="Changer de source" aria-label="Changer de source" aria-expanded="false" aria-controls="online-form">${ico('chevron-down')}</button>`;
}

// « Dernière analyse » sous le formulaire rouvert : un compteur ramène à la liste filtrée.
function _renderOnlineLast(show) {
    const box = document.getElementById('online-last');
    const rows = show && !_online.busy && _online.rows && _online.rows.length ? _onlineVisible() : null;
    box.hidden = !rows;
    if (!rows) { box.innerHTML = ''; return; }
    const chips = ONLINE_FILTERS.map(f => ({ f, n: rows.filter(r => f.kinds.includes(r.kind)).length })).filter(c => c.n)
        .map(({ f, n }) => `<button type="button" class="online-chip" data-action="onlineFilter" data-arg="${f.key}"><span class="vbadge ${f.cls}">${f.label} <b>${n}</b></span></button>`).join('');
    box.innerHTML = `<div class="online-kicker">Dernière analyse</div><div class="online-chips">${chips}</div>`;
}

// Lignes montrées : sans les parties déjà analysées, sauf demande (« Afficher les N »).
function _onlineVisible() {
    return (_online.rows || []).filter(row => _online.showSeen || !row.res.prev);
}

// Squelette calqué sur .online-row (6 lignes au plus : la liste dépasse rarement l'écran).
function _onlineSkeleton(count) {
    const widths = [58, 44, 66, 50, 38, 62];
    const rows = widths.slice(0, Math.min(count, widths.length)).map(w => `<div class="online-row sk-row" aria-hidden="true">
            <span class="sk online-thumb"></span>
            <span class="online-main"><span class="sk sk-line" style="width:${w}%"></span><span class="sk sk-line sk-small"></span></span>
            <span class="sk sk-pill"></span>
          </div>`).join('');
    return `<span class="sr-only">Récupération et analyse des parties…</span>
        <div class="online-chips" aria-hidden="true"><span class="sk online-sk-chip"></span><span class="sk online-sk-chip"></span><span class="sk online-sk-chip"></span></div>
        <div class="online-list">${rows}</div>`;
}

// État illustré (réseau, aucune partie, tout théorique…) : disque, titre, phrase courte, actions.
function _onlineState(icon, tone, title, text, actions = '') {
    return `<div class="online-state">
        <span class="online-disc ${tone}">${ico(icon)}</span>
        <h3>${escapeHtml(title)}</h3>${text ? `<p>${escapeHtml(text)}</p>` : ''}
        ${actions ? `<div class="online-state-act">${actions}</div>` : ''}</div>`;
}

const _onlineShowSeenBtn = (n, cls = 'btn btn-soft') =>
    `<button type="button" class="${cls}" data-action="toggleOnlineSeen">${_online.showSeen ? 'Masquer les parties déjà analysées' : n > 1 ? `Afficher les ${n}` : 'Afficher la partie'}</button>`;

function _renderOnlineResults() {
    const box = document.getElementById('online-results'), panel = document.getElementById('review-panel');
    const show = _reviewTab === 'online' && document.getElementById('online-form').hidden;   // résultats sous la ligne repliée seulement
    box.setAttribute('aria-busy', String(_online.busy));
    panel.classList.remove('is-wide');
    if (!show) { box.innerHTML = ''; return; }
    if (_online.busy) { box.innerHTML = _onlineSkeleton(_online.src ? _online.src.count : 20); return; }

    const site = _online.src ? _SITE_NAME[_online.src.site] : '';
    if (_online.errKind === 'net') {
        const offline = typeof Net !== 'undefined' && !Net.online();
        box.innerHTML = _onlineState('cloud', 'is-err', `${site} ne répond pas`,
            offline ? 'Hors ligne · le PGN collé marche sans Internet' : 'Vérifiez votre connexion et réessayez.',
            `<button type="button" class="btn btn-primary" data-action="onlineRefetch" data-needs-network>${ico('rotate-ccw')} Réessayer</button>
             <button type="button" class="btn btn-soft" data-action="setOnlineSite" data-arg="pgn">${ico('upload')} Coller un PGN</button>`);
        return;
    }
    if (_online.errKind === 'empty') {
        box.innerHTML = _onlineState('search', 'is-accent', 'Aucune partie trouvée', `Ce pseudo n'a pas de partie récente sur ${site}.`,
            `<button type="button" class="btn btn-soft" data-action="onlineEditSource">Changer de source</button>`);
        return;
    }
    if (!_online.rows) { box.innerHTML = ''; return; }

    const s = _online.summary, rows = _onlineVisible();
    if (!_online.rows.length) {
        const next = ONLINE_COUNTS.find(c => c > _online.src.count);
        box.innerHTML = _onlineState('search', 'is-accent', 'Aucune partie à comparer',
            `${_onlinePl(s.skipped, 'ignorée', 'ignorées')} · Chess960 ou position de départ`,
            next ? `<button type="button" class="btn btn-primary" data-action="onlineMore" data-arg="${next}" data-needs-network>Analyser ${next} parties</button>` : '');
        return;
    }
    const hidden = s.seen && !_online.showSeen ? s.seen : 0;
    if (!rows.length) {
        box.innerHTML = _onlineState('eye', 'is-accent', 'Rien de nouveau', `${_onlinePl(hidden, 'partie déjà analysée', 'parties déjà analysées')}`, _onlineShowSeenBtn(hidden));
        return;
    }
    if (rows.every(r => r.kind === 'theory')) {
        box.innerHTML = _onlineState('check', 'is-ok', rows.length > 1 ? `${rows.length} parties, toutes théoriques` : 'Partie entièrement théorique',
            hidden ? _onlinePl(hidden, 'déjà analysée', 'déjà analysées') : 'Aucun coup n\'est sorti du répertoire.',
            hidden ? _onlineShowSeenBtn(hidden) : '');
        return;
    }

    const counts = ONLINE_FILTERS.map(f => ({ f, n: rows.filter(r => f.kinds.includes(r.kind)).length }));
    if (_online.filter && !counts.find(c => c.f.key === _online.filter && c.n)) _online.filter = null;
    const flt = ONLINE_FILTERS.find(f => f.key === _online.filter);
    const list = _online.rows.map((row, i) => ({ row, i }))
        .filter(({ row }) => (_online.showSeen || !row.res.prev) && (!flt || flt.kinds.includes(row.kind)))
        .sort((a, b) => _ONLINE_ORDER[a.row.kind] - _ONLINE_ORDER[b.row.kind]);
    if (!list.some(x => x.i === _online.sel)) _online.sel = list.length ? list[0].i : -1;

    const counted = _online.rows.filter(r => r.counted === 'counted').length, already = _online.rows.filter(r => r.counted === 'already').length;
    const chips = counts.map(({ f, n }) => `<button type="button" class="online-chip" data-action="onlineFilter" data-arg="${f.key}" aria-pressed="${_online.filter === f.key}"${n ? '' : ' disabled'}><span class="vbadge ${f.cls}">${f.label} <b>${n}</b></span></button>`).join('');
    const seenBar = s.seen ? `<div class="online-seen">${ico('eye')}<span>${_online.showSeen ? _onlinePl(s.seen, 'déjà analysée', 'déjà analysées') + ' affichée' + (s.seen > 1 ? 's' : '') : _onlinePl(s.seen, 'déjà analysée masquée', 'déjà analysées masquées')}</span>${_onlineShowSeenBtn(s.seen, 'online-seen-btn')}</div>` : '';
    const sel = _online.rows[_online.sel];

    box.innerHTML = `<p class="sr-only" role="status">${escapeHtml(counted || already ? `${_onlinePl(counted, 'erreur comptée', 'erreurs comptées')}${already ? ` · ${already} l'étai${already > 1 ? 'ent' : 't'} déjà` : ''}` : `${_onlinePl(rows.length, 'partie', 'parties')} analysée${rows.length > 1 ? 's' : ''}`)}</p>
        <div class="online-inbox">
          <div class="online-col">
            <div class="online-chips" role="group" aria-label="Filtrer par verdict">${chips}</div>
            <div class="online-list">${list.map(({ row, i }) => _onlineRowHTML(row, i, i === _online.sel)).join('')}</div>
            ${seenBar}
          </div>
          ${sel ? _onlineDetailHTML(sel, _online.sel) : ''}
        </div>`;
    panel.classList.add('is-wide');
    if (typeof refreshGlyphs === 'function') refreshGlyphs();
}

// Une partie : vignette de la position déviante, adversaire, ouverture et date, coup déviant et verdict.
function _onlineRowHTML(row, i, sel) {
    const f = _onlineFacts(row);
    const sub = [f.opening, f.date, f.res].filter(Boolean).map(escapeHtml).join(' · ');
    return `<button type="button" class="online-row${sel ? ' is-sel' : ''}" data-action="onlineRow" data-arg="${i}"${sel ? ' aria-current="true"' : ''}>
            <span class="online-thumb">${_onlineMini(row, 'online-mini', f.dev ? 'Position après le coup déviant' : 'Dernière position')}</span>
            <span class="online-main"><b><span class="glyph" data-glyph="${row.color === 'w' ? 'K' : 'k'}"></span><span class="online-opp">${escapeHtml(f.opp)}</span></b><small>${sub}</small></span>
            <span class="online-side">${f.move || _onlineTag(row) ? `<span class="online-mv">${f.move}${_onlineTag(row)}</span>` : ''}${_onlineBadge(row)}</span>
          </button>`;
}

// Partie choisie (bureau) : position déviante en grand, extrait de la ligne, faits, puis « Ouvrir dans Jouer ».
function _onlineDetailHTML(row, i) {
    const f = _onlineFacts(row), d = row.r.deviation;
    const exp = row.kind === 'mistake' && d && d.expected && d.expected.san
        ? `<div class="online-cmp"><div class="is-played"><span>Joué</span><b>${f.move}</b></div><div class="is-rep"><span>Répertoire</span><b>${_plyLabel(row.res.ply, d.expected.san, true)}</b></div></div>` : '';
    const when = [f.longDate, f.res].filter(Boolean).join(' · ');
    return `<aside class="online-detail" aria-label="Partie choisie">
        <div class="online-detail-board">
          <div class="online-big">${_onlineMini(row, 'online-big-board', f.dev ? 'Position après le coup déviant' : 'Dernière position')}</div>
          <p class="online-line">${_onlineExcerpt(row)}</p>
        </div>
        <div class="online-detail-info">
        <div class="online-detail-h"><span class="glyph" data-glyph="${row.color === 'w' ? 'K' : 'k'}"></span><b>${escapeHtml(f.opp)}</b></div>
        <div class="online-detail-v">${_onlineBadge(row)}${_onlineTag(row)}</div>
        ${exp}
        <dl class="online-kv">
          ${f.opening ? `<dt>Ouverture</dt><dd>${escapeHtml(f.opening)}</dd>` : ''}
          ${when ? `<dt>Date</dt><dd>${escapeHtml(when)}</dd>` : ''}
          <dt>Sortie</dt><dd>${f.dev ? `au ${row.res.ply + 1}<sup>e</sup> demi-coup` : `aucune (${row.r.moves.length} demi-coups)`}</dd>
        </dl>
        <button type="button" class="btn btn-primary online-go" data-action="openOnlineGame" data-arg="${i}">${ico('play')} Ouvrir dans Jouer</button>
        <button type="button" class="btn online-ghost" data-action="onlineTree" data-arg="${i}">${ico('git-branch')} Voir dans l'Arbre</button>
        </div>
      </aside>`;
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────

async function runOnlineFetch() {
    if (_online.busy) return;
    const user = _onlineTypedUser();
    const p    = { ..._onlinePrefs(), user };
    const site = _SITE_NAME[p.site];
    if (!user) { _online = { ..._online, error: `Entrez votre pseudo ${site}.`, errKind: 'user', formOpen: true }; renderOnlinePane(); return; }
    if (typeof Net !== 'undefined' && !Net.online()) { renderOnlinePane(); return; }   // la note « Hors ligne » et le segment PGN suffisent
    _saveOnlinePrefs(p);
    _online = { busy: true, rows: null, summary: null, error: '', errKind: '', showSeen: false, filter: null, sel: -1,
                formOpen: false, src: { site: p.site, user, count: p.count }, fetched: 0 };
    renderOnlinePane();
    try {
        const games = p.site === 'lichess' ? await fetchLichessGames(user, p.count) : await fetchChesscomGames(user, p.count);
        const res   = analyzeOnlineGames(games, user);
        recordGameFrequencies(games, g => _userColor(g.headers, user));      // onglet « Adversaire » (une fois par partie)
        _online.rows = res.rows; _online.summary = res.summary; _online.fetched = games.length;
        if (_gameScreenShown() && gameMode === 'play') loadDB();             // erreurs comptées : base active rechargée
        if (typeof refreshTree === 'function') refreshTree();
        if (!games.length) { _online.rows = null; _online.errKind = 'empty'; }
    } catch (e) {
        if (e.message === 'user') { _online.error = `Pseudo introuvable sur ${site}.`; _online.errKind = 'user'; _online.formOpen = true; }
        else { _online.error = 'Impossible de joindre le site.'; _online.errKind = 'net'; }
    }
    _online.busy = false;
    renderOnlinePane();
}

function openOnlineGame(i) {
    const row = _online.rows && _online.rows[Number(i)];
    if (!row) return;
    closeGameReview();
    closeData();
    openPlay(row.color);
    showReviewResult(row.res);
}

// Clic sur une ligne : dès 920 px, la partie est montrée à droite ; sur téléphone, elle s'ouvre dans Jouer.
function onlineRow(i) {
    if (!_onlineWide()) { openOnlineGame(i); return; }
    _online.sel = Number(i);
    _renderOnlineResults();
    const row = document.querySelector(`#online-results .online-row[data-arg="${Number(i)}"]`);
    if (row) row.focus({ preventScroll: true });
}

// « Voir dans l'Arbre » : Jouer sur la position déviante, onglet Arbre ouvert.
function onlineTree(i) {
    openOnlineGame(i);
    if (typeof showSideTab === 'function') showSideTab('tree');
}

function onlineFilter(key) {
    _online.filter = _online.filter === key && !_online.formOpen ? null : key;
    _online.formOpen = false;
    renderOnlinePane();
}

function onlineEditSource() {
    _online.formOpen = true;
    if (_online.errKind === 'net' || _online.errKind === 'empty') { _online.errKind = ''; _online.error = ''; }
    renderOnlinePane();
    const u = document.getElementById('online-user');
    if (u && _reviewTab === 'online') u.focus({ preventScroll: true });
}

function onlineRefetch() {
    const u = document.getElementById('online-user');
    if (_online.src && u) {
        u.value = _online.src.user;
        if (_online.src.site !== _onlinePrefs().site) _saveOnlinePrefs({ ..._onlinePrefs(), site: _online.src.site });
    }
    _reviewTab = 'online';
    return runOnlineFetch();
}

function onlineMore(n) {
    setOnlineCount(n);
    return onlineRefetch();
}

function toggleOnlineSeen() {
    _online.showSeen = !_online.showSeen;
    _renderOnlineResults();
}

registerActions({ openOnlineGame, toggleOnlineSeen, setOnlineSite, setOnlineCount, onlineRow, onlineTree, onlineFilter, onlineEditSource, onlineRefetch, onlineMore });
