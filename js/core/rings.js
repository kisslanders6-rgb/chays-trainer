/**
 * core/rings.js
 * ──────────────────────────────────────────────────────────────────────────
 * Anneau de progression commun (styles : style.css, « COMPOSANTS COMMUNS (LOT 7) »).
 *
 *   Ring.html({ value, max, size?, stroke?, label?, sub?, cls?, ariaLabel?, decorative? }) → HTML d'un anneau :
 *     piste en --border-strong, valeur en --accent (en --ok et classe .is-done quand value ≥ max),
 *     au centre <b>label</b><small>sub</small>. La valeur est bornée entre 0 et max.
 *     decorative : anneau caché aux lecteurs d'écran (aria-hidden), quand le parent porte déjà le libellé.
 *   Ring.chip({ value, max, text, action, arg?, current? }) → bouton « puce à anneau » (data-action / data-arg,
 *     cf. registerActions) : anneau de 22 px avec le nombre réussi au centre, libellé, puis « / max ».
 *
 * Tout texte inséré passe par escapeHtml (utils.js, chargé avant).
 */
'use strict';

const Ring = (function () {
    const esc = s => escapeHtml(String(s == null ? '' : s));

    // ─── ANNEAU ───────────────────────────────────────────────────────────────

    // Fraction affichée : 0 à 1 ; un max nul ou négatif donne un anneau vide.
    function fraction(value, max) {
        const v = Number(value) || 0, m = Number(max) || 0;
        return m > 0 ? Math.min(1, Math.max(0, v / m)) : 0;
    }

    function html({ value = 0, max = 1, size = 60, stroke = 5, label = '', sub = '', cls = '', ariaLabel = '', decorative = false } = {}) {
        const r = (60 - stroke) / 2, C = 2 * Math.PI * r, p = fraction(value, max);
        const done = Number(max) > 0 && Number(value) >= Number(max);
        const aria = ariaLabel || `${Math.min(Number(value) || 0, Number(max) || 0)} sur ${Number(max) || 0}`;
        return `<div class="ring${done ? ' is-done' : ''}${cls ? ' ' + esc(cls) : ''}" style="--ring-size:${Number(size) || 60}px"${decorative ? ' aria-hidden="true"' : ` role="img" aria-label="${esc(aria)}"`}>`
            + `<svg viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="${r}" stroke-width="${stroke}"/>`
            + `<circle class="v" cx="30" cy="30" r="${r}" stroke-width="${stroke}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - p)).toFixed(1)}"/></svg>`
            + (label !== '' || sub !== '' ? `<span class="ring-txt">${label !== '' ? `<b>${esc(label)}</b>` : ''}${sub !== '' ? `<small>${esc(sub)}</small>` : ''}</span>` : '')
            + '</div>';
    }

    // ─── PUCE À ANNEAU ────────────────────────────────────────────────────────

    function chip({ value = 0, max = 1, text = '', action = '', arg = '', current = false } = {}) {
        const v = Number(value) || 0, m = Number(max) || 0;
        return `<button type="button" class="ring-chip" data-action="${esc(action)}"${arg !== '' ? ` data-arg="${esc(arg)}"` : ''}${current ? ' aria-current="true"' : ''}`
            + ` aria-label="${esc(`${text} : ${v} sur ${m}`)}">`
            + html({ value: v, max: m, size: 22, stroke: 7, label: String(v), decorative: true })
            + `<span>${esc(text)}</span><span class="ring-chip-max">/ ${m}</span></button>`;
    }

    return { html, chip, fraction };
})();
