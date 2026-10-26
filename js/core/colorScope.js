/**
 * core/colorScope.js
 * ──────────────────────────────────────────────────────────────────────────
 * Sélecteur de couleur commun (Statistiques, Entraînement, Analyser mes parties, import PGN).
 *
 *   ColorScope.render(host, { options, value, onChange, label? })
 *     options : sous-ensemble ordonné de 'w', 'b', 'all' (ou 'mix') ; value : option choisie.
 *     onChange(valeur) n'est appelé que si le choix change.
 *
 * Un groupe de boutons radio (role="radiogroup") avec un curseur qui glisse sous l'option choisie ;
 * chaque option porte le roi du jeu de pièces actif (les deux rois pour « Les deux »).
 * Rendu une seconde fois sur le même hôte avec les mêmes options, le composant est mis à jour sur place :
 * le curseur glisse au lieu de réapparaître. Flèches, Origine et Fin au clavier.
 */

'use strict';

const ColorScope = (function () {
    const LABELS = { w: 'Blancs', b: 'Noirs', all: 'Les deux', mix: 'Les deux' };
    const king = p => `<span class="glyph" data-glyph="${p}">${(typeof PIECE_SVG !== 'undefined' && PIECE_SVG[p]) || ''}</span>`;
    const icon = o => o === 'w' ? king('K') : o === 'b' ? king('k') : `<span class="cs-both">${king('K')}${king('k')}</span>`;

    function paint(root, value) {
        const opts = root._cs.options, i = Math.max(0, opts.indexOf(value));
        root._cs.value = opts[i];
        root.style.setProperty('--i', i);
        root.querySelectorAll('.cs-opt').forEach((b, k) => {
            b.setAttribute('aria-checked', String(k === i));
            b.tabIndex = k === i ? 0 : -1;
        });
    }

    function pick(root, k, focus) {
        const opts = root._cs.options, v = opts[(k + opts.length) % opts.length];
        const changed = v !== root._cs.value;
        paint(root, v);
        if (focus) root.querySelector(`.cs-opt[data-v="${v}"]`).focus();
        if (changed && root._cs.onChange) root._cs.onChange(v);
    }

    function render(host, { options, value, onChange, label = 'Couleur' }) {
        if (!host) return;
        let root = host.firstElementChild;
        if (!root || !root._cs || root._cs.options.join() !== options.join()) {
            host.innerHTML = `<div class="cs" role="radiogroup" aria-label="${escapeHtml(label)}" style="--n:${options.length}">
                <span class="cs-thumb" aria-hidden="true"></span>
                ${options.map(o => `<button type="button" class="cs-opt" role="radio" data-v="${o}">${icon(o)}<span>${LABELS[o]}</span></button>`).join('')}
            </div>`;
            root = host.firstElementChild;
            root._cs = { options: options.slice() };
            root.addEventListener('click', e => {
                const b = e.target.closest('.cs-opt');
                if (b) pick(root, root._cs.options.indexOf(b.dataset.v), false);
            });
            root.addEventListener('keydown', e => {
                const i = root._cs.options.indexOf(root._cs.value);
                const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: root._cs.options.length - 1 }[e.key];
                if (to === undefined) return;
                e.preventDefault();
                pick(root, to, true);
            });
        }
        root._cs.onChange = onChange;
        paint(root, value);
    }

    return { render };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { ColorScope };
