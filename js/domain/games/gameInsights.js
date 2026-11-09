/**
 * domain/games/gameInsights.js
 * ──────────────────────────────────────────────────────────────────────────
 * Calculs du bilan général et du temps (Statistiques › Parties), purs : ni écran ni stockage.
 *   Bilan : byGap, heat (jour × tranche de 4 h), sessions, ends, records, volume.
 *   Temps : timeCurve, exitClock, zeitnot, leadAtMove, thinking. Une horloge se lit en part du temps initial, comparable d'une cadence à l'autre.
 * Une partie : celle de GameArchive ; une ligne : { g, a } (StatsGames.analysed). Résumés : OpeningReport.summarize.
 */

'use strict';

const GameInsights = (function () {
    const MIN = 5, SESSION_GAP = 30 * 60e3, ZEITNOT = .1, LEAD_MOVE = 20, THOUGHT = 1.5;
    const sum = OpeningReport.summarize, meOf = OpeningReport.meOf, oppOf = OpeningReport.oppOf, base = OpeningReport.clockBase;
    const startOf = g => g.start || g.at;
    const groupSum = groups => groups.map(sum);
    const avg = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
    const myPly = (g, move) => 2 * (move - 1) + (g.color === 'w' ? 0 : 1);
    const oppPly = (g, move) => 2 * (move - 1) + (g.color === 'w' ? 1 : 0);
    const clockable = g => base(g) > 0 && Array.isArray(g.clk);

    // ─── BILAN ───────────────────────────────────────────────────────────────
    // Cinq tranches d'écart (Elo de l'adversaire moins le mien), du plus fort au plus faible.
    function byGap(list) {
        const out = [[], [], [], [], []];
        list.forEach(g => {
            const me = meOf(g), opp = oppOf(g);
            if (!Number.isFinite(me) || !Number.isFinite(opp)) return;
            const d = opp - me;
            out[d >= 150 ? 0 : d >= 50 ? 1 : d > -50 ? 2 : d > -150 ? 3 : 4].push(g);
        });
        return groupSum(out);
    }

    // Score par jour (lundi d'abord) et tranche de 4 h, à l'heure locale de début.
    function heat(list) {
        const cells = Array.from({ length: 7 }, () => Array.from({ length: 6 }, () => []));
        list.forEach(g => { const d = new Date(startOf(g)); cells[(d.getDay() + 6) % 7][Math.floor(d.getHours() / 4)].push(g); });
        const grid = cells.map(groupSum), flat = [];
        grid.forEach((row, day) => row.forEach((t, slot) => { if (t.n >= MIN) flat.push({ day, slot, t }); }));
        flat.sort((a, b) => b.t.score - a.t.score);
        return { grid, best: flat[0] || null, worst: flat.length > 1 ? flat[flat.length - 1] : null };
    }

    // Une session : parties séparées de moins de 30 min. Score selon le rang dans la session et selon les défaites d'affilée juste avant.
    function sessions(list) {
        const sorted = list.slice().sort((a, b) => startOf(a) - startOf(b)), ranks = [[], [], [], [], []], after = [[], [], []];
        let rank = 0, losses = 0, prevEnd = 0, count = 0;
        sorted.forEach(g => {
            if (!prevEnd || startOf(g) - prevEnd > SESSION_GAP) { rank = 0; losses = 0; count++; }
            ranks[Math.min(rank, 4)].push(g);
            if (losses) after[Math.min(losses, 3) - 1].push(g);
            rank++;
            losses = g.result === 'l' ? losses + 1 : 0;
            prevEnd = g.at;
        });
        return { count, ranks: groupSum(ranks), after: groupSum(after) };
    }

    // Comment finissent les parties : gains et défaites, en part de chacun ; nulles à part.
    function ends(list) {
        const known = list.filter(g => g.end), part = kind => {
            const of = known.filter(g => g.result === kind), out = { n: of.length };
            ['mate', 'resign', 'time', 'abandon', 'other'].forEach(e => { out[e] = of.length ? 100 * of.filter(g => (['mate', 'resign', 'time', 'abandon'].includes(g.end) ? g.end : 'other') === e).length / of.length : 0; });
            return out;
        };
        return { wins: part('w'), losses: part('l'), draws: known.filter(g => g.result === 'd').length };
    }

    // Meilleur Elo, plus longue série de gains, plus forte baisse depuis un sommet. Parties classées d'un même site et d'une même cadence.
    function records(list) {
        const rated = list.filter(g => g.rated && Number.isFinite(g.me)).sort((a, b) => a.at - b.at);
        if (!rated.length) return null;
        let best = rated[0], peak = rated[0].me, drop = 0, run = 0, streak = 0;
        rated.forEach(g => {
            if (g.me > best.me) best = g;
            peak = Math.max(peak, g.me);
            drop = Math.max(drop, peak - g.me);
            run = g.result === 'w' ? run + 1 : 0;
            streak = Math.max(streak, run);
        });
        return { best: best.me, bestAt: best.at, streak, drop };
    }

    // Par mois civil : parties, variation d'Elo ; moyenne des mois les plus joués contre les autres. Liste d'un seul site et d'une seule cadence.
    function volume(list, count, now) {
        const end = new Date(now), months = [];
        for (let i = count - 1; i >= 0; i--) {
            const from = new Date(end.getFullYear(), end.getMonth() - i, 1).getTime(), to = new Date(end.getFullYear(), end.getMonth() - i + 1, 1).getTime();
            const of = list.filter(g => g.rated && Number.isFinite(g.me) && g.at >= from && g.at < to).sort((a, b) => a.at - b.at), first = of[0], last = of[of.length - 1];
            const start = first ? (Number.isFinite(first.me0) ? first.me0 : first.me) : 0;
            months.push({ at: from, n: of.length, delta: of.length >= 2 ? last.me - start : null });
        }
        const active = months.filter(m => m.delta !== null && m.n >= MIN).sort((a, b) => b.n - a.n);
        if (active.length < 4) return { months, high: null, low: null };
        const half = Math.floor(active.length / 2);
        return { months, high: avg(active.slice(0, half).map(m => m.delta)), low: avg(active.slice(half).map(m => m.delta)) };
    }

    // ─── TEMPS ───────────────────────────────────────────────────────────────
    // Temps restant moyen après chaque coup, en % du temps initial : moi et l'adversaire. S'arrête quand trop peu de parties vont si loin.
    function timeCurve(list, maxMove = 60) {
        const games = list.filter(clockable), floor = Math.max(3, Math.ceil(games.length * .1)), out = [];
        for (let move = 1; move <= maxMove; move++) {
            const me = [], opp = [];
            games.forEach(g => {
                const a = g.clk[myPly(g, move)], b = g.clk[oppPly(g, move)];
                if (Number.isFinite(a) && Number.isFinite(b)) { me.push(a / base(g)); opp.push(b / base(g)); }
            });
            if (me.length < floor) break;
            out.push({ move, me: avg(me), opp: avg(opp), n: me.length });
        }
        return { games: games.length, points: out };
    }

    // Avance à l'horloge à la sortie du répertoire : moyenne, score en avance, score en retard.
    function exitClock(rows) {
        const seen = rows.map(({ g, a }) => ({ g, lead: OpeningReport.clockLead(g, a.path.length) })).filter(x => x.lead !== null);
        return { n: seen.length, lead: avg(seen.map(x => x.lead)), ahead: sum(seen.filter(x => x.lead >= 0).map(x => x.g)), behind: sum(seen.filter(x => x.lead < 0).map(x => x.g)) };
    }

    // Zeitnot : coups joués avec moins de 10 % du temps initial. Part de mes coups et de ceux de l'adversaire, score avec ou sans.
    function zeitnot(list) {
        const games = list.filter(clockable), withIt = [], without = [];
        let mine = 0, mineLow = 0, theirs = 0, theirsLow = 0;
        games.forEach(g => {
            const limit = base(g) * 100 * ZEITNOT;                  // horloges en centièmes de seconde
            let low = false;
            g.clk.forEach((c, i) => {
                const own = (i % 2 === 0) === (g.color === 'w');
                if (own) { mine++; if (c < limit) { mineLow++; low = true; } } else { theirs++; if (c < limit) theirsLow++; }
            });
            (low ? withIt : without).push(g);
        });
        return { games: games.length, share: mine ? 100 * mineLow / mine : null, oppShare: theirs ? 100 * theirsLow / theirs : null, withIt: sum(withIt), without: sum(without) };
    }

    // Score selon l'avance à l'horloge au coup 20, en cinq tranches, du plus grand retard à la plus grande avance.
    function leadAtMove(list, move = LEAD_MOVE) {
        const out = [[], [], [], [], []];
        list.filter(clockable).forEach(g => {
            const a = g.clk[myPly(g, move)], b = g.clk[oppPly(g, move)];
            if (!Number.isFinite(a) || !Number.isFinite(b)) return;
            const d = (a - b) / base(g);
            out[d <= -20 ? 0 : d < -5 ? 1 : d <= 5 ? 2 : d < 20 ? 3 : 4].push(g);
        });
        return groupSum(out);
    }

    // Temps passé sur un coup, en secondes : horloge d'avant moins horloge d'après, plus l'incrément.
    function spent(g, i) {
        if (!Number.isFinite(g.clk[i])) return null;
        const before = i >= 2 ? g.clk[i - 2] : g.tc[0] * 100;
        return Number.isFinite(before) ? Math.max(0, before - g.clk[i] + g.tc[1] * 100) / 100 : null;
    }

    // Premier coup hors répertoire : temps moyen, temps moyen de mes vingt coups suivants, score selon que j'y ai réfléchi (1,5 fois mon rythme) ou non.
    function thinking(rows) {
        const first = [], usual = [], thought = [], quick = [];
        rows.forEach(({ g, a }) => {
            if (!clockable(g) || !a.dev) return;
            const i = a.dev.by === 'me' ? a.dev.ply : a.dev.ply + 1, t = spent(g, i);
            if (t === null) return;
            const next = [];
            for (let k = i + 2; k < i + 42 && k < g.clk.length; k += 2) { const s = spent(g, k); if (s !== null) next.push(s); }
            if (next.length < 3) return;
            const pace = avg(next);
            first.push(t); usual.push(pace);
            (t >= pace * THOUGHT ? thought : quick).push(g);
        });
        return { n: first.length, first: avg(first), usual: avg(usual), thought: sum(thought), quick: sum(quick) };
    }

    return { MIN, LEAD_MOVE, byGap, heat, sessions, ends, records, volume, timeCurve, exitClock, zeitnot, leadAtMove, thinking };
})();
