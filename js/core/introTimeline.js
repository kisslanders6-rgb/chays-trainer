/**
 * core/introTimeline.js
 * ──────────────────────────────────────────────────────────────────────────
 * Atterrissage de l'écran de lancement : la pièce et la signature du splash rétrécissent et se
 * déplacent jusqu'à leur place exacte dans la barre du haut (FLIP : positions mesurées une fois,
 * une seule transform par élément), leurs couleurs glissent vers celles du thème, le voile s'efface
 * et l'accueil monte en cascade (onglets, icônes, puis blocs [data-stagger]).
 * Uniquement transform, opacity et propriétés de couleur déclarées avec @property (css/splash.css).
 *
 * API (appelée par splash.js) :
 *   IntroTimeline.land(splash) → Promise résolue quand tout est en place (true) ou annulée par
 *                                release() (false) — jamais rejetée —, ou null si impossible
 *   IntroTimeline.release()    → annule les animations restantes (après le retrait du splash)
 */

'use strict';

const IntroTimeline = (function () {
    const EASE = {
        flip: 'cubic-bezier(.72, 0, .18, 1)',
        soft: 'cubic-bezier(.4, 0, .2, 1)',
        out:  'cubic-bezier(.16, 1, .3, 1)'
    };
    const T = {                         // ms depuis le début de l'atterrissage
        flipDur: 780, wmLag: 50,        // vol de la pièce, la signature part juste après
        veil: 120, veilDur: 520,        // le fond du splash s'efface
        tabs: 440, tabsStep: 45,        // onglets et icônes de la barre
        home: 560, homeStep: 70,        // blocs [data-stagger] de l'onglet affiché
        enterDur: 560
    };
    const COLORS = ['--ct-encre', '--ct-grave'];
    let running = [];

    function anim(el, keyframes, options) {
        const a = el.animate(keyframes, Object.assign({ fill: 'both' }, options));
        running.push(a);
        return a;
    }

    const shown = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

    // Inverse la position de départ : translate + scale depuis le coin haut gauche (transform-origin: 0 0).
    function flip(el, target, options) {
        const a = el.getBoundingClientRect();
        if (!shown(target) || !a.width) {               // cible absente (signature masquée) : l'élément s'efface sur place
            return anim(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-12px) scale(.92)' }],
                        Object.assign({}, options, { duration: options.duration * .6 }));
        }
        const b = target.getBoundingClientRect(), s = b.width / a.width;
        return anim(el, [
            { transform: 'translate(0px, 0px) scale(1)' },
            { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${s})` }
        ], options);
    }

    // Version claire du logo (splash) → couleurs du thème lues sur la cible.
    function recolor(el, target, options) {
        const from = getComputedStyle(el), to = getComputedStyle(target);
        const kf = [{}, {}];
        COLORS.forEach(p => { kf[0][p] = from.getPropertyValue(p).trim(); kf[1][p] = to.getPropertyValue(p).trim(); });
        if (COLORS.some(p => kf[0][p] && kf[0][p] !== kf[1][p])) anim(el, kf, options);
    }

    function cascade(nodes, delay, step) {
        Array.from(nodes).forEach((n, i) => anim(n,
            [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
            { duration: T.enterDur, delay: delay + i * step, easing: EASE.out }));
    }

    function land(splash) {
        release();
        const stage = splash.querySelector('.sp-stage');
        const piece = splash.querySelector('.sp-piece');
        const wm    = splash.querySelector('.sp-wm');
        const navPiece = document.getElementById('logo-nav');
        const navWm    = document.querySelector('.topnav-wm');
        if (!stage || !piece || !shown(navPiece) || typeof piece.animate !== 'function') return null;

        // Le tracé est terminé : on rend la main au CSS, pour que les couleurs du logo puissent glisser.
        piece.querySelectorAll('[pathLength]').forEach(el => el.getAnimations().forEach(a => a.cancel()));

        const flight = { duration: T.flipDur, easing: EASE.flip };
        flip(piece, navPiece, flight);
        if (wm) flip(wm, navWm, Object.assign({}, flight, { delay: T.wmLag }));
        recolor(stage, navPiece, { duration: T.flipDur, easing: EASE.soft });
        const veil = splash.querySelector('.sp-veil');
        if (veil) anim(veil, [{ opacity: 1 }, { opacity: 0 }], { duration: T.veilDur, delay: T.veil, easing: EASE.soft });
        const tabs = document.querySelector('.topnav-tabs:not([style*="none"])');
        cascade([...(tabs ? tabs.querySelectorAll('.topnav-tab') : []), ...document.querySelectorAll('.topnav-right > *')], T.tabs, T.tabsStep);
        cascade(document.querySelectorAll('.home-tab:not(.hidden) [data-stagger]'), T.home, T.homeStep);

        // Une animation annulée rejette `finished` (AbortError) : on le transforme en résultat.
        return Promise.all(running.map(a => a.finished)).then(() => true, () => false);
    }

    function release() {
        running.forEach(a => a.cancel());
        running = [];
    }

    return { land, release, timings: T };
})();
