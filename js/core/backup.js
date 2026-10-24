/**
 * core/backup.js
 * ──────────────────────────────────────────────────────────────────────────
 * Rend la sécurité des données VISIBLE. S'appuie sur l'état déjà tenu par
 * storage.js (_readBackupState : changes / lastExport) sans le modifier.
 *
 *   - getBackupStatus()          niveau (empty | ok | warn | danger) + textes
 *   - renderBackupStatus()       carte « Sauvegarde des données » (Paramètres)
 *   - updateBackupIndicators()   pastille sur le bouton ⚙ de la barre du haut
 *   - checkBackupOnStart()       rappel au lancement (au plus une fois par jour)
 *   - requestPersistence()       demande au navigateur de ne pas purger le stockage
 *
 * Avec un compte connecté (synchronisation active), les données sont aussi enregistrées en ligne :
 * la carte l'indique, et ni rappel ni pastille ne poussent à télécharger un fichier — la sauvegarde
 * locale (.json) reste proposée, jamais imposée.
 *
 * Niveaux :
 *   synced  compte connecté : copie en ligne
 *   empty   rien (ou presque) à protéger
 *   ok      sauvegarde récente, ou rien de modifié depuis
 *   warn    ≥ 7 jours ou > BACKUP_THRESHOLD modifications non sauvegardées
 *   danger  jamais sauvegardé (≥ 5 positions) ou ≥ 30 jours avec modifications
 */

'use strict';

const BACKUP_STALE_DAYS   = 7;
const BACKUP_DANGER_DAYS  = 30;
const BACKUP_MIN_POSITIONS = 5;        // en dessous, pas d'alerte « jamais sauvegardé »
const BACKUP_NAG_KEY      = 'chessTrainer_backupNag';
const _BK_DAY_MS          = 86400000;

// ─── CALCUL DE L'ÉTAT ─────────────────────────────────────────────────────────

function _countPositions() {
    let n = 0;
    loadRepertoireList().forEach(rep => ['w', 'b'].forEach(c => { n += Object.keys(readDBFor(rep, c)).length; }));
    return n;
}

// Poids approximatif des données de l'application dans le stockage (en Ko).
function _dataSizeKb() {
    let chars = 0;
    dataStore.keys().forEach(k => {
        if (/^(openingDB_|openingOpp_|chessTrainer_)/.test(k)) chars += k.length + (dataStore.get(k) || '').length;
    });
    return Math.max(1, Math.round(chars * 2 / 1024));
}

function _agoLabel(ts) {
    const d = Math.floor((Date.now() - ts) / _BK_DAY_MS);
    if (d <= 0)  return "aujourd'hui";
    if (d === 1) return 'hier';
    if (d < 14)  return `il y a ${d} jours`;
    if (d < 60)  return `il y a ${Math.floor(d / 7)} semaines`;
    return `il y a ${Math.floor(d / 30)} mois`;
}

// Compte connecté et service configuré : les données sont synchronisées en ligne.
function isCloudBackedUp() {
    return typeof Auth !== 'undefined' && Auth.isSignedIn() && typeof CloudClient !== 'undefined' && CloudClient.configured();
}

function getBackupStatus() {
    const s       = _readBackupState();              // storage.js : { changes, remindedAt, lastExport }
    const total   = _countPositions();
    const last    = s.lastExport || 0;
    const days    = last ? (Date.now() - last) / _BK_DAY_MS : Infinity;
    const changes = s.changes;
    const plural  = (n, one, many) => `${n} ${n > 1 ? many : one}`;
    const lastLocal = last ? `Dernière sauvegarde locale : ${_agoLabel(last)}` : 'Aucune sauvegarde locale';

    let level, title, sub;
    if (isCloudBackedUp()) {
        level = 'synced';
        title = 'Synchronisé avec votre compte';
        sub   = `Vos données sont enregistrées en ligne et sur cet appareil. Une sauvegarde locale (fichier .json) reste possible si vous le souhaitez. ${lastLocal}.`;
    } else if (!total || (!last && total < BACKUP_MIN_POSITIONS)) {
        level = 'empty';
        title = lastLocal;
        sub   = total ? 'Pensez à télécharger une sauvegarde, ou à créer un compte, dès que votre répertoire grandit.' : 'Rien à sauvegarder pour le moment.';
    } else if (!last) {
        level = 'danger';
        title = 'Aucune sauvegarde';
        sub   = `Vos ${plural(total, 'position', 'positions')} n'existent que dans ce navigateur, sur cet appareil. Téléchargez une sauvegarde ou connectez-vous pour les synchroniser.`;
    } else if (!changes) {
        level = 'ok';
        title = `Sauvegarde locale à jour (${_agoLabel(last)})`;
        sub   = 'Aucune modification depuis.';
    } else {
        level = days >= BACKUP_DANGER_DAYS ? 'danger'
              : (days >= BACKUP_STALE_DAYS || changes > BACKUP_THRESHOLD) ? 'warn' : 'ok';
        title = lastLocal;
        sub   = `${plural(changes, 'modification', 'modifications')} depuis, non sauvegardée${changes > 1 ? 's' : ''} hors de ce navigateur.`;
    }
    return { level, title, sub, total, changes, last, days };
}

// ─── INDICATEURS (pastille sur ⚙) ─────────────────────────────────────────────

// Rappel de sauvegarde (Paramètres › Données) : jamais, chaque semaine (seuils par défaut) ou chaque mois
// (seulement passé 30 jours, ou sans aucune sauvegarde). Jamais quand le compte synchronise.
function backupReminderDue(st) {
    const r = typeof appSettings !== 'undefined' ? appSettings.backupReminder : 'weekly';
    if (r === 'never' || (st.level !== 'warn' && st.level !== 'danger')) return false;
    return r !== 'monthly' || !st.last || st.days >= BACKUP_DANGER_DAYS;
}

function updateBackupIndicators() {
    const st    = getBackupStatus();
    const alert = backupReminderDue(st);
    document.querySelectorAll('[data-backup-dot]').forEach(el => {
        el.classList.toggle('has-alert', alert);
        el.dataset.level = st.level;
        el.title = alert ? 'Paramètres — sauvegarde recommandée' : 'Paramètres';
        el.setAttribute('aria-label', el.title);
    });
}

// ─── CARTE DANS LES PARAMÈTRES ────────────────────────────────────────────────

function renderBackupStatus() {
    const box = document.getElementById('backup-status');
    if (!box) return;
    const st     = getBackupStatus();
    const urgent = st.level === 'warn' || st.level === 'danger';
    const icon   = st.level === 'ok' || st.level === 'synced' ? 'shield-check' : st.level === 'empty' ? 'info' : 'shield-alert';
    const note   = st.level === 'synced'
        ? 'Cet appareil garde une copie pour fonctionner hors ligne ; les modifications sont envoyées dès que la connexion revient.'
        : 'Sans compte, les données ne vivent que dans ce navigateur : vider le cache ou les données du site les efface, même si le stockage est protégé.';

    box.innerHTML = `
        <div class="backup-card lv-${st.level}">
          <div class="backup-head">
            <span class="backup-ico">${ico(icon)}</span>
            <div>
              <div class="backup-title">${st.title}</div>
              <div class="backup-sub">${st.sub}</div>
            </div>
          </div>
          <div class="backup-meta">
            <span>${ico('database')} ${st.total} position${st.total > 1 ? 's' : ''} · ${_dataSizeKb()} Ko</span>
            <span id="backup-persist"></span>
          </div>
          <div class="backup-actions">
            <button class="btn ${urgent ? 'btn-primary' : ''}" data-action="backupExport" title="Fichier .json : répertoires, statistiques, planning de révision, finales">${ico('download')} Télécharger une sauvegarde</button>
            <button class="btn" data-action="importDBPrompt" title="Fusionne un fichier .json avec vos données">${ico('upload')} Restaurer une sauvegarde</button>
          </div>
          <div class="backup-note">${note} Pour échanger des lignes avec d'autres logiciels, utilisez l'export PGN du panneau Données.</div>
        </div>`;
    _fillPersistence();
}

// ─── STOCKAGE PERSISTANT ──────────────────────────────────────────────────────

async function _fillPersistence() {
    const el = document.getElementById('backup-persist');
    if (!el || !navigator.storage || !navigator.storage.persisted) return;
    let ok = false;
    try { ok = await navigator.storage.persisted(); } catch (e) { return; }
    el.innerHTML = ok
        ? `${ico('check')} Stockage protégé par le navigateur`
        : `${ico('alert-triangle')} Stockage non protégé · <button class="toast-link" data-action="requestPersistence">Protéger</button>`;
}

async function requestPersistence() {
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
    renderBackupStatus();
}

// ─── RAPPEL AU LANCEMENT ──────────────────────────────────────────────────────
// Un rappel au plus toutes les 24 h, et seulement si l'état est « warn » ou « danger ».

function checkBackupOnStart() {
    updateBackupIndicators();
    const st = getBackupStatus();
    if (!backupReminderDue(st)) return;
    const last = Number(dataStore.get(BACKUP_NAG_KEY)) || 0;
    if (Date.now() - last < _BK_DAY_MS) return;
    dataStore.set(BACKUP_NAG_KEY, String(Date.now()));
    setTimeout(() => { if (typeof showBackupToast === 'function' && !isCloudBackedUp()) showBackupToast(); }, 1500);   // session restaurée entre-temps
}

// ─── AUTO-BRANCHEMENT (aucune modification d'app.js ni de storage.js requise) ─
document.addEventListener('DOMContentLoaded', () => {
    // 1. La pastille se met à jour après chaque modification ou export.
    ['noteChange', 'markExported'].forEach(name => {
        const orig = window[name];
        if (typeof orig !== 'function' || orig._bk) return;
        window[name] = function (...args) { const r = orig.apply(this, args); updateBackupIndicators(); return r; };
        window[name]._bk = true;
    });
    // 2. Rappel éventuel au lancement.
    checkBackupOnStart();
    // 3. Connexion / déconnexion : la carte et la pastille changent de discours.
    if (typeof Auth !== 'undefined' && Auth.onChange) Auth.onChange(() => {
        updateBackupIndicators();
        if (document.getElementById('backup-status')) renderBackupStatus();
        if (isCloudBackedUp() && typeof hideBackupToast === 'function') hideBackupToast();
    });
});

registerActions({
    backupExport: () => { exportDB(); renderBackupStatus(); },
    importDBPrompt: () => importDBPrompt(),
    requestPersistence: () => requestPersistence()
});
