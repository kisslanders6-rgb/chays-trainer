/**
 * storage.js
 * ──────────────────────────────────────────────────────────────────────────
 * Couche de persistance : localStorage, répertoires, import/export JSON.
 * Toutes les fonctions sont globales pour être accessibles depuis les autres modules.
 */

'use strict';

// ─── CLÉS LOCALSTORAGE ────────────────────────────────────────────────────────

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
    let list = [];
    try {
        const raw = localStorage.getItem(REPERTOIRE_LIST_KEY);
        list = raw ? JSON.parse(raw) : [];
    } catch (e) { list = []; }
    if (!Array.isArray(list) || !list.length) list = [DEFAULT_REPERTOIRE];
    if (!list.includes(DEFAULT_REPERTOIRE)) list.unshift(DEFAULT_REPERTOIRE);
    return list;
}

function saveRepertoireList(list) {
    try { localStorage.setItem(REPERTOIRE_LIST_KEY, JSON.stringify(list)); } catch (e) {}
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
    try {
        const raw = localStorage.getItem(dbKeyFor(rep, color));
        return raw ? normalizeDB(JSON.parse(raw)) : {};
    } catch (e) { return {}; }
}

const _legacyChecked = new Set();

function loadDB() {
    const key = getDBKey();
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (e) {}
    openingDB = readDBFor(currentRepertoire, playerColor);
    // Reconstruit (une fois par session) le chemin des anciennes entrées sans `path`.
    if (!_legacyChecked.has(key)) { _legacyChecked.add(key); migrateLegacyPaths(); }
    if (raw !== null && raw !== JSON.stringify(openingDB)) saveDB();
}

function saveDB() {
    try { localStorage.setItem(getDBKey(), JSON.stringify(openingDB)); } catch (e) {}
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
        databases: {}
    };
    list.forEach(rep => {
        colors.forEach(col => {
            const key = dbKeyFor(rep, col);
            let raw = null;
            try { raw = localStorage.getItem(key); } catch (e) {}
            if (raw) {
                try { exportData.databases[key] = JSON.parse(raw); } catch (e) {}
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
                        const raw = localStorage.getItem(key);
                        if (raw) existing = JSON.parse(raw);
                    } catch (err) {}
                    const merged = Object.assign({}, normalizeDB(existing), normalizeDB(entries));
                    try {
                        localStorage.setItem(key, JSON.stringify(merged));
                        count += Object.keys(entries).length;
                    } catch (err) {}
                });
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
