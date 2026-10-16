/**
 * core/mobile.js
 * ──────────────────────────────────────────────────────────────────────────
 * Confort mobile / application installée. Autonome : aucune modification d'app.js.
 *   - enregistre le service worker (mode hors ligne, cf. sw.js)
 *   - ligne « Installer l'application » dans les Paramètres (Android/Chrome : bouton ;
 *     iPhone/iPad : mode d'emploi, Safari n'offre pas d'invite)
 *   - raccourcis de l'icône d'appli : /?tab=stats, /?tab=training…
 *   - petite vibration sur un coup refusé (Android ; suit le réglage « Effets sonores »)
 *   - tiroir du panneau de jeu sous l'échiquier (écrans < 600 px) : toucher la poignée ou glisser
 *   - menu « Plus » de la barre d'icônes : actions secondaires (.tb-more), pour des boutons assez larges
 */

'use strict';

const _isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const _isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

document.documentElement.dataset.standalone = _isStandalone() ? '1' : '0';

// ─── SERVICE WORKER ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

// ─── INSTALLATION ─────────────────────────────────────────────────────────────
let _installEvent = null;

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _installEvent = e; updateInstallRow(); });
window.addEventListener('appinstalled',        () => { _installEvent = null; updateInstallRow(); });

function updateInstallRow() {
    const sec = document.getElementById('install-section');
    if (!sec) return;
    const hint = document.getElementById('install-hint');
    const btn  = document.getElementById('install-btn');
    let show = false;
    if (_isStandalone()) {
        show = false;
    } else if (_installEvent) {
        show = true;
        hint.textContent = "Ouvre Chays Trainer comme une vraie application, même sans connexion.";
        btn.style.display = '';
    } else if (_isIOS()) {
        show = true;
        hint.textContent = "Sur iPhone / iPad : touche le bouton Partager de Safari, puis « Sur l'écran d'accueil ».";
        btn.style.display = 'none';
    }
    sec.classList.toggle('hidden', !show);
}

async function installApp() {
    if (!_installEvent) return;
    _installEvent.prompt();
    try { await _installEvent.userChoice; } catch (e) {}
    _installEvent = null;
    updateInstallRow();
}

// ─── TIROIR DU PANNEAU DE JEU (mobile) ────────────────────────────────────────
// Fermé : statut + coups sur une ligne, sous l'échiquier. Ouvert : feuille plein écran (arbre, théorie…).
let _sheetBackdrop = null;

function setSheetOpen(open) {
    const panel = document.getElementById('side-panel'), handle = document.getElementById('sheet-handle');
    if (!panel) return;
    if (!_sheetBackdrop) {
        _sheetBackdrop = document.createElement('div');
        _sheetBackdrop.className = 'sheet-backdrop';
        _sheetBackdrop.addEventListener('click', () => setSheetOpen(false));
        document.body.appendChild(_sheetBackdrop);
    }
    panel.classList.toggle('open', open);
    _sheetBackdrop.classList.toggle('open', open);
    if (handle) {
        handle.setAttribute('aria-expanded', String(open));
        handle.setAttribute('aria-label', open ? 'Réduire le panneau' : 'Agrandir le panneau');
    }
    if (!open) panel.scrollTop = 0;
}

function toggleSheet() {
    const panel = document.getElementById('side-panel');
    if (panel) setSheetOpen(!panel.classList.contains('open'));
}

(function initSheetSwipe() {
    const handle = document.getElementById('sheet-handle');
    if (!handle) return;
    let y0 = null, moved = false;
    handle.addEventListener('pointerdown', e => { y0 = e.clientY; moved = false; });
    handle.addEventListener('pointermove', e => {
        if (y0 === null || moved) return;
        const dy = e.clientY - y0;
        if (Math.abs(dy) > 30) { moved = true; setSheetOpen(dy < 0); }
    });
    handle.addEventListener('pointerup', () => { y0 = null; });
    handle.addEventListener('click', e => { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
})();

document.addEventListener('keydown', e => {
    const panel = document.getElementById('side-panel');
    if (e.key === 'Escape' && panel && panel.classList.contains('open')) setSheetOpen(false);
});

// ─── BARRE D'ICÔNES : MENU « PLUS » (mobile) ──────────────────────────────────
// Les actions secondaires (.tb-more) du groupe affiché sont proposées dans un petit menu au-dessus
// de la barre ; chaque entrée déclenche le bouton d'origine.
let _tbMenu = null;

function closeToolbarMore() {
    if (!_tbMenu) return;
    _tbMenu.menu.remove();
    _tbMenu.btn.setAttribute('aria-expanded', 'false');
    _tbMenu = null;
}

function toggleToolbarMore(btn) {
    if (_tbMenu) { const same = _tbMenu.btn === btn; closeToolbarMore(); if (same) return; }
    const menu = document.createElement('div');
    menu.className = 'menu tb-more-menu';
    menu.setAttribute('role', 'menu');
    btn.parentElement.querySelectorAll('.tb-more').forEach(src => {
        const item = document.createElement('button');
        item.className = 'menu-item';
        item.setAttribute('role', 'menuitem');
        item.innerHTML = src.querySelector('.ico').outerHTML + ' ' + src.querySelector('.btn-label').textContent;
        item.addEventListener('click', () => { closeToolbarMore(); src.click(); });
        menu.appendChild(item);
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.right  = Math.max(8, window.innerWidth - r.right) + 'px';
    menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    _tbMenu = { menu, btn };
    const first = menu.querySelector('.menu-item');
    if (first) first.focus({ preventScroll: true });
}

document.addEventListener('pointerdown', e => {
    if (_tbMenu && !_tbMenu.menu.contains(e.target) && !_tbMenu.btn.contains(e.target)) closeToolbarMore();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeToolbarMore(); });
window.addEventListener('resize', closeToolbarMore);

// ─── DÉMARRAGE ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateInstallRow();

    // Raccourcis d'icône : /?tab=stats  /?tab=training  /?tab=endgame
    const tab = new URLSearchParams(location.search).get('tab');
    if (['play', 'stats', 'training', 'endgame'].includes(tab) && typeof switchHomeTab === 'function') switchHomeTab(tab);

    // Vibration sur coup refusé
    if (navigator.vibrate && typeof playSound === 'function' && !playSound._vib) {
        const orig = playSound;
        window.playSound = function (kind) {
            if (kind === 'error' && typeof appSettings !== 'undefined' && appSettings.sound) navigator.vibrate(70);
            return orig.apply(this, arguments);
        };
        window.playSound._vib = true;
    }
});
