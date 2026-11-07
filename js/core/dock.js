/**
 * core/dock.js
 * ──────────────────────────────────────────────────────────────────────────
 * Dock du téléphone (sous 600 px, Ergonomie « Sous la main », lot 3) : une seule barre de cinq cases, toujours aux
 * mêmes places, dont le centre porte la prochaine action et n'est jamais désactivé.
 *   Hors partie (#topnav-tabs-setup) : Jouer · Statistiques · centre · Entraînement · Finales.
 *     Centre : la capsule Suite (Revoir, Réviser, Traiter, À jour) et, sans elle, l'action pleine de l'accueil
 *     (#hp-today .hp-cta, cachée sur téléphone) ; à défaut, Entraînement.
 *   En partie (.board-controls) : Retourner · ‹ · centre · › · Plus.
 *     Centre selon le mode : Sauter (mise en situation), Annuler (reçu d'un coup enregistré), Indice, sinon
 *     Arbre (Jouer), Passer (Entraînement), Recommencer (Finales) ; S'entraîner (aperçu) ; Ajouter (N) ou Brouillon (Analyse).
 *     Les boutons du mode cachés sur téléphone passent dans « Plus » (toggleToolbarMore, mobile.js) ; Quitter
 *     devient le ✕ de la barre du haut (#topnav-exit, Dock.exit).
 * Le centre agit en touchant le bouton d'origine (proxy) : les règles de chaque action restent là où elles sont.
 * Dock.refresh() est appelé par Suite.refresh, setStatus, _syncHintBtn (chaque rendu de l'échiquier) et applyModeUI.
 */

'use strict';

const Dock = (function () {
    const MQ = '(max-width: 599px)';
    let homeRun = null, gameRun = null, gameTarget = null;

    const phone = () => matchMedia(MQ).matches;
    const shown = el => !!el && el.style.display !== 'none' && !el.closest('[style*="display: none"]');
    const inGame = () => { const gs = document.getElementById('game-screen'); return !!gs && !gs.classList.contains('hidden'); };

    // Bouton du mode affiché dans la barre d'actions (data-modes), quel qu'il soit sur téléphone.
    function modeBtn(sel) {
        return [...document.querySelectorAll('.board-controls ' + sel)].find(shown) || null;
    }

    function paint(el, { icon, label, n, tone, title }) {
        const orb = n != null ? `<b>${escapeHtml(String(n))}</b>` : ico(icon);
        const html = `<span class="dock-orb">${orb}</span><span class="dock-l">${escapeHtml(label)}</span>`;
        if (el.innerHTML !== html) el.innerHTML = html;
        el.dataset.tone = tone || '';
        el.title = title || label;
        el.setAttribute('aria-label', title || label);
    }

    // ─── CENTRE HORS PARTIE ───────────────────────────────────────────────────
    const HOME_LABELS = { retry: 'Revoir', due: 'Réviser', news: 'Traiter', done: 'À jour' };
    function homeCenter() {
        let st = null;
        try { st = typeof Suite !== 'undefined' ? Suite.state() : null; } catch (e) { st = null; }
        if (st && st.kind !== 'live') {
            return {
                icon: 'check', label: HOME_LABELS[st.kind], n: st.kind === 'done' ? null : st.n, title: st.label,
                tone: st.kind === 'done' ? 'soft' : st.kind === 'retry' ? 'err' : '',
                run: () => { if (UI_ACTIONS[st.action]) UI_ACTIONS[st.action](); }
            };
        }
        const cta = document.querySelector('#hp-today .hp-cta');
        if (cta) {
            const act = cta.dataset.action, label = act === 'homeAddLine' && cta.id !== 'hp-start-cta' ? 'Ajouter' : act === 'homeReview' ? 'Réviser' : 'Commencer';
            return { icon: act === 'homeAddLine' && cta.id !== 'hp-start-cta' ? 'plus' : 'play', label, title: cta.textContent.trim(), run: () => cta.click() };
        }
        return { icon: 'check', label: 'À jour', tone: 'soft', title: 'Entraînement', run: () => switchHomeTab('training') };
    }

    // ─── CENTRE EN PARTIE ─────────────────────────────────────────────────────
    function gameCenter() {
        const proxy = (b, o) => ({ ...o, target: b, run: () => b.click() });
        if (gameMode === 'preview') {
            const b = modeBtn('.btn-primary.btn-grow');
            return proxy(b, { icon: 'play', label: 'S\'entraîner', title: b ? b.title : '' });
        }
        if (gameMode === 'analysis') {
            const add = document.querySelector('#analysis-panel .ab-add');
            if (add && !add.disabled) {
                const c = add.querySelector('.ab-count');
                return proxy(add, { icon: 'git-merge', label: c ? `Ajouter (${c.textContent})` : 'Ajouter', title: add.title || 'Ajouter au répertoire' });
            }
            return { icon: 'git-branch', label: 'Brouillon', tone: 'soft', title: 'Toutes les branches du brouillon', run: () => setSheetOpen(true) };
        }
        // Bouton de la barre d'état qui sert maintenant : Sauter (mise en situation), Annuler ou Rétablir (reçu d'un coup).
        const act = document.querySelector('#status-bar .status-act'), k = act ? act.dataset.act || '' : '';
        if (k === 'Sauter') return proxy(act, { icon: 'skip-forward', label: 'Sauter', tone: 'soft', title: act.title || k });
        if (gameMode === 'play' && (k === 'Annuler' || k === 'Rétablir')) return proxy(act, { icon: 'rotate-ccw', label: k, tone: 'soft', title: act.title || k });
        const hint = modeBtn('.tb-hint');
        if (hint && !hint.disabled) {
            const sol = hint.dataset.sol === 'sol';
            return proxy(hint, { icon: sol ? 'target' : 'lightbulb', label: sol ? 'Solution' : 'Indice', tone: hint.classList.contains('is-suggest') ? 'warn' : 'soft', title: hint.title });
        }
        if (gameMode === 'training') {
            const b = modeBtn('[onclick^="nextDrill"]');
            return b ? proxy(b, { icon: 'skip-forward', label: 'Passer', tone: 'soft', title: b.title }) : null;
        }
        if (gameMode === 'endgame') {
            const b = modeBtn('[onclick^="retryEndgame"]');
            return b ? proxy(b, { icon: 'rotate-ccw', label: 'Recommencer', tone: 'soft', title: b.title }) : null;
        }
        return { icon: 'git-branch', label: 'Arbre', tone: 'soft', title: 'Arbre du répertoire',
                 run: () => { if (typeof showSideTab === 'function') showSideTab('tree'); setSheetOpen(true); } };
    }

    function refresh() {
        const home = document.getElementById('nav-center'), game = document.getElementById('dock-center');
        if (!phone()) { homeRun = gameRun = null; return; }
        try {
            if (home && !inGame()) { const c = homeCenter(); paint(home, c); homeRun = c.run; }
            if (game && inGame()) {
                const c = gameCenter();
                game.hidden = !c;
                gameTarget = c ? c.target || null : null;
                if (c) { paint(game, c); gameRun = c.run; }
                document.querySelectorAll('.board-controls .dock-more').forEach(b => { b.hidden = !moreItems(b).length && gameMode !== 'play'; });
            }
        } catch (e) { if (typeof reportError === 'function') reportError('dock', e); }
    }

    function runHome() { refresh(); if (homeRun) homeRun(); }
    function runGame() { refresh(); if (gameRun) gameRun(); }

    // « Plus » : les boutons du mode que le dock cache, sauf celui que porte le centre et Quitter (✕ du haut).
    function moreItems(moreBtn) {
        const inMode = el => { for (let n = el; n && !n.classList.contains('board-controls'); n = n.parentElement) if (n.style.display === 'none') return false; return true; };
        return [...document.querySelectorAll('.board-controls button')].filter(b => b !== moreBtn && b !== gameTarget && inMode(b) && !b.disabled
            && !b.classList.contains('is-exit') && !b.classList.contains('dock-center') && b.querySelector('.btn-label') && getComputedStyle(b).display === 'none');
    }

    // ✕ de la barre du haut : le Quitter du mode s'il existe, sinon l'accueil.
    function exit() {
        const b = modeBtn('.is-exit');
        if (b) b.click(); else goHome();
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
        const mq = matchMedia(MQ);
        if (mq.addEventListener) mq.addEventListener('change', refresh);
    }

    return { refresh, runHome, runGame, exit, moreItems, homeCenter, gameCenter };
})();
