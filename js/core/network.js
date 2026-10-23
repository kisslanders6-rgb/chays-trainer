/**
 * core/network.js
 * ──────────────────────────────────────────────────────────────────────────
 * État de la connexion. Autonome : aucune modification d'app.js.
 *   - <html class="is-offline"> tant que le navigateur se dit hors ligne
 *   - bandeau discret sous la barre du haut (#net-banner), puis « De retour en ligne » 2,5 s
 *   - tout élément [data-needs-network] est grisé (CSS) et son clic intercepté hors ligne,
 *     avec un petit message ; le reste de l'application reste utilisable
 *   - .net-note : message affiché seulement hors ligne (CSS)
 *
 * API : Net.online() → booléen · Net.onChange(fn) → fn(online) à chaque changement.
 * navigator.onLine peut se tromper (portail Wi-Fi) : les appels réseau gardent leur propre gestion d'erreur.
 */

'use strict';

const Net = (function () {
    let online = navigator.onLine !== false;
    let banner = null, backTimer = null, toastEl = null, toastTimer = null;
    const listeners = [];

    function placeBanner() {
        const nav = document.getElementById('topnav');
        if (!banner || !nav) return;
        banner.style.top = getComputedStyle(nav).position === 'sticky' ? nav.offsetHeight + 'px' : '0';
    }

    function showBanner(kind) {
        if (!banner) return;
        clearTimeout(backTimer);
        banner.dataset.kind = kind;
        banner.querySelector('span').textContent = kind === 'offline'
            ? 'Hors ligne · vos données restent sur cet appareil. Parties en ligne et compte indisponibles.'
            : 'De retour en ligne.';
        banner.classList.remove('hidden');
        placeBanner();
        if (kind === 'back') backTimer = setTimeout(() => banner.classList.add('hidden'), 2500);
    }

    function apply(first) {
        document.documentElement.classList.toggle('is-offline', !online);
        document.querySelectorAll('[data-needs-network]').forEach(el => el.setAttribute('aria-disabled', String(!online)));
        if (!online) showBanner('offline');
        else if (!first) showBanner('back');
        else if (banner) banner.classList.add('hidden');
    }

    function set(v) {
        if (v === online) return;
        online = v;
        apply(false);
        listeners.forEach(fn => { try { fn(online); } catch (e) {} });
    }

    function blockedToast() {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'toast net-toast';
            toastEl.setAttribute('role', 'status');
        }
        toastEl.textContent = 'Cette action a besoin d\'une connexion Internet.';
        document.body.appendChild(toastEl);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.remove(), 3500);
    }

    // Hors ligne : le clic sur un élément réseau n'atteint pas son gestionnaire (phase de capture).
    function guard(e) {
        if (online) return;
        const el = e.target.closest && e.target.closest('[data-needs-network]');
        if (!el) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        blockedToast();
    }

    // Les éléments créés après coup (fenêtre Compte, résultats…) reçoivent aussi aria-disabled.
    function watchNew() {
        new MutationObserver(muts => {
            if (online) return;
            muts.forEach(m => m.addedNodes.forEach(n => {
                if (n.nodeType !== 1) return;
                if (n.matches('[data-needs-network]')) n.setAttribute('aria-disabled', 'true');
                n.querySelectorAll('[data-needs-network]').forEach(el => el.setAttribute('aria-disabled', 'true'));
            }));
        }).observe(document.body, { childList: true, subtree: true });
    }

    function init() {
        banner = document.createElement('div');
        banner.id = 'net-banner';
        banner.className = 'net-banner hidden';
        banner.setAttribute('role', 'status');
        banner.innerHTML = '<span></span>';
        const nav = document.getElementById('topnav');
        if (nav) nav.after(banner); else document.body.prepend(banner);

        document.addEventListener('click', guard, true);
        document.addEventListener('submit', guard, true);
        window.addEventListener('online',  () => set(true));
        window.addEventListener('offline', () => set(false));
        window.addEventListener('resize', placeBanner);
        watchNew();
        apply(true);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    return {
        online: () => online,
        onChange(fn) { listeners.push(fn); }
    };
})();
