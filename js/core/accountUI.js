/**
 * core/accountUI.js
 * ──────────────────────────────────────────────────────────────────────────
 * Interface du compte. Autonome : crée elle-même son bouton « Compte » (barre du haut)
 * et sa fenêtre — aucune modification de index.html (hors balises <script>/<link>) ni d'app.js.
 * Rien n'apparaît si le service n'est pas configuré (cloudConfig.js vide).
 *
 * Vues hors connexion, en une colonne : connexion (« auth ») et création de compte (« signup »), avec en tête
 *        « Continuer avec Google » (redirection) si le fournisseur est activé ; erreurs en ligne sous le champ ;
 *        après une erreur, l'autre vue est proposée avec l'e-mail déjà rempli · accueil d'un nouveau compte
 *        (« welcome », pseudo pré-rempli : created_at ≈ last_sign_in_at) · mot de passe oublié · nouveau mot de
 *        passe · première synchronisation (trois cartes, une seule action « Continuer »).
 * Compte connecté, trois rubriques : Profil (carte d'identité, atelier d'avatar, réglages du profil),
 *        Synchronisation (état en grand, appareils, exporter), Sécurité (e-mail, mot de passe, déconnexion,
 *        Zone sensible). Jauge du mot de passe (PwMeter) : huit encoches, bouton désactivé sous 8 caractères.
 *
 * Choix de première synchronisation → SyncIntent (auth.js) + événement window « chays-sync-intent »,
 * consommés par syncEngine.js. API pour ce moteur : AccountUI.setSyncStatus(niveau, texte)
 * avec niveau = 'ok' | 'busy' | 'offline' | 'error'.
 * Prérequis : auth.js, cloudClient.js, cloudAdapter.js ; au besoin askConfirm (openingsLogic.js),
 * exportDB (storage.js) et ico (icons.js), appelés seulement à l'exécution.
 */

'use strict';

const AccountUI = (function () {
    let overlay = null, btn = null;
    let view = 'auth', linkMode = false, busy = false, switched = false, chooser = null, choosing = false;
    let draftEmail = '', swapOffer = false, welcomeName = '';      // e-mail repris d'une vue à l'autre ; nom proposé à l'accueil
    let syncStatus = { level: 'ok', text: 'Connecté' }, lastOk = 0;   // lastOk : dernière synchronisation réussie vue ici (mémoire seulement)
    let studioTab = '', pickStrategy = 'merge';                      // onglet de l'atelier d'avatar ; carte choisie à la première synchronisation
    let providers = [], providersReady = false;           // fournisseurs externes activés (Auth.providers) ; Ready = liste connue
    const SVG_GOOGLE = '<svg class="account-provider-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
    const PROVIDER_LABEL = { google: 'Google', apple: 'Apple', github: 'GitHub', discord: 'Discord' };

    const icon = n => (typeof ico === 'function' ? ico(n) : '');
    const esc  = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const SVG_USER = '<svg class="ico" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    const SVG_USER_BTN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    const $ = sel => overlay.querySelector(sel);
    const isOpen = () => overlay && !overlay.classList.contains('hidden');
    const isOnline = () => typeof Net === 'undefined' || Net.online();
    const OFFLINE_NOTE = '<div class="pgn-note info net-note">Hors ligne : connexion au compte impossible pour l\'instant. Vos données restent utilisables sur cet appareil.</div>';

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
        overlay.querySelectorAll('.account-submit, .account-choice').forEach(x => { x.disabled = b; });
        updatePwMeter();
    }

    // Erreur en ligne, sous le champ concerné (sinon dans la zone de message du formulaire).
    function fieldError(name, text) {
        const f = overlay && overlay.querySelector(`.acct-field[data-field="${name}"]`);
        if (!f) return msg(text, 'err');
        f.classList.add('is-err');
        let e = f.querySelector('.acct-ferr');
        if (!e) {
            e = document.createElement('span');
            e.className = 'acct-ferr'; e.id = 'acct-ferr-' + name; e.setAttribute('role', 'alert');
            f.querySelector('.acct-in').after(e);
        }
        e.innerHTML = icon('alert-triangle') + `<span>${esc(text)}</span>`;
        const i = f.querySelector('input');
        i.setAttribute('aria-invalid', 'true');
        i.setAttribute('aria-describedby', [e.id, f.querySelector('.acct-pwm') ? 'acct-pwm' : ''].filter(Boolean).join(' '));
    }
    function clearFieldError(f) {
        f.classList.remove('is-err');
        const e = f.querySelector('.acct-ferr'), i = f.querySelector('input');
        if (e) e.remove();
        i.removeAttribute('aria-invalid');
        if (f.querySelector('.acct-pwm')) i.setAttribute('aria-describedby', 'acct-pwm'); else i.removeAttribute('aria-describedby');
    }
    const clearErrors = () => { overlay.querySelectorAll('.acct-field.is-err').forEach(clearFieldError); msg(''); };
    // Erreurs du service rattachées à un champ.
    const ERR_FIELD = { invalid_credentials: 'password', weak_password: 'password', same_password: 'password', user_exists: 'email', invalid_email: 'email', email_not_confirmed: 'email' };

    // ─── Jauge du mot de passe (PwMeter) ──────────────────────────────────────
    // Une encoche par caractère jusqu'à 8, compteur « 5/8 », vert à 8. Tant qu'il manque des caractères,
    // le bouton du formulaire est désactivé, la raison en infobulle (la vérification à l'envoi reste).
    const PW_MIN = 8, PW_SHORT = 'Mot de passe : 8 caractères minimum.';
    function pwMeterHTML(n) {
        const done = n >= PW_MIN;
        return `<div class="acct-pwm${done ? ' is-done' : ''}" id="acct-pwm" role="meter" aria-label="Longueur du mot de passe" aria-valuemin="0" aria-valuemax="${PW_MIN}" aria-valuenow="${Math.min(n, PW_MIN)}" aria-valuetext="${n} caractère${n > 1 ? 's' : ''} sur ${PW_MIN} minimum">`
            + Array.from({ length: PW_MIN }, (_, i) => `<i${i < n ? ' class="on"' : ''}></i>`).join('')
            + `<b>${done ? icon('check') + PW_MIN : n}/${PW_MIN}</b></div>`;
    }
    function updatePwMeter() {
        const m = overlay && overlay.querySelector('.acct-pwm');
        if (!m) return;
        const form = m.closest('form'), n = form.elements.password.value.length;
        m.outerHTML = pwMeterHTML(n);
        const b = form.querySelector('.account-submit');
        if (n < PW_MIN) { b.disabled = true; b.title = PW_SHORT; }
        else { b.disabled = busy; b.removeAttribute('title'); }
    }

    const countLocal = () => {
        let positions = 0, other = false, reps = 0;
        LocalStorageAdapter.keys().forEach(k => {
            const kind = SyncModel.kindOf(k);
            if (!kind) return;
            let v = null; try { v = JSON.parse(LocalStorageAdapter.get(k)); } catch (e) { /* illisible : compté comme vide */ }
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

    // ─── Avatar (pseudo, pièce ou initiale, couleur : Compte › Profil) ─────────
    // « Échiquier » : teintes de l'échiquier calibrées pour rester lisibles (style.css), pas les cases brutes.
    const AVATAR_TINTS = { theme: ['var(--theme-dark-deep)', 'var(--theme-light-refined)'], sapin: ['#2f4a26', '#efe3c9'], noyer: ['#5a3c26', '#f1e3cc'], nuit: ['#2c3f62', '#e3e9f3'],
                           ardoise: ['#3b3f44', '#ebebe7'], prune: ['#4b3560', '#efe7f6'], ivoire: ['#efe3c9', '#26381e'] };
    // Photo (avatarPhoto.js) si elle existe et qu'aucun motif précis n'est demandé ; sinon le motif choisi.
    function avatarInner(glyph, color) {
        const photo = !glyph && typeof AvatarPhoto !== 'undefined' && AvatarPhoto.src();
        if (photo) return `<img class="av-photo" src="${photo}" alt="">`;
        const g = glyph || appSettings.avatarGlyph, c = color || appSettings.avatarColor;
        if (g === 'initial' || g === 'initials') {
            const u = Auth.user() || {}, name = (appSettings.pseudo || '').trim() || (u.email || '?').split('@')[0];
            const words = name.split(/[\s._-]+/).filter(Boolean);
            const txt = g === 'initial' ? name[0] : words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
            return `<span class="av-mono${g === 'initials' ? ' is-two' : ''}">${esc((txt || '?').toUpperCase())}</span>`;
        }
        if (g.startsWith('av-')) return `<span class="av-picto">${icon(g)}</span>`;
        if (typeof PIECE_SETS === 'undefined') return g.toUpperCase();
        const set = PIECE_SETS[appSettings.pieceSet] && appSettings.pieceSet !== 'blindfold' ? PIECE_SETS[appSettings.pieceSet] : PIECE_SETS[DEFAULT_PIECE_SET];
        const key = c === 'ivoire' ? g : g.toUpperCase();                 // pièce noire sur fond ivoire, blanche ailleurs
        return `<span class="av-glyph">${set.svg[key]}</span>`;
    }
    const avatarStyle = c => { const t = AVATAR_TINTS[c || appSettings.avatarColor] || AVATAR_TINTS.sapin; return `background:${t[0]};color:${t[1]}`; };

    const AVATAR_COLOR_NAMES = { theme: 'Échiquier', sapin: 'Sapin', noyer: 'Noyer', nuit: 'Nuit', ardoise: 'Ardoise', prune: 'Prune', ivoire: 'Ivoire' };
    const AVATAR_NAMES = { initial: 'Initiale', initials: 'Deux initiales', k: 'Roi', q: 'Dame', r: 'Tour', b: 'Fou', n: 'Cavalier', p: 'Pion',
                           'av-crown': 'Couronne', 'av-star': 'Étoile', 'av-flame': 'Flamme', 'av-leaf': 'Feuille', 'av-moon': 'Lune', 'av-bolt': 'Éclair',
                           'av-compass': 'Boussole', 'av-mountain': 'Montagne', 'av-owl': 'Hibou', 'av-fox': 'Renard' };

    // ─── Bouton de la barre du haut ───────────────────────────────────────────
    function updateButton() {
        if (!btn) return;
        const u = Auth.user();
        btn.classList.toggle('has-session', !!u);
        btn.dataset.sync = u ? syncStatus.level : '';
        btn.innerHTML = u ? `<span class="avatar topnav-avatar" style="${avatarStyle()}">${avatarInner()}</span>` : SVG_USER_BTN;
        const who = (appSettings.pseudo || '').trim() || (u && u.email);
        btn.title = u ? `Compte — ${who}` : 'Compte (non connecté)';
        btn.setAttribute('aria-label', btn.title);
    }

    // ─── Vues hors connexion : une colonne (Google, « ou », e-mail, mot de passe, un bouton) ───
    // Champ : libellé (et lien à droite), icône en tête, erreur en ligne ajoutée dessous par fieldError.
    function pwField(autocomplete, label, opts = {}) {
        return `<div class="account-field acct-field" data-field="password">
            <span class="acct-field-h"><label for="acct-pw">${label || 'Mot de passe'}</label>${opts.forgot ? '<button type="button" class="toast-link acct-forgot" data-act="view:recover">Oublié ?</button>' : ''}</span>
            <span class="account-pw acct-in">${icon('lock')}<input id="acct-pw" type="password" name="password" autocomplete="${autocomplete}" minlength="8" required${opts.meter ? ' aria-describedby="acct-pwm"' : ''}>
            <button type="button" class="account-eye" data-act="eye" title="Afficher le mot de passe">${icon('eye')}<span class="sr-only">Afficher</span></button></span>
            ${opts.meter ? pwMeterHTML(0) : ''}</div>`;
    }

    // « Continuer avec Google », en tête des deux vues (redirection, pas de One Tap).
    function googleBlock(label) {
        if (!providersReady && isOnline()) return '<div class="account-providers sk-online" aria-hidden="true"><span class="sk sk-btn"></span></div><div class="account-or sk-online" aria-hidden="true"><span class="sk sk-line" style="width:140px"></span></div>';
        if (!providers.includes('google')) return '';
        return `<div class="account-providers"><button class="btn account-provider account-provider-google" data-needs-network data-act="provider:google" type="button"><span class="account-provider-badge">${SVG_GOOGLE}</span>Continuer avec Google</button></div>
            <div class="account-or"><span>${label}</span></div>`;
    }
    const emailField = (value = draftEmail) => `<div class="account-field acct-field" data-field="email"><span class="acct-field-h"><label for="acct-email">Adresse e-mail</label></span>
        <span class="acct-in">${icon('mail')}<input id="acct-email" type="email" name="email" autocomplete="username" required placeholder="vous@exemple.fr" value="${esc(value)}"></span></div>`;
    // Après une erreur : l'autre vue, avec l'e-mail saisi.
    const swapLink = () => swapOffer ? `<button type="button" class="toast-link account-link account-swap" data-act="swap">${view === 'signup' ? 'Se connecter avec cette adresse' : 'Créer un compte avec cette adresse'}</button>` : '';

    function viewAuth() {
        return `<div class="account-auth">
            <h3 class="account-auth-title">Se connecter</h3>
            <div class="panel-sub">Retrouvez vos répertoires sur tous vos appareils. Sans compte, vos données restent uniquement sur cet appareil.</div>
            ${OFFLINE_NOTE}
            ${googleBlock('ou par e-mail')}
            <form class="account-form" data-form="${linkMode ? 'link' : 'auth'}" data-needs-network novalidate>
                ${emailField()}
                ${linkMode ? '' : pwField('current-password', 'Mot de passe', { forgot: true })}
                <div class="account-msg" role="status" aria-live="polite"></div>
                ${swapLink()}
                <button class="btn btn-primary account-submit" type="submit" data-needs-network>${linkMode ? 'Recevoir un lien de connexion' : 'Se connecter'}</button>
                ${linkMode ? '<div class="set-hint">Pas de mot de passe à retenir : le lien vous connecte (et crée le compte si besoin).</div><button type="button" class="toast-link account-link" data-act="link:off">Utiliser un mot de passe</button>'
                           : `<div class="account-links"><button type="button" class="toast-link account-link" data-act="link:on">${icon('mail')}Recevoir un lien par e-mail</button></div>`}
            </form>
            <div class="account-switch">Pas encore de compte ? <button type="button" class="toast-link" data-act="view:signup">Créer un compte</button></div></div>`;
    }

    function viewSignup() {
        return `<div class="account-auth">
            <h3 class="account-auth-title">Créer un compte</h3>
            <div class="panel-sub">Vos répertoires, statistiques et finales sont sauvegardés en ligne et synchronisés entre vos appareils.</div>
            ${OFFLINE_NOTE}
            ${googleBlock('ou par e-mail')}
            <form class="account-form" data-form="auth" data-needs-network novalidate>
                ${emailField()}
                ${pwField('new-password', 'Choisissez un mot de passe', { meter: true })}
                <div class="account-msg" role="status" aria-live="polite"></div>
                ${swapLink()}
                <button class="btn btn-primary account-submit" type="submit" data-needs-network>Créer mon compte</button>
            </form>
            <div class="account-switch">Déjà un compte ? <button type="button" class="toast-link" data-act="view:auth">Se connecter</button></div></div>`;
    }

    // Premier passage d'un nouveau compte (Google en particulier) : pseudo proposé, modifiable, et un motif.
    const WELCOME_GLYPHS = ['initial', 'n', 'q', 'av-owl', 'av-fox', 'av-leaf'];
    function viewWelcome() {
        return `<div class="account-auth">
            <div class="acct-welcome">${avatarHTML('acct-welcome-avatar')}<div><h3 class="account-auth-title">Bienvenue !</h3><span class="acct-mono">${esc((Auth.user() || {}).email || '')}</span></div></div>
            <div class="panel-sub">Votre compte est créé. Choisissez le nom affiché sur l'accueil (« Bonjour, … ») ; vous pourrez le changer dans Compte › Profil.</div>
            <form class="account-form" data-form="welcome" novalidate>
                <label class="account-field"><span>Pseudo</span><input type="text" name="pseudo" maxlength="24" autocomplete="nickname" value="${esc(welcomeName)}"></label>
                ${glyphTiles(WELCOME_GLYPHS)}
                <div class="account-msg" role="status" aria-live="polite"></div>
                <button class="btn btn-primary account-submit" type="submit">Commencer</button>
                <button type="button" class="toast-link account-link" data-act="view:account">Plus tard</button>
            </form></div>`;
    }

    function viewRecover() {
        return `<div class="account-auth">
            <div class="panel-sub">Saisissez l'adresse de votre compte : nous vous envoyons un lien pour choisir un nouveau mot de passe.</div>
            <form class="account-form" data-form="recover" data-needs-network novalidate>
                ${emailField((Auth.user() || {}).email || draftEmail)}
                <div class="account-msg" role="status" aria-live="polite"></div>
                <button class="btn btn-primary account-submit" type="submit" data-needs-network>Envoyer le lien</button>
                <button type="button" class="toast-link account-link" data-act="${Auth.isSignedIn() ? 'view:account' : 'view:auth'}">Retour</button>
            </form></div>`;
    }

    function viewNewPassword() {
        return `<div class="account-auth">
            <div class="panel-sub">Choisissez votre nouveau mot de passe.</div>
            <form class="account-form" data-form="newpw" data-needs-network novalidate>
                ${pwField('new-password', 'Nouveau mot de passe', { meter: true })}
                <div class="account-msg" role="status" aria-live="polite"></div>
                <button class="btn btn-primary account-submit" type="submit" data-needs-network>Enregistrer</button>
                ${Auth.isSignedIn() ? '<button type="button" class="toast-link account-link" data-act="view:account">Annuler</button>' : ''}
            </form></div>`;
    }

    // Première synchronisation : trois cartes (une seule choisie), une seule action pleine « Continuer ».
    // Rien ne part avant « Continuer » (SyncIntent).
    function viewChooser() {
        const c = chooser, l = c.local.positions, r = c.remote.positions, pos = n => plural(n, 'position', 'positions');
        const cards = [
            ['merge', 'git-merge', 'Fusionner', 'Réunit les deux : pour une position commune, les essais et erreurs sont additionnés. Rien n\'est perdu.', `${l} + ${r} · rien n'est perdu`],
            ['upload', 'upload', 'Envoyer cet appareil', 'Le contenu en ligne est remplacé par celui de cet appareil.', `le compte reprend ${pos(l)}`],
            ['download', 'download', 'Récupérer mon compte', 'Cet appareil est remplacé par le contenu en ligne. Une sauvegarde locale (.json) vous sera proposée avant.', `cet appareil reprend ${pos(r)}`]
        ];
        return `<div class="account-auth">
            <div class="panel-sub">Cet appareil et le compte <strong>${esc((Auth.user() || {}).email || '')}</strong> contiennent tous deux des données. Rien n'est envoyé avant votre choix.</div>
            ${switched ? `<div class="pgn-note warn">${icon('alert-triangle')} Cet appareil contenait des données d'un autre compte.</div>` : ''}
            <div class="acct-vs"><div><b>${l}</b><small>${icon('devices')}Cet appareil</small></div><span aria-hidden="true">${icon('git-merge')}</span><div><b>${r}</b><small>${icon('cloud')}Compte</small></div></div>
            <div class="account-choices" role="radiogroup" aria-label="Première synchronisation">${cards.map(([s, ic, title, desc, fig]) =>
                `<button type="button" class="account-choice" role="radio" aria-checked="${s === pickStrategy}" data-act="choose:${s}">
                    <span class="acct-choice-ic">${icon(ic)}</span>
                    <span class="acct-choice-t"><span class="account-choice-title">${title}${s === 'merge' ? ' <em>recommandé</em>' : ''}</span>
                    <span class="account-choice-desc">${desc}</span><span class="acct-choice-fig">${fig}</span></span></button>`).join('')}
            </div>
            <button class="btn btn-primary account-submit acct-continue" type="button" data-act="strategy-go">Continuer</button>
            <button class="toast-link account-link" data-act="close" type="button">Plus tard</button>
            <div class="account-msg" role="status" aria-live="polite"></div></div>`;
    }

    // ─── Compte connecté : trois rubriques ────────────────────────────────────
    const ACCOUNT_SECTIONS = [
        { id: 'profil',          icon: 'user',    label: 'Profil',          desc: 'Pseudo, avatar' },
        { id: 'synchronisation', icon: 'devices', label: 'Synchronisation', desc: 'Appareils, exporter' },
        { id: 'securite',        icon: 'lock',    label: 'Sécurité',        desc: 'Mot de passe, déconnexion' }
    ];
    // Sous-titre de la carte d'identité : l'e-mail quand le pseudo occupe le titre.
    const _subLine = (u, name) => name ? u.email || '' : '';
    let confirmDelete = false, editEmail = false, userInfo = null;

    function _figures() {
        let positions = 0, streak = 0, today = 0;
        try {
            loadRepertoireList().forEach(n => { positions += Object.keys(readDBFor(n, 'w')).length + Object.keys(readDBFor(n, 'b')).length; });
            const act = readActivity();
            streak = typeof _streak === 'function' ? _streak(act) : 0;
            today = (act[dayStamp(Date.now())] || { a: 0 }).a;
        } catch (e) { /* hors de l'appli complète (tests) : chiffres à zéro */ }
        return { positions, streak, today };
    }

    // Avatar : seule --size change d'un emplacement à l'autre (posée par la classe cls, account.css).
    const avatarHTML = (cls, glyph) => `<span class="avatar ${cls}" style="${avatarStyle()}">${avatarInner(glyph)}</span>`;
    const avatarName = () => `${AVATAR_NAMES[appSettings.avatarGlyph] || 'Pièce'} · ${AVATAR_COLOR_NAMES[appSettings.avatarColor] || ''}`;

    // Carte « Velours » : avatar en grand, pseudo, e-mail, trois chiffres ; pastille d'état de la synchronisation.
    function _idCard() {
        const u = Auth.user() || {}, f = _figures(), name = (appSettings.pseudo || '').trim();
        return `<div class="acct-id">
            <span class="acct-id-av">${avatarHTML('acct-id-avatar')}<i class="acct-id-dot" data-level="${esc(syncStatus.level)}" title="${esc(syncStatus.text)}"></i></span>
            <div class="acct-id-who"><b id="acct-name">${esc(name || u.email || '')}</b><small id="acct-sub">${esc(_subLine(u, name))}</small>
                <div class="acct-id-figs"><div><b>${f.positions}</b>positions</div><div><b>${f.streak} j</b>d'affilée</div><div><b>${f.today}</b>aujourd'hui</div></div></div>
        </div>`;
    }

    // Grille des motifs (radio) : --cols posé par fitTiles (PanelKit.balancedCols).
    const glyphTiles = glyphs => `<div class="acct-tiles" role="radiogroup" aria-label="Motif">${glyphs.map(g =>
        `<button type="button" class="acct-tile" role="radio" aria-checked="${appSettings.avatarGlyph === g}" aria-label="${AVATAR_NAMES[g] || 'Pièce'}" title="${AVATAR_NAMES[g] || 'Pièce'}" data-pn="seg" data-key="avatarGlyph" data-v="${g}">${avatarHTML('acct-tile-avatar', g)}</button>`).join('')}</div>`;
    const swatchBg = c => c === 'theme' ? 'background:linear-gradient(135deg, var(--theme-dark-deep) 50%, var(--theme-light-refined) 50%)' : `background:${(AVATAR_TINTS[c] || AVATAR_TINTS.sapin)[0]}`;

    // Atelier d'avatar (AvatarStudio) : segments Motif / Photo.
    function _avatarStudio() {
        const AP = typeof AvatarPhoto !== 'undefined' ? AvatarPhoto : null;
        const photo = !!(AP && AP.src()), off = !!(AP && AP.unavailable());
        const tab = studioTab || (photo || off ? 'photo' : 'motif');
        const segBtn = (id, ic, label) => `<button type="button" role="tab" aria-selected="${tab === id}" data-act="studio:${id}">${icon(ic)}${label}</button>`;
        const motif = `<div class="acct-studio-main">${glyphTiles(AVATAR_GLYPHS)}
                <div class="acct-studio-h">Couleur · <span>${AVATAR_COLOR_NAMES[appSettings.avatarColor] || ''}</span></div>
                <div class="acct-swatches" role="radiogroup" aria-label="Couleur">${AVATAR_COLORS.map(c =>
                    `<button type="button" class="acct-swatch" role="radio" aria-checked="${appSettings.avatarColor === c}" aria-label="Couleur ${AVATAR_COLOR_NAMES[c] || c}" title="${AVATAR_COLOR_NAMES[c] || c}" data-pn="seg" data-key="avatarColor" data-v="${c}"><i style="${swatchBg(c)}"></i></button>`).join('')}</div>
                ${photo ? '<p class="acct-studio-note">Votre photo est affichée : le motif la remplace si vous la retirez.</p>' : ''}
            </div>
            <div class="acct-studio-aside" aria-hidden="true">${avatarHTML('acct-studio-avatar')}</div>`;
        const hint = off ? 'Elle n’a pas pu être téléchargée depuis votre compte (stockage « avatars » absent ou photo supprimée). Le motif la remplace.'
                   : photo ? 'Votre photo remplace le motif, partout où l’avatar s’affiche.'
                   : 'Recadrée en carré ; enregistrée avec votre compte (sinon, sur cet appareil seulement).';
        const photoTab = `<div class="acct-photo">
                <span class="acct-photo-av">${avatarHTML('acct-studio-avatar')}${off ? `<i class="acct-photo-warn" title="Photo indisponible">${icon('alert-triangle')}</i>` : ''}</span>
                <div class="pn-text"><b>${off ? 'Photo indisponible' : photo ? 'Votre photo' : 'Aucune photo'}</b><small>${hint}</small></div>
                <div class="pn-actions"><button class="btn" type="button" data-act="photo-pick">${icon('upload')}${photo || off ? 'Nouvelle photo' : 'Choisir une photo'}</button>${photo || appSettings.avatarPhoto ? '<button class="btn" type="button" data-act="photo-remove" data-key="avatarPhoto">Retirer</button>' : ''}</div>
            </div>`;
        return `<h3 class="pn-h">Avatar</h3><div class="pn-group acct-studio">
            <div class="acct-studio-top"><div class="acct-seg" role="tablist" aria-label="Avatar">${segBtn('motif', 'av-owl', 'Motif')}${segBtn('photo', 'upload', 'Photo')}</div><span class="acct-mono">${esc(avatarName())}</span></div>
            <div class="acct-studio-body${tab === 'photo' ? ' is-photo' : ''}" role="tabpanel">${tab === 'photo' ? photoTab : motif}</div></div>`;
    }

    function sectionProfil() {
        return _idCard() + _avatarStudio()
            + PanelKit.group('Identité', [
                PanelKit.row('Pseudo', 'Affiché sur l’accueil (« Bonsoir, … ») et dans la barre du haut.',
                    `<input class="pn-input" type="text" maxlength="24" autocomplete="nickname" placeholder="Votre pseudo" value="${esc(appSettings.pseudo)}" data-pn="text" data-key="pseudo" aria-label="Pseudo">`)])
            + PanelKit.group('Classement et objectif', [
                PanelKit.row('Classement Elo', 'Facultatif, visible de vous seul.',
                    `<input class="pn-input is-short" type="text" inputmode="numeric" maxlength="4" placeholder="ex. 1650" value="${esc(appSettings.elo)}" data-pn="text" data-key="elo" aria-label="Classement Elo">`),
                PanelKit.row('Objectif quotidien', 'Aussi réglable dans Paramètres › Jeu et entraînement.',
                    PanelKit.range('dailyGoal', appSettings.dailyGoal, 5, 50, 5, `${appSettings.dailyGoal} positions`, 'Objectif quotidien'))])
            + PanelKit.group('Comptes d’échecs en ligne', [
                PanelKit.row('Lichess', 'Pour comparer vos parties à votre répertoire (Analyser mes parties).',
                    `<input class="pn-input" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="pseudo Lichess" value="${esc(appSettings.lichessUser)}" data-pn="text" data-key="lichessUser" aria-label="Pseudo Lichess">`),
                PanelKit.row('Chess.com', 'Enregistré avec le compte : retrouvé sur tous vos appareils.',
                    `<input class="pn-input" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="pseudo Chess.com" value="${esc(appSettings.chesscomUser)}" data-pn="text" data-key="chesscomUser" aria-label="Pseudo Chess.com">`)]);
    }

    function _ago(t) {
        if (!t) return 'jamais';
        const m = Math.round((Date.now() - t) / 60000);
        if (m < 2) return 'à l’instant';
        if (m < 60) return `il y a ${m} min`;
        const h = Math.round(m / 60);
        if (h < 24) return `il y a ${h} h`;
        const d = Math.round(h / 24);
        return `il y a ${d} jour${d > 1 ? 's' : ''}`;
    }

    // État de la synchronisation en grand (mis à jour sur place par setSyncStatus).
    const SYNC_LOOK = { ok: ['check', 'À jour'], busy: ['rotate-ccw', 'Synchronisation en cours'], offline: ['cloud', 'Hors ligne'], error: ['alert-triangle', 'Synchronisation en échec'] };
    function _syncHero() {
        const lv = SYNC_LOOK[syncStatus.level] ? syncStatus.level : 'ok', [ic, title] = SYNC_LOOK[lv];
        const me = typeof listDevices === 'function' ? listDevices().find(d => d.me) : null;
        const last = lastOk || (me && me.seen) || 0;
        return `<div class="acct-sync" id="account-sync-hero" data-level="${lv}">
            <span class="acct-sync-ic">${icon(ic)}</span>
            <div class="acct-sync-t"><b>${title}</b><span id="account-sync-text" data-level="${lv}">${esc(syncStatus.text)}</span>
                <small class="acct-mono">Dernière synchronisation : ${_ago(last)}</small></div>
            <button class="btn btn-primary" type="button" data-act="sync-now" data-needs-network>${icon('rotate-ccw')}${lv === 'error' ? 'Réessayer' : 'Synchroniser maintenant'}</button></div>`;
    }

    function sectionSync() {
        const devs = listDevices();
        return `<div class="pn-group acct-sync-group">${_syncHero()}</div>`
            + `<div class="pgn-note info net-note">Hors ligne : vos modifications seront synchronisées au retour de la connexion.</div>`
            + PanelKit.group('Vos appareils', devs.length ? devs.map(d => `<div class="pn-device">${icon('devices')}
                <div class="pn-text"><b>${esc(d.name || 'Appareil')}${d.me ? '<em>cet appareil</em>' : ''}</b><small>${d.revoked ? 'Déconnexion demandée' : d.me ? 'Actif maintenant' : 'Dernière synchronisation ' + _ago(d.seen)}</small></div>
                ${d.me || d.revoked ? '' : `<button class="btn" type="button" data-act="revoke:${esc(d.id)}">${icon('log-out')}Déconnecter</button>`}</div>`)
                : [PanelKit.row('Aucun appareil enregistré pour l’instant', 'La liste se remplit à la prochaine synchronisation.', '')])
            + PanelKit.group('Ce qui est synchronisé', [
                PanelKit.row('Répertoires, statistiques, révisions, finales', 'Toujours synchronisés.', icon('check')),
                PanelKit.row('Échiquier, pièces, jeu, notation, profil', 'Toujours synchronisés : même réglage sur tous vos appareils.', icon('check')),
                PanelKit.row('Mode clair / sombre et sons', 'Désactivé, chaque appareil garde les siens.', PanelKit.toggle('syncLooks', appSettings.syncLooks, 'Synchroniser le mode et les sons'))])
            + PanelKit.group('Sauvegarde', [
                PanelKit.row('Exporter mes données', 'Fichier .json : répertoires, statistiques, planning de révision, finales.', `<button class="btn" type="button" data-act="export">${icon('download')}Exporter</button>`)]);
    }

    function sectionSecurite() {
        const u = Auth.user() || {};
        const ids = userInfo && Array.isArray(userInfo.identities) ? userInfo.identities.map(i => i.provider) : null;
        const methods = ids ? [ids.includes('google') ? 'Google' : null, ids.includes('email') ? 'e-mail' : null].filter(Boolean).join(' · ') : '';
        return PanelKit.group('Connexion', [
            editEmail
                ? `<div class="pn-row is-col"><form class="account-form" data-form="email" data-needs-network novalidate>
                    <div class="account-field acct-field" data-field="email"><span class="acct-field-h"><label for="acct-email">Nouvelle adresse e-mail</label></span>
                    <span class="acct-in">${icon('mail')}<input id="acct-email" type="email" name="email" autocomplete="email" required></span></div>
                    <div class="account-msg" role="status" aria-live="polite"></div>
                    <div class="pn-actions"><button class="btn btn-primary account-submit" type="submit" data-needs-network>Envoyer le lien de confirmation</button><button class="btn" type="button" data-act="email-cancel">Annuler</button></div>
                   </form></div>`
                : PanelKit.row(esc(u.email || 'Adresse e-mail'), methods ? `Connexion par ${methods}` : 'Adresse e-mail du compte', `<button class="btn" type="button" data-act="email-edit" data-needs-network>Modifier</button>`),
            PanelKit.row('Mot de passe', 'Choisissez-en un nouveau, ou recevez un lien par e-mail pour le réinitialiser.',
                `<div class="pn-actions"><button class="btn" type="button" data-act="view:newpw">Changer</button><button class="btn" type="button" data-act="view:recover">Recevoir un lien</button></div>`)])
            + PanelKit.group('Session', [
                PanelKit.row('Se déconnecter', 'Vos données restent sur cet appareil et en ligne.', `<button class="btn" type="button" data-act="signout">${icon('log-out')}Se déconnecter</button>`),
                PanelKit.row('Se déconnecter et effacer cet appareil', 'Rien n’est supprimé en ligne.', `<button class="btn" type="button" data-act="signout-erase">Effacer cet appareil</button>`)])
            + `<h3 class="pn-h acct-danger-h">${icon('shield-alert')}Zone sensible</h3><div class="pn-group pn-danger acct-danger">`
            + PanelKit.row('Supprimer mon compte', 'Supprime définitivement le compte et les données en ligne. Les données de cet appareil sont conservées.',
                `<button class="btn btn-danger" type="button" data-act="delete-ask" data-needs-network>Supprimer…</button>`)
            + (confirmDelete ? `<div class="pn-confirm"><label class="acct-confirm-l" for="account-delete-confirm">Tapez SUPPRIMER pour confirmer</label>
                <div class="pn-actions"><input class="pn-input acct-confirm-in" id="account-delete-confirm" autocomplete="off" placeholder="SUPPRIMER">
                <button class="btn btn-danger" type="button" data-act="delete-account" data-needs-network disabled title="Tapez SUPPRIMER pour confirmer">${icon('trash')}Supprimer définitivement</button>
                <button class="btn" type="button" data-act="delete-cancel">Annuler</button></div></div>` : '')
            + `</div>`;
    }

    // ─── Fenêtre ──────────────────────────────────────────────────────────────
    let panelApi = null;
    const TITLES = { auth: 'Connexion', signup: 'Créer un compte', welcome: 'Bienvenue', recover: 'Mot de passe oublié', newpw: 'Nouveau mot de passe', chooser: 'Première synchronisation' };

    function render() {
        if (!panelApi) return;
        panelApi.refresh();
        const first = view !== 'account' && panelApi.el.querySelector('.pn-content input');
        if (first && isOpen()) setTimeout(() => first.focus(), 0);
    }

    function renderContent(section) {
        if (view === 'account') {
            return '<div class="account-msg" role="status" aria-live="polite"></div>'
                 + ({ profil: sectionProfil, synchronisation: sectionSync, securite: sectionSecurite }[section] || sectionProfil)();
        }
        const v = { recover: viewRecover, newpw: viewNewPassword, chooser: viewChooser, signup: viewSignup, welcome: viewWelcome }[view] || viewAuth;
        return v();
    }

    function open(v, section) {
        if (!overlay) return;
        view = v || (Auth.isSignedIn() ? 'account' : 'auth');
        if (view === 'auth' || view === 'signup') { linkMode = false; swapOffer = false; }
        confirmDelete = false; editEmail = false; studioTab = '';
        panelApi.open(view === 'account' ? section : undefined);
        if (view === 'account' && Auth.fetchUser) Auth.fetchUser().then(u => { userInfo = u; if (isOpen() && panelApi.state.section === 'securite') render(); });
    }
    function close() { if (panelApi) panelApi.close(); }

    // Réglages du profil : enregistrés comme préférences synchronisées (settings.js).
    function onControl(kind, key, value, el) {
        if (kind === 'text' || kind === 'text-commit') {
            if (key === 'elo') value = value.replace(/\D/g, '').slice(0, 4);
            if (key === 'elo' && value && value.length < 3 && kind === 'text') return;    // attend 3 chiffres
            value = String(value).trim() === '' ? '' : (kind === 'text-commit' ? value.trim() : value);
            if (!SYNCED_PREFS[key].ok(value)) return;
            appSettings[key] = value; saveSettings();
            updateButton();
            const name = panelApi.el.querySelector('#acct-name'), sub = panelApi.el.querySelector('#acct-sub'), u = Auth.user() || {};
            if (name) name.textContent = (appSettings.pseudo || '').trim() || u.email || '';
            if (sub) sub.textContent = _subLine(u, (appSettings.pseudo || '').trim());
            if (key === 'pseudo' && typeof renderHomeSummary === 'function') renderHomeSummary();
            return;
        }
        if (kind === 'range' || kind === 'range-commit') {
            if (typeof setPref === 'function') setPref(key, value);
            const out = el.parentElement.querySelector('output'); if (out) out.textContent = `${value} positions`;
            return;
        }
        if (kind === 'toggle' && key === 'syncLooks') {
            appSettings.syncLooks = value; saveSettings();
            if (value) _copyLooksToPrefs();
            return render();
        }
        if (kind === 'seg') {
            if (!SYNCED_PREFS[key] || !SYNCED_PREFS[key].ok(value)) return;
            const p = view === 'welcome' && overlay.querySelector('input[name=pseudo]');      // pseudo en cours de saisie gardé
            if (p) welcomeName = p.value;
            appSettings[key] = value; saveSettings();
            updateButton(); render();
        }
    }

    // ─── Première synchronisation ─────────────────────────────────────────────
    function applyStrategy(strategy, backupFirst) {
        const u = Auth.user(); if (!u) return;
        if (backupFirst) {                                                    // sauvegarde locale, seulement si demandée
            try { if (typeof exportDB === 'function') exportDB(); }
            catch (e) { reportError('sauvegarde avant synchronisation', e, { notify: true, message: 'La sauvegarde locale a échoué : la synchronisation n\'a pas été lancée. Réessayez, ou exportez depuis Données.' }); return; }
        }
        SyncIntent.set({ user: u.id, strategy, at: Date.now() });
        if (strategy !== 'download') SyncMeta.markAllDirty();
        window.dispatchEvent(new CustomEvent('chays-sync-intent', { detail: { strategy, user: u.id } }));
    }

    // ask : connexion par un lien non demandé ici, ou changement de compte → les données de cet appareil
    // ne partent jamais sans que l'utilisateur l'ait choisi (fenêtre « Première synchronisation »).
    async function ensureIntent(opts) {
        const ask = !!(opts && opts.ask);
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
            if (local.has && !remote.has && !ask) {
                applyStrategy('upload');
                return toast(`Vos ${plural(local.positions, 'position', 'positions')} vont être sauvegardées dans votre compte.`);
            }
            if (!local.has && remote.has) {
                applyStrategy('download');
                return toast(`Vos ${plural(remote.positions, 'position', 'positions')} en ligne vont être récupérées.`);
            }
            chooser = { local, remote }; pickStrategy = 'merge';
            open('chooser');
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

    // Suppression définitive du compte : double confirmation, les données de cet appareil sont conservées.
    async function onDeleteAccount() {
        const input = overlay.querySelector('#account-delete-confirm');
        if (!input || input.value.trim().toUpperCase() !== 'SUPPRIMER') { msg('Tapez SUPPRIMER pour confirmer la suppression.', 'err'); if (input) input.focus(); return; }
        setBusy(true);
        if (typeof AvatarPhoto !== 'undefined') await AvatarPhoto.purge();        // dossier de photos, avant le compte
        const r = await Auth.deleteAccount();
        setBusy(false);
        if (!r.ok) return msg(r.message, 'err');
        confirmDelete = false;
        close();
        toast('Votre compte a été supprimé. Vos données restent sur cet appareil.');
    }

    // ─── Événements ───────────────────────────────────────────────────────────
    async function submit(form) {
        if (busy) return;
        const type = form.dataset.form;
        const f = form.elements;
        const email = f.email ? f.email.value.trim() : '';
        const pw = f.password ? f.password.value : '';
        if (type === 'welcome') {
            const name = (f.pseudo.value || '').trim().slice(0, 24);
            if (name && SYNCED_PREFS.pseudo.ok(name)) { appSettings.pseudo = name; saveSettings(); updateButton(); if (typeof renderHomeSummary === 'function') renderHomeSummary(); }
            view = 'account'; render();
            return;
        }
        if (email) draftEmail = email;
        clearErrors();
        if (type !== 'newpw' && !/^\S+@\S+\.\S+$/.test(email)) return fieldError('email', 'Adresse e-mail invalide.');
        if (type !== 'recover' && type !== 'link' && type !== 'email' && !pw) return fieldError('password', 'Saisissez un mot de passe.');
        if ((type === 'newpw' || (type === 'auth' && view === 'signup')) && pw.length < PW_MIN) return fieldError('password', PW_SHORT);
        setBusy(true);
        let r;
        if (type === 'recover')      r = await Auth.recover(email);
        else if (type === 'link')    r = await Auth.signInWithLink(email);
        else if (type === 'email')   r = await Auth.updateEmail(email);
        else if (type === 'newpw')   r = await Auth.updatePassword(pw);
        else if (view === 'signup')  r = await Auth.signUp(email, pw);
        else                         r = await Auth.signIn(email, pw);
        if (!overlay.contains(form)) return;                           // la vue a changé pendant l'appel (ex. connexion réussie)
        setBusy(false);
        if (!r.ok) {
            // Connexion refusée ou adresse déjà inscrite : l'autre vue est proposée, l'e-mail déjà rempli.
            if (type === 'auth' && ['invalid_credentials', 'user_exists', 'email_not_confirmed'].includes(r.code) && !swapOffer) {
                swapOffer = true; render();
            }
            return ERR_FIELD[r.code] ? fieldError(ERR_FIELD[r.code], r.message) : msg(r.message, 'err');
        }
        if (type === 'recover') return msg("Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé.", 'ok');
        if (type === 'link')    return msg(`Lien envoyé à ${email} : ouvrez-le sur cet appareil pour vous connecter.`, 'ok');
        if (type === 'email')   { editEmail = false; render(); return msg(`Un lien de confirmation vient d'être envoyé à ${email}. L'adresse changera une fois le lien ouvert.`, 'ok'); }
        if (type === 'newpw')   { view = 'account'; render(); return msg('Mot de passe modifié.', 'ok'); }
        if (r.needsConfirmation) {
            linkMode = false; swapOffer = false; view = 'auth'; render();
            return msg(`Compte créé. Un e-mail de confirmation vient d'être envoyé à ${email} : cliquez sur le lien qu'il contient, puis connectez-vous.`, 'ok');
        }
        // connexion réussie : l'événement « signed-in » affiche la vue du compte
    }

    // E-mail en cours de saisie, repris par la vue suivante.
    function keepEmail() {
        const i = overlay.querySelector('.account-form input[name=email]');
        if (i && i.value.trim()) draftEmail = i.value.trim();
    }

    function onClick(e) {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const act = el.dataset.act;
        if (act === 'close') close();
        else if (act === 'export') { if (typeof exportDB === 'function') exportDB(); }
        else if (act === 'email-edit') { editEmail = true; render(); }
        else if (act === 'email-cancel') { editEmail = false; render(); }
        else if (act === 'delete-ask') { confirmDelete = true; render(); const i = overlay.querySelector('#account-delete-confirm'); if (i) i.focus(); }
        else if (act === 'delete-cancel') { confirmDelete = false; render(); }
        else if (act.startsWith('revoke:')) { revokeDevice(act.slice(7)); if (typeof SyncEngine !== 'undefined') SyncEngine.syncNow(); render(); msg('L’appareil sera déconnecté à sa prochaine synchronisation.', 'ok'); }
        else if (act === 'link:on' || act === 'link:off') { keepEmail(); linkMode = act === 'link:on'; render(); }
        else if (act === 'swap') { keepEmail(); view = view === 'signup' ? 'auth' : 'signup'; swapOffer = false; linkMode = false; render(); }
        else if (act.startsWith('view:')) { keepEmail(); view = act.slice(5); swapOffer = false; render(); }
        else if (act === 'eye') {
            const i = el.parentElement.querySelector('input'), hidden = i.type === 'text';
            i.type = hidden ? 'password' : 'text';
            el.querySelector('.sr-only').textContent = hidden ? 'Afficher' : 'Masquer';
            el.title = hidden ? 'Afficher le mot de passe' : 'Masquer le mot de passe';
            el.classList.toggle('is-on', !hidden);
        }
        else if (act.startsWith('studio:')) { studioTab = act.slice(7); render(); }
        else if (act.startsWith('choose:')) {
            pickStrategy = act.slice(7);
            overlay.querySelectorAll('.account-choice').forEach(b => b.setAttribute('aria-checked', String(b === el)));
        }
        else if (act === 'strategy-go') runStrategy(pickStrategy);
        else if (act === 'sync-now') { if (typeof SyncEngine !== 'undefined') SyncEngine.syncNow(); }
        else if (act === 'photo-pick') { if (typeof AvatarPhoto !== 'undefined') AvatarPhoto.pick(); }
        else if (act === 'photo-remove') { if (typeof AvatarPhoto !== 'undefined') AvatarPhoto.remove(); }
        else if (act === 'signout') onSignOut(false);
        else if (act === 'signout-erase') onSignOut(true);
        else if (act === 'delete-account') onDeleteAccount();
        else if (act.startsWith('provider:')) {
            const r = Auth.signInWithProvider(act.slice(9));
            if (!r.ok) msg(r.message, 'err');
        }
    }

    // Première synchronisation : applique la carte choisie (« Continuer »), avec confirmation si des données sont remplacées.
    function runStrategy(s) {
        const run = backupFirst => { applyStrategy(s, backupFirst); view = 'account'; render(); toast(s === 'merge' ? 'Fusion programmée : vos données vont être réunies.' : s === 'upload' ? 'Vos données vont remplacer celles du compte.' : 'Les données du compte vont remplacer celles de cet appareil.'); };
        if (s === 'download') {
            // La sauvegarde locale est proposée, pas imposée.
            const text = 'Remplacer les données de cet appareil par celles du compte ? Vous pouvez d\'abord télécharger une sauvegarde locale (.json) de ce qui va être remplacé.';
            if (typeof askConfirmChoice === 'function') askConfirmChoice(text, { cascade: 'Télécharger une sauvegarde, puis remplacer', solo: 'Remplacer sans sauvegarde' }, () => run(true), () => run(false));
            else if (confirm(text)) run(false);
            return;
        }
        const warn = s === 'upload' ? "Remplacer les données en ligne par celles de cet appareil ? Ce qui n'existe pas ici sera supprimé du compte." : null;
        if (warn && typeof askConfirm === 'function') askConfirm(warn, () => run(false)); else run(false);
    }

    // Saisie : jauge du mot de passe, erreur du champ effacée, confirmation de suppression.
    function onInput(e) {
        const t = e.target, f = t.closest && t.closest('.acct-field.is-err');
        if (f) clearFieldError(f);
        if (t.name === 'password') updatePwMeter();
        if (t.id === 'account-delete-confirm') {
            const b = overlay.querySelector('[data-act="delete-account"]'), ok = t.value.trim().toUpperCase() === 'SUPPRIMER';
            b.disabled = !ok || busy;
            if (ok) b.removeAttribute('title'); else b.title = 'Tapez SUPPRIMER pour confirmer';
        }
    }

    // Grilles de motifs : colonnes équilibrées selon la largeur (6 × 3 pour les 18 motifs).
    function fitTiles() {
        if (!overlay) return;
        overlay.querySelectorAll('.acct-tiles').forEach(g => {
            const w = g.clientWidth;
            if (w) g.style.setProperty('--cols', PanelKit.balancedCols(g.children.length, w, 44, 6));
        });
    }

    // ─── Installation ─────────────────────────────────────────────────────────
    function build() {
        panelApi = PanelKit.create({
            id: 'account-overlay', before: 'help-overlay',
            title: () => view === 'account' ? 'Compte' : TITLES[view] || 'Compte',
            sections: () => view === 'account' ? ACCOUNT_SECTIONS : [{ id: 'single', icon: 'user', label: TITLES[view] || 'Compte' }],
            render: renderContent,
            afterRender: () => { fitTiles(); updatePwMeter(); },
            onControl,
            onClose: () => { confirmDelete = false; editEmail = false; }
        });
        overlay = panelApi.el;
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('submit', e => { e.preventDefault(); submit(e.target); });
        overlay.addEventListener('input', onInput);
        if (typeof ResizeObserver === 'function') new ResizeObserver(fitTiles).observe(overlay.querySelector('.pn-content'));

        btn = document.createElement('button');
        btn.id = 'account-btn'; btn.className = 'theme-toggle'; btn.type = 'button';
        btn.onclick = () => open();
        const pill = document.querySelector('.topnav-pill') || document.querySelector('.topnav-right');
        if (pill) pill.insertBefore(btn, pill.firstChild); else document.body.appendChild(btn);
    }

    function onNotice(n) {
        if (!n) return;
        if (n.kind === 'recovery') open('newpw');
        else if (n.kind === 'confirmed') toast('Adresse confirmée : vous êtes connecté.');
        else if (n.kind === 'signed-in') toast('Vous êtes connecté.');
        else if (n.kind === 'error') toast(n.message);
        else if (n.kind === 'confirm-link') {
            // Lien que cet appareil n'a pas demandé : on nomme le compte avant de s'y connecter (texte simple, sans HTML).
            const text = n.current
                ? `Ce lien connecte cet appareil au compte ${n.email}, à la place de ${n.current}. Continuer ?`
                : `Ce lien connecte cet appareil au compte ${n.email}. Continuez seulement s'il s'agit de votre adresse et que vous venez de demander ce lien.`;
            if (typeof askConfirm === 'function') askConfirm(text, () => Auth.answerLink(true));
            else Auth.answerLink(confirm(text));
        }
    }

    function init() {
        if (!Auth.configured() || overlay) return;
        build();
        updateButton();
        Auth.onChange((ev, data) => {
            if (ev === 'signed-in') {
                switched = !!(data && data.switched);
                if (isOpen() && view !== 'newpw') { view = 'account'; render(); }
                updateButton(); ensureIntent({ ask: switched || !!(data && data.confirmed) });
                welcomeIfNew();
            } else if (ev === 'signed-out') {
                updateButton(); if (isOpen()) { view = 'auth'; linkMode = false; render(); }
            } else if (ev === 'expired') {
                updateButton(); toast('Votre session a expiré : reconnectez-vous pour reprendre la synchronisation.');
                if (isOpen()) { view = 'auth'; linkMode = false; render(); }
            } else if (ev === 'notice') onNotice(data);
        });
        onNotice(Auth.takeNotice());
        if (typeof AvatarPhoto !== 'undefined') AvatarPhoto.onChange(() => { updateButton(); if (isOpen() && view === 'account') render(); });
        if (Auth.isSignedIn()) ensureIntent();
        loadProviders();
        if (typeof Net !== 'undefined') Net.onChange(on => { if (on && !providersReady) loadProviders(); });
    }

    // Nouveau compte (création et première connexion à moins d'une minute d'écart) sans pseudo : accueil.
    function isNewUser(u) {
        if (!u || !u.created_at || !u.last_sign_in_at) return false;
        return Math.abs(Date.parse(u.last_sign_in_at) - Date.parse(u.created_at)) < 60000;
    }
    function suggestedName(u) {
        const m = (u && u.user_metadata) || {};
        const name = (m.full_name || m.name || m.given_name || '').trim() || ((u && u.email) || '').split('@')[0];
        return name.slice(0, 24);
    }
    async function welcomeIfNew() {
        if ((appSettings.pseudo || '').trim() || !Auth.fetchUser) return;
        const u = await Auth.fetchUser();
        if (!isNewUser(u) || view === 'chooser' || (appSettings.pseudo || '').trim()) return;
        welcomeName = suggestedName(u);
        open('welcome');
    }

    // Boutons « Continuer avec … » dès que la liste est connue ; hors ligne, nouvel essai au retour de la connexion.
    function loadProviders() {
        if (!isOnline()) return;
        Promise.resolve(Auth.providers ? Auth.providers() : []).then(p => {
            providers = Array.isArray(p) ? p : [];
            providersReady = providers.length > 0 || isOnline();
            if (isOpen() && view === 'auth') render();
        }).catch(() => { providersReady = true; if (isOpen() && view === 'auth') render(); });
    }

    function setSyncStatus(level, text) {
        syncStatus = { level: level || 'ok', text: text || 'Connecté' };
        if (level === 'ok' && text) lastOk = Date.now();
        updateButton();
        const hero = overlay && overlay.querySelector('#account-sync-hero');
        if (hero) hero.outerHTML = _syncHero();
        const dot = overlay && overlay.querySelector('.acct-id-dot');
        if (dot) { dot.dataset.level = syncStatus.level; dot.title = syncStatus.text; }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    PanelKit.jump({ id: 'account-overlay', label: 'Compte', icon: 'user', order: 2, open: () => open() });

    // Préférences reçues d'un autre appareil : avatar et fenêtre à jour.
    function refresh() { updateButton(); if (isOpen() && view === 'account') render(); }

    return { open, close, setSyncStatus, ensureIntent, refresh, notify: toast, isNewUser, suggestedName };
})();
