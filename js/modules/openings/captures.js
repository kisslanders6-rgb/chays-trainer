/**
 * modules/openings/captures.js
 * ──────────────────────────────────────────────────────────────────────────
 * Pièces prises et avantage matériel, une ligne au-dessus et une au-dessous de l'échiquier (#cap-top, #cap-bot),
 * dans tous les modes de l'écran de jeu. Tout se déduit de la position affichée : la navigation ◀ ▶ suit d'elle-même.
 *
 * Captures.compute(départ, plateau) est PURE. Pièces prises = celles qui manquent par rapport à la position de départ
 * de la partie (premier boardBefore de moveHistory, ou l'exercice en Finales : rien n'y est « pris » au départ).
 * Une promotion n'est pas une prise : la pièce en plus annule le pion manquant. « +N » = matériel réel sur l'échiquier
 * (pion 1, Fou et Cavalier 3, Tour 5, Dame 9), affiché seulement du côté en avance.
 * Chaque ligne appartient au camp assis de son côté de l'échiquier et montre, en couleur adverse, ce qu'il a pris.
 */

'use strict';

const Captures = (function () {
    const ORDER = ['p', 'b', 'n', 'r', 'q'], VALUE = { p: 1, b: 3, n: 3, r: 5, q: 9 };
    const NAMES = { p: ['pion', 'pions'], b: ['Fou', 'Fous'], n: ['Cavalier', 'Cavaliers'], r: ['Tour', 'Tours'], q: ['Dame', 'Dames'] };

    function count(b) {
        const c = { w: { p: 0, b: 0, n: 0, r: 0, q: 0 }, b: { p: 0, b: 0, n: 0, r: 0, q: 0 } };
        b.forEach(x => {
            if (!x) return;
            const t = x.toLowerCase();
            if (t in VALUE) c[x === t ? 'b' : 'w'][t]++;
        });
        return c;
    }

    // { taken: { w: { p: n, … } (pièces noires prises par les Blancs), b: … }, diff } ; diff > 0 : les Blancs mènent.
    function compute(start, cur) {
        const s = count(start), c = count(cur), taken = { w: {}, b: {} };
        ['w', 'b'].forEach(col => {
            const miss = {};
            let extra = 0;                                   // pièces en plus : des pions promus
            ORDER.forEach(t => {
                const d = s[col][t] - c[col][t];
                if (d > 0) miss[t] = d; else extra -= d;
            });
            if (miss.p) { miss.p -= extra; if (miss.p <= 0) delete miss.p; }
            taken[col === 'w' ? 'b' : 'w'] = miss;
        });
        const mat = o => ORDER.reduce((n, t) => n + o[t] * VALUE[t], 0);
        return { taken, diff: mat(c.w) - mat(c.b) };
    }

    function rowHTML(side, res) {
        const list = res.taken[side], foe = side === 'w' ? 'b' : 'w', lead = side === 'w' ? res.diff : -res.diff;
        const groups = ORDER.filter(t => list[t]).map(t => {
            const key = foe === 'w' ? t.toUpperCase() : t;
            return `<span class="cap-grp">${`<span class="cap-pc is-${foe}">${PIECE_SVG[key] || ''}</span>`.repeat(list[t])}</span>`;
        }).join('');
        return `<span class="cap-who">${side === 'w' ? 'Blancs' : 'Noirs'}</span>${groups}${lead > 0 ? `<span class="cap-diff">+${lead}</span>` : ''}`;
    }

    function ariaOf(side, res) {
        const list = res.taken[side], lead = side === 'w' ? res.diff : -res.diff;
        const parts = ORDER.filter(t => list[t]).map(t => `${list[t]} ${NAMES[t][list[t] > 1 ? 1 : 0]}`);
        const who = side === 'w' ? 'Blancs' : 'Noirs';
        return `${who} : ${parts.length ? parts.join(', ') + ' pris' : 'aucune prise'}${lead > 0 ? `, avantage de ${lead}` : ''}`;
    }

    function paint(id, side, res) {
        const el = document.getElementById(id);
        if (!el) return;
        const html = rowHTML(side, res);
        if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
        el.setAttribute('aria-label', ariaOf(side, res));
    }

    // Appelé en fin de renderBoard : `board` est alors la position affichée, navigation comprise.
    function render() {
        if (!appSettings.captures) return;
        const start = moveHistory.length ? moveHistory[0].boardBefore : board;
        const res = compute(start, board);
        paint('cap-top', boardFlipped ? 'w' : 'b', res);
        paint('cap-bot', boardFlipped ? 'b' : 'w', res);
    }

    return { compute, render };
})();
