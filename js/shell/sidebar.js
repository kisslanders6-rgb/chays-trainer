/**
 * shell/sidebar.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Barre latérale (à partir de 1 100 px, section « BARRE LATÉRALE » de css/home.css).
 * La colonne est faite en CSS ; ce module ajoute ce qu'elle ne peut pas faire seule :
 *   - la puce du répertoire, la couleur et le retour de l'aperçu (`.topnav-meta`) vont en tête du panneau de jeu ;
 *   - les menus déroulants de chaque rubrique (MENUS), qui appellent les fonctions et les boutons déjà présents.
 * Barre étendue : seul le sous-menu de l'onglet actif est déplié, sans accordéon ni chevron (arbitrage du 12 novembre 2026).
 * Rail : volet à droite de l'icône, au survol (le clic garde son effet : changer d'onglet), au toucher sinon.
 * Bouton Replier / Étendre (#side-toggle, icône panneau) : dans la pilule d'actions, en pied, à la même place dans les deux états.
 */

'use strict';

const SideBar = (() => {
    const MQ = '(min-width: 1100px)';
    const NAMES = { play: 'Aujourd’hui', stats: 'Progrès', training: 'Entraînement', endgame: 'Finales' };

    // Chaque entrée dit ce qu'elle fait, une fois sur le bon onglet :
    //   to     fait défiler jusqu'à cette section ;  act / arg  action enregistrée (registerActions) ;
    //   press  touche ce bouton de la page, avec ses propres gardes ;  run  appelle la fonction ;  when  masque l'entrée si faux.
    const RESUME = '[data-action="resumeLastPlay"]';
    // Statistiques : chaque entrée ouvre son onglet (statsPane) ; une vue de Parties passe aussi par statsInView.
    const pane = p => () => UI_ACTIONS.statsPane(p);
    const MENUS = {
        play: [
            { id: 'today', label: 'Révisions du jour', to: '#hp-today' },
            { id: 'w', label: 'Avec les Blancs', run: () => startGame('w') },
            { id: 'b', label: 'Avec les Noirs', run: () => startGame('b') },
            { id: 'resume', label: 'Reprendre', press: RESUME, when: () => !!document.querySelector(RESUME) },
            { id: 'news', label: 'À traiter', to: '#hp-news' },
            { id: 'games', label: 'Analyser mes parties', act: 'homeGames' },
            { id: 'pgn', label: 'Importer un PGN', act: 'homeImportPgn' },
            { id: 'board', label: 'Échiquier libre', act: 'helpAnalysis' }
        ],
        stats: [
            { id: 'overview', label: 'Maîtrise', run: pane('overview') },
            { id: 'openings', label: 'Ouvertures', run: pane('openings') },
            { id: 'games', label: 'Parties', run: pane('games') },               // ses vues restent dans la page (segments)
            { id: 'regularity', label: 'Régularité', run: pane('regularity') }
        ],
        training: [
            { id: 'due', label: 'Révision du jour', run: () => startDailyReview() },
            { id: 'weak', label: 'Points faibles', press: '[data-focus="weak"]' },
            { id: 'line', label: 'Ligne complète', press: '[data-focus="line"]' },
            { id: 'unsure', label: 'À confirmer', press: '[data-focus="unsure"]' },
            { id: 'timed', label: 'Contre-la-montre', press: '[data-focus="timed"]' },
            { id: 'free', label: 'Mode libre', press: '[data-focus="free"]' }
        ],
        endgame: ENDGAME_CATEGORIES.map(c => ({
            id: c.id, label: c.label, act: 'egJump', arg: c.id, n: ENDGAME_EXERCISES.filter(e => e.cat === c.id).length
        }))
    };

    let mounted = false, held = false, open = null, current = null, lastTab = null, lastRail = null;
    let openTimer = 0, closeTimer = 0, observer = null;

    const bar = () => document.getElementById('topnav-tabs-setup');
    const tabEl = id => document.getElementById('nav-tab-' + id);
    const activeTab = () => Object.keys(NAMES).find(id => tabEl(id).classList.contains('active'));
    const inGame = () => { const g = document.getElementById('game-screen'); return !!g && !g.classList.contains('hidden'); };
    const isRail = () => getComputedStyle(document.documentElement).getPropertyValue('--side-w').trim() !== '240px';
    const canHover = () => matchMedia('(hover: hover)').matches;
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

    function item(tab, it) {
        const key = tab + '.' + it.id, count = it.n ? `<em>${it.n}</em>` : '';
        return `<button type="button" class="sb-it" data-key="${key}" data-action="sbChoose" data-arg="${key}"><span>${escapeHtml(it.label)}</span>${count}</button>`;
    }

    function menuHTML(tab) {
        return `<div class="sb-in"><button type="button" class="sb-title" data-action="sbRubric" data-arg="${tab}"><span>${NAMES[tab]}</span>${ico('chevron-right')}</button>${MENUS[tab].map(it => item(tab, it)).join('')}</div>`;
    }

    function findItem(key) {
        const [tab, id] = key.split('.');
        return { tab, it: MENUS[tab].find(x => x.id === id) };
    }

    function paintToggle(rail) {
        const b = document.getElementById('side-toggle'), label = rail ? 'Étendre la barre' : 'Replier la barre';
        b.innerHTML = ico(rail ? 'panel-open' : 'panel-close');
        b.title = label;
        b.setAttribute('aria-label', label);
    }

    // Replie ou étend, et le retient sur cet appareil. Sans effet en dessous de 1 100 px.
    // Un rail gardé après une sortie de partie (held) s'étend d'abord, sans toucher à la préférence.
    function toggle() {
        if (!mounted) return false;
        if (held) {
            held = false;
            if (sideBarMode() === 'wide') { document.documentElement.setAttribute('data-side', 'wide'); return true; }
        }
        setPref('sideBar', isRail() ? 'wide' : 'rail');
        return true;
    }

    // Quitter une partie depuis la barre ne l'élargit pas : seul le geste Replier / Étendre (ou B) change sa largeur.
    function keepRail(go) {
        const hold = inGame() && document.documentElement.getAttribute('data-side') === 'wide';
        go();
        if (hold && !inGame()) { held = true; document.documentElement.setAttribute('data-side', 'rail'); }
    }

    function paint() {
        if (!mounted) return;
        const rail = isRail();
        paintToggle(rail);
        bar().querySelectorAll('.sb-menu').forEach(menu => {
            const tab = menu.dataset.menu, on = tab === open;
            menu.classList.toggle('open', on);
            tabEl(tab).setAttribute('aria-expanded', String(on));
            menu.querySelectorAll('.sb-it').forEach(el => {
                const here = el.dataset.key === current;
                el.classList.toggle('on', here);
                if (here) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
                const it = findItem(el.dataset.key).it;
                if (it.when) el.hidden = !it.when();
            });
            if (on && rail) {
                const y = Math.max(12, Math.min(tabEl(tab).getBoundingClientRect().top, innerHeight - menu.offsetHeight - 12));
                menu.style.setProperty('--sb-top', y + 'px');
            }
        });
    }

    function reveal(selector) {
        const el = document.querySelector(selector);
        if (!el) return;
        const sticky = document.querySelector('.home-tab:not(.hidden) .st-scope');
        const top = el.getBoundingClientRect().top + window.scrollY - (sticky ? sticky.offsetHeight : 0) - 12;
        window.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
    }

    function choose(key) {
        const { tab, it } = findItem(key);
        current = key;
        if (isRail()) open = null;
        lastTab = tab;
        const weakList = tab === 'stats' && !!statsWeak;              // la liste complète des points faibles remplace la page
        if (weakList) closeStatsWeak();
        if (inGame() || activeTab() !== tab || weakList) keepRail(() => switchHomeTab(tab));
        if (it.act) UI_ACTIONS[it.act](it.arg);
        if (it.run) it.run();
        if (it.press) {
            const el = document.querySelector(it.press);
            if (el && el.getAttribute('aria-expanded') !== 'true') el.click();   // une ligne dépliée le reste
        }
        const target = it.to || it.press;
        if (target) setTimeout(() => reveal(target), 60);             // après le rendu de l'onglet, dont les hauteurs bougent encore
        paint();
    }

    function setOpen(tab) { open = tab; paint(); }
    function clearTimers() { clearTimeout(openTimer); clearTimeout(closeTimer); }

    // ─── GESTES ───
    function onTabClick(e) {
        const tab = e.target.closest('.topnav-tab[id^="nav-tab-"]');
        if (!tab) return;
        const id = tab.id.slice(8);
        clearTimers();
        if (!isRail()) return;                                        // étendue : le clic change d'onglet, son sous-menu suit (sync)
        if (canHover()) { setOpen(null); return; }                    // souris : le clic change d'onglet
        e.stopPropagation();                                          // toucher : il ouvre le volet, qui mène à l'onglet
        setOpen(open === id ? null : id);
    }

    function onKey(e) {
        if (e.key === 'Escape' && open && isRail()) { setOpen(null); return; }
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const tab = e.target.closest('.topnav-tab[id^="nav-tab-"]');
        if (!tab) return;
        e.preventDefault(); e.stopPropagation();
        const id = tab.id.slice(8);
        if (isRail()) setOpen(open === id ? null : id); else tab.click();
    }

    function onOver(e) {
        clearTimeout(closeTimer);
        if (!isRail() || !canHover()) return;
        const tab = e.target.closest('.topnav-tab[id^="nav-tab-"]');
        if (!tab) return;
        clearTimeout(openTimer);
        const id = tab.id.slice(8);
        openTimer = setTimeout(() => setOpen(id), 90);
    }

    function onLeave() {
        clearTimeout(openTimer);
        if (isRail() && canHover()) closeTimer = setTimeout(() => setOpen(null), 220);
    }

    function onDocClick(e) {
        if (open && isRail() && !e.target.closest('#topnav-tabs-setup')) setOpen(null);
    }

    // Un onglet changé ailleurs (raccourci, Suite, fin de partie), ou un passage du rail à la barre étendue.
    function sync() {
        if (!mounted) return;
        if (document.documentElement.getAttribute('data-side') === 'wide') held = false;   // étendue ailleurs (Paramètres)
        const tab = activeTab(), rail = isRail();
        if (tab === lastTab && rail === lastRail) return;
        if (tab !== lastTab && current && !current.startsWith(tab + '.')) current = null;
        lastTab = tab; lastRail = rail;
        open = rail ? null : tab;
        paint();
    }

    function mount() {
        if (mounted) return;
        mounted = true;
        const nav = bar();
        document.querySelector('.topnav-pill').insertAdjacentHTML('beforeend', '<button type="button" class="side-toggle" id="side-toggle" data-action="sideToggle"></button>');
        Object.keys(NAMES).forEach(id => {
            const tab = tabEl(id), menu = document.createElement('div');
            tab.setAttribute('role', 'button');
            tab.setAttribute('tabindex', '0');
            menu.className = 'sb-menu';
            menu.dataset.menu = id;
            menu.setAttribute('role', 'group');
            menu.setAttribute('aria-label', NAMES[id]);
            menu.innerHTML = menuHTML(id);
            tab.after(menu);
        });
        nav.addEventListener('click', onTabClick, true);
        nav.addEventListener('keydown', onKey);
        nav.addEventListener('mouseover', onOver);
        nav.addEventListener('mouseleave', onLeave);
        document.addEventListener('click', onDocClick);
        window.addEventListener('resize', sync);
        observer = new MutationObserver(sync);
        observer.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-side'] });
        lastTab = activeTab(); lastRail = isRail();
        open = lastRail ? null : lastTab;
        paint();
    }

    function unmount() {
        if (!mounted) return;
        mounted = false;
        clearTimers();
        const nav = bar();
        observer.disconnect();
        nav.removeEventListener('click', onTabClick, true);
        nav.removeEventListener('keydown', onKey);
        nav.removeEventListener('mouseover', onOver);
        nav.removeEventListener('mouseleave', onLeave);
        document.removeEventListener('click', onDocClick);
        window.removeEventListener('resize', sync);
        nav.querySelectorAll('.sb-menu').forEach(el => el.remove());
        document.getElementById('side-toggle').remove();
        Object.keys(NAMES).forEach(id => ['role', 'tabindex', 'aria-expanded'].forEach(a => tabEl(id).removeAttribute(a)));
        open = current = null;
    }

    function place(side) {
        const meta = document.getElementById('topnav-tabs-game');
        const slot = document.getElementById('game-meta-slot');
        if (meta && slot) {
            const from = side ? meta : slot, to = side ? slot : meta;
            [...from.children].forEach(el => to.appendChild(el));
        }
        if (side) mount(); else unmount();
    }

    registerActions({
        sbChoose: key => choose(key),
        sbRubric: tab => { current = null; open = null; keepRail(() => switchHomeTab(tab)); paint(); },
        sideToggle: () => toggle()
    });

    if (typeof window !== 'undefined' && window.matchMedia) {
        const mq = matchMedia(MQ), large = matchMedia('(min-width: 1440px)');
        place(mq.matches);
        if (mq.addEventListener) mq.addEventListener('change', e => place(e.matches));
        if (large.addEventListener) large.addEventListener('change', () => { held = false; document.documentElement.setAttribute('data-side', sideBarMode()); });
    }

    return { place, toggle, MENUS, held: () => held };
})();
