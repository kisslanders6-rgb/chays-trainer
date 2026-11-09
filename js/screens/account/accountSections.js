/**
 * screens/account/accountSections.js
 * ──────────────────────────────────────────────────────────────────────────
 * Rubriques du compte connecté (Profil, Synchronisation, Sécurité) : le HTML seul. L'état reste dans AccountUI,
 * qui le prête par ctx.get() : { syncStatus, lastOk, studioTab, userInfo, editEmail, confirmDelete }.
 */

'use strict';

const AccountSections = ctx => {
    const { esc, icon, avatarHTML, AVATAR_NAMES, AVATAR_COLOR_NAMES, AVATAR_TINTS } = ctx;

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

    const avatarName = () => `${AVATAR_NAMES[appSettings.avatarGlyph] || 'Pièce'} · ${AVATAR_COLOR_NAMES[appSettings.avatarColor] || ''}`;

    // Carte « Velours » : avatar en grand, pseudo, e-mail, trois chiffres ; pastille d'état de la synchronisation.
    function _idCard() {
        const { syncStatus } = ctx.get();
        const u = Auth.user() || {}, f = _figures(), name = (appSettings.pseudo || '').trim();
        return `<div class="acct-id">
            <span class="acct-id-av">${avatarHTML('acct-id-avatar')}<i class="acct-id-dot" data-level="${esc(syncStatus.level)}" title="${esc(syncStatus.text)}"></i></span>
            <div class="acct-id-who"><b id="acct-name">${esc(name || u.email || '')}</b><small id="acct-sub">${esc(ctx.subLine(u, name))}</small>
                <div class="acct-id-figs"><div><b>${f.positions}</b>positions</div><div><b>${f.streak} j</b>d'affilée</div><div><b>${f.today}</b>aujourd'hui</div></div></div>
        </div>`;
    }

    // Grille des motifs (radio) : --cols posé par fitTiles (PanelKit.balancedCols).
    const glyphTiles = glyphs => `<div class="acct-tiles" role="radiogroup" aria-label="Motif">${glyphs.map(g =>
        `<button type="button" class="acct-tile" role="radio" aria-checked="${appSettings.avatarGlyph === g}" aria-label="${AVATAR_NAMES[g] || 'Pièce'}" title="${AVATAR_NAMES[g] || 'Pièce'}" data-pn="seg" data-key="avatarGlyph" data-v="${g}">${avatarHTML('acct-tile-avatar', g)}</button>`).join('')}</div>`;
    const swatchBg = c => c === 'theme' ? 'background:linear-gradient(135deg, var(--theme-dark-deep) 50%, var(--theme-light-refined) 50%)' : `background:${(AVATAR_TINTS[c] || AVATAR_TINTS.sapin)[0]}`;

    // Atelier d'avatar (AvatarStudio) : segments Motif / Photo.
    function _avatarStudio() {
        const { studioTab } = ctx.get();
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

    // Niveau réel, tiré des parties ; site et cadence sont ceux de Statistiques › Parties.
    function _eloRows() {
        const lv = typeof GameArchive !== 'undefined' ? GameArchive.level() : null;
        if (!lv) return [PanelKit.row('Classement Elo', 'Reliez un compte pour suivre votre Elo et vos résultats face à votre répertoire.', '')];
        const speedName = lv.speeds.find(([s]) => s === lv.speed)[1];
        const rows = [PanelKit.row('Classement Elo', `<span>${GameArchive.SITE_NAME[lv.site]}</span> · <span>${speedName}</span>`, `<b class="acct-elo">${lv.r}</b>`)];
        if (lv.sites.length > 1) rows.push(PanelKit.row('Site', '', PanelKit.seg('eloSite', lv.sites.map(s => [s, GameArchive.SITE_NAME[s]]), lv.site, 'Site')));
        if (lv.speeds.length > 1) rows.push(PanelKit.row('Cadence', '', PanelKit.seg('eloSpeed', lv.speeds, lv.speed, 'Cadence')));
        return rows;
    }

    function sectionProfil() {
        return _idCard() + _avatarStudio()
            + PanelKit.group('Identité', [
                PanelKit.row('Pseudo', 'Affiché sur l’accueil (« Bonsoir, … ») et dans la barre du haut.',
                    `<input class="pn-input" type="text" maxlength="24" autocomplete="nickname" placeholder="Votre pseudo" value="${esc(appSettings.pseudo)}" data-pn="text" data-key="pseudo" aria-label="Pseudo">`)])
            + PanelKit.group('Classement et objectif', [
                ..._eloRows(),
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
        const { syncStatus, lastOk } = ctx.get();
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
        const { userInfo, editEmail, confirmDelete } = ctx.get();
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

    return { sectionProfil, sectionSync, sectionSecurite, syncHero: _syncHero, glyphTiles };
};
