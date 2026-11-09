/**
 * domain/games/gameQuality.js
 * ──────────────────────────────────────────────────────────────────────────
 * Qualité de jeu d'après les évaluations coup par coup (Stockfish ou Lichess), mêmes calculs pour les deux sites, purs.
 *   Perte d'un coup : baisse du pourcentage de gain (formule de Lichess). Imprécision 5 points, erreur 10, gaffe 15.
 *   Précision d'un coup : formule de Lichess ; précision d'une partie : celle du site si elle existe, sinon moyenne arithmétique et harmonique de ses coups.
 *   quality(parties)  précision, erreurs pour 40 coups, précision par phase (moi et l'adversaire), conversion, résistance, erreurs punies ou non, courbe.
 *   months(parties, n, now)  précision par mois. exitBuckets(lignes)  score selon l'évaluation à la sortie du répertoire.
 */

'use strict';

const GameQuality = (function () {
    const LIMIT = 1000, START = 20, INACCURACY = 5, MISTAKE = 10, BLUNDER = 15, ADVANTAGE = 200, ADVANTAGE_PLY = 10, CURVE_LIMIT = 600, MID_PLY = 24;
    const sum = OpeningReport.summarize, exitEval = OpeningReport.exitEval;
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    const win = cp => 50 + 50 * (2 / (1 + Math.exp(-.00368208 * clamp(cp, LIMIT))) - 1);
    const moveAccuracy = drop => Math.min(100, Math.max(0, 103.1668 * Math.exp(-.04354 * drop) - 3.1669 + 1));
    const hasEv = g => Array.isArray(g.ev) && g.ev.length > 0;
    const cache = new WeakMap();

    function phaseOf(g, ply) {
        const [middle, end] = g.div || [MID_PLY, 0];
        return end && ply >= end ? 2 : middle && ply >= middle ? 1 : 0;
    }
    const side = () => ({ n: 0, acc: 0, harm: 0, inaccuracy: 0, mistake: 0, blunder: 0, phases: [{ n: 0, acc: 0 }, { n: 0, acc: 0 }, { n: 0, acc: 0 }] });

    // Bilan d'une partie, gardé tant que la partie vit en mémoire.
    function perGame(g) {
        if (cache.has(g)) return cache.get(g);
        const me = side(), opp = side(), mine = g.color === 'w' ? 0 : 1;
        const punish = { chances: 0, taken: 0 }, luck = { errors: 0, unpunished: 0 };
        let peak = -Infinity, low = Infinity, prevDrop = 0;
        const ev = g.ev;
        for (let i = 0; i < ev.length; i++) {
            const sign = i % 2 === 0 ? 1 : -1, before = (i ? ev[i - 1] : START) * sign, after = ev[i] * sign, drop = Math.max(0, win(before) - win(after));
            const isMine = i % 2 === mine, s = isMine ? me : opp, acc = moveAccuracy(drop), p = phaseOf(g, i + 1);
            s.n++; s.acc += acc; s.harm += 1 / Math.max(acc, 1); s.phases[p].n++; s.phases[p].acc += acc;
            if (drop >= BLUNDER) s.blunder++; else if (drop >= MISTAKE) s.mistake++; else if (drop >= INACCURACY) s.inaccuracy++;
            if (i && prevDrop >= MISTAKE) {
                if (isMine) { punish.chances++; if (drop < INACCURACY) punish.taken++; }
                else { luck.errors++; if (drop >= INACCURACY) luck.unpunished++; }
            }
            prevDrop = drop;
            if (i >= ADVANTAGE_PLY) { const v = ev[i] * (g.color === 'w' ? 1 : -1); peak = Math.max(peak, v); low = Math.min(low, v); }
        }
        // Précision d'une partie : moyenne arithmétique et harmonique de ses coups (une gaffe pèse lourd). Écart mesuré avec Chess.com : 3,7 points.
        const blend = s => s.n ? (s.acc / s.n + s.n / s.harm) / 2 : null;
        const out = { me, opp, punish, luck, peak, low, accuracy: blend(me), oppAccuracy: blend(opp) };
        cache.set(g, out);
        return out;
    }

    function total(games, who) {
        const t = side();
        games.forEach(g => {
            const s = perGame(g)[who];
            ['n', 'acc', 'inaccuracy', 'mistake', 'blunder'].forEach(k => { t[k] += s[k]; });
            s.phases.forEach((p, i) => { t.phases[i].n += p.n; t.phases[i].acc += p.acc; });
        });
        const per40 = k => t.n ? 40 * t[k] / t.n : null;
        // La précision du site prime quand elle existe ; sinon celle calculée ici.
        const site = who === 'me' ? 'accuracy' : 'oppAccuracy', values = games.map(g => Number.isFinite(g[site]) ? g[site] : perGame(g)[site]).filter(Number.isFinite);
        return { moves: t.n, accuracy: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, inaccuracy: per40('inaccuracy'), mistake: per40('mistake'), blunder: per40('blunder'), phases: t.phases.map(p => p.n ? p.acc / p.n : null) };
    }

    function curve(games, maxMove = 50) {
        const floor = Math.max(3, Math.ceil(games.length * .1)), out = [];
        for (let move = 1; move <= maxMove; move++) {
            const v = [];
            games.forEach(g => { const c = g.ev[2 * move - 1]; if (Number.isFinite(c)) v.push(clamp(c * (g.color === 'w' ? 1 : -1), CURVE_LIMIT)); });
            if (v.length < floor) break;
            out.push({ move, cp: v.reduce((a, b) => a + b, 0) / v.length, n: v.length });
        }
        return out;
    }

    function quality(list) {
        const games = list.filter(hasEv), rows = games.map(perGame);
        const add = (a, k) => rows.reduce((s, r) => s + r[a][k], 0), pct = (a, b) => b ? 100 * a / b : null;
        return {
            games: games.length, me: total(games, 'me'), opp: total(games, 'opp'),
            conversion: sum(games.filter(g => perGame(g).peak >= ADVANTAGE)), resistance: sum(games.filter(g => perGame(g).low <= -ADVANTAGE)),
            punished: pct(add('punish', 'taken'), add('punish', 'chances')), chances: add('punish', 'chances'),
            unpunished: pct(add('luck', 'unpunished'), add('luck', 'errors')), errors: add('luck', 'errors'),
            curve: curve(games)
        };
    }

    function months(list, count, now) {
        const end = new Date(now), out = [], games = list.filter(hasEv);
        for (let i = count - 1; i >= 0; i--) {
            const from = new Date(end.getFullYear(), end.getMonth() - i, 1).getTime(), to = new Date(end.getFullYear(), end.getMonth() - i + 1, 1).getTime();
            const of = games.filter(g => g.at >= from && g.at < to);
            out.push({ at: from, n: of.length, accuracy: of.length ? total(of, 'me').accuracy : null });
        }
        return out;
    }

    // Cinq tranches, de la sortie la plus mauvaise à la meilleure (centipions).
    function exitBuckets(rows) {
        const out = [[], [], [], [], []];
        rows.forEach(({ g, a }) => {
            const v = exitEval(g, a.path.length);
            if (v !== null) out[v <= -100 ? 0 : v < -30 ? 1 : v <= 30 ? 2 : v < 100 ? 3 : 4].push(g);
        });
        return out.map(sum);
    }

    return { win, moveAccuracy, hasEv, perGame, quality, months, exitBuckets };
})();
