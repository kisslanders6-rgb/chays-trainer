/**
 * core/themeColor.js
 * ──────────────────────────────────────────────────────────────────────────
 * Synchronise la couleur de la barre système (barre de titre de l'appli installée
 * sur ordinateur, barre d'état / d'adresse sur mobile) avec le thème actif, via
 * <meta name="theme-color">. Se met à jour tout seul quand data-theme (clair/sombre)
 * ou data-board (thème d'échiquier) change : aucune modification d'app.js requise.
 * Pendant l'écran de lancement (<html class="splashing">, hors sortie « splash-out ») : SPLASH_BAR,
 * le fond de l'écran de lancement, pour enchaîner sans saut avec l'écran système de la PWA.
 *
 * THEME_BAR_VAR : variable CSS utilisée pour la barre.
 *   '--accent'  barre colorée, comme les logos      (par défaut)
 *   '--surface' barre qui se fond avec la barre de navigation
 */

'use strict';

const THEME_BAR_VAR = '--accent';
const SPLASH_BAR    = '#f5f5f3';

function syncThemeColor() {
    const root = document.documentElement;
    const splashing = root.classList.contains('splashing') && !root.classList.contains('splash-out');
    let color  = splashing ? SPLASH_BAR : getComputedStyle(root).getPropertyValue(THEME_BAR_VAR).trim();
    if (!color) return;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.appendChild(meta);
    }
    if (meta.content !== color) meta.content = color;
}

syncThemeColor();
new MutationObserver(syncThemeColor)
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-board', 'class'] });
