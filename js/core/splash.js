/**
 * core/splash.js
 * ──────────────────────────────────────────────────────────────────────────
 * Sortie de l'écran de lancement (#splash, index.html ; animation : css/splash.css).
 * L'animation démarre seule au premier affichage (classe « splashing » posée dans le <head>) ;
 * ce script décide seulement QUAND sortir :
 *   - pas avant la fin de la suspension (animation spHold de l'overlay, ≈ 1,55 s) : rien n'est coupé
 *     si l'application est prête instantanément ;
 *   - pas avant que l'application soit prête : DOMContentLoaded (logos teintés, pièces, onglet ?tab=),
 *     puis chargement complet et police Inter, ces deux-là plafonnés à 2,6 s ;
 *   - quoi qu'il arrive au plus tard à 4,5 s : un réseau lent ne bloque jamais l'accès.
 * Pendant la sortie (≈ 0,45 s), <html class="splash-out"> : la barre système reprend la couleur du
 * thème (themeColor.js) et #app monte légèrement. Onglet en arrière-plan (horloge des animations
 * suspendue) : retrait direct par minuteur.
 */

'use strict';

(function () {
    const root = document.documentElement;
    if (!root.classList.contains('splashing')) return;
    const splash = document.getElementById('splash');

    const READY_CAP = 2600;                       // ms depuis le début de la navigation
    const MAX_SHOWN = 4500;
    const EXIT_MS   = 450;
    const until = ms => new Promise(r => setTimeout(r, Math.max(0, ms - performance.now())));
    const cssAnim = name => splash.getAnimations().find(a => a.animationName === name);

    let left = false, done = false;

    function finish() {
        if (done) return;
        done = true;
        root.classList.remove('splashing', 'splash-out');
        splash.remove();
    }

    function leave() {
        if (left) return;
        left = true;
        root.classList.add('splash-out');
        splash.classList.add('is-leaving');
        const exit = cssAnim('spExit');
        if (exit) exit.finished.then(finish, finish);
        setTimeout(finish, EXIT_MS + 250);
    }

    if (!splash) { root.classList.remove('splashing'); return; }

    const hold = cssAnim('spHold');
    const held = hold ? hold.finished.catch(() => {}) : Promise.resolve();

    const domReady = new Promise(r => {
        if (document.readyState !== 'loading') r();
        else document.addEventListener('DOMContentLoaded', () => setTimeout(r, 0), { once: true });   // après les autres gestionnaires
    });
    const loaded = new Promise(r => {
        if (document.readyState === 'complete') r();
        else window.addEventListener('load', r, { once: true });
    });
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready.catch(() => {}) : Promise.resolve();
    const ready = domReady.then(() => Promise.race([Promise.all([loaded, fonts]), until(READY_CAP)]));

    Promise.all([held, ready]).then(() => requestAnimationFrame(leave));
    until(MAX_SHOWN).then(leave);
})();
