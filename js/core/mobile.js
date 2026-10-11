/**
 * core/mobile.js
 * ──────────────────────────────────────────────────────────────────────────
 * Confort mobile / application installée. Autonome : aucune modification d'app.js.
 *   - enregistre le service worker (mode hors ligne, cf. sw.js)
 *   - ligne « Installer l'application » dans les Paramètres (Android/Chrome : bouton ;
 *     iPhone/iPad : mode d'emploi, Safari n'offre pas d'invite)
 *   - raccourcis de l'icône d'appli : /?tab=stats, /?tab=training…
 *   - petite vibration sur un coup refusé (Android ; suit le réglage « Effets sonores »)
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
