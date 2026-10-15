/**
 * core/accountUI.js
 * ──────────────────────────────────────────────────────────────────────────
 * Étape 4 : interface du compte. Autonome : crée elle-même son bouton « Compte » (barre du haut)
 * et sa fenêtre — aucune modification de index.html (hors balises <script>/<link>) ni d'app.js.
 * Rien n'apparaît si le service n'est pas configuré (cloudConfig.js vide).
 *
 * Vues : connexion / création de compte · mot de passe oublié · nouveau mot de passe ·
 *        compte connecté · première synchronisation (choix fusionner / envoyer / récupérer).
 *
 * Choix de première synchronisation → SyncIntent (auth.js) + événement window « chays-sync-intent »,
 * que le moteur de synchro (étape 5) consommera. API pour ce moteur : AccountUI.setSyncStatus(niveau, texte)
 * avec niveau = 'ok' | 'busy' | 'offline' | 'error'.
 * Prérequis : auth.js, cloudClient.js, cloudAdapter.js ; au besoin askConfirm (openingsLogic.js),
 * exportDB (storage.js) et ico (icons.js), appelés seulement à l'exécution.
 */

'use strict';

const AccountUI = (function () {
    let overlay = null, btn = null;
    let view = 'auth', mode = 'signin', busy = false, switched = false, chooser = null, choosing = false;
    let syncStatus = { level: 'ok', text: 'Connecté' };

    const icon = n => (typeof ico === 'function' ? ico(n) : '');
    const esc  = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const SVG_USER = '<svg class="ico" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    const SVG_USER_BTN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    const $ = sel => overlay.querySelector(sel);
    const isOpen = () => overlay && !overlay.classList.contains('hidden');

    // ─── Petits outils ────────────────────────────────────────────────────────
    function toast(text) {
        const el = document.createElement('div');
        el.className = 'toast account-toast'; el.setAttribute('role', 'status');
        const sp = document.createElement('span'); sp.textContent = text;
        const x = document.createElement('button'); x.className = 'toast-x'; x.setAttribute('aria-label', 'Fermer'); x.innerHTML = icon('x');
        x.onclick = () => el.remove();
        el.append(sp, x); document.body.appendChild(el);
        setTimeout(() => el.remove(), 8000);
    }

    function msg(text, kind) {
        const m = overlay && $('.account-msg');
        if (!m) return;
        m.className = 'account-msg' + (text ? ' pgn-note ' + (kind || 'info') : '');
        m.textContent = text || '';
    }

    function setBusy(b) {
        busy = b;
        overlay.querySelectorAll('.account-submit, [data-act^="strategy:"]').forEach(x => { x.disabled = b; });
    }

    const countLocal = () => {
        let positions = 0, other = false, reps = 0;
        LocalStorageAdapter.keys().forEach(k => {
            const kind = SyncModel.kindOf(k);
            if (!kind) return;
            let v = null; try { v = JSON.parse(LocalStorageAdapter.get(k)); } catch (e) {}
            if (kind === 'db' && v && typeof v === 'object') positions += Object.keys(v).length;
            else if (kind === 'list' && Array.isArray(v)) reps = v.length;
            else if ((kind === 'trash' && Array.isArray(v) && v.length) || (kind === 'endgames' && v && Object.keys(v).length)) other = true;
        });
        return { positions, has: positions > 0 || other || reps > 1 };
    };
    const countRemote = docs => ({
        positions: docs.filter(d => SyncModel.kindOf(d.key) === 'db').reduce((n, d) => n + Object.keys(d.data || {}).length, 0),
        has: docs.length > 0
    });
    const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

    // ─── Bouton de la barre du haut ───────────────────────────────────────────
    function updateButton() {
        if (!btn) return;
        const u = Auth.user();
        btn.classList.toggle('has-session', !!u);
        btn.dataset.sync = u ? syncStatus.level : '';
        btn.title = u ? `Compte — ${u.email}` : 'Compte (non connecté)';
        btn.setAttribute('aria-label', btn.title);
    }

    // ─── Vues ─────────────────────────────────────────────────────────────────
    const head = title => `<div class="panel-head"><div class="panel-title">${SVG_USER} ${title}</div>
        <button class="panel-x" data-act="close" title="Fermer (Échap)" aria-label="Fermer">${icon('x')}</button></div>`;

    function pwField(autocomplete, label) {
        return `<label class="account-field"><span>${label || 'Mot de passe'}</span><span class="account-pw">
            <input type="password" name="password" autocomplete="${autocomplete}" minlength="8" required>
            <button type="button" class="account-eye" data-act="eye">Afficher</button></span></label>`;
    }

    function viewAuth() {
        const up = mode === 'signup';
        return head('Compte') + `
            <div class="panel-sub">Sans compte, vos données restent uniquement sur cet appareil. Avec un compte, elles sont aussi sauvegardées en ligne et synchronisées entre vos appareils.</div>
            <div class="seg account-seg">
                <button class="seg-btn ${up ? '' : 'active'}" data-act="mode:signin" type="button">Connexion</button>
                <button class="seg-btn ${up ? 'active' : ''}" data-act="mode:signup" type="button">Créer un compte</button>
            </div>
            <form class="account-form" data-form="auth" novalidate>
                <label class="account-field"><span>Adresse e-mail</span><input type="email" name="email" autocomplete="username" required></label>
                ${pwField(up ? 'new-password' : 'current-password')}
                <div class="account-msg" role="status" aria-live="polite"></div>
                <button class="btn btn-primary account-submit" type="submit">${up ? 'Créer mon compte' : 'Se connecter'}</button>
                ${up ? '<div class="set-hint">8 caractères minimum.</div>' : '<button type="button" class="toast-link account-link" data-act="view:recover">Mot de passe oublié ?</button>'}
            </form>`;
    }

    function viewRecover() {
        return head('Mot de passe oublié') + `
            <div class="panel-sub">Saisissez l'adresse de votre compte : nous vous envoyons un lien pour choisir un nouveau mot de passe.</div>
            <form class="account-form" data-form="recover" novalidate>
                <label class="account-field"><span>Adresse e-mail</span><input type="email" name="email" autocomplete="username" required></label>
                <div class="account-msg" role="status" aria-live="polite"></div>
                <button class="btn btn-primary account-submit" type="submit">Envoyer le lien</button>
                <button type="button" class="toast-link account-link" data-act="view:auth">Retour à la connexion</button>
            </form>`;
    }

    function viewNewPassword() {
        return head('Nouveau mot de passe') + `
            <div class="panel-sub">Choisissez votre nouveau mot de passe.</div>
            <form class="account-form" data-form="newpw" novalidate>
                ${pwField('new-password', 'Nouveau mot de passe')}
                <div class="account-msg" role="status" aria-live="polite"></div>
                <button class="btn btn-primary account-submit" type="submit">Enregistrer</button>
            </form>`;
    }

    function viewAccount() {
        const u = Auth.user() || {};
        return head('Compte') + `
            <div class="account-user">
                <div class="account-avatar">${esc((u.email || '?').charAt(0).toUpperCase())}</div>
                <div><div class="account-email">${esc(u.email || '')}</div>
                <div class="account-sync" data-level="${esc(syncStatus.level)}"><span class="account-sync-dot"></span><span id="account-sync-text">${esc(syncStatus.text)}</span></div></div>
            </div>
            <div class="account-msg" role="status" aria-live="polite"></div>
            <div class="account-actions">
                <button class="btn btn-primary" data-act="sync-now">Synchroniser maintenant</button>
                <button class="btn" data-act="signout">Se déconnecter</button>
                <button class="btn btn-danger" data-act="signout-erase">Se déconnecter et effacer les données de cet appareil</button>
            </div>
            <div class="set-hint account-note">Se déconnecter garde vos données sur cet appareil (et en ligne). L'effacement ne touche que cet appareil.</div>`;
    }

    function viewChooser() {
        const c = chooser;
        return head('Première synchronisation') + `
            <div class="panel-sub">Cet appareil contient <strong>${plural(c.local.positions, 'position', 'positions')}</strong> et votre compte en contient <strong>${plural(c.remote.positions, 'position', 'positions')}</strong>. Que faire ?</div>
            ${switched ? `<div class="pgn-note warn">${icon('alert-triangle')} Cet appareil contenait des données d'un autre compte.</div>` : ''}
            <div class="account-choices">
                <button class="account-choice is-rec" data-act="strategy:merge">
                    <span class="account-choice-title">Fusionner <em>(recommandé)</em></span>
                    <span class="account-choice-desc">Réunit les deux : pour une position commune, les essais et erreurs sont additionnés ; tout le reste est conservé des deux côtés. Rien n'est perdu.</span></button>
                <button class="account-choice" data-act="strategy:upload">
                    <span class="account-choice-title">Envoyer cet appareil</span>
                    <span class="account-choice-desc">Le contenu en ligne est remplacé par celui de cet appareil.</span></button>
                <button class="account-choice" data-act="strategy:download">
                    <span class="account-choice-title">Récupérer mon compte</span>
                    <span class="account-choice-desc">Cet appareil est remplacé par le contenu en ligne. Une sauvegarde JSON est téléchargée d'abord.</span></button>
            </div>
            <button class="toast-link account-link" data-act="close" type="button">Plus tard</button>
            <div class="account-msg" role="status" aria-live="polite"></div>`;
    }

    function render() {
        if (!overlay) return;
        const panel = $('.account-panel');
        panel.innerHTML = view === 'account' ? viewAccount() : view === 'recover' ? viewRecover()
                        : view === 'newpw' ? viewNewPassword() : view === 'chooser' ? viewChooser() : viewAuth();
        const first = panel.querySelector('input');
        if (first && isOpen()) setTimeout(() => first.focus(), 0);
    }

    function open(v) {
        if (!overlay) return;
        view = v || (Auth.isSignedIn() ? 'account' : 'auth');
        if (view === 'auth') mode = 'signin';
        render();
        overlay.classList.remove('hidden');
    }
    function close() { if (overlay) overlay.classList.add('hidden'); }

    // ─── Première synchronisation ─────────────────────────────────────────────
    function applyStrategy(strategy) {
        const u = Auth.user(); if (!u) return;
        if (strategy === 'download') { try { if (typeof exportDB === 'function') exportDB(); } catch (e) {} }   // sauvegarde avant remplacement
        SyncIntent.set({ user: u.id, strategy, at: Date.now() });
        if (strategy !== 'download') SyncMeta.markAllDirty();
        window.dispatchEvent(new CustomEvent('chays-sync-intent', { detail: { strategy, user: u.id } }));
    }

    async function ensureIntent() {
        const u = Auth.user();
        if (!u || choosing) return;
        const cur = SyncIntent.get();
        if (cur && cur.user === u.id) return;
        choosing = true;
        try {
            const r = await CloudClient.listDocs();
            if (!r.ok || Auth.user() !== u) return;                    // hors ligne : on réessaiera à la prochaine ouverture / connexion
            const local = countLocal(), remote = countRemote(r.docs);
            if (!local.has && !remote.has) return applyStrategy('merge');
            if (local.has && !remote.has) {
                applyStrategy('upload');
                return toast(`Vos ${plural(local.positions, 'position', 'positions')} vont être sauvegardées dans votre compte.`);
            }
            if (!local.has && remote.has) {
                applyStrategy('download');
                return toast(`Vos ${plural(remote.positions, 'position', 'positions')} en ligne vont être récupérées.`);
            }
            chooser = { local, remote };
            view = 'chooser'; render(); overlay.classList.remove('hidden');
        } finally { choosing = false; }
    }

    // ─── Déconnexion ──────────────────────────────────────────────────────────
    function wipeLocal() {
        LocalStorageAdapter.keys().forEach(k => {
            if (SyncModel.isSynced(k) || k === SyncIntent.KEY) LocalStorageAdapter.remove(k);
        });
        SyncMeta.reset();
    }

    function onSignOut(erase) {
        if (!erase) { Auth.signOut(); return; }
        const dirty = Object.keys(SyncMeta.dirtySnapshot()).length;
        const text = 'Se déconnecter et effacer toutes les données de cet appareil ? ' +
            (dirty ? `${plural(dirty, 'modification non synchronisée sera', 'modifications non synchronisées seront')} définitivement perdue${dirty > 1 ? 's' : ''}. ` : '') +
            'Vos données en ligne ne sont pas touchées.';
        const go = async () => { await Auth.signOut(); wipeLocal(); location.reload(); };
        if (typeof askConfirm === 'function') askConfirm(text, go); else if (confirm(text)) go();
    }

    // ─── Événements ───────────────────────────────────────────────────────────
    async function submit(form) {
        if (busy) return;
        const type = form.dataset.form;
        const f = form.elements;
        const email = f.email ? f.email.value.trim() : '';
        const pw = f.password ? f.password.value : '';
        if (type !== 'newpw' && !/^\S+@\S+\.\S+$/.test(email)) return msg('Adresse e-mail invalide.', 'err');
        if (type !== 'recover' && !pw) return msg('Saisissez un mot de passe.', 'err');
        if ((type === 'newpw' || (type === 'auth' && mode === 'signup')) && pw.length < 8) return msg('Mot de passe : 8 caractères minimum.', 'err');
        setBusy(true);
        let r;
        if (type === 'recover')      r = await Auth.recover(email);
        else if (type === 'newpw')   r = await Auth.updatePassword(pw);
        else if (mode === 'signup')  r = await Auth.signUp(email, pw);
        else                         r = await Auth.signIn(email, pw);
        if (!overlay.contains(form)) return;                           // la vue a changé pendant l'appel (ex. connexion réussie)
        setBusy(false);
        if (!r.ok) return msg(r.message, 'err');
        if (type === 'recover') return msg("Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé.", 'ok');
        if (type === 'newpw')   { view = 'account'; render(); return msg('Mot de passe modifié.', 'ok'); }
        if (r.needsConfirmation) {
            mode = 'signin'; view = 'auth'; render();
            return msg(`Compte créé. Un e-mail de confirmation vient d'être envoyé à ${email} : cliquez sur le lien qu'il contient, puis connectez-vous.`, 'ok');
        }
        // connexion réussie : l'événement « signed-in » affiche la vue du compte
    }

    function onClick(e) {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const act = el.dataset.act;
        if (act === 'close') close();
        else if (act.startsWith('mode:')) { mode = act.slice(5); render(); }
        else if (act.startsWith('view:')) { view = act.slice(5); render(); }
        else if (act === 'eye') {
            const i = el.parentElement.querySelector('input');
            i.type = i.type === 'password' ? 'text' : 'password';
            el.textContent = i.type === 'password' ? 'Afficher' : 'Masquer';
        }
        else if (act === 'sync-now') { if (typeof SyncEngine !== 'undefined') SyncEngine.syncNow(); }
        else if (act === 'signout') onSignOut(false);
        else if (act === 'signout-erase') onSignOut(true);
        else if (act.startsWith('strategy:')) {
            const s = act.slice(9);
            const run = () => { applyStrategy(s); view = 'account'; render(); toast(s === 'merge' ? 'Fusion programmée : vos données vont être réunies.' : s === 'upload' ? 'Vos données vont remplacer celles du compte.' : 'Les données du compte vont remplacer celles de cet appareil.'); };
            const warn = s === 'upload' ? "Remplacer les données en ligne par celles de cet appareil ? Ce qui n'existe pas ici sera supprimé du compte."
                       : s === 'download' ? 'Remplacer les données de cet appareil par celles du compte ? Une sauvegarde JSON va d\'abord être téléchargée.' : null;
            if (warn && typeof askConfirm === 'function') askConfirm(warn, run); else run();
        }
    }

    // ─── Installation ─────────────────────────────────────────────────────────
    function build() {
        overlay = document.createElement('div');
        overlay.id = 'account-overlay'; overlay.className = 'overlay hidden';
        overlay.innerHTML = '<div class="panel account-panel" role="dialog" aria-modal="true" aria-label="Compte"></div>';
        const before = document.getElementById('help-overlay');               // avant l'aide et la confirmation : celles-ci passent au-dessus
        if (before && before.parentNode) before.parentNode.insertBefore(overlay, before); else document.body.appendChild(overlay);

        overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('submit', e => { e.preventDefault(); submit(e.target); });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape' || !isOpen()) return;
            const c = document.getElementById('confirm-overlay');
            if (c && !c.classList.contains('hidden')) return;
            close();
        });

        btn = document.createElement('button');
        btn.id = 'account-btn'; btn.className = 'theme-toggle'; btn.type = 'button'; btn.innerHTML = SVG_USER_BTN;
        btn.onclick = () => open();
        const right = document.querySelector('.topnav-right');
        if (right) right.insertBefore(btn, right.firstChild); else document.body.appendChild(btn);
    }

    function onNotice(n) {
        if (!n) return;
        if (n.kind === 'recovery') open('newpw');
        else if (n.kind === 'confirmed') toast('Adresse confirmée : vous êtes connecté.');
        else if (n.kind === 'error') toast(n.message);
    }

    function init() {
        if (!Auth.configured() || overlay) return;
        build();
        updateButton();
        Auth.onChange((ev, data) => {
            if (ev === 'signed-in') {
                switched = !!(data && data.switched);
                if (isOpen() && view !== 'newpw') { view = 'account'; render(); }
                updateButton(); ensureIntent();
            } else if (ev === 'signed-out') {
                updateButton(); if (isOpen()) { view = 'auth'; mode = 'signin'; render(); }
            } else if (ev === 'expired') {
                updateButton(); toast('Votre session a expiré : reconnectez-vous pour reprendre la synchronisation.');
                if (isOpen()) { view = 'auth'; mode = 'signin'; render(); }
            } else if (ev === 'notice') onNotice(data);
        });
        onNotice(Auth.takeNotice());
        if (Auth.isSignedIn()) ensureIntent();
    }

    function setSyncStatus(level, text) {
        syncStatus = { level: level || 'ok', text: text || 'Connecté' };
        updateButton();
        const t = overlay && overlay.querySelector('#account-sync-text');
        if (t) { t.textContent = syncStatus.text; t.parentElement.dataset.level = syncStatus.level; }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    return { open, close, setSyncStatus, ensureIntent };
})();
