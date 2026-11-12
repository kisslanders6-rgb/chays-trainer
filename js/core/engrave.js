/**
 * core/engrave.js
 * ──────────────────────────────────────────────────────────────────────────
 * « Le trait gravé » (identité « Noyer gravé », novembre 2026) : la gravure du roi de la marque
 * (assets/brand/chays-logo.svg, #gravure-trait), seule, en laiton. Réservé aux moments de marque :
 * une position qui devient Maîtrisée pendant l'Entraînement (à la suite du titre de la barre d'état), et son décompte dans le bilan de séance.
 *
 *   Engrave.mark()      → <svg> immobile, petit, pour un badge
 *   Engrave.play(host)  → trace le trait couché à la fin de host (un titre), puis l'efface ; animations
 *                         réduites : le trait apparaît déjà tracé, puis s'efface
 */

'use strict';

const Engrave = (function () {
    const PATH = 'M279.4 158.1 C300.2 168.5 279.4 186.7 261.2 197.1 C240.4 210.1 235.2 237.4 250.8 255.6 C266.4 273.8 287.2 273.8 283.3 293.3 C280.7 305 256 308.9 235.2 310.2';
    // Debout (badge) ou couché (à la suite d'un titre : rotation d'un quart de tour autour du centre du trait).
    const svg = (cls, lying) => lying
        ? `<svg class="engrave ${cls}" viewBox="188 198 160 72" aria-hidden="true" focusable="false"><path pathLength="1" transform="rotate(-90 267.5 234)" d="${PATH}"/></svg>`
        : `<svg class="engrave ${cls}" viewBox="228 150 82 168" aria-hidden="true" focusable="false"><path pathLength="1" d="${PATH}"/></svg>`;
    const TRACE = 600, HOLD = 900, FADE = 400;

    // Animations réduites : réglage de l'appli (data-motion, posé par settings.js), sinon celui de l'appareil.
    function _reduced() {
        const m = document.documentElement.getAttribute('data-motion');
        if (m === 'reduced') return true;
        if (m === 'full') return false;
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function play(host) {
        if (!host) return;
        host.querySelectorAll('.engrave-fx').forEach(el => el.remove());
        host.insertAdjacentHTML('beforeend', svg('engrave-fx', true));
        const el = host.lastElementChild, path = el.querySelector('path');
        if (typeof el.animate !== 'function') { setTimeout(() => el.remove(), TRACE + HOLD); return; }
        const reduce = _reduced();
        if (!reduce) path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
                                  { duration: TRACE, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' });
        const out = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE, delay: (reduce ? 0 : TRACE) + HOLD, fill: 'forwards' });
        out.finished.then(() => el.remove(), () => el.remove());
    }

    return { mark: () => svg('engrave-mark'), play };
})();
