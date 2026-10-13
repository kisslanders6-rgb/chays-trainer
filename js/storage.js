/**
 * storage.js
 * ──────────────────────────────────────────────────────────────────────────
 * Couche de persistance : répertoires, bases d'ouvertures, import/export JSON.
 * Tous les accès au stockage passent par `dataStore` (js/core/storageAdapter.js).
 * Toutes les fonctions sont globales pour être accessibles depuis les autres modules.
 */

'use strict';

// ─── CLÉS DE STOCKAGE ─────────────────────────────────────────────────────────

const THEME_STORAGE_KEY     = 'chessTrainer_theme';
const REPERTOIRE_LIST_KEY   = 'chessTrainer_repertoires';
const DEFAULT_REPERTOIRE    = 'Général';

// ─── ÉTAT GLOBAL RÉPERTOIRES ──────────────────────────────────────────────────

let currentRepertoire = DEFAULT_REPERTOIRE;
let openingDB = {};

// ─── RÉPERTOIRES ──────────────────────────────────────────────────────────────

function slugifyRepertoire(name) {
    return name.trim();
}

function loadRepertoireList() {
    let list = dataStore.getJSON(REPERTOIRE_LIST_KEY, []);
    if (!Array.isArray(list) || !list.length) list = [DEFAULT_REPERTOIRE];
    if (!list.includes(DEFAULT_REPERTOIRE)) list.unshift(DEFAULT_REPERTOIRE);
    return list;
}

function saveRepertoireList(list) {
    dataStore.setJSON(REPERTOIRE_LIST_KEY, list);
}

function addRepertoire(name) {
    const clean = slugifyRepertoire(name);
    if (!clean) return null;
    const list = loadRepertoireList();
    if (!list.includes(clean)) {
        list.push(clean);
        saveRepertoireList(list);
    }
    return clean;
}

function createRepertoirePrompt() {
    const name = prompt('Nom du nouveau répertoire (ex : "Défense Sicilienne", "Ruy Lopez") :');
    if (!name || !name.trim()) return;
    const clean = addRepertoire(name);
    if (clean) selectRepertoire(clean);
}

// ─── BASE DE DONNÉES (ouvertures) ─────────────────────────────────────────────

// Modèle d'une entrée (une seule réponse par position de MON camp) :
//   openingDB[cléPosition] = { move, san, attempts, failures, path?, ply?, lastReviewed? }
//   - path : coups UCI depuis la position initiale, mon coup inclus (sert aux stats
//            et à la cinématique de l'entraînement) ; ply = path.length.
// Les coups adverses ne sont jamais stockés : ils sont implicites dans les clés.

function dbKeyFor(rep, color) {
    return `openingDB_${rep}_${color}`;
}

function getDBKey() {
    return dbKeyFor(currentRepertoire, playerColor);
}

function normalizeEntry(e) {
    if (!e || typeof e.move !== 'string') return null;
    const attempts = Number.isFinite(e.attempts) ? Math.max(0, e.attempts) : 0;
    const failures = Number.isFinite(e.failures) ? Math.min(Math.max(0, e.failures), attempts) : 0;
    const out = { move: e.move, san: e.san || e.move, attempts, failures };
    if (Array.isArray(e.path) && e.path.length) { out.path = e.path.slice(); out.ply = e.path.length; }
    // lastReviewed : timestamp (ms) du dernier passage. Absent sur les anciennes entrées
    // → traité comme « non revu depuis longtemps » par l'entraînement.
    const lr = typeof e.lastReviewed === 'string' ? Date.parse(e.lastReviewed) : e.lastReviewed;
    if (Number.isFinite(lr) && lr > 0) out.lastReviewed = lr;
    return out;   // l'ancien champ `alt` est volontairement abandonné
}

function normalizeDB(db) {
    const out = {};
    if (!db || typeof db !== 'object') return out;
    Object.keys(db).forEach(k => { const n = normalizeEntry(db[k]); if (n) out[k] = n; });
    return out;
}

// Lecture d'une base sans toucher à l'état global (utilisée par Stats / Entraînement).
function readDBFor(rep, color) {
    const raw = dataStore.get(dbKeyFor(rep, color));
    if (!raw) return {};
    try { return normalizeDB(JSON.parse(raw)); } catch (e) { return {}; }
}

// ─── RÉPONSES ADVERSES CONNUES (pour détecter les lignes « non couvertes ») ───
// oppSeen[clé de position avec l'ADVERSAIRE au trait] = [coups UCI joués ou importés].
// Stockage séparé de la base : n'affecte ni les stats, ni l'unicité des coups de mon camp.

let oppSeen = {};

function oppKeyFor(rep, color) { return `openingOpp_${rep}_${color}`; }

function readOppFor(rep, color) {
    const out = {};
    const o = dataStore.getJSON(oppKeyFor(rep, color), null);
    if (o && typeof o === 'object') {
        Object.keys(o).forEach(k => { if (Array.isArray(o[k])) out[k] = o[k].filter(u => typeof u === 'string'); });
    }
    return out;
}

function saveOpp() {
    dataStore.setJSON(oppKeyFor(currentRepertoire, playerColor), oppSeen);
}

function recordOppReply(posKey, uci) {                 // renvoie true si nouveau (l'appelant appelle saveOpp)
    const list = oppSeen[posKey] || (oppSeen[posKey] = []);
    if (list.includes(uci)) return false;
    list.push(uci);
    return true;
}

function forgetOppReply(posKey, uci) {
    const list = oppSeen[posKey];
    const i = list ? list.indexOf(uci) : -1;
    if (i < 0) return false;
    list.splice(i, 1);
    if (!list.length) delete oppSeen[posKey];
    return true;
}

// ─── RAPPEL DE SAUVEGARDE ─────────────────────────────────────────────────────
// Compte les ajouts / modifications / suppressions de coups depuis le dernier export JSON.
// Au-delà de BACKUP_THRESHOLD, un rappel (toast) est affiché, puis tous les BACKUP_THRESHOLD changements.

const BACKUP_STATE_KEY = 'chessTrainer_backupState';
const BACKUP_THRESHOLD = 15;

function _readBackupState() {
    const s = dataStore.getJSON(BACKUP_STATE_KEY, null) || {};
    return { changes: Number(s.changes) || 0, remindedAt: Number(s.remindedAt) || 0, lastExport: Number(s.lastExport) || 0 };
}

function _writeBackupState(s) {
    dataStore.setJSON(BACKUP_STATE_KEY, s);
}

function noteChange(n) {
    if (!(n > 0)) return;
    const s = _readBackupState();
    s.changes += n;
    const remind = s.changes > BACKUP_THRESHOLD && (s.changes - s.remindedAt) > BACKUP_THRESHOLD;
    if (remind) s.remindedAt = s.changes;
    _writeBackupState(s);
    if (remind && typeof showBackupToast === 'function') showBackupToast();
}

function markExported() {
    _writeBackupState({ changes: 0, remindedAt: 0, lastExport: Date.now() });
    if (typeof hideBackupToast === 'function') hideBackupToast();
}

const _legacyChecked = new Set();

function loadDB() {
    const key = getDBKey();
    const raw = dataStore.get(key);
    openingDB = readDBFor(currentRepertoire, playerColor);
    oppSeen   = readOppFor(currentRepertoire, playerColor);
    // Reconstruit (une fois par session) le chemin des anciennes entrées sans `path`.
    if (!_legacyChecked.has(key)) { _legacyChecked.add(key); migrateLegacyPaths(); }
    if (raw !== null && raw !== JSON.stringify(openingDB)) saveDB();
}

function saveDB() {
    dataStore.set(getDBKey(), JSON.stringify(openingDB));
}

// ─── EXPORT / IMPORT JSON ─────────────────────────────────────────────────────

function exportDB() {
    // Exporte TOUS les répertoires de TOUTES les couleurs dans un seul fichier.
    const list = loadRepertoireList();
    const colors = ['w', 'b'];
    const exportData = {
        version: 1,
        exportDate: new Date().toISOString(),
        repertoires: list,
        databases: {},
        opponents: {}          // réponses adverses connues (facultatif à l'import)
    };
    list.forEach(rep => {
        colors.forEach(col => {
            const key = dbKeyFor(rep, col);
            const raw = dataStore.get(key);
            if (raw) {
                try { exportData.databases[key] = JSON.parse(raw); } catch (e) {}
            }
            const okey = oppKeyFor(rep, col);
            const oraw = dataStore.get(okey);
            if (oraw) {
                try { exportData.opponents[okey] = JSON.parse(oraw); } catch (e) {}
            }
        });
    });

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `ChaysTrainer_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    markExported();
}

function importDBPrompt() {
    document.getElementById('import-file-input').value = '';
    document.getElementById('import-file-input').click();
}

function importDBFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        let data;
        try { data = JSON.parse(e.target.result); } catch (err) {
            alert('Fichier JSON invalide. Veuillez sélectionner un fichier exporté par Chays Trainer.');
            return;
        }
        if (!data || data.version !== 1 || typeof data.databases !== 'object') {
            alert('Format de fichier non reconnu. Assurez-vous que le fichier a été créé par la fonction "Exporter" de Chays Trainer.');
            return;
        }
        askConfirm(
            `Importer "${file.name}" ? Les répertoires importés s'ajouteront aux vôtres (les entrées existantes seront fusionnées, les nouvelles ajoutées). Cette opération est irréversible sans sauvegarde préalable.`,
            () => {
                // Fusionner les répertoires
                const currentList = loadRepertoireList();
                if (Array.isArray(data.repertoires)) {
                    data.repertoires.forEach(rep => {
                        if (!currentList.includes(rep)) currentList.push(rep);
                    });
                    saveRepertoireList(currentList);
                }
                // Importer chaque base
                let count = 0;
                Object.entries(data.databases).forEach(([key, entries]) => {
                    if (typeof entries !== 'object') return;
                    let existing = {};
                    try {
                        const raw = dataStore.get(key);
                        if (raw) existing = JSON.parse(raw);
                    } catch (err) {}
                    const merged = Object.assign({}, normalizeDB(existing), normalizeDB(entries));
                    if (dataStore.set(key, JSON.stringify(merged))) count += Object.keys(entries).length;
                });
                // Réponses adverses connues : union avec l'existant
                if (data.opponents && typeof data.opponents === 'object') {
                    Object.entries(data.opponents).forEach(([okey, map]) => {
                        if (!map || typeof map !== 'object') return;
                        const cur = dataStore.getJSON(okey, null) || {};
                        Object.keys(map).forEach(pk => {
                            if (!Array.isArray(map[pk])) return;
                            cur[pk] = Array.from(new Set((cur[pk] || []).concat(map[pk])));
                        });
                        dataStore.setJSON(okey, cur);
                    });
                }
                // Recharger la base active et l'UI
                loadDB();
                renderRepertoireList();
                renderAdminEntries();
                alert(`✓ Import réussi : ${count} entrée(s) importée(s) ou mise(s) à jour.`);
            }
        );
    };
    reader.readAsText(file);
}
