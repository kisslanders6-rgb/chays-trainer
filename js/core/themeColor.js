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
 * La couleur est toujours écrite en #rrggbb : une variable CSS non enregistrée se lit telle qu'écrite
 * (« oklch(from color-mix(…) …) »), formule que les navigateurs refusent dans theme-color avant de
 * retomber sur le marron du manifeste. Elle est donc résolue par un élément témoin, puis ramenée en RGB
 * par un canvas 1×1 (getComputedStyle peut encore rendre de l'oklch).
 *
 * THEME_BAR_VAR : variable CSS utilisée pour la barre en thème clair (en sombre : --bg).
 *   '--accent'  barre colorée, comme les logos      (par défaut)
 *   '--surface' barre qui se fond avec la barre de navigation
 */

'use strict';

const THEME_BAR_VAR = '--accent';
const SPLASH_BAR    = '#2c1f16';

// Couleur CSS quelconque (variable, color-mix, oklch relatif…) → '#rrggbb' ; '' si elle ne se résout pas.
const _barProbe = (() => {
    let el = null, g = null;
    return css => {
        if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
        if (!el) {
            el = document.createElement('i');
            el.setAttribute('aria-hidden', 'true');
            el.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
            const c = document.createElement('canvas'); c.width = c.height = 1;
            g = c.getContext && c.getContext('2d', { willReadFrequently: true });
        }
        el.style.color = '';
        el.style.color = css;
        if (!el.style.color) return '';                              // syntaxe refusée par ce navigateur
        (document.body || document.documentElement).appendChild(el);
        const resolved = getComputedStyle(el).color;
        el.remove();
        if (!g) return /^rgb/.test(resolved) ? _rgbToHex(resolved) : '';
        g.clearRect(0, 0, 1, 1);
        g.fillStyle = '#000';
        g.fillStyle = resolved;
        g.fillRect(0, 0, 1, 1);
        const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
        return '#' + [r, gr, b].map(n => n.toString(16).padStart(2, '0')).join('');
    };
})();
const _rgbToHex = s => { const m = s.match(/\d+(\.\d+)?/g); return m && m.length >= 3 ? '#' + m.slice(0, 3).map(n => Math.round(+n).toString(16).padStart(2, '0')).join('') : ''; };

function syncThemeColor() {
    const root = document.documentElement;
    const splashing = root.classList.contains('splashing') && !root.classList.contains('splash-out');
    // En sombre, l'accent est clair (texte foncé dessus) : la barre prend le fond, plus discret.
    const v = root.getAttribute('data-theme') === 'dark' ? '--bg' : THEME_BAR_VAR;
    const color = splashing ? SPLASH_BAR : _barProbe(`var(${v})`);
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
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-board', 'data-dark', 'class'] });
