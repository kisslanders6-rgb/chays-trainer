/**
 * core/splash.js
 * ──────────────────────────────────────────────────────────────────────────
 * Sortie de l'écran de lancement (#splash, index.html ; animation : css/splash.css).
 * L'animation démarre seule au premier affichage (classe « splashing » posée dans le <head>) ;
 * ce script décide seulement QUAND sortir :
 *   - pas avant la fin de la suspension (animation spHold de l'overlay, 2 s ; 0,45 s pour l'ouverture courte,
 *     html.splash-quick) : rien n'est coupé si l'application est prête instantanément ; un toucher, un clic ou
 *     une touche écourte la suspension (la sortie attend toujours que l'app soit prête) ;
 *   - pas avant que l'application soit prête : DOMContentLoaded (logos teintés, pièces, onglet ?tab=),
 *     puis chargement complet et polices (Inter, Fraunces, IBM Plex Mono), ces deux-là plafonnés à 2,6 s ;
 *   - quoi qu'il arrive au plus tard à 4,5 s : un réseau lent ne bloque jamais l'accès.
 * Sortie : atterrissage (js/core/introTimeline.js, ≈ 1,3 s ; × 0,55 pour l'ouverture courte) — la pièce et la signature volent jusqu'à
 * la barre du haut et l'accueil monte en cascade. Mouvement réduit ou barre introuvable : fondu de 0,45 s.
 * Pendant la sortie, <html class="splash-out"> : la barre système reprend la couleur du thème
 * (themeColor.js). Onglet en arrière-plan (horloge des animations suspendue) : retrait par minuteur.
 */

'use strict';

(function () {
    const root = document.documentElement;
    if (!root.classList.contains('splashing')) return;
    const splash = document.getElementById('splash');

    const READY_CAP = 2600;                       // ms depuis le début de la navigation
    const MAX_SHOWN = 4500;
    const EXIT_MS   = 450;
    const QUICK     = root.classList.contains('splash-quick');
    const SPEED     = QUICK ? .55 : 1;               // ouverture courte : atterrissage accéléré
    const LAND_MS   = 1400 * SPEED;
    const until = ms => new Promise(r => setTimeout(r, Math.max(0, ms - performance.now())));
    const cssAnim = name => splash.getAnimations().find(a => a.animationName === name);

    let left = false, done = false;

    function finish() {
        if (done) return;
        done = true;
        root.classList.remove('splashing', 'splash-out');
        splash.remove();                                      // le vrai logo apparaît sous la copie volante
        if (typeof IntroTimeline !== 'undefined') IntroTimeline.release();
    }

    function leave() {
        if (left) return;
        left = true;
        root.classList.add('splash-out');
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const flight = !reduce && typeof IntroTimeline !== 'undefined' ? IntroTimeline.land(splash, SPEED) : null;
        if (flight) {
            flight.then(finish, finish);
            setTimeout(finish, LAND_MS + 400);
            return;
        }
        splash.classList.add('is-leaving');
        const exit = cssAnim('spExit');
        if (exit) exit.finished.then(finish, finish);
        setTimeout(finish, EXIT_MS + 250);
    }

    if (!splash) { root.classList.remove('splashing'); return; }

    const hold = cssAnim('spHold');
    const skip = new Promise(r => ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, r, { once: true, capture: true })));
    const held = Promise.race([hold ? hold.finished.catch(() => {}) : Promise.resolve(), skip]);

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
