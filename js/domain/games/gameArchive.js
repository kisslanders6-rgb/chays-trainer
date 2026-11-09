/**
 * domain/games/gameArchive.js
 * ──────────────────────────────────────────────────────────────────────────
 * Parties Chess.com et Lichess gardées sur l'appareil pour l'onglet Statistiques › Parties (API publiques, sans clé).
 * Une partie normalisée (version SCHEMA) : { v, id, site, user, at, start, color, me, opp, me0?, opp0?, rated, result: 'w' | 'd' | 'l', end, speed, tc?, sans, clk?,
 *   accuracy?, oppAccuracy?, err?, oppErr?, phases?, oppPhases?, ev?, div? }.
 *   at / start : fin et début (ms) ; speed : 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily' ; tc : [base, incrément] en secondes ; sans : tous les demi-coups.
 *   me / opp : Elo après la partie ; me0 / opp0 : Elo avant. Lichess donne l'Elo d'avant et ratingDiff ; Chess.com celui d'après : withPreGame le déduit à la lecture.
 *   end : 'mate' | 'resign' | 'time' | 'abandon' | 'stalemate' | 'draw' | 'other' ; clk : temps restant après chaque demi-coup, en centièmes de seconde (absent par correspondance).
 *   Sans évaluations du site (Chess.com, Lichess non analysé) : ev, div et evBy viennent de GameEval ; evFail : partie illisible.
 *   Lichess, parties analysées : err / oppErr [imprécisions, erreurs, gaffes, ACPL], phases { opening, middlegame, endgame }, ev (centipions du point de vue des Blancs, mat : ±(MATE − n)), div [milieu, finale].
 * Stockage IndexedDB (« chays-games ») : trop volumineux pour localStorage, recalculable, donc ni sauvegardé ni synchronisé. Une partie d'une version antérieure est retéléchargée.
 * 12 mois par défaut ; backfill remonte tout l'historique, MAX_PER_SITE parties au plus.
 * Requêtes l'une après l'autre, comme le demandent les deux sites ; Lichess est lu en flux. Sans IndexedDB : mémoire de la session.
 * Niveau réel : dernier Elo par site et par cadence, gardé en résumé (chessTrainer_eloLevels, local) pour être lu sans attendre IndexedDB.
 *   level() applique le choix mémorisé (préférences eloSite, eloSpeed) ; Statistiques, Compte et l'explorateur Lichess le partagent.
 */

'use strict';

const GameArchive = (function () {
    const SCHEMA = 2, MAX_PER_SITE = 10000, MONTHS = 12, STORE = 'games', MATE = 10000, MAX_RATING_STEP = 64;
    const CC_DRAWS = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];
    const CC_ENDS = { checkmated: 'mate', resigned: 'resign', timeout: 'time', abandoned: 'abandon', stalemate: 'stalemate', agreed: 'draw', repetition: 'draw', insufficient: 'draw', '50move': 'draw', timevsinsufficient: 'draw' };
    const LI_ENDS = { mate: 'mate', resign: 'resign', outoftime: 'time', timeout: 'abandon', stalemate: 'stalemate', draw: 'draw' };
    const LI_UNPLAYED = ['created', 'started', 'aborted', 'noStart'];
    const LI_SPEEDS = { ultraBullet: 'bullet', bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', correspondence: 'daily' };
    const SPEEDS = [['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rapide'], ['classical', 'Classique'], ['daily', 'Par correspondance']];
    const SITE_NAME = { chesscom: 'Chess.com', lichess: 'Lichess' };
    const USER_PREF = { chesscom: 'chesscomUser', lichess: 'lichessUser' };
    const LEVELS_KEY = 'chessTrainer_eloLevels';

    // ─── NORMALISATION (pure) ────────────────────────────────────────────────
    function sansFromPgn(pgn) {
        return String(pgn || '').replace(/^\[[^\]]*\]\s*$/gm, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\$\d+/g, ' ')
            .replace(/\d+\.+/g, ' ').split(/\s+/).filter(t => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
    }
    const clocksFromPgn = pgn => [...String(pgn || '').matchAll(/%clk (\d+):(\d+):(\d+(?:\.\d+)?)/g)].map(m => Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 100));
    const pgnTag = (pgn, tag) => { const m = new RegExp(`\\[${tag} "([^"]*)"\\]`).exec(String(pgn || '')); return m ? m[1] : ''; };
    function startFromPgn(pgn) {
        const d = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(pgnTag(pgn, 'UTCDate')), t = /^(\d{1,2}):(\d{2}):(\d{2})/.exec(pgnTag(pgn, 'UTCTime'));
        return d && t ? Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]) : 0;
    }
    function timeControl(text) { const m = /^(\d+)(?:\+(\d+))?$/.exec(String(text || '')); return m ? [+m[1], +(m[2] || 0)] : undefined; }
    const putIf = (o, k, v) => { if (v !== undefined && v !== null && !(typeof v === 'number' && !Number.isFinite(v))) o[k] = v; };

    function fromChesscom(g, user) {
        const u = user.toLowerCase();
        if (g.rules !== 'chess' || !g.pgn || !g.white || !g.black) return null;
        if (/\[SetUp "1"\]/.test(g.pgn)) return null;
        const color = (g.white.username || '').toLowerCase() === u ? 'w' : (g.black.username || '').toLowerCase() === u ? 'b' : null;
        if (!color) return null;
        const mine = color === 'w' ? g.white : g.black, other = color === 'w' ? g.black : g.white;
        const result = mine.result === 'win' ? 'w' : CC_DRAWS.includes(mine.result) ? 'd' : 'l';
        const at = g.end_time * 1000, speed = g.time_class === 'daily' ? 'daily' : g.time_class, clk = speed === 'daily' ? [] : clocksFromPgn(g.pgn);
        const out = { v: SCHEMA, id: 'cc:' + (g.uuid || g.url), site: 'chesscom', user: u, at, start: startFromPgn(g.pgn) || at, color, me: mine.rating, opp: other.rating,
                      rated: !!g.rated, result, end: CC_ENDS[result === 'w' ? other.result : mine.result] || 'other', speed, sans: sansFromPgn(g.pgn) };
        putIf(out, 'tc', speed === 'daily' ? undefined : timeControl(g.time_control));
        if (clk.length) out.clk = clk;
        if (g.accuracies) { putIf(out, 'accuracy', g.accuracies[color === 'w' ? 'white' : 'black']); putIf(out, 'oppAccuracy', g.accuracies[color === 'w' ? 'black' : 'white']); }
        return out;
    }

    const liErrors = a => a && Number.isFinite(a.acpl) ? [a.inaccuracy, a.mistake, a.blunder, a.acpl] : undefined;
    const liEval = a => Number.isFinite(a.mate) ? (a.mate > 0 ? MATE - a.mate : -MATE - a.mate) : a.eval;

    function fromLichess(g, user) {
        const u = user.toLowerCase();
        if (g.variant !== 'standard' || !g.moves || !g.players || LI_UNPLAYED.includes(g.status) || g.initialFen) return null;
        const idOf = p => p && p.user ? String(p.user.id || p.user.name).toLowerCase() : '';
        const color = idOf(g.players.white) === u ? 'w' : idOf(g.players.black) === u ? 'b' : null;
        if (!color) return null;
        const mine = color === 'w' ? g.players.white : g.players.black, other = color === 'w' ? g.players.black : g.players.white;
        const result = !g.winner ? 'd' : (g.winner === 'white') === (color === 'w') ? 'w' : 'l';
        const after = p => Number.isFinite(p.rating) ? p.rating + (Number.isFinite(p.ratingDiff) ? p.ratingDiff : 0) : p.rating;
        const out = { v: SCHEMA, id: 'li:' + g.id, site: 'lichess', user: u, at: g.lastMoveAt || g.createdAt, start: g.createdAt || g.lastMoveAt, color, me: after(mine), opp: after(other),
                      rated: !!g.rated, result, end: LI_ENDS[g.status] || 'other', speed: LI_SPEEDS[g.speed] || g.speed, sans: g.moves.split(' ') };
        putIf(out, 'me0', mine.rating); putIf(out, 'opp0', other.rating);
        if (g.clock) out.tc = [g.clock.initial, g.clock.increment];
        if (Array.isArray(g.clocks) && g.clocks.length) out.clk = g.clocks.slice(0, out.sans.length);     // Lichess ajoute une dernière valeur, l'horloge à la fin de la partie
        const ma = mine.analysis, oa = other.analysis;
        if (ma) { putIf(out, 'accuracy', ma.accuracy); putIf(out, 'err', liErrors(ma)); putIf(out, 'phases', ma.phases); }
        if (oa) { putIf(out, 'oppAccuracy', oa.accuracy); putIf(out, 'oppErr', liErrors(oa)); putIf(out, 'oppPhases', oa.phases); }
        if (Array.isArray(g.analysis) && g.analysis.length) out.ev = g.analysis.map(liEval);
        if (g.division && (g.division.middle || g.division.end)) out.div = [g.division.middle || 0, g.division.end || 0];
        return out;
    }

    // ─── CALCULS (purs) ──────────────────────────────────────────────────────
    function tally(list) {
        const t = { n: list.length, w: 0, d: 0, l: 0 };
        list.forEach(g => { t[g.result]++; });
        t.score = t.n ? Math.round(100 * (t.w + t.d / 2) / t.n) : 0;
        return t;
    }
    // Elo d'avant la partie là où le site ne donne que celui d'après : le mien est celui de ma partie classée précédente
    // (même site, même cadence), celui de l'adversaire est corrigé du même écart. Liste triée par date ; un trop grand saut est ignoré.
    function withPreGame(list) {
        const last = new Map();
        list.forEach(g => {
            if (!g.rated || !Number.isFinite(g.me)) return;
            const key = `${g.site}|${g.user}|${g.speed}`, prev = last.get(key);
            last.set(key, g.me);
            if (Number.isFinite(g.me0) || !Number.isFinite(prev) || Math.abs(g.me - prev) > MAX_RATING_STEP) return;
            g.me0 = prev;
            if (Number.isFinite(g.opp)) g.opp0 = g.opp + (g.me - prev);
        });
        return list;
    }
    const outdated = list => list.some(g => (g.v || 1) < SCHEMA);

    // Elo après chaque partie classée d'une cadence, de la plus ancienne à la plus récente.
    const eloSeries = (list, speed) => list.filter(g => g.rated && g.speed === speed && Number.isFinite(g.me)).sort((a, b) => a.at - b.at).map(g => ({ at: g.at, r: g.me }));

    // Dernier Elo et nombre de parties classées : { site: { cadence: { r, n } } }.
    function eloLevels(list) {
        const out = {};
        list.filter(g => g.rated && Number.isFinite(g.me) && SPEEDS.some(([s]) => s === g.speed)).sort((a, b) => a.at - b.at).forEach(g => {
            const bySite = out[g.site] = out[g.site] || {}, cell = bySite[g.speed] = bySite[g.speed] || { r: 0, n: 0 };
            cell.r = g.me; cell.n++;
        });
        return out;
    }
    // Site et cadence à montrer : le choix mémorisé s'il existe encore, sinon Chess.com et la cadence la plus jouée.
    function pickElo(levels, linked, site, speed) {
        const sites = linked.filter(s => levels[s] && Object.keys(levels[s]).length);
        if (!sites.length) return null;
        const at = sites.includes(site) ? site : sites.includes('chesscom') ? 'chesscom' : sites[0], own = levels[at];
        const sp = own[speed] ? speed : Object.keys(own).sort((a, b) => own[b].n - own[a].n)[0];
        return { r: own[sp].r, site: at, speed: sp, sites, speeds: SPEEDS.filter(([s]) => own[s]) };
    }
    // Niveau réel du joueur, ou null sans partie classée d'un compte relié.
    function level() {
        const linked = Object.keys(SITE_NAME).filter(s => appSettings[USER_PREF[s]].trim());
        return pickElo(dataStore.getJSON(LEVELS_KEY, null) || {}, linked, appSettings.eloSite, appSettings.eloSpeed);
    }

    // ─── STOCKAGE ────────────────────────────────────────────────────────────
    let dbp = null, memory = new Map();
    function db() {
        if (dbp) return dbp;
        dbp = new Promise(resolve => {
            try {
                if (typeof indexedDB === 'undefined') { resolve(null); return; }
                const rq = indexedDB.open('chays-games', 1);
                rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: 'id' });
                rq.onsuccess = () => resolve(rq.result);
                rq.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
        return dbp;
    }
    async function all() {
        const list = withPreGame(await read()), levels = eloLevels(list);
        if (JSON.stringify(levels) !== JSON.stringify(dataStore.getJSON(LEVELS_KEY, null))) dataStore.setJSON(LEVELS_KEY, levels);
        return list;
    }
    async function read() {
        const d = await db();
        if (!d) return [...memory.values()].sort((a, b) => a.at - b.at);
        return new Promise(resolve => {
            const rq = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
            rq.onsuccess = () => resolve(rq.result.sort((a, b) => a.at - b.at));
            rq.onerror = () => resolve([]);
        });
    }
    async function write(puts, drops) {
        const d = await db();
        if (!d) { puts.forEach(g => memory.set(g.id, g)); drops.forEach(id => memory.delete(id)); return; }
        return new Promise((resolve, reject) => {
            const tx = d.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
            puts.forEach(g => st.put(g));
            drops.forEach(id => st.delete(id));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // ─── RÉCUPÉRATION ────────────────────────────────────────────────────────
    async function json(url) {
        const res = await fetch(url);
        if (res.status === 404) throw new Error('user');
        if (res.status === 429) throw new Error('limit');
        if (!res.ok) throw new Error('http');
        return res.json();
    }
    const monthOf = t => new Date(t).toISOString().slice(0, 7).replace('-', '/');

    // Chess.com : archives mensuelles, de la plus récente à la plus ancienne. range : { from?, to?, last?, max }, mois « AAAA/MM » compris.
    async function pullChesscom(user, range, onProgress) {
        const u = encodeURIComponent(user.toLowerCase());
        let months = (await json(`https://api.chess.com/pub/player/${u}/games/archives`)).archives || [];
        if (range.last) months = months.slice(-range.last);
        const out = [];
        for (const url of months.slice().reverse()) {
            const month = url.slice(-7);
            if (range.to && month > range.to) continue;
            if (range.from && month < range.from) break;
            let data;
            try { data = await json(url); } catch (e) { if (e.message === 'limit') throw e; continue; }   // mois en cours parfois absent
            (data.games || []).forEach(g => { const n = fromChesscom(g, user); if (n) out.push(n); });
            onProgress(out.length);
            if (out.length >= range.max) break;
        }
        return out;
    }

    // Lichess : réponse lue au fil de l'eau, la progression avance pendant le téléchargement. range : { since?, until?, max }.
    async function pullLichess(user, range, onProgress) {
        const q = `max=${range.max}${range.since ? `&since=${range.since}` : ''}${range.until ? `&until=${range.until}` : ''}`;
        const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?${q}&moves=true&opening=false&accuracy=true&clocks=true&evals=true&division=true`;
        const res = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
        if (res.status === 404) throw new Error('user');
        if (res.status === 429) throw new Error('limit');
        if (!res.ok) throw new Error('http');
        const out = [];
        const line = l => { if (!l.trim()) return; try { const n = fromLichess(JSON.parse(l), user); if (n) out.push(n); } catch (e) { /* ligne illisible */ } };
        if (res.body && res.body.getReader && typeof TextDecoder !== 'undefined') {
            const reader = res.body.getReader(), decoder = new TextDecoder();
            let rest = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                const parts = (rest + decoder.decode(value, { stream: true })).split('\n');
                rest = parts.pop();
                parts.forEach(line);
                onProgress(out.length);
            }
            line(rest);
        } else (await res.text()).split('\n').forEach(line);
        onProgress(out.length);
        return out;
    }

    // Range des parties reçues ; une partie déjà connue n'est réécrite que si sa version est dépassée. Au-delà de MAX_PER_SITE, les plus anciennes partent.
    async function store(have, pulled) {
        const byId = new Map(have.map(g => [g.id, g])), fresh = pulled.filter(g => !byId.has(g.id) || (byId.get(g.id).v || 1) < SCHEMA);
        fresh.forEach(g => byId.set(g.id, g));
        const total = [...byId.values()].sort((a, b) => a.at - b.at);
        await write(fresh, total.slice(0, Math.max(0, total.length - MAX_PER_SITE)).map(g => g.id));
        return fresh.length;
    }
    async function mine(site, user) { const u = user.toLowerCase(); return (await all()).filter(g => g.site === site && g.user === u); }

    // Complète l'archive d'un site depuis la dernière partie à jour (12 mois sans archive) ; renvoie le nombre de parties écrites. Erreur : 'user' | 'limit' | 'http'.
    async function sync(site, user, onProgress = () => {}) {
        const have = await mine(site, user), current = have.filter(g => (g.v || 1) >= SCHEMA), latest = current.length ? current[current.length - 1].at : 0;
        const pulled = site === 'lichess'
            ? await pullLichess(user, { since: latest ? latest + 1 : Date.now() - MONTHS * 30 * 864e5, max: MAX_PER_SITE }, onProgress)
            : await pullChesscom(user, latest ? { from: monthOf(latest), last: MONTHS, max: MAX_PER_SITE } : { last: MONTHS, max: MAX_PER_SITE }, onProgress);
        return store(have, pulled);
    }

    // Remonte tout l'historique au-delà de la plus ancienne partie connue ; renvoie le nombre de parties ajoutées.
    async function backfill(site, user, onProgress = () => {}) {
        const have = await mine(site, user), room = MAX_PER_SITE - have.length;
        if (room <= 0) return 0;
        const oldest = have.length ? have[0] : null;
        const pulled = site === 'lichess'
            ? await pullLichess(user, { until: oldest ? (oldest.start || oldest.at) - 1 : 0, max: room }, onProgress)
            : await pullChesscom(user, { to: oldest ? monthOf(oldest.at) : '', max: room }, onProgress);
        return store(have, pulled);
    }

    // Archive antérieure au résumé : il est calculé une fois, sans attendre l'ouverture des Statistiques.
    if (typeof window !== 'undefined' && dataStore.get(LEVELS_KEY) === null) window.addEventListener('load', () => all().catch(() => {}));

    const saveEvals = list => write(list, []);

    return { SITE_NAME, SCHEMA, MATE, saveEvals, sansFromPgn, clocksFromPgn, fromChesscom, fromLichess, tally, withPreGame, outdated, eloSeries, eloLevels, pickElo, level, all, sync, backfill };
})();
