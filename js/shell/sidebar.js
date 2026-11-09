/**
 * shell/sidebar.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Barre latérale (à partir de 1 100 px, section « BARRE LATÉRALE » de css/home.css).
 * La colonne est faite en CSS ; ce module ne déplace que ce qui n'y tient pas :
 * la puce du répertoire, la couleur et le retour de l'aperçu (`.topnav-meta`) vont en tête du panneau de jeu.
 */

'use strict';

const SideBar = (() => {
    const MQ = '(min-width: 1100px)';

    function place(side) {
        const bar = document.getElementById('topnav-tabs-game');
        const slot = document.getElementById('game-meta-slot');
        if (!bar || !slot) return;
        const from = side ? bar : slot, to = side ? slot : bar;
        [...from.children].forEach(el => to.appendChild(el));
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
        const mq = matchMedia(MQ);
        place(mq.matches);
        if (mq.addEventListener) mq.addEventListener('change', e => place(e.matches));
    }

    return { place };
})();
