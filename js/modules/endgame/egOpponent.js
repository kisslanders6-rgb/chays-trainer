/**
 * modules/endgame/egOpponent.js
 * ──────────────────────────────────────────────────────────────────────────
 * Adversaire calculé des finales, appuyé sur le juge commun (egJudge.js).
 *
 *   EndgameOpponent.pick(fen, policy) → Promise<{ uci, source, exact } | null>
 *       policy 'max' (résistance maximale, défaut) ou 'human' (préférence appSettings.egOpponent).
 */

'use strict';

// Résistance maximale : l'ordre des coups renvoyé par le juge (meilleur d'abord : gain le plus rapide,
// perte la plus lointaine). En position nulle, l'adversaire « essaie » : poussée de pion, puis échec.
// Humain : un coup au hasard parmi ceux qui gardent le même résultat (en perte, parmi les trois plus tenaces).
const EndgameOpponent = {
    async pick(fen, policy, rnd = Math.random) {
        const p = await EndgameJudge.probe(fen);
        if (!p || !p.moves || !p.moves.length) return null;
        const res = EndgameJudge.result;
        const best = Math.max(...p.moves.map(m => m.wdl));
        const same = p.moves.filter(m => res(m.wdl) === res(best));
        let m;
        if (policy === 'human') {
            const pool = res(best) < 0 ? same.slice(0, 3) : same;
            m = pool[Math.floor(rnd() * pool.length)];
        } else if (res(best) === 0 && same.length > 1) {
            const push = x => x.zeroing && x.san && !x.san.includes('x');
            m = same.find(push) || same.find(x => x.san && x.san.includes('+')) || same[0];
        } else m = same[0];
        return { uci: m.uci, source: p.source, exact: p.exact };
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { EndgameOpponent };
