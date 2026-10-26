/**
 * core/dropdown.js
 * ──────────────────────────────────────────────────────────────────────────
 * Menu déroulant de l'interface, à la place des <select> natifs (styles : .dd, style.css).
 *   dropdownHTML({ value, options: [[valeur, texte, détail?]], action, label?, aria?, cls?, footer? })
 *     → bouton (.dd-btn) + liste fermée (.dd-menu, role="listbox").
 *   Choisir une option appelle UI_ACTIONS[action](valeur) (cf. registerActions, utils.js).
 *   footer : { text, action, icon } — dernière ligne séparée, déclenchée par data-action comme un bouton ordinaire.
 * Un seul menu ouvert à la fois ; clic ailleurs, Échap ou Tab le ferment ; flèches, Origine et Fin au clavier.
 */

'use strict';

function dropdownHTML(o) {
    const cur = o.options.find(x => x[0] === o.value) || o.options[0] || ['', ''];
    const opts = o.options.map(([v, text, sub]) => `
        <button type="button" class="dd-opt" role="option" aria-selected="${v === o.value}" data-dd-action="${o.action}" data-dd-value="${escapeHtml(v)}">
            <span class="dd-opt-text">${escapeHtml(text)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>${v === o.value ? ico('check') : ''}
        </button>`).join('');
    const foot = o.footer ? `<span class="dd-sep" role="separator"></span>
        <button type="button" class="dd-opt dd-foot" data-action="${o.footer.action}">${ico(o.footer.icon || 'plus')}<span class="dd-opt-text">${escapeHtml(o.footer.text)}</span></button>` : '';
    return `<div class="dd ${o.cls || ''}">
        <button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false"${o.aria ? ` aria-label="${escapeHtml(o.aria)}"` : ''}>
            ${o.label ? `<span class="dd-label">${escapeHtml(o.label)}</span>` : ''}<span class="dd-value">${escapeHtml(cur[1])}</span>${ico('chevron-down')}
        </button>
        <div class="dd-menu" role="listbox"${o.aria ? ` aria-label="${escapeHtml(o.aria)}"` : ''} hidden>${opts}${foot}</div>
    </div>`;
}

// Choix du répertoire (onglets Statistiques et Entraînement), avec le nombre de positions de chacun.
// La puce de RepPicker (repPicker.js) : liste avec recherche, fenêtre flottante ou panneau du bas.
function repertoireDropdownHTML(action) {
    return RepPicker.html(action);
}

function _ddClose(dd, focusBtn) {
    if (!dd) return;
    const menu = dd.querySelector('.dd-menu'), btn = dd.querySelector('.dd-btn');
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    dd.classList.remove('open');
    if (focusBtn) btn.focus();
}

function _ddOpen(dd) {
    document.querySelectorAll('.dd.open').forEach(o => { if (o !== dd) _ddClose(o); });
    const menu = dd.querySelector('.dd-menu'), btn = dd.querySelector('.dd-btn');
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    dd.classList.add('open');
    (menu.querySelector('[aria-selected="true"]') || menu.querySelector('.dd-opt')).focus();
}

document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('.dd-btn');
    if (btn) {
        const dd = btn.closest('.dd');
        if (dd.classList.contains('open')) _ddClose(dd); else _ddOpen(dd);
        return;
    }
    const opt = e.target.closest && e.target.closest('.dd-opt');
    if (opt) {
        _ddClose(opt.closest('.dd'), true);
        const fn = opt.dataset.ddAction && UI_ACTIONS[opt.dataset.ddAction];
        if (fn) fn(opt.dataset.ddValue, opt, e);
        return;
    }
    document.querySelectorAll('.dd.open').forEach(dd => _ddClose(dd));
});

document.addEventListener('keydown', e => {
    const dd = e.target.closest && e.target.closest('.dd');
    if (!dd) return;
    const open = dd.classList.contains('open');
    if (!open) {
        if (e.target.matches('.dd-btn') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); _ddOpen(dd); }
        return;
    }
    const items = [...dd.querySelectorAll('.dd-opt')], i = items.indexOf(document.activeElement);
    const go = n => { e.preventDefault(); items[(n + items.length) % items.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _ddClose(dd, true); }
    else if (e.key === 'Tab') _ddClose(dd);
});
