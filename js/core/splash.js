/**
 * core/splash.js
 * ──────────────────────────────────────────────────────────────────────────
 * Écran de lancement (#splash, index.html). Affiché par le script du <head> une fois par session
 * d'onglet (<html class="splashing">). Dès que l'application est montée, le logo central glisse et
 * rétrécit jusqu'à sa place exacte dans la barre du haut (#logo-nav, technique FLIP : position
 * mesurée, animation en transform seulement) pendant que le voile se dissipe.
 * Mouvement réduit, logo de barre invisible ou Web Animations absent : simple fondu.
 * Plafond : quoi qu'il arrive, l'écran disparaît au plus tard 2,5 s après le chargement du script.
 */

'use strict';

(function () {
    const root = document.documentElement;
    if (!root.classList.contains('splashing')) return;
    const splash = document.getElementById('splash');
    let done = false;
    const anims = [];

    // Arrêt du plafond (onglet en arrière-plan : l'horloge des animations est suspendue) : rien ne doit
    // rester figé, notamment le fondu d'entrée de #app.
    function finish() {
        if (done) return;
        done = true;
        anims.forEach(a => a.cancel());
        root.classList.remove('splashing');
        if (splash) splash.remove();
    }
    const failsafe = setTimeout(finish, 2500);

    function run() {
        const veil   = splash && splash.querySelector('.splash-veil');
        const logo   = splash && splash.querySelector('.splash-logo');
        const target = document.getElementById('logo-nav');
        if (!veil || !logo || typeof logo.animate !== 'function') return finish();

        const end = () => { clearTimeout(failsafe); finish(); };
        const from = logo.getBoundingClientRect();
        const to   = target ? target.getBoundingClientRect() : null;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reduce || !to || !to.width || !from.width) {
            const fade = splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: 'ease-out', fill: 'forwards' });
            anims.push(fade);
            fade.onfinish = end;
            return;
        }

        const s = to.width / from.width;
        const move = logo.animate([
            { transform: 'none' },
            { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${s})`, borderRadius: (7 / s) + 'px' }
        ], { duration: 600, easing: 'cubic-bezier(.6, 0, .2, 1)', fill: 'forwards' });
        anims.push(move, veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, delay: 220, easing: 'ease-out', fill: 'forwards' }));
        const app = document.getElementById('app');
        if (app) anims.push(app.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 300, easing: 'ease-out', fill: 'backwards' }));
        move.onfinish = end;
    }

    // Après les autres gestionnaires DOMContentLoaded (logos teintés, pièces, onglet ?tab=), puis
    // deux images : la mise en page de la barre est alors définitive.
    const start = () => requestAnimationFrame(() => requestAnimationFrame(run));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
