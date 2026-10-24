/**
 * core/accountUI.js
 * ──────────────────────────────────────────────────────────────────────────
 * Interface du compte. Autonome : crée elle-même son bouton « Compte » (barre du haut)
 * et sa fenêtre — aucune modification de index.html (hors balises <script>/<link>) ni d'app.js.
 * Rien n'apparaît si le service n'est pas configuré (cloudConfig.js vide).
 *
 * Vues : connexion / création de compte (e-mail, ou Google si activé dans Supabase) · mot de passe
 *        oublié · nouveau mot de passe · compte connecté (dont suppression du compte) ·
 *        première synchronisation (choix fusionner / envoyer / récupérer).
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
    let view = 'auth', mode = 'signin', busy = false, switched = false, chooser = null, choosing = false;
    let syncStatus = { level: 'ok', text: 'Connecté' };
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

    // ─── Avatar (pseudo, pièce ou initiale, couleur : Compte › Profil) ─────────
    const AVATAR_TINTS = { sapin: ['#2f4a26', '#efe3c9'], noyer: ['#5a3c26', '#f1e3cc'], nuit: ['#2c3f62', '#e3e9f3'],
                           ardoise: ['#3b3f44', '#ebebe7'], prune: ['#4b3560', '#efe7f6'], ivoire: ['#efe3c9', '#26381e'] };
    function avatarInner(glyph, color) {
        const g = glyph || appSettings.avatarGlyph, c = color || appSettings.avatarColor;
        if (g === 'initial') {
            const u = Auth.user() || {};
            return esc(((appSettings.pseudo || '').trim()[0] || (u.email || '?')[0]).toUpperCase());
        }
        if (typeof PIECE_SETS === 'undefined') return g.toUpperCase();
        const set = PIECE_SETS[appSettings.pieceSet] && appSettings.pieceSet !== 'blindfold' ? PIECE_SETS[appSettings.pieceSet] : PIECE_SETS[DEFAULT_PIECE_SET];
        const key = c === 'ivoire' ? g : g.toUpperCase();                 // pièce noire sur fond ivoire, blanche ailleurs
        return `<span class="av-glyph">${set.svg[key]}</span>`;
    }
    const avatarStyle = c => { const t = AVATAR_TINTS[c || appSettings.avatarColor] || AVATAR_TINTS.sapin; return `background:${t[0]};color:${t[1]}`; };

    // ─── Bouton de la barre du haut ───────────────────────────────────────────
    function updateButton() {
        if (!btn) return;
        const u = Auth.user();
        btn.classList.toggle('has-session', !!u);
        btn.dataset.sync = u ? syncStatus.level : '';
        btn.innerHTML = u ? `<span class="topnav-avatar" style="${avatarStyle()}">${avatarInner()}</span>` : SVG_USER_BTN;
        const who = (appSettings.pseudo || '').trim() || (u && u.email);
        btn.title = u ? `Compte — ${who}` : 'Compte (non connecté)';
        btn.setAttribute('aria-label', btn.title);
    }

    // ─── Vues hors connexion (une seule rubrique) ─────────────────────────────
    function pwField(autocomplete, label) {
        return `<label class="account-field"><span>${label || 'Mot de passe'}</span><span class="account-pw">
            <input type="password" name="password" autocomplete="${autocomplete}" minlength="8" required>
            <button type="button" class="account-eye" data-act="eye">Afficher</button></span></label>`;
    }

    function viewAuth() {
        const up = mode === 'signup', link = mode === 'link';
        return `<div class="account-auth">
            <h3 class="account-auth-title">Vos répertoires, sur tous vos appareils</h3>
            <div class="panel-sub">Sans compte, vos données restent uniquement sur cet appareil. Avec un compte, elles sont aussi sauvegardées en ligne et synchronisées entre vos appareils.</div>
            ${OFFLINE_NOTE}
            ${!providersReady && isOnline() ? '<div class="account-providers sk-online" aria-hidden="true"><span class="sk sk-btn"></span></div><div class="account-or sk-online" aria-hidden="true"><span class="sk sk-line" style="width:140px"></span></div>' : ''}
            ${providers.length ? `<div class="account-providers">${providers.filter(p => PROVIDER_LABEL[p]).map(p =>
                `<button class="btn account-provider account-provider-${p}" data-needs-network data-act="provider:${p}" type="button">${p === 'google' ? `<span class="account-provider-badge">${SVG_GOOGLE}</span>` : ''}Continuer avec ${PROVIDER_LABEL[p]}</button>`).join('')}</div>
                <div class="account-or"><span>ou avec votre e-mail</span></div>` : ''}
            <div class="seg account-seg">
                <button class="seg-btn ${link ? 'active' : ''}" data-act="mode:link" type="button">Lien par e-mail</button>
                <button class="seg-btn ${!up && !link ? 'active' : ''}" data-act="mode:signin" type="button">Mot de passe</button>
                <button class="seg-btn ${up ? 'active' : ''}" data-act="mode:signup" type="button">Créer un compte</button>
            </div>
            <form class="account-form" data-form="${link ? 'link' : 'auth'}" data-needs-network novalidate>
                <label class="account-field"><span>Adresse e-mail</span><input type="email" name="email" autocomplete="username" required></label>
                ${link ? '' : pwField(up ? 'new-password' : 'current-password')}
                <div class="account-msg" role="status" aria-live="polite"></div>
                <button class="btn btn-primary account-submit" type="submit" data-needs-network>${link ? 'Recevoir un lien de connexion' : up ? 'Créer mon compte' : 'Se connecter'}</button>
                ${link ? '<div class="set-hint">Pas de mot de passe à retenir : le lien vous connecte (et crée le compte si besoin).</div>'
                       : up ? '<div class="set-hint">8 caractères minimum.</div>' : '<button type="button" class="toast-link account-link" data-act="view:recover">Mot de passe oublié ?</button>'}
            </form></div>`;
    }

    function viewRecover() {
        return `<div class="account-auth">
            <div class="panel-sub">Saisissez l'adresse de votre compte : nous vous envoyons un lien pour choisir un nouveau mot de passe.</div>
            <form class="account-form" data-form="recover" data-needs-network novalidate>
                <label class="account-field"><span>Adresse e-mail</span><input type="email" name="email" autocomplete="username" required value="${esc((Auth.user() || {}).email || '')}"></label>
                <div class="account-msg" role="status" aria-live="polite"></div>
                <button class="btn btn-primary account-submit" type="submit" data-needs-network>Envoyer le lien</button>
                <button type="button" class="toast-link account-link" data-act="${Auth.isSignedIn() ? 'view:account' : 'view:auth'}">Retour</button>
            </form></div>`;
    }

    function viewNewPassword() {
        return `<div class="account-auth">
            <div class="panel-sub">Choisissez votre nouveau mot de passe.</div>
            <form class="account-form" data-form="newpw" data-needs-network novalidate>
                ${pwField('new-password', 'Nouveau mot de passe')}
                <div class="account-msg" role="status" aria-live="polite"></div>
                <button class="btn btn-primary account-submit" type="submit" data-needs-network>Enregistrer</button>
                ${Auth.isSignedIn() ? '<button type="button" class="toast-link account-link" data-act="view:account">Annuler</button>' : ''}
            </form></div>`;
    }

    function viewChooser() {
        const c = chooser;
        return `<div class="account-auth">
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
                    <span class="account-choice-desc">Cet appareil est remplacé par le contenu en ligne. Une sauvegarde locale (.json) vous sera proposée avant.</span></button>
            </div>
            <button class="toast-link account-link" data-act="close" type="button">Plus tard</button>
            <div class="account-msg" role="status" aria-live="polite"></div></div>`;
    }

    // ─── Compte connecté : quatre rubriques ───────────────────────────────────
    const ACCOUNT_SECTIONS = [
        { id: 'profil',    icon: 'user',     label: 'Profil',                desc: 'Pseudo, avatar, niveau' },
        { id: 'securite',  icon: 'lock',     label: 'Connexion et sécurité', desc: 'E-mail, mot de passe' },
        { id: 'appareils', icon: 'devices',  label: 'Appareils et synchro',  desc: 'Ce qui est synchronisé, et où' },
        { id: 'donnees',   icon: 'database', label: 'Données du compte',     desc: 'Exporter, déconnecter, supprimer' }
    ];
    const LEVEL_LABELS = { debut: 'Débutant', club: 'Joueur de club', conf: 'Confirmé', expert: 'Expert' };
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

    function _profileCard() {
        const u = Auth.user() || {}, f = _figures(), name = (appSettings.pseudo || '').trim();
        return `<div class="pn-group"><div class="pn-profile">
            <span class="pn-avatar" style="${avatarStyle()}">${avatarInner()}<i style="background:${syncStatus.level === 'error' ? 'var(--err)' : syncStatus.level === 'offline' ? 'var(--text-dim)' : syncStatus.level === 'busy' ? '#d9a21b' : 'var(--ok)'}"></i></span>
            <div class="pn-who"><b id="acct-name">${esc(name || u.email || '')}</b><small id="acct-sub">${LEVEL_LABELS[appSettings.level]}${appSettings.elo ? ` · ${esc(appSettings.elo)} Elo` : ''}${name ? ` · ${esc(u.email || '')}` : ''}</small></div>
            <div class="pn-figures"><div><b>${f.positions}</b>positions</div><div><b>${f.streak} j</b>d'affilée</div><div><b>${f.today}</b>aujourd'hui</div></div>
        </div></div>`;
    }

    function sectionProfil() {
        const choice = (key, v, inner, style, label) => `<button type="button" class="pn-choice" role="radio" aria-checked="${appSettings[key] === v}" aria-label="${label}" data-pn="seg" data-key="${key}" data-v="${v}" style="${style}">${inner}</button>`;
        return _profileCard()
            + PanelKit.group('Identité', [
                PanelKit.row('Pseudo', 'Affiché sur l’accueil (« Bonsoir, … ») et dans la barre du haut.',
                    `<input class="pn-input" type="text" maxlength="24" autocomplete="nickname" placeholder="Votre pseudo" value="${esc(appSettings.pseudo)}" data-pn="text" data-key="pseudo" aria-label="Pseudo">`),
                PanelKit.row('Avatar', 'Une pièce ou votre initiale, sur la couleur de votre choix.',
                    `<div class="pn-choices" role="radiogroup" aria-label="Motif">${AVATAR_GLYPHS.map(g => choice('avatarGlyph', g, avatarInner(g), avatarStyle(), g === 'initial' ? 'Initiale' : 'Pièce')).join('')}</div>
                     <div class="pn-choices" role="radiogroup" aria-label="Couleur">${AVATAR_COLORS.map(c => choice('avatarColor', c, '', avatarStyle(c), 'Couleur ' + c)).join('')}</div>`, { col: true })])
            + PanelKit.group('Niveau et objectif', [
                PanelKit.row('Niveau', 'Pour situer votre progression.', PanelKit.seg('level', Object.entries(LEVEL_LABELS), appSettings.level, 'Niveau')),
                PanelKit.row('Classement Elo', 'Facultatif, visible de vous seul.',
                    `<input class="pn-input is-short" type="text" inputmode="numeric" maxlength="4" placeholder="ex. 1650" value="${esc(appSettings.elo)}" data-pn="text" data-key="elo" aria-label="Classement Elo">`),
                PanelKit.row('Objectif quotidien', 'Aussi réglable dans Paramètres › Jeu et entraînement.',
                    PanelKit.range('dailyGoal', appSettings.dailyGoal, 5, 50, 5, `${appSettings.dailyGoal} positions`, 'Objectif quotidien'))])
            + PanelKit.group('Comptes d’échecs en ligne', [
                PanelKit.row('Lichess', 'Pour comparer vos parties à votre répertoire (Données › Mes parties en ligne).',
                    `<input class="pn-input" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="pseudo Lichess" value="${esc(appSettings.lichessUser)}" data-pn="text" data-key="lichessUser" aria-label="Pseudo Lichess">`),
                PanelKit.row('Chess.com', 'Enregistré avec le compte : retrouvé sur tous vos appareils.',
                    `<input class="pn-input" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="pseudo Chess.com" value="${esc(appSettings.chesscomUser)}" data-pn="text" data-key="chesscomUser" aria-label="Pseudo Chess.com">`)]);
    }

    function sectionSecurite() {
        const u = Auth.user() || {};
        const ids = userInfo && Array.isArray(userInfo.identities) ? userInfo.identities.map(i => i.provider) : null;
        const methods = ids ? [ids.includes('email') ? 'e-mail' : null, ids.includes('google') ? 'Google' : null].filter(Boolean).join(' et ') : '';
        return PanelKit.group(null, [
            editEmail
                ? `<div class="pn-row is-col"><form class="account-form" data-form="email" data-needs-network novalidate>
                    <label class="account-field"><span>Nouvelle adresse e-mail</span><input type="email" name="email" autocomplete="email" required></label>
                    <div class="account-msg" role="status" aria-live="polite"></div>
                    <div class="pn-actions"><button class="btn btn-primary account-submit" type="submit" data-needs-network>Envoyer le lien de confirmation</button><button class="btn" type="button" data-act="email-cancel">Annuler</button></div>
                   </form></div>`
                : PanelKit.row('Adresse e-mail', esc(u.email || ''), `<button class="btn" type="button" data-act="email-edit" data-needs-network>Modifier</button>`),
            PanelKit.row('Mot de passe', 'Choisissez-en un nouveau, ou recevez un lien par e-mail pour le réinitialiser.',
                `<div class="pn-actions"><button class="btn" type="button" data-act="view:newpw">Changer</button><button class="btn" type="button" data-act="view:recover">Recevoir un lien</button></div>`),
            PanelKit.row('Méthodes de connexion', methods ? `Connexion par ${methods}.` : 'E-mail, et Google si vous l’avez utilisé.', '')
        ]);
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

    function sectionAppareils() {
        const devs = listDevices();
        return PanelKit.group(null, [
            PanelKit.row(`<span class="pn-status" data-level="${esc(syncStatus.level)}" id="account-sync-text">${esc(syncStatus.text)}</span>`, 'Les modifications sont envoyées automatiquement, et reçues des autres appareils.',
                `<button class="btn" type="button" data-act="sync-now" data-needs-network>${icon('cloud')}Synchroniser maintenant</button>`)])
            + `<div class="pgn-note info net-note">Hors ligne : vos modifications seront synchronisées au retour de la connexion.</div>`
            + PanelKit.group('Ce qui est synchronisé', [
                PanelKit.row('Répertoires, statistiques, révisions, finales', 'Toujours synchronisés.', icon('check')),
                PanelKit.row('Échiquier, pièces, jeu, notation, profil', 'Toujours synchronisés : même réglage sur tous vos appareils.', icon('check')),
                PanelKit.row('Mode clair / sombre et sons', 'Désactivé, chaque appareil garde les siens.', PanelKit.toggle('syncLooks', appSettings.syncLooks, 'Synchroniser le mode et les sons'))])
            + PanelKit.group('Vos appareils', devs.length ? devs.map(d => `<div class="pn-device">${icon('devices')}
                <div class="pn-text"><b>${esc(d.name || 'Appareil')}${d.me ? '<em>cet appareil</em>' : ''}</b><small>${d.revoked ? 'Déconnexion demandée' : d.me ? 'Actif maintenant' : 'Dernière synchronisation ' + _ago(d.seen)}</small></div>
                ${d.me || d.revoked ? '' : `<button class="btn" type="button" data-act="revoke:${esc(d.id)}">Déconnecter</button>`}</div>`)
                : [PanelKit.row('Aucun appareil enregistré pour l’instant', 'La liste se remplit à la prochaine synchronisation.', '')]);
    }

    function sectionDonnees() {
        return PanelKit.group(null, [
            PanelKit.row('Exporter mes données', 'Fichier .json : répertoires, statistiques, planning de révision, finales.', `<button class="btn" type="button" data-act="export">${icon('download')}Exporter</button>`),
            PanelKit.row('Se déconnecter', 'Vos données restent sur cet appareil et en ligne.', `<button class="btn" type="button" data-act="signout">${icon('log-out')}Se déconnecter</button>`),
            PanelKit.row('Se déconnecter et effacer cet appareil', 'Rien n’est supprimé en ligne.', `<button class="btn" type="button" data-act="signout-erase">Effacer cet appareil</button>`)])
            + `<h3 class="pn-h">Zone sensible</h3><div class="pn-group pn-danger">`
            + PanelKit.row('Supprimer mon compte', 'Supprime définitivement le compte et les données en ligne. Les données de cet appareil sont conservées.',
                `<button class="btn btn-danger" type="button" data-act="delete-ask" data-needs-network>Supprimer…</button>`)
            + (confirmDelete ? `<div class="pn-confirm"><b>Tapez SUPPRIMER pour confirmer</b>
                <div class="pn-actions"><input class="pn-input" id="account-delete-confirm" autocomplete="off" placeholder="SUPPRIMER" aria-label="Confirmation">
                <button class="btn btn-danger" type="button" data-act="delete-account" data-needs-network>Supprimer définitivement</button>
                <button class="btn" type="button" data-act="delete-cancel">Annuler</button></div></div>` : '')
            + `</div>`;
    }

    // ─── Fenêtre ──────────────────────────────────────────────────────────────
    let panelApi = null;
    const TITLES = { auth: 'Compte', recover: 'Mot de passe oublié', newpw: 'Nouveau mot de passe', chooser: 'Première synchronisation' };

    function render() {
        if (!panelApi) return;
        panelApi.refresh();
        const first = view !== 'account' && panelApi.el.querySelector('.pn-content input');
        if (first && isOpen()) setTimeout(() => first.focus(), 0);
    }

    function renderContent(section) {
        if (view === 'account') {
            return '<div class="account-msg" role="status" aria-live="polite"></div>'
                 + { profil: sectionProfil, securite: sectionSecurite, appareils: sectionAppareils, donnees: sectionDonnees }[section || 'profil']();
        }
        return view === 'recover' ? viewRecover() : view === 'newpw' ? viewNewPassword() : view === 'chooser' ? viewChooser() : viewAuth();
    }

    function open(v, section) {
        if (!overlay) return;
        view = v || (Auth.isSignedIn() ? 'account' : 'auth');
        if (view === 'auth') mode = 'signin';
        confirmDelete = false; editEmail = false;
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
            if (sub) sub.textContent = LEVEL_LABELS[appSettings.level] + (appSettings.elo ? ` · ${appSettings.elo} Elo` : '') + ((appSettings.pseudo || '').trim() ? ` · ${u.email || ''}` : '');
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
            appSettings[key] = value; saveSettings();
            updateButton(); render();
        }
    }

    // ─── Première synchronisation ─────────────────────────────────────────────
    function applyStrategy(strategy, backupFirst) {
        const u = Auth.user(); if (!u) return;
        if (backupFirst) { try { if (typeof exportDB === 'function') exportDB(); } catch (e) {} }   // sauvegarde locale, seulement si demandée
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
        if (type !== 'newpw' && !/^\S+@\S+\.\S+$/.test(email)) return msg('Adresse e-mail invalide.', 'err');
        if (type !== 'recover' && type !== 'link' && type !== 'email' && !pw) return msg('Saisissez un mot de passe.', 'err');
        if ((type === 'newpw' || (type === 'auth' && mode === 'signup')) && pw.length < 8) return msg('Mot de passe : 8 caractères minimum.', 'err');
        setBusy(true);
        let r;
        if (type === 'recover')      r = await Auth.recover(email);
        else if (type === 'link')    r = await Auth.signInWithLink(email);
        else if (type === 'email')   r = await Auth.updateEmail(email);
        else if (type === 'newpw')   r = await Auth.updatePassword(pw);
        else if (mode === 'signup')  r = await Auth.signUp(email, pw);
        else                         r = await Auth.signIn(email, pw);
        if (!overlay.contains(form)) return;                           // la vue a changé pendant l'appel (ex. connexion réussie)
        setBusy(false);
        if (!r.ok) return msg(r.message, 'err');
        if (type === 'recover') return msg("Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé.", 'ok');
        if (type === 'link')    return msg(`Lien envoyé à ${email} : ouvrez-le sur cet appareil pour vous connecter.`, 'ok');
        if (type === 'email')   { editEmail = false; render(); return msg(`Un lien de confirmation vient d'être envoyé à ${email}. L'adresse changera une fois le lien ouvert.`, 'ok'); }
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
        else if (act === 'export') { if (typeof exportDB === 'function') exportDB(); }
        else if (act === 'email-edit') { editEmail = true; render(); }
        else if (act === 'email-cancel') { editEmail = false; render(); }
        else if (act === 'delete-ask') { confirmDelete = true; render(); const i = overlay.querySelector('#account-delete-confirm'); if (i) i.focus(); }
        else if (act === 'delete-cancel') { confirmDelete = false; render(); }
        else if (act.startsWith('revoke:')) { revokeDevice(act.slice(7)); if (typeof SyncEngine !== 'undefined') SyncEngine.syncNow(); render(); msg('L’appareil sera déconnecté à sa prochaine synchronisation.', 'ok'); }
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
        else if (act === 'delete-account') onDeleteAccount();
        else if (act.startsWith('provider:')) {
            const r = Auth.signInWithProvider(act.slice(9));
            if (!r.ok) msg(r.message, 'err');
        }
        else if (act.startsWith('strategy:')) {
            const s = act.slice(9);
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
    }

    // ─── Installation ─────────────────────────────────────────────────────────
    function build() {
        panelApi = PanelKit.create({
            id: 'account-overlay', before: 'help-overlay',
            title: () => view === 'account' ? 'Compte' : TITLES[view] || 'Compte',
            sections: () => view === 'account' ? ACCOUNT_SECTIONS : [{ id: 'single', icon: 'user', label: TITLES[view] || 'Compte' }],
            render: renderContent,
            onControl,
            onClose: () => { confirmDelete = false; editEmail = false; }
        });
        overlay = panelApi.el;
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('submit', e => { e.preventDefault(); submit(e.target); });

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
        loadProviders();
        if (typeof Net !== 'undefined') Net.onChange(on => { if (on && !providersReady) loadProviders(); });
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
        updateButton();
        const t = overlay && overlay.querySelector('#account-sync-text');
        if (t) { t.textContent = syncStatus.text; t.dataset.level = syncStatus.level; }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    // Préférences reçues d'un autre appareil : avatar et fenêtre à jour.
    function refresh() { updateButton(); if (isOpen() && view === 'account') render(); }

    return { open, close, setSyncStatus, ensureIntent, refresh, notify: toast };
})();
