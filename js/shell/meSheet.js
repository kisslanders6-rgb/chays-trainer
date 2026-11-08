/**
 * shell/meSheet.js
 * ──────────────────────────────────────────────────────────────────────────
 * Fiche « Moi » (téléphone, sous 600 px, Ergonomie « Sous la main », lot 4). Dans la barre du haut, la loupe et un
 * seul bouton Moi (#me-btn, avatar du compte ou silhouette) remplacent Compte, Paramètres, Aide et thème. Le point
 * de sauvegarde (data-backup-dot, backup.js) passe sur ce bouton.
 * La fiche monte du bas, à portée du pouce : carte d'identité, Compte, Paramètres (badge « Sauvegarde » quand le
 * point est allumé), Aide, puis Thème (Sombre · Clair · Système) et Main du pouce (préférence locale thumbHand).
 * Sur ordinateur et tablette, rien ne change : ⌘F, « , » et « ? » restent.
 */

'use strict';

const MeSheet = (function () {
    let el = null, backdrop = null;

    const isOpen = () => !!el && el.classList.contains('open');
    const signedIn = () => typeof Auth !== 'undefined' && Auth.configured() && !!Auth.user();

    function avatar(cls) {
        if (signedIn() && typeof AccountUI !== 'undefined' && AccountUI.avatarHTML) return AccountUI.avatarHTML(cls);
        return `<span class="me-silhouette ${cls}">${ico('user')}</span>`;
    }

    // Bouton de la barre du haut : avatar du compte, sinon silhouette.
    function paint() {
        const b = document.getElementById('me-btn');
        if (!b) return;
        const html = avatar('me-btn-avatar');
        if (b.dataset.html !== html) { b.dataset.html = html; b.innerHTML = html; }
        if (isOpen()) render();
    }

    function seg(name, value, opts) {
        return `<div class="seg me-seg" role="radiogroup" aria-label="${escapeHtml(name)}">${opts.map(([v, label]) =>
            `<button type="button" class="seg-btn${v === value ? ' active' : ''}" role="radio" aria-checked="${v === value}" data-me="${name === 'Thème' ? 'theme' : 'hand'}" data-v="${v}">${escapeHtml(label)}</button>`).join('')}</div>`;
    }

    function row(act, icon, label, badge) {
        return `<button type="button" class="me-row" data-me="${act}">${ico(icon)}<b>${escapeHtml(label)}</b>${badge || ''}${ico('chevron-right')}</button>`;
    }

    function render() {
        const u = signedIn() ? Auth.user() : null;
        const name = (appSettings.pseudo || '').trim() || (u && u.email) || 'Sur cet appareil';
        const sub = u ? (AccountUI.syncText ? AccountUI.syncText() : 'Connecté')
                  : typeof Auth !== 'undefined' && Auth.configured() ? 'Non connecté' : 'Données gardées sur cet appareil';
        const dot = document.getElementById('me-btn');
        const alert = dot && dot.classList.contains('has-alert');
        const rows = (typeof Auth !== 'undefined' && Auth.configured() ? row('account', 'user', 'Compte') : '')
            + row('settings', 'settings', 'Paramètres', alert ? `<span class="vbadge ${dot.dataset.level === 'warn' ? 'is-warn' : 'is-err'}">Sauvegarde</span>` : '')
            + row('help', 'info', 'Aide');
        el.innerHTML = `<div class="me-grab" aria-hidden="true"></div>
            <div class="me-id">${avatar('me-id-avatar')}<span><b>${escapeHtml(name)}</b><small>${escapeHtml(sub)}</small></span></div>
            <div class="me-rows">${rows}</div>
            <div class="me-lbl">Thème</div>${seg('Thème', themeMode(), [['dark', 'Sombre'], ['light', 'Clair'], ['system', 'Système']])}
            <div class="me-lbl">Main du pouce</div>${seg('Main du pouce', appSettings.thumbHand, [['right', 'Droite'], ['left', 'Gauche']])}`;
    }

    function build() {
        backdrop = document.createElement('div');
        backdrop.className = 'me-backdrop';
        backdrop.addEventListener('click', close);
        el = document.createElement('div');
        el.className = 'me-sheet';
        el.id = 'me-sheet';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Moi');
        el.addEventListener('click', onClick);
        document.body.append(backdrop, el);
    }

    function onClick(e) {
        const b = e.target.closest('[data-me]');
        if (!b) return;
        const act = b.dataset.me;
        if (act === 'theme') { setThemeMode(b.dataset.v); render(); return; }
        if (act === 'hand') { setPref('thumbHand', b.dataset.v); render(); return; }
        close();
        if (act === 'account' && typeof AccountUI !== 'undefined') AccountUI.open();
        else if (act === 'settings') showSettings();
        else if (act === 'help') showHelp();
    }

    function open() {
        if (!el) build();
        render();
        el.classList.add('open');
        backdrop.classList.add('open');
        const b = document.getElementById('me-btn');
        if (b) b.setAttribute('aria-expanded', 'true');
        const first = el.querySelector('.me-row');
        if (first && matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
    }

    function close() {
        if (!isOpen()) return;
        el.classList.remove('open');
        backdrop.classList.remove('open');
        const b = document.getElementById('me-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
    }

    function toggle() { if (isOpen()) close(); else open(); }

    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(); });
    document.addEventListener('DOMContentLoaded', paint);

    return { open, close, toggle, paint, isOpen };
})();
