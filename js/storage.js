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
    askText({ title: 'Nouveau répertoire', placeholder: 'ex : Défense Sicilienne', ok: 'Créer',
              validate: n => loadRepertoireList().includes(n) ? 'Ce répertoire existe déjà.' : '' }, name => {
        const clean = addRepertoire(name);
        if (clean) selectRepertoire(clean);
    });
}

// Renomme un répertoire : ses bases (Blancs / Noirs), ses réponses adverses connues et les éléments
// de la corbeille qui s'y rattachent. « Général » est protégé (comme pour la suppression).
// Renvoie le nouveau nom, ou null si le renommage est impossible.
function renameRepertoire(oldName, newName) {
    const clean = slugifyRepertoire(newName || '');
    const list  = loadRepertoireList();
    if (!clean || clean === oldName || oldName === DEFAULT_REPERTOIRE || list.includes(clean) || !list.includes(oldName)) return null;
    for (const c of ['w', 'b']) {
        for (const [from, to] of [[dbKeyFor(oldName, c), dbKeyFor(clean, c)], [oppKeyFor(oldName, c), oppKeyFor(clean, c)]]) {
            const raw = dataStore.get(from);
            if (raw === null) continue;
            if (!dataStore.set(to, raw)) return null;            // stockage plein : on s'arrête avant toute suppression
        }
    }
    for (const c of ['w', 'b']) { dataStore.remove(dbKeyFor(oldName, c)); dataStore.remove(oppKeyFor(oldName, c)); }
    list[list.indexOf(oldName)] = clean;
    saveRepertoireList(list);
    const trash = loadTrash();
    if (trash.some(it => it.rep === oldName && it.type !== 'repertoire')) {
        trash.forEach(it => { if (it.rep === oldName && it.type !== 'repertoire') it.rep = clean; });
        saveTrash(trash);
    }
    if (currentRepertoire === oldName) currentRepertoire = clean;
    return clean;
}

function renameRepertoirePrompt(name) {
    if (name === DEFAULT_REPERTOIRE) { alert('Le répertoire par défaut ne peut pas être renommé.'); return; }
    askText({ title: 'Renommer le répertoire', value: name, ok: 'Renommer',
              validate: n => n === name ? 'Choisissez un nom différent.' : loadRepertoireList().includes(n) ? 'Ce nom est déjà utilisé.' : '' }, n => {
        const clean = renameRepertoire(name, n);
        if (clean) selectRepertoire(clean);
    });
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
    if (Number.isFinite(e.due) && e.due > 0) { out.due = e.due; out.interval = Number.isFinite(e.interval) ? Math.max(0, e.interval) : 0; }
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

// ─── RÉPÉTITION ESPACÉE ET JOURNAL D'ACTIVITÉ ─────────────────────────────────
// Chaque passage sur une position (Jouer ou Entraînement) appelle recordReview() APRÈS la mise à jour
// de ses compteurs. Planning (inspiré de SM-2) :
//   - réussite alors que la révision était due : intervalle × REVIEW_GROWTH (1 jour la première fois),
//     plafonné à REVIEW_MAX_DAYS ; une réussite anticipée ne change pas l'échéance ;
//   - erreur : intervalle remis à zéro, la position redevient due dans REVIEW_RETRY_MS.
// L'entraînement favorise les positions dues (cf. _trainingWeight) sans jamais exclure les autres.

const DAY_MS           = 86400000;
const REVIEW_GROWTH    = 2.5;
const REVIEW_MAX_DAYS  = 180;
const REVIEW_RETRY_MS  = 10 * 60000;
const ACTIVITY_KEY     = 'chessTrainer_activity';
const ACTIVITY_KEEP_DAYS = 400;

const isDue = (e, now = Date.now()) => !e.due || e.due <= now;

function recordReview(entry, ok) {
    const now = Date.now();
    entry.lastReviewed = now;
    if (!ok) {
        entry.interval = 0;
        entry.due = now + REVIEW_RETRY_MS;
    } else if (isDue(entry, now)) {
        entry.interval = entry.interval ? Math.min(REVIEW_MAX_DAYS, Math.round(entry.interval * REVIEW_GROWTH * 10) / 10) : 1;
        entry.due = now + entry.interval * DAY_MS;
    }
    logActivity(ok);
}

// Jour local au format AAAA-MM-JJ.
function dayStamp(t) {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readActivity() {
    const o = dataStore.getJSON(ACTIVITY_KEY, null);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
}

function logActivity(ok) {
    const now = Date.now(), act = readActivity(), day = dayStamp(now);
    const d = act[day] || { a: 0, f: 0 };
    d.a++;
    if (!ok) d.f++;
    act[day] = d;
    const oldest = dayStamp(now - ACTIVITY_KEEP_DAYS * DAY_MS);
    Object.keys(act).forEach(k => { if (k < oldest) delete act[k]; });
    dataStore.setJSON(ACTIVITY_KEY, act);
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
        opponents: {},         // réponses adverses connues (facultatif à l'import)
        progress: {            // progression des finales et journal d'activité (facultatifs à l'import)
            endgames: dataStore.getJSON('chessTrainer_endgames', {}),
            activity: readActivity()
        }
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
                        if (typeof rep === 'string' && rep.trim() && !currentList.includes(rep)) currentList.push(rep);
                    });
                    saveRepertoireList(currentList);
                }
                // Importer chaque base
                let count = 0;
                // Seules les clés de bases d'ouvertures sont acceptées (un fichier ne doit pas pouvoir
                // écrire d'autres clés, ex. la session de connexion).
                const isDbKey  = k => /^openingDB_.+_[wb]$/.test(k);
                const isOppKey = k => /^openingOpp_.+_[wb]$/.test(k);
                Object.entries(data.databases).forEach(([key, entries]) => {
                    if (!isDbKey(key) || !entries || typeof entries !== 'object') return;
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
                        if (!isOppKey(okey) || !map || typeof map !== 'object') return;
                        const cur = dataStore.getJSON(okey, null) || {};
                        Object.keys(map).forEach(pk => {
                            if (!Array.isArray(map[pk])) return;
                            cur[pk] = Array.from(new Set((cur[pk] || []).concat(map[pk])));
                        });
                        dataStore.setJSON(okey, cur);
                    });
                }
                // Progression : on garde, pour chaque jour / exercice, la valeur la plus avancée
                const prog = data.progress && typeof data.progress === 'object' ? data.progress : {};
                if (prog.activity && typeof prog.activity === 'object') {
                    const act = readActivity();
                    Object.entries(prog.activity).forEach(([day, d]) => {
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !d || !(Number(d.a) >= 0)) return;
                        const cur = act[day] || { a: 0, f: 0 };
                        if (Number(d.a) > cur.a) act[day] = { a: Number(d.a), f: Math.min(Number(d.a), Math.max(0, Number(d.f) || 0)) };
                    });
                    dataStore.setJSON(ACTIVITY_KEY, act);
                }
                if (prog.endgames && typeof prog.endgames === 'object') {
                    const eg = dataStore.getJSON('chessTrainer_endgames', {}) || {};
                    Object.entries(prog.endgames).forEach(([id, p]) => {
                        if (!p || typeof p !== 'object') return;
                        if (!eg[id] || (Number(p.tries) || 0) > (Number(eg[id].tries) || 0)) eg[id] = p;
                    });
                    dataStore.setJSON('chessTrainer_endgames', eg);
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
