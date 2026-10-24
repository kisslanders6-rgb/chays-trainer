/**
 * core/cloudAdapter.js
 * ──────────────────────────────────────────────────────────────────────────
 * Suivi local des changements à synchroniser. Aucun réseau ici.
 *
 *   SyncMeta               état de synchro de CET appareil (local, jamais synchronisé) :
 *                            owner     compte auquel appartiennent ces données
 *                            versions  dernière version serveur connue, par clé
 *                            dirty     clés modifiées depuis la dernière synchro (avec un tampon)
 *                            base      copie de la dernière version synchronisée de chaque clé
 *   createSyncingAdapter   enveloppe un adaptateur de stockage : toute écriture d'une clé
 *                          synchronisable la marque « dirty » (valeur inchangée = ignorée).
 *   installSyncingAdapter  à appeler quand un compte est connecté.
 *   uninstallSyncingAdapter retour au stockage local pur (comportement d'origine).
 *
 * Règle pour le moteur de synchro (syncEngine.js) : les données reçues du serveur s'écrivent via
 * LocalStorageAdapter (qui ne marque rien), puis SyncMeta.setBase / setVersion.
 * Prérequis : storageAdapter.js (LocalStorageAdapter, dataStore) et syncModel.js (SyncModel).
 */

'use strict';

const SyncMeta = (function () {
    const META_KEY    = 'chessTrainer_syncMeta';
    const BASE_PREFIX = 'chessTrainer_syncBase_';
    const listeners   = [];
    const L = () => LocalStorageAdapter;

    function read() {
        let m = null;
        try { m = JSON.parse(L().get(META_KEY)); } catch (e) { /* illisible : état vierge, tout sera resynchronisé */ }
        m = (m && typeof m === 'object') ? m : {};
        const obj = o => (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
        return { owner: typeof m.owner === 'string' ? m.owner : null,
                 seq: Number.isFinite(m.seq) ? m.seq : 0, versions: obj(m.versions), dirty: obj(m.dirty) };
    }
    const write = m => L().set(META_KEY, JSON.stringify(m));
    const wipeBases = () => L().keys().filter(k => k.startsWith(BASE_PREFIX)).forEach(k => L().remove(k));

    function markDirty(key) {
        const m = read();
        m.dirty[key] = ++m.seq;
        write(m);
        listeners.forEach(fn => { try { fn(key); } catch (e) { reportError('synchro : écouteur ' + key, e); } });
    }

    // Première activation de la synchro : tout ce qui est synchronisable doit partir.
    function markAllDirty() {
        const m = read();
        L().keys().forEach(k => { if (SyncModel.isSynced(k)) m.dirty[k] = ++m.seq; });
        write(m);
    }

    const dirtySnapshot = () => Object.assign({}, read().dirty);

    // N'efface le marquage que si la clé n'a pas été modifiée depuis le tampon observé.
    function clearDirty(key, stamp) {
        const m = read();
        if (m.dirty[key] !== stamp) return false;
        delete m.dirty[key];
        write(m);
        return true;
    }

    const version = key => { const v = read().versions[key]; return Number.isFinite(v) ? v : null; };
    function setVersion(key, n) {
        const m = read();
        if (n === null || n === undefined) delete m.versions[key]; else m.versions[key] = n;
        write(m);
    }

    const base = key => L().get(BASE_PREFIX + key);
    // Renvoie false si l'écriture échoue (stockage plein) : le moteur doit alors s'arrêter.
    function setBase(key, raw) {
        if (raw === null || raw === undefined) return L().remove(BASE_PREFIX + key);
        return L().set(BASE_PREFIX + key, String(raw));
    }
    const baseKeys = () => L().keys().filter(k => k.startsWith(BASE_PREFIX)).map(k => k.slice(BASE_PREFIX.length));

    const owner = () => read().owner;
    // Rattache l'état au compte. Renvoie true si un AUTRE compte était rattaché (état remis à zéro).
    function bindOwner(id) {
        const m = read();
        if (m.owner === id) return false;
        const switched = m.owner !== null;
        if (switched) { wipeBases(); m.versions = {}; m.dirty = {}; m.seq = 0; }
        m.owner = id;
        write(m);
        return switched;
    }

    function reset() { wipeBases(); L().remove(META_KEY); }
    function onDirty(fn) { listeners.push(fn); }

    return { owner, bindOwner, markDirty, markAllDirty, dirtySnapshot, clearDirty,
             version, setVersion, base, setBase, baseKeys, reset, onDirty };
})();

function createSyncingAdapter(inner) {
    return {
        name: 'syncing', inner,
        get: key => inner.get(key),
        keys: () => inner.keys(),
        set(key, value) {
            const val = String(value);
            const synced = SyncModel.isSynced(key);
            if (synced && inner.get(key) === val) return true;             // inchangé : rien à envoyer
            const ok = inner.set(key, val);
            if (ok && synced) SyncMeta.markDirty(key);
            return ok;
        },
        remove(key) {
            const had = inner.get(key) !== null;
            const ok  = inner.remove(key);
            if (ok && had && SyncModel.isSynced(key)) SyncMeta.markDirty(key);
            return ok;
        }
    };
}

function installSyncingAdapter()   { if (dataStore.adapter.name !== 'syncing') dataStore.setAdapter(createSyncingAdapter(LocalStorageAdapter)); }
function uninstallSyncingAdapter() { dataStore.setAdapter(LocalStorageAdapter); }
