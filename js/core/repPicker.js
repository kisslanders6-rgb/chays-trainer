/**
 * core/repPicker.js
 * ──────────────────────────────────────────────────────────────────────────
 * Choix du répertoire : une puce (initiale, nom, indicateurs) qui ouvre une liste avec recherche.
 *   Ordinateur : fenêtre flottante sous la puce. Téléphone (≤ 719 px ou pointeur grossier) : panneau du bas.
 *
 *   RepPicker.html(action, { size?, locked? }) → la puce ; choisir un répertoire appelle UI_ACTIONS[action](nom).
 *     size 'sm' : version de la barre du haut en jeu (ronde, sans indicateurs ; initiale seule sur téléphone, cf. .rp-sm).
 *     locked : puce désactivée (séance guidée : le répertoire ne change pas en cours de séance).
 *   Indicateurs : positions et révisions dues de chaque répertoire. Dernière ligne : « Nouveau répertoire ».
 * Clavier : flèches dans la liste, Entrée pour choisir, Échap pour fermer (la puce reprend le focus).
 */

'use strict';

const RepPicker = (function () {
    let pop = null, opener = null, action = null;

    function stats(name) {
        const all = Object.values(readDBFor(name, 'w')).concat(Object.values(readDBFor(name, 'b')));
        const now = Date.now();
        return { n: all.length, due: all.filter(e => isDue(e, now)).length };
    }
    const initial = name => escapeHtml((name.trim()[0] || '?').toUpperCase());
    const meta = s => `${s.n} position${s.n > 1 ? 's' : ''}${s.due ? ` · ${s.due} à réviser` : ''}`;

    function html(act, { size, locked = false } = {}) {
        const name = escapeHtml(currentRepertoire);
        if (size === 'sm') {
            const title = locked ? `Répertoire « ${name} » (fixé par la séance guidée)` : `Répertoire « ${name} » : changer`;
            return `<button type="button" class="rp-chip rp-sm" data-rp-action="${act}" aria-haspopup="dialog" aria-expanded="false" title="${title}" aria-label="${title}"${locked ? ' disabled' : ''}>
                <span class="rp-ini" aria-hidden="true">${initial(currentRepertoire)}</span><span class="rp-txt"><b>${name}</b></span>${locked ? '' : ico('chevron-down')}
            </button>`;
        }
        const s = stats(currentRepertoire);
        return `<button type="button" class="rp-chip" data-rp-action="${act}" aria-haspopup="dialog" aria-expanded="false" title="Changer de répertoire">
            <span class="rp-ini" aria-hidden="true">${initial(currentRepertoire)}</span>
            <span class="rp-txt"><b>${name}</b><small>${meta(s)}</small></span>${ico('chevron-down')}
        </button>`;
    }

    const isSheet = () => window.matchMedia('(max-width: 719px), (pointer: coarse)').matches;

    function rows(filter) {
        const q = filter.trim().toLowerCase();
        const list = loadRepertoireList().filter(n => !q || n.toLowerCase().includes(q));
        if (!list.length) return `<div class="rp-none">Aucun répertoire ne correspond.</div>`;
        return list.map(n => {
            const s = stats(n), cur = n === currentRepertoire;
            return `<button type="button" class="rp-row" role="option" aria-selected="${cur}" data-rp-name="${escapeHtml(n)}">
                <span class="rp-ini" aria-hidden="true">${initial(n)}</span>
                <span class="rp-txt"><b>${escapeHtml(n)}</b><small>${meta(s)}</small></span>${cur ? ico('check') : ''}
            </button>`;
        }).join('');
    }

    function close(focus) {
        if (!pop) return;
        pop.remove();
        pop = null;
        if (opener) { opener.setAttribute('aria-expanded', 'false'); if (focus) opener.focus(); }
        opener = null;
    }

    function open(chip) {
        close(false);
        opener = chip;
        action = chip.dataset.rpAction;
        const sheet = isSheet();
        pop = document.createElement('div');
        pop.className = 'rp-layer' + (sheet ? ' is-sheet' : '');
        pop.innerHTML = `<div class="rp-backdrop" data-rp-close></div>
            <div class="rp-pop" role="dialog" aria-modal="${sheet}" aria-label="Choisir un répertoire">
                ${sheet ? '<span class="rp-grip" aria-hidden="true"></span><b class="rp-title">Répertoire</b>' : ''}
                <label class="rp-search">${ico('search')}<input type="search" placeholder="Rechercher un répertoire" aria-label="Rechercher un répertoire" autocomplete="off"></label>
                <div class="rp-list" role="listbox" aria-label="Répertoires">${rows('')}</div>
                <button type="button" class="rp-new" data-action="createRepertoire">${ico('plus')}<span>Nouveau répertoire</span></button>
            </div>`;
        document.body.appendChild(pop);
        chip.setAttribute('aria-expanded', 'true');
        if (!sheet) {
            const r = chip.getBoundingClientRect(), box = pop.querySelector('.rp-pop');
            box.style.top = `${Math.round(r.bottom + 6)}px`;
            box.style.left = `${Math.round(Math.min(r.left, window.innerWidth - box.offsetWidth - 12))}px`;
        }
        const input = pop.querySelector('input');
        input.addEventListener('input', () => { pop.querySelector('.rp-list').innerHTML = rows(input.value); });
        (sheet ? pop.querySelector('.rp-row[aria-selected="true"]') || input : input).focus();
    }

    function choose(name) {
        const act = action;
        close(true);
        const fn = UI_ACTIONS[act];
        if (fn && name !== currentRepertoire) fn(name);
    }

    document.addEventListener('click', e => {
        const chip = e.target.closest && e.target.closest('.rp-chip');
        if (chip) { if (pop && opener === chip) close(true); else open(chip); return; }
        if (!pop) return;
        if (e.target.closest('[data-rp-close]')) { close(true); return; }
        const row = e.target.closest('.rp-row');
        if (row) { choose(row.dataset.rpName); return; }
        if (e.target.closest('.rp-new')) { close(false); return; }          // data-action : createRepertoire
        if (!e.target.closest('.rp-pop')) close(false);
    });

    document.addEventListener('keydown', e => {
        if (!pop) return;
        const items = [...pop.querySelectorAll('.rp-row, .rp-new')], i = items.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : pop.querySelector('input')).focus(); }
        else if (e.key === 'Enter' && e.target.matches('input')) {
            const first = pop.querySelector('.rp-row');
            if (first) { e.preventDefault(); choose(first.dataset.rpName); }
        }
    });
    window.addEventListener('resize', () => close(false));

    return { html, close };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { RepPicker };
