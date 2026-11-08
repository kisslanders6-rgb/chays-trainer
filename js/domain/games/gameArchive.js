/**
 * domain/games/gameArchive.js
 * ──────────────────────────────────────────────────────────────────────────
 * Parties Chess.com et Lichess gardées sur l'appareil pour l'onglet Statistiques › Parties (API publiques, sans clé).
 * Une partie normalisée : { id, site, user, at, color, me, opp, rated, result: 'w' | 'd' | 'l', speed, accuracy?, sans }.
 *   speed : 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily' ; me / opp : Elo après la partie ; sans : 60 demi-coups au plus.
 * Stockage IndexedDB (« chays-games ») : trop volumineux pour localStorage, recalculable, donc ni sauvegardé ni synchronisé.
 * Requêtes l'une après l'autre, comme le demandent les deux sites. Sans IndexedDB : mémoire de la session.
 */

'use strict';

const GameArchive = (function () {
    const MAX_PER_SITE = 2000, MONTHS = 12, KEEP_PLIES = 60, STORE = 'games';
    const CC_DRAWS = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];
    const LI_SPEEDS = { ultraBullet: 'bullet', bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', correspondence: 'daily' };

    // ─── NORMALISATION (pure) ────────────────────────────────────────────────
    function sansFromPgn(pgn) {
        return String(pgn || '').replace(/^\[[^\]]*\]\s*$/gm, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\$\d+/g, ' ')
            .replace(/\d+\.+/g, ' ').split(/\s+/).filter(t => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)).slice(0, KEEP_PLIES);
    }

    function fromChesscom(g, user) {
        const u = user.toLowerCase();
        if (g.rules !== 'chess' || !g.pgn || !g.white || !g.black) return null;
        if (/\[SetUp "1"\]/.test(g.pgn)) return null;
        const color = (g.white.username || '').toLowerCase() === u ? 'w' : (g.black.username || '').toLowerCase() === u ? 'b' : null;
        if (!color) return null;
        const mine = color === 'w' ? g.white : g.black, other = color === 'w' ? g.black : g.white;
        const result = mine.result === 'win' ? 'w' : CC_DRAWS.includes(mine.result) ? 'd' : 'l';
        const acc = g.accuracies ? g.accuracies[color === 'w' ? 'white' : 'black'] : undefined;
        const out = { id: 'cc:' + (g.uuid || g.url), site: 'chesscom', user: u, at: g.end_time * 1000, color, me: mine.rating, opp: other.rating,
                      rated: !!g.rated, result, speed: g.time_class === 'daily' ? 'daily' : g.time_class, sans: sansFromPgn(g.pgn) };
        if (Number.isFinite(acc)) out.accuracy = acc;
        return out;
    }

    function fromLichess(g, user) {
        const u = user.toLowerCase();
        if (g.variant !== 'standard' || !g.moves || !g.players || g.status === 'started' || g.initialFen) return null;
        const idOf = p => p && p.user ? String(p.user.id || p.user.name).toLowerCase() : '';
        const color = idOf(g.players.white) === u ? 'w' : idOf(g.players.black) === u ? 'b' : null;
        if (!color) return null;
        const mine = color === 'w' ? g.players.white : g.players.black, other = color === 'w' ? g.players.black : g.players.white;
        const result = !g.winner ? 'd' : (g.winner === 'white') === (color === 'w') ? 'w' : 'l';
        const out = { id: 'li:' + g.id, site: 'lichess', user: u, at: g.lastMoveAt || g.createdAt, color, me: mine.rating, opp: other.rating,
                      rated: !!g.rated, result, speed: LI_SPEEDS[g.speed] || g.speed, sans: g.moves.split(' ').slice(0, KEEP_PLIES) };
        if (mine.analysis && Number.isFinite(mine.analysis.accuracy)) out.accuracy = mine.analysis.accuracy;
        return out;
    }

    // ─── CALCULS (purs) ──────────────────────────────────────────────────────
    function tally(list) {
        const t = { n: list.length, w: 0, d: 0, l: 0 };
        list.forEach(g => { t[g.result]++; });
        t.score = t.n ? Math.round(100 * (t.w + t.d / 2) / t.n) : 0;
        return t;
    }
    // Elo après chaque partie classée d'une cadence, de la plus ancienne à la plus récente.
    const eloSeries = (list, speed) => list.filter(g => g.rated && g.speed === speed && Number.isFinite(g.me)).sort((a, b) => a.at - b.at).map(g => ({ at: g.at, r: g.me }));

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
    // Chess.com : archives mensuelles, de la plus récente au mois de la dernière partie connue.
    async function pullChesscom(user, latest, onProgress) {
        const u = encodeURIComponent(user.toLowerCase());
        const months = ((await json(`https://api.chess.com/pub/player/${u}/games/archives`)).archives || []).slice(-MONTHS).reverse();
        const oldest = latest ? new Date(latest).toISOString().slice(0, 7).replace('-', '/') : '';
        const out = [];
        for (const url of months) {
            if (oldest && url.slice(-7) < oldest) break;
            let data;
            try { data = await json(url); } catch (e) { if (e.message === 'limit') throw e; continue; }   // mois en cours parfois absent
            (data.games || []).forEach(g => { const n = fromChesscom(g, user); if (n) out.push(n); });
            onProgress(out.length);
            if (out.length >= MAX_PER_SITE) break;
        }
        return out;
    }
    async function pullLichess(user, latest, onProgress) {
        const since = latest ? latest + 1 : Date.now() - MONTHS * 30 * 864e5;
        const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${MAX_PER_SITE}&since=${since}&moves=true&opening=false&accuracy=true&clocks=false&evals=false`;
        const res = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
        if (res.status === 404) throw new Error('user');
        if (res.status === 429) throw new Error('limit');
        if (!res.ok) throw new Error('http');
        const out = [];
        (await res.text()).split('\n').filter(Boolean).forEach(l => { try { const n = fromLichess(JSON.parse(l), user); if (n) out.push(n); } catch (e) { /* ligne illisible */ } });
        onProgress(out.length);
        return out;
    }

    // Complète l'archive d'un site ; renvoie le nombre de parties nouvelles. Erreur : 'user' | 'limit' | 'http'.
    async function sync(site, user, onProgress = () => {}) {
        const u = user.toLowerCase(), have = (await all()).filter(g => g.site === site && g.user === u);
        const latest = have.length ? have[have.length - 1].at : 0;
        const pulled = await (site === 'lichess' ? pullLichess : pullChesscom)(user, latest, onProgress);
        const known = new Set(have.map(g => g.id)), fresh = pulled.filter(g => !known.has(g.id));
        const total = [...have, ...fresh].sort((a, b) => a.at - b.at);
        await write(fresh, total.slice(0, Math.max(0, total.length - MAX_PER_SITE)).map(g => g.id));
        return fresh.length;
    }

    return { sansFromPgn, fromChesscom, fromLichess, tally, eloSeries, all, sync };
})();
