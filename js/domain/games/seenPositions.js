/**
 * domain/games/seenPositions.js
 * ──────────────────────────────────────────────────────────────────────────
 * Positions vues en partie : celles où j'avais le trait dans une de mes parties archivées (GameArchive),
 * sur les PLIES premiers demi-coups. Sert au filtre « Vu en partie » de l'Entraînement (préférence trainSeen).
 *   refresh()                 relit l'archive et rejoue les coups (≈ 0,1 ms par partie) ; annonce Bus 'seen:ready'.
 *   has(couleur, clé)         la position a-t-elle été atteinte ?   count(couleur, clé) : combien de parties.
 *   countIn(répertoire, couleurs)   positions du répertoire déjà atteintes.
 * L'archive n'est ni sauvegardée ni synchronisée : rien n'est gardé ici non plus, tout se recalcule au lancement
 * et après chaque récupération de parties (Bus 'games:analysed'). Sous MIN positions, le filtre est suspendu.
 */

'use strict';

const SeenPositions = (function () {
    const PLIES = 40, MIN = 5;
    let seen = { w: new Map(), b: new Map() }, ready = false, busy = null;

    function scan(games) {
        const out = { w: new Map(), b: new Map() };
        for (const g of games) {
            if (!g || !Array.isArray(g.sans) || !g.sans.length || !out[g.color]) continue;
            let pos = Chess.start();
            const keys = new Set();
            for (let i = 0; i < Math.min(PLIES, g.sans.length); i++) {
                if (pos.turn === g.color) keys.add(Chess.key(pos));
                const uci = GamePositions.uciOf(pos, g.sans[i]);
                if (!uci) break;
                pos = Chess.play(pos, uci);
            }
            keys.forEach(k => out[g.color].set(k, (out[g.color].get(k) || 0) + 1));   // une partie compte une fois par position
        }
        return out;
    }

    function refresh() {
        if (busy) return busy;
        busy = Promise.resolve(typeof GameArchive !== 'undefined' ? GameArchive.all() : [])
            .then(games => { seen = scan(games || []); })
            .catch(() => { /* archive illisible : filtre suspendu */ })
            .then(() => { ready = true; busy = null; if (typeof Bus !== 'undefined') Bus.emit('seen:ready'); });
        return busy;
    }

    const has = (color, key) => !!(seen[color] && seen[color].has(key));
    const count = (color, key) => (seen[color] && seen[color].get(key)) || 0;
    function countIn(rep, colors) {
        let n = 0;
        (colors || ['w', 'b']).forEach(c => { if (seen[c].size) Object.keys(readDBFor(rep, c)).forEach(k => { if (seen[c].has(k)) n++; }); });
        return n;
    }

    if (typeof Bus !== 'undefined') Bus.on('games:analysed', () => { refresh(); });

    return { MIN, PLIES, scan, refresh, has, count, countIn, ready: () => ready, _set: s => { seen = s; ready = true; } };
})();
