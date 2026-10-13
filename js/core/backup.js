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
 * Niveaux :
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

function getBackupStatus() {
    const s       = _readBackupState();              // storage.js : { changes, remindedAt, lastExport }
    const total   = _countPositions();
    const last    = s.lastExport || 0;
    const days    = last ? (Date.now() - last) / _BK_DAY_MS : Infinity;
    const changes = s.changes;
    const plural  = (n, one, many) => `${n} ${n > 1 ? many : one}`;

    let level, title, sub;
    if (!total || (!last && total < BACKUP_MIN_POSITIONS)) {
        level = 'empty';
        title = last ? `Dernière sauvegarde : ${_agoLabel(last)}` : 'Pas encore de sauvegarde';
        sub   = total ? 'Pensez à exporter dès que votre répertoire grandit.' : 'Rien à sauvegarder pour le moment.';
    } else if (!last) {
        level = 'danger';
        title = 'Jamais sauvegardé';
        sub   = `Vos ${plural(total, 'position', 'positions')} n'existent que dans ce navigateur. Un export les met à l'abri.`;
    } else if (!changes) {
        level = 'ok';
        title = `Sauvegardé ${_agoLabel(last)}`;
        sub   = 'Aucune modification depuis.';
    } else {
        level = days >= BACKUP_DANGER_DAYS ? 'danger'
              : (days >= BACKUP_STALE_DAYS || changes > BACKUP_THRESHOLD) ? 'warn' : 'ok';
        title = `Dernière sauvegarde : ${_agoLabel(last)}`;
        sub   = `${plural(changes, 'modification', 'modifications')} depuis, non sauvegardée${changes > 1 ? 's' : ''}.`;
    }
    return { level, title, sub, total, changes, last, days };
}

// ─── INDICATEURS (pastille sur ⚙) ─────────────────────────────────────────────

function updateBackupIndicators() {
    const st    = getBackupStatus();
    const alert = st.level === 'warn' || st.level === 'danger';
    document.querySelectorAll('[data-backup-dot]').forEach(el => {
        el.classList.toggle('has-alert', alert);
        el.dataset.level = st.level;
        el.title = alert ? 'Paramètres — sauvegarde recommandée' : 'Paramètres';
    });
}

// ─── CARTE DANS LES PARAMÈTRES ────────────────────────────────────────────────

function renderBackupStatus() {
    const box = document.getElementById('backup-status');
    if (!box) return;
    const st     = getBackupStatus();
    const urgent = st.level === 'warn' || st.level === 'danger';
    const icon   = st.level === 'ok' ? 'shield-check' : st.level === 'empty' ? 'info' : 'shield-alert';

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
            <button class="btn ${urgent ? 'btn-primary' : ''}" onclick="exportDB(); renderBackupStatus();">${ico('download')} Exporter maintenant</button>
            <button class="btn" onclick="importDBPrompt()">${ico('upload')} Importer</button>
          </div>
          <div class="backup-note">Les données vivent dans ce navigateur : vider le cache ou les données du site les efface, même si le stockage est protégé.</div>
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
        : `${ico('alert-triangle')} Stockage non protégé · <button class="toast-link" onclick="requestPersistence()">Protéger</button>`;
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
    if (st.level !== 'warn' && st.level !== 'danger') return;
    const last = Number(dataStore.get(BACKUP_NAG_KEY)) || 0;
    if (Date.now() - last < _BK_DAY_MS) return;
    dataStore.set(BACKUP_NAG_KEY, String(Date.now()));
    setTimeout(() => { if (typeof showBackupToast === 'function') showBackupToast(); }, 1500);
}

// ─── AUTO-BRANCHEMENT (aucune modification d'app.js ni de storage.js requise) ─
document.addEventListener('DOMContentLoaded', () => {
    // 1. La carte « Sauvegarde » se remplit à chaque ouverture des Paramètres.
    if (typeof showSettings === 'function' && !showSettings._bk) {
        const orig = showSettings;
        window.showSettings = function () { orig(); renderBackupStatus(); };
        window.showSettings._bk = true;
    }
    // 2. La pastille se met à jour après chaque modification ou export.
    ['noteChange', 'markExported'].forEach(name => {
        const orig = window[name];
        if (typeof orig !== 'function' || orig._bk) return;
        window[name] = function (...args) { const r = orig.apply(this, args); updateBackupIndicators(); return r; };
        window[name]._bk = true;
    });
    // 3. Rappel éventuel au lancement.
    checkBackupOnStart();
});
