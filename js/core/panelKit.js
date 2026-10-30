/**
 * core/panelKit.js
 * ──────────────────────────────────────────────────────────────────────────
 * Socle commun des fenêtres à rubriques (Paramètres, Compte, Aide) — styles dans css/panels.css.
 *
 *   ordinateur  liste des rubriques à gauche, contenu à droite, recherche dans l'en-tête
 *   téléphone   plein écran : d'abord la liste des rubriques, puis la rubrique choisie (← pour revenir)
 *
 * PanelKit.create({ id, title, search, sections, render, onOpen }) construit l'overlay et renvoie
 * { open(sectionId?), close(), refresh(), el, isOpen() }.
 *   sections : [{ id, icon, label, desc }]        render(sectionId | null, query) → HTML du contenu
 * Les contrôles (interrupteurs, segments, curseurs) se déclarent avec les fonctions ci-dessous et sont
 * gérés par le module appelant via `onControl(kind, key, value, el)`.
 * Grilles de choix (.theme-options) : le nombre de colonnes (--cols) est choisi selon la largeur ET le nombre
 * de tuiles, pour éviter une tuile seule en dernière ligne (balancedCols) ; recalculé à chaque rendu et
 * quand la fenêtre change de largeur. Largeur minimale d'une tuile et colonnes au plus : data-min / data-max.
 * Repère local (localMark) : réglage propre à l'appareil ; une rubrique { local: true } le porte dans la liste.
 * Recherche : un élément data-pn="query" data-key="mot" relance la recherche sur ce mot (suggestions).
 */

'use strict';

const PanelKit = (function () {
    const esc = s => escapeHtml(String(s == null ? '' : s));
    const panels = [];

    // ─── Briques de contenu ───────────────────────────────────────────────────
    const group = (title, rows) => `${title ? `<h3 class="pn-h">${title}</h3>` : ''}<div class="pn-group">${rows.join('')}</div>`;
    const text  = (label, hint) => `<div class="pn-text"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div>`;
    const row   = (label, hint, control, opts = {}) =>
        `<div class="pn-row${opts.col ? ' is-col' : ''}${opts.off ? ' is-off' : ''}"${opts.attrs || ''}>${text(label, hint)}${control || ''}</div>`;
    const toggle = (key, on, label) =>
        `<button type="button" class="pn-switch" role="switch" aria-checked="${!!on}" aria-label="${esc(label || '')}" data-pn="toggle" data-key="${key}"></button>`;
    const seg = (key, options, value, label) =>
        `<div class="pn-seg" role="radiogroup" aria-label="${esc(label || '')}">${options.map(([v, l]) =>
            `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" data-pn="seg" data-key="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const range = (key, value, min, max, step, out, label) =>
        `<label class="pn-range"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${esc(label || '')}" data-pn="range" data-key="${key}"><output>${out}</output></label>`;
    const localMark = (title = 'Propre à cet appareil') =>
        `<span class="pn-local" role="img" title="${esc(title)}" aria-label="${esc(title)}">${ico('devices')}</span>`;
    const button = (label, act, opts = {}) =>
        `<button type="button" class="btn${opts.primary ? ' btn-primary' : ''}${opts.danger ? ' btn-danger' : ''}" data-pn="act" data-key="${act}"${opts.attrs || ''}>${opts.icon ? ico(opts.icon) : ''}${label}</button>`;

    // ─── Fenêtre ──────────────────────────────────────────────────────────────
    function create(cfg) {
        const overlay = document.getElementById(cfg.id) || document.createElement('div');
        overlay.id = cfg.id;
        overlay.className = 'overlay hidden';
        overlay.innerHTML = `
            <div class="panel pn" role="dialog" aria-modal="true" aria-labelledby="${cfg.id}-title" data-drill="0">
                <div class="pn-head">
                    <button type="button" class="panel-x pn-back" data-pn="back" aria-label="Retour">${ico('chevron-left')}</button>
                    <h2 class="pn-title" id="${cfg.id}-title"></h2>
                    ${cfg.search ? `<label class="pn-search">${ico('search')}<input type="search" placeholder="${esc(cfg.search)}" aria-label="${esc(cfg.search)}" autocomplete="off" data-pn="search"></label>` : ''}
                    <button type="button" class="panel-x" data-pn="close" title="Fermer (Échap)" aria-label="Fermer">${ico('x')}</button>
                </div>
                <div class="pn-body"><nav class="pn-nav" aria-label="Rubriques"></nav><div class="pn-content" tabindex="-1"></div></div>
            </div>`;
        if (!overlay.parentNode) {
            const before = cfg.before && document.getElementById(cfg.before);    // ex. le Compte passe sous l'Aide et la confirmation
            if (before && before.parentNode) before.parentNode.insertBefore(overlay, before); else document.body.appendChild(overlay);
        }

        const box = overlay.querySelector('.pn'), nav = overlay.querySelector('.pn-nav'), content = overlay.querySelector('.pn-content');
        const titleEl = overlay.querySelector('.pn-title'), searchEl = overlay.querySelector('[data-pn="search"]');
        const st = { section: (cfg.sections()[0] || {}).id, drill: false, q: '' };
        const narrow = () => matchMedia('(max-width: 640px)').matches;

        function refresh(keepScroll = true) {
            const sections = cfg.sections();
            if (!sections.some(s => s.id === st.section)) st.section = (sections[0] || {}).id;
            const q = st.q.trim(), single = sections.length <= 1;
            box.dataset.drill = (st.drill || q || single) ? '1' : '0';
            box.dataset.single = single ? '1' : '0';
            const cur = sections.find(s => s.id === st.section);
            const title = typeof cfg.title === 'function' ? cfg.title() : cfg.title;
            titleEl.textContent = st.drill && !q && cur && narrow() && !single ? cur.label : title;
            nav.innerHTML = sections.map(s => `<button type="button" class="${s.id === st.section && !q ? 'is-on' : ''}" data-pn="section" data-key="${s.id}"${s.id === st.section && !q ? ' aria-current="true"' : ''}>
                ${ico(s.icon)}<span>${s.label}<small>${s.desc || ''}</small></span>${s.badge ? `<i class="pn-badge">${s.badge}</i>` : s.local ? localMark() : ''}${ico('chevron-right', 'pn-chev')}</button>`).join('');
            const top = content.scrollTop;
            content.innerHTML = cfg.render(q ? null : st.section, q);
            content.scrollTop = keepScroll ? top : 0;
            fitGrids(content);
            if (cfg.afterRender) cfg.afterRender(q ? null : st.section);
        }
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitGrids(content)).observe(content);

        function open(section) {
            panels.forEach(p => { if (p !== api && p.isOpen()) p.close(); });
            if (section) { st.section = section; st.drill = true; } else st.drill = false;
            st.q = ''; if (searchEl) searchEl.value = '';
            if (cfg.onOpen) cfg.onOpen();
            refresh(false);
            overlay.classList.remove('hidden');
            (narrow() ? box : (searchEl || box.querySelector('[data-pn="close"]'))).focus({ preventScroll: true });
        }
        function close() { overlay.classList.add('hidden'); if (cfg.onClose) cfg.onClose(); }
        const isOpen = () => !overlay.classList.contains('hidden');

        overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
        overlay.addEventListener('click', e => {
            const el = e.target.closest('[data-pn]');
            if (!el) return;
            const kind = el.dataset.pn, key = el.dataset.key;
            if (kind === 'close') return close();
            if (kind === 'back') { st.drill = false; st.q = ''; if (searchEl) searchEl.value = ''; return refresh(false); }
            if (kind === 'query') { st.q = key; if (searchEl) { searchEl.value = key; searchEl.focus({ preventScroll: true }); } return refresh(false); }
            if (kind === 'section') { st.section = key; st.drill = true; st.q = ''; if (searchEl) searchEl.value = ''; refresh(false); content.focus({ preventScroll: true }); return; }
            if (kind === 'toggle') return cfg.onControl('toggle', key, el.getAttribute('aria-checked') !== 'true', el);
            if (kind === 'seg') return cfg.onControl('seg', key, el.dataset.v, el);
            if (kind === 'act') return cfg.onControl('act', key, el.dataset.v, el);
        });
        overlay.addEventListener('input', e => {
            const el = e.target;
            if (el.dataset.pn === 'search') { st.q = el.value; refresh(false); return; }
            if (el.dataset.pn === 'range') { cfg.onControl('range', el.dataset.key, Number(el.value), el); return; }
            if (el.dataset.pn === 'text') cfg.onControl('text', el.dataset.key, el.value, el);
        });
        overlay.addEventListener('change', e => {
            const el = e.target;
            if (el.dataset.pn === 'range') cfg.onControl('range-commit', el.dataset.key, Number(el.value), el);
            if (el.dataset.pn === 'text') cfg.onControl('text-commit', el.dataset.key, el.value, el);
        });
        // Échap : vide la recherche, sinon ferme (sauf si une confirmation est ouverte par-dessus).
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape' || !isOpen()) return;
            if (document.querySelector('#confirm-overlay:not(.hidden), #text-overlay:not(.hidden), #promo-overlay:not(.hidden)')) return;
            e.stopPropagation();
            if (st.q && searchEl) { st.q = ''; searchEl.value = ''; refresh(false); return; }
            close();
        });

        const api = { open, close, refresh, isOpen, el: overlay, state: st };
        panels.push(api);
        return api;
    }

    // ─── Grilles de choix ─────────────────────────────────────────────────────
    // Colonnes essayées : de celles que permettent des tuiles un peu plus étroites (85 % de minTile) jusqu'à
    // max − 2 (jamais moins de 3 si 3 tiennent). On garde celle dont la dernière ligne est la plus remplie, une
    // tuile seule comptant pour rien ; à égalité, la plus large. 13 tuiles : 5 + 5 + 3, pas 4 + 4 + 4 + 1.
    const GRID_GAP = 8;   // = gap de .pn .theme-options (css/panels.css)
    function balancedCols(n, width, minTile = 112, maxCols = 6) {
        const fit = t => Math.floor((width + GRID_GAP) / (t + GRID_GAP));
        const max = Math.max(1, Math.min(maxCols, n, fit(minTile)));
        const top = Math.max(max, Math.min(maxCols, n, fit(minTile * .85)));
        let best = max, score = -1;
        for (let c = top; c >= Math.max(Math.min(3, max), max - 2); c--) {
            const last = n % c || c, s = last === 1 && c > 1 ? 0 : last / c;
            if (s > score) { best = c; score = s; }
        }
        return best;
    }
    function fitGrids(root) {
        root.querySelectorAll('.theme-options').forEach(g => {
            const w = g.clientWidth;
            if (w) g.style.setProperty('--cols', balancedCols(g.children.length, w, Number(g.dataset.min) || undefined, Number(g.dataset.max) || undefined));
        });
    }

    // Surligne la recherche dans un texte brut (le HTML existant est préservé).
    function mark(html, q) {
        if (!q) return html;
        const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        return html.split(/(<[^>]+>)/).map(p => p.startsWith('<') ? p : p.replace(re, '<mark>$1</mark>')).join('');
    }
    const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const matches = (q, ...texts) => texts.some(t => norm(t).includes(norm(q)));

    return { create, group, row, text, toggle, seg, range, button, localMark, mark, matches, esc, balancedCols };
})();
