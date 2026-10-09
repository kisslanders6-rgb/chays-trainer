/**
 * core/trash.js
 * ──────────────────────────────────────────────────────────────────────────
 * Corbeille temporaire (30 jours) : rien n'est détruit à la première suppression.
 *   - répertoire entier   → type 'repertoire'  (bases Blancs/Noirs + réponses adverses connues)
 *   - coup isolé          → type 'move'
 *   - branche / variante  → type 'branch'      (coup + coups en aval supprimés avec lui)
 * Stockage : localStorage « chessTrainer_trash » = [{ id, type, deletedAt, rep, color?, label, count, data }].
 * Purge automatique des éléments de plus de 30 jours au chargement de l'application.
 */

'use strict';

const TRASH_KEY    = 'chessTrainer_trash';
const TRASH_TTL_MS = 30 * 24 * 3600 * 1000;

// ─── STOCKAGE ─────────────────────────────────────────────────────────────────

function loadTrash() {
    try {
        const a = JSON.parse(localStorage.getItem(TRASH_KEY));
        return Array.isArray(a) ? a.filter(it => it && it.id && it.deletedAt) : [];
    } catch (e) { return []; }
}

function saveTrash(list) {
    try { localStorage.setItem(TRASH_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
}

function purgeExpiredTrash() {
    const now  = Date.now();
    const list = loadTrash();
    const kept = list.filter(it => now - it.deletedAt <= TRASH_TTL_MS);
    if (kept.length !== list.length) saveTrash(kept);
    return list.length - kept.length;
}

// Place un élément dans la corbeille. false = échec (stockage plein) : l'appelant NE doit PAS supprimer.
function moveToTrash(item) {
    item.id        = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    item.deletedAt = Date.now();
    const list = loadTrash();
    list.unshift(item);
    if (!saveTrash(list)) {
        alert("Corbeille indisponible (stockage plein) : suppression annulée, rien n'a été effacé.");
        return false;
    }
    updateTrashBadges();
    return true;
}

// ─── SUPPRESSIONS ─────────────────────────────────────────────────────────────

// Coup(s) de la base active : keys[0] = coup supprimé, les suivants = branches orphelines emportées avec lui.
function trashEntries(keys, note) {
    const entries = {};
    keys.forEach(k => { if (openingDB[k]) entries[k] = JSON.parse(JSON.stringify(openingDB[k])); });
    const n = Object.keys(entries).length;
    if (!n) return true;
    const root = entries[keys[0]] || entries[Object.keys(entries)[0]];
    let line = root.san;
    if (root.path) { try { line = formatLinePrefix(_pathToSans(root.path)); } catch (e) {} }
    return moveToTrash({
        type: n > 1 ? 'branch' : 'move', rep: currentRepertoire, color: playerColor,
        label: line + (note ? ` (${note})` : ''), count: n, data: { entries }
    });
}

// Répertoire entier (jamais « Général »). true = déplacé dans la corbeille.
function deleteRepertoire(name) {
    if (name === DEFAULT_REPERTOIRE) return false;
    const list = loadRepertoireList();
    const idx  = list.indexOf(name);
    if (idx < 0) return false;

    const data = { index: idx, dbs: {}, opp: {} };
    let count = 0;
    ['w', 'b'].forEach(c => {
        try {
            data.dbs[c] = localStorage.getItem(dbKeyFor(name, c));
            data.opp[c] = localStorage.getItem(oppKeyFor(name, c));
        } catch (e) { data.dbs[c] = data.opp[c] = null; }
        count += Object.keys(readDBFor(name, c)).length;
    });
    if (!moveToTrash({ type: 'repertoire', rep: name, label: name, count, data })) return false;

    ['w', 'b'].forEach(c => {
        try { localStorage.removeItem(dbKeyFor(name, c)); localStorage.removeItem(oppKeyFor(name, c)); } catch (e) {}
    });
    list.splice(idx, 1);
    saveRepertoireList(list);
    noteChange(Math.max(1, count));
    return true;
}

// ─── RESTAURATION ─────────────────────────────────────────────────────────────

function restoreTrashItem(id) {
    const list = loadTrash();
    const item = list.find(it => it.id === id);
    if (!item) return { ok: false, message: 'Élément introuvable.' };

    try {
        if (item.type === 'repertoire') {
            const reps = loadRepertoireList();
            let name = item.rep;
            if (reps.includes(name)) {                                    // nom repris entre-temps : on ne fusionne pas
                let n = 2;
                name = `${item.rep} (restauré)`;
                while (reps.includes(name)) name = `${item.rep} (restauré ${n++})`;
            }
            ['w', 'b'].forEach(c => {
                if (item.data.dbs[c]  != null) localStorage.setItem(dbKeyFor(name, c),  item.data.dbs[c]);
                if (item.data.opp[c]  != null) localStorage.setItem(oppKeyFor(name, c), item.data.opp[c]);
            });
            reps.splice(Math.min(item.data.index, reps.length), 0, name);
            saveRepertoireList(reps);
            saveTrash(list.filter(it => it.id !== id));
            return { ok: true, type: 'repertoire', rep: name,
                     message: `✓ Répertoire « ${name} » restauré${name !== item.rep ? ' (le nom d\'origine était déjà pris)' : ''}.` };
        }

        // coup / branche : on remet chaque coup à sa place (même position) dans sa base d'origine
        const reps = loadRepertoireList();
        if (!reps.includes(item.rep)) { reps.push(item.rep); saveRepertoireList(reps); }   // répertoire supprimé depuis
        const db = readDBFor(item.rep, item.color);
        const conflicts = {};
        let restored = 0;
        Object.keys(item.data.entries).forEach(k => {
            if (db[k]) conflicts[k] = item.data.entries[k];                // position déjà occupée : on n'écrase jamais
            else { db[k] = item.data.entries[k]; restored++; }
        });
        localStorage.setItem(dbKeyFor(item.rep, item.color), JSON.stringify(db));
        noteChange(restored);

        const rest = Object.keys(conflicts).length;
        if (rest) {
            item.data.entries = conflicts;                                 // le reste demeure dans la corbeille
            item.count = rest;
            item.type  = rest > 1 ? 'branch' : 'move';
            saveTrash(list);
        } else {
            saveTrash(list.filter(it => it.id !== id));
        }
        return { ok: true, type: item.type, rep: item.rep, color: item.color,
                 message: rest ? `✓ ${restored} coup(s) restauré(s). ${rest} coup(s) conservé(s) dans la corbeille : leur position a reçu un autre coup depuis.`
                               : `✓ ${restored} coup(s) restauré(s) dans « ${item.rep} » (${item.color === 'w' ? 'Blancs' : 'Noirs'}).` };
    } catch (e) {
        return { ok: false, message: 'Restauration impossible (stockage indisponible).' };
    }
}

// ─── INTERFACE ────────────────────────────────────────────────────────────────

function updateTrashBadges() {
    const n = loadTrash().length;
    document.querySelectorAll('[data-trash-count]').forEach(el => { el.textContent = n ? `(${n})` : ''; });
    document.querySelectorAll('[data-trash-dot]').forEach(el => el.classList.toggle('has-items', n > 0));
}

function _trashMsg(text, kind) {
    document.getElementById('trash-msg').innerHTML = text ? `<div class="pgn-note ${kind}">${_esc(text)}</div>` : '';
}

function showTrash() {
    purgeExpiredTrash();
    _trashMsg('', '');
    renderTrash();
    document.getElementById('trash-overlay').classList.remove('hidden');
}

function closeTrash() {
    document.getElementById('trash-overlay').classList.add('hidden');
}

function renderTrash() {
    const list = loadTrash();
    const box  = document.getElementById('trash-list');
    const fmt  = ts => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    document.getElementById('trash-empty-btn').style.display = list.length ? '' : 'none';

    if (!list.length) {
        box.innerHTML = '<div class="tree-empty">La corbeille est vide.</div>';
        updateTrashBadges();
        return;
    }
    box.innerHTML = list.map(it => {
        const days = Math.max(0, Math.ceil((it.deletedAt + TRASH_TTL_MS - Date.now()) / 86400000));
        const side = it.color ? (it.color === 'w' ? 'Blancs' : 'Noirs') : '';
        const kind = it.type === 'repertoire' ? `📁 Répertoire · ${it.count} coup${it.count > 1 ? 's' : ''}`
                   : it.type === 'branch'     ? `🌿 Branche · ${it.count} coups`
                                              : '♟ Coup';
        const where = it.type === 'repertoire' ? '' : ` · ${_esc(it.rep)} (${side})`;
        return `<div class="trash-item">
            <div class="trash-info">
                <div class="trash-title">${_esc(it.label)}</div>
                <div class="trash-meta">${kind}${where}<br>Supprimé le ${fmt(it.deletedAt)} · purge dans ${days} j</div>
            </div>
            <div class="trash-actions">
                <button class="btn" onclick="onTrashRestore('${it.id}')">Restaurer</button>
                <button class="btn btn-danger" onclick="onTrashDelete('${it.id}')">Supprimer définitivement</button>
            </div>
        </div>`;
    }).join('');
    updateTrashBadges();
}

function onTrashRestore(id) {
    const r = restoreTrashItem(id);
    _trashMsg(r.message, r.ok ? 'ok' : 'err');
    if (r.ok) {
        if (r.type === 'repertoire') {
            renderRepertoireList(); initStats(); initTraining();
        } else {
            if (r.rep === currentRepertoire && r.color === playerColor && document.getElementById('game-screen').style.display !== 'none') loadDB();
            if (!document.getElementById('admin-overlay').classList.contains('hidden')) renderAdminEntries();
            if (typeof refreshTree === 'function') refreshTree();
            initStats(); initTraining();
        }
    }
    renderTrash();
}

function onTrashDelete(id) {
    askConfirm('Supprimer définitivement cet élément ? Cette action est irréversible.', () => {
        saveTrash(loadTrash().filter(it => it.id !== id));
        _trashMsg('', '');
        renderTrash();
    });
}

function emptyTrash() {
    const n = loadTrash().length;
    if (!n) return;
    askConfirm(`Vider la corbeille ? ${n} élément${n > 1 ? 's seront supprimés' : ' sera supprimé'} définitivement.`, () => {
        saveTrash([]);
        _trashMsg('', '');
        renderTrash();
    });
}
