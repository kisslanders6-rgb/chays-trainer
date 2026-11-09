/**
 * domain/games/openingReport.js
 * ──────────────────────────────────────────────────────────────────────────
 * Calculs de la fiche d'une ouverture (Statistiques › Par ouverture), purs : ni écran ni stockage.
 *   summarize(parties)         score, score attendu d'après l'Elo, écart, points perdus, performance.
 *   months(parties, n, now)    score et attendu de chacun des n derniers mois civils.
 *   detail(lignes, minPly)     répertoire suivi ou quitté, couverture, profondeur, réponses adverses, coups joués à la place.
 *   clockLead(partie, demi-coups)  avance à l'horloge après ces demi-coups, en points de temps initial.
 *   exitEval(partie, demi-coups)   évaluation de mon point de vue après ces demi-coups (centipions, bornée), ou null.
 *   diagnose(n, écart, maîtrise, évaluation?)   'learn' | 'replace' | 'through' | 'losing' | 'consolidate' | 'keep', ou null sans assez d'éléments.
 * Une partie : celle de GameArchive. Une ligne : { g: partie, a: { dev, path, played } } (StatsGames.analysed).
 *   dev : déviation retenue (detectDeviation) ou null ; path : coups UCI joués dans le répertoire ; played : mon coup à la place du coup prévu.
 */

'use strict';

const OpeningReport = (function () {
    const MIN_DIAGNOSIS = 5, MIN_PERF = 3, MIN_EVAL = 3, LOSING = -3, KNOWN = 60, EVAL_LIMIT = 1000, EVEN = 30;

    const expected = (me, opp) => 1 / (1 + Math.pow(10, (opp - me) / 400));
    const meOf = g => Number.isFinite(g.me0) ? g.me0 : g.me, oppOf = g => Number.isFinite(g.opp0) ? g.opp0 : g.opp;     // Elo d'avant la partie quand il est connu
    const hasElo = g => Number.isFinite(meOf(g)) && Number.isFinite(oppOf(g));
    const clockBase = g => g.tc && g.tc[0] > 0 && Array.isArray(g.clk) ? g.tc[0] : 0;
    const points = g => g.result === 'w' ? 1 : g.result === 'd' ? .5 : 0;

    function summarize(list) {
        const t = { n: list.length, w: 0, d: 0, l: 0, score: 0, expected: null, delta: null, lost: 0, perf: null };
        let pts = 0, ptsElo = 0, exp = 0, opp = 0, withElo = 0;
        list.forEach(g => {
            t[g.result]++;
            pts += points(g);
            if (hasElo(g)) { withElo++; ptsElo += points(g); exp += expected(meOf(g), oppOf(g)); opp += oppOf(g); }
        });
        if (!t.n) return t;
        t.score = 100 * pts / t.n;
        if (withElo) {
            t.expected = 100 * exp / withElo;
            t.delta = 100 * (ptsElo - exp) / withElo;
            t.lost = exp - ptsElo;
            if (withElo >= MIN_PERF) { const s = Math.min(.95, Math.max(.05, ptsElo / withElo)); t.perf = Math.round(opp / withElo + 400 * Math.log10(s / (1 - s))); }
        }
        return t;
    }

    function months(list, count, now) {
        const end = new Date(now), out = [];
        for (let i = count - 1; i >= 0; i--) {
            const from = new Date(end.getFullYear(), end.getMonth() - i, 1).getTime(), to = new Date(end.getFullYear(), end.getMonth() - i + 1, 1).getTime();
            out.push({ at: from, ...summarize(list.filter(g => g.at >= from && g.at < to)) });
        }
        return out;
    }

    // Demi-coup de l'adversaire ? (indice à partir de 0 ; les Blancs jouent les indices pairs.)
    const oppPly = (i, color) => (i % 2 === 0) === (color === 'b');

    // Écart entre mon horloge et celle de l'adversaire après leur dernier coup dans ces demi-coups, en % du temps initial. null sans horloge.
    function clockLead(g, plies) {
        const base = clockBase(g);
        if (!base || plies < 2) return null;
        const last = plies - 1, mine = (last % 2 === 0) === (g.color === 'w') ? last : last - 1, theirs = mine === last ? last - 1 : last;
        return Number.isFinite(g.clk[mine]) && Number.isFinite(g.clk[theirs]) ? (g.clk[mine] - g.clk[theirs]) / base : null;
    }

    function exitEval(g, plies) {
        if (!Array.isArray(g.ev) || plies < 1 || !Number.isFinite(g.ev[plies - 1])) return null;
        return Math.max(-EVAL_LIMIT, Math.min(EVAL_LIMIT, g.ev[plies - 1] * (g.color === 'w' ? 1 : -1)));
    }

    function detail(rows, minPly = 0) {
        const kept = [], left = [], hist = {}, seen = new Map(), swaps = new Map(), parents = new Map(), leads = [], evals = [], good = [], bad = [];
        let gaps = 0, depth = 0;
        rows.forEach(({ g, a }) => {
            const dev = a.dev, byMe = !!dev && dev.by === 'me', gap = !!dev && dev.by === 'opp' && !dev.endOfLine;
            (byMe ? left : kept).push(g);
            if (gap) gaps++;
            depth += dev ? dev.ply : a.path.length;
            const lead = clockLead(g, a.path.length);
            if (lead !== null) leads.push(lead);
            const ev = exitEval(g, a.path.length);
            if (ev !== null) { evals.push(ev); if (ev >= EVEN) good.push(g); else if (ev <= -EVEN) bad.push(g); }
            if (byMe || gap) { const m = hist[Math.ceil((dev.ply + 1) / 2)] = hist[Math.ceil((dev.ply + 1) / 2)] || { me: 0, gap: 0 }; m[byMe ? 'me' : 'gap']++; }
            for (let i = minPly; i < a.path.length; i++) {
                if (!oppPly(i, g.color)) continue;
                const before = a.path.slice(0, i).join(' '), key = `${before}|${a.path[i]}`;
                parents.set(before, (parents.get(before) || 0) + 1);
                const r = seen.get(key) || { key, before, ply: i + 1, san: g.sans[i], uci: a.path[i], games: [], state: 'covered' };
                r.games.push(g);
                if (dev && dev.by === 'opp' && dev.ply === i) r.state = dev.endOfLine ? 'end' : 'missing';
                seen.set(key, r);
            }
            if (byMe && dev.expected && a.played) {
                const key = `${dev.key}|${a.played.uci}`, s = swaps.get(key) || { key: dev.key, ply: dev.ply + 1, played: a.played.san, expected: dev.expected.san, games: [] };
                s.games.push(g);
                swaps.set(key, s);
            }
        });
        const n = rows.length;
        return {
            n, kept: summarize(kept), left: summarize(left),
            followed: n ? 100 * kept.length / n : null,
            coverage: n ? 100 * (n - gaps) / n : null,
            exitMove: n ? Math.max(1, Math.ceil(depth / n / 2)) : null,
            exitClock: leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null,
            exitEval: evals.length >= MIN_EVAL ? evals.reduce((a, b) => a + b, 0) / evals.length : null,
            exitGood: summarize(good), exitBad: summarize(bad),
            hist,
            replies: [...seen.values()].map(r => ({ ...r, n: r.games.length, share: 100 * r.games.length / parents.get(r.before), t: summarize(r.games) })).sort((a, b) => b.n - a.n || a.ply - b.ply),
            swaps: [...swaps.values()].map(s => ({ ...s, n: s.games.length, t: summarize(s.games) })).sort((a, b) => b.n - a.n || a.ply - b.ply)
        };
    }

    function diagnose(n, delta, mastery, exit = null) {
        if (n < MIN_DIAGNOSIS || delta === null || mastery === null) return null;
        if (mastery < KNOWN) return delta < 0 ? 'learn' : 'consolidate';
        if (delta >= LOSING) return 'keep';
        return exit === null ? 'losing' : exit < 0 ? 'replace' : 'through';
    }

    return { KNOWN, expected, meOf, oppOf, clockBase, clockLead, exitEval, summarize, months, detail, diagnose };
})();
