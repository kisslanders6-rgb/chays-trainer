/**
 * core/syncEngine.js
 * ──────────────────────────────────────────────────────────────────────────
 * Moteur de synchronisation. Ne fait rien sans compte connecté (stockage local pur).
 *
 * Principe : pour chaque document (clé synchronisable), fusion à trois points
 *   base (dernière version synchronisée) · local · distant      → SyncModel.merge()
 * puis : envoi si le distant doit changer, écriture locale si le local doit changer.
 * Le moteur ne se fie PAS qu'aux marques « dirty » : au démarrage de session, il compare aussi chaque
 * clé à sa base, ce qui rattrape les modifications faites hors ligne ou déconnecté.
 *
 * Déclencheurs : connexion / reprise de session · 4 s après une modification (au plus 30 s d'attente) ·
 * retour sur l'onglet · retour du réseau · sondage toutes les 2 min · « Synchroniser maintenant ».
 * Premier passage sur un appareil : selon le choix enregistré (SyncIntent) — fusionner / envoyer / récupérer.
 *
 * Sûretés : une valeur locale illisible n'est jamais traitée comme « supprimée » · une clé modifiée
 * pendant la synchro n'est jamais écrasée · la mémoire de l'appli est rechargée dans la foulée de chaque
 * écriture locale (aucun instantané périodique ne peut ré-écraser la fusion) · un seul onglet synchronise
 * à la fois (Web Locks) · échec réseau : nouvel essai espacé (15 s → 5 min), rien n'est perdu.
 *
 * Prérequis : storageAdapter, syncModel, cloudClient, cloudAdapter, auth ; accountUI (statut) facultatif.
 */

'use strict';

const SyncEngine = (function () {
    const DEBOUNCE_MS = 4000, MAX_WAIT_MS = 30000, POLL_MS = 120000, MAX_ATTEMPTS = 5;
    const BACKOFF = [15000, 30000, 60000, 120000, 300000];
    const LOCKED = { locked: true };
    const L = () => LocalStorageAdapter;
    const same = SyncModel.same;

    let running = null, again = false, timer = null, pendingSince = 0, backoffIdx = 0, authFails = 0;
    let fullScan = true, status = { level: 'ok', text: 'Connecté' };
    const statusListeners = [];

    // ─── Outils ───────────────────────────────────────────────────────────────
    const coded = (code, extra) => Object.assign(new Error(code), { code }, extra);
    const errOf = r => coded(/quota_/.test(r.message || '') ? 'quota' : r.error || 'server', { status: r.status });   // quota : supabase/schema.sql
    const active = () => typeof Auth !== 'undefined' && Auth.isSignedIn() && CloudClient.configured();
    const hhmm = ts => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    function setStatus(level, text) {
        status = { level, text };
        if (typeof AccountUI !== 'undefined') { try { AccountUI.setSyncStatus(level, text); } catch (e) {} }
        statusListeners.forEach(fn => { try { fn(status); } catch (e) {} });
    }

    function parseStrict(raw) {                              // null = absent ; ok:false = présent mais illisible
        if (raw === null || raw === undefined) return { ok: true, value: null };
        try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false }; }
    }

    // Forme canonique d'un document : celle que l'application relit (aucun va-et-vient inutile).
    function normalizeValue(kind, v) {
        if (v === null || v === undefined) return null;
        if (kind === 'db' && typeof normalizeDB === 'function') return normalizeDB(v);
        if (kind === 'list' && Array.isArray(v) && typeof DEFAULT_REPERTOIRE === 'string' && v.indexOf(DEFAULT_REPERTOIRE) > 0)
            return [DEFAULT_REPERTOIRE].concat(v.filter(x => x !== DEFAULT_REPERTOIRE));
        return v;
    }

    function currentIntent() {
        const u = Auth.user(), i = SyncIntent.get();
        return u && i && i.user === u.id ? i : null;
    }

    // ─── Mémoire de l'application ─────────────────────────────────────────────
    // Appelé de façon SYNCHRONE juste après une écriture locale : la base chargée en mémoire est
    // rechargée avant que l'application ne puisse en réécrire un ancien instantané.
    function reloadMemory(key) {
        try {
            if (key === 'chessTrainer_prefs' && typeof reloadSyncedPrefs === 'function') { reloadSyncedPrefs(); return; }
            if (typeof loadDB !== 'function' || typeof getDBKey !== 'function') return;
            if (key === getDBKey() || (typeof oppKeyFor === 'function' && key === oppKeyFor(currentRepertoire, playerColor))) loadDB();
        } catch (e) {}
    }

    function refreshViews(keys) {
        if (!keys.length) return;
        const hidden = id => { const el = document.getElementById(id); return !el || el.classList.contains('hidden'); };
        const attempt = fn => { try { fn(); } catch (e) {} };
        if (keys.includes('chessTrainer_repertoires') && typeof loadRepertoireList === 'function') attempt(() => {
            if (!loadRepertoireList().includes(currentRepertoire)) currentRepertoire = DEFAULT_REPERTOIRE;
            if (typeof renderRepertoireList === 'function') renderRepertoireList();
        });
        if (typeof initStats === 'function')    attempt(initStats);
        if (typeof initTraining === 'function') attempt(initTraining);
        if (keys.includes('chessTrainer_endgames') && typeof initEndgame === 'function' && !hidden('home-tab-endgame')) attempt(initEndgame);
        if (keys.includes('chessTrainer_trash') && typeof updateTrashBadges === 'function') attempt(() => {
            updateTrashBadges(); if (!hidden('trash-overlay') && typeof renderTrash === 'function') renderTrash();
        });
        if (!hidden('data-overlay') && typeof renderDataPanel === 'function') attempt(renderDataPanel);
        if (typeof refreshTree === 'function') attempt(refreshTree);
        if (keys.includes('chessTrainer_prefs') && typeof applySyncedPrefs === 'function') attempt(applySyncedPrefs);
    }

    // ─── Un document ──────────────────────────────────────────────────────────
    async function syncKey(key, mode, remoteVers) {
        const kind = SyncModel.kindOf(key);
        let fetchRemote = remoteVers.has(key);
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const stamp    = SyncMeta.dirtySnapshot()[key];                  // tampon observé avant de lire
            const localRaw = L().get(key);
            const lp = parseStrict(localRaw);
            if (!lp.ok) return { skipped: 'corrupt' };                       // jamais interprété comme une suppression
            const local = lp.value;
            const bp = parseStrict(SyncMeta.base(key)), base = bp.ok ? bp.value : null;

            let remote = null;
            if (fetchRemote) {
                const g = await CloudClient.getDoc(key);
                if (!g.ok) throw errOf(g);
                remote = g.doc;
            }
            const remoteData = remote ? remote.data : null;

            let merged;
            if (mode === 'upload')        merged = local;
            else if (mode === 'download') merged = remoteData;
            else                          merged = SyncModel.merge(key, base, local, remoteData);
            merged = normalizeValue(kind, merged);

            const eqLocal = same(local, merged), eqRemote = same(remoteData, merged);
            let version = remote ? remote.version : null, pushed = false;

            if (!eqRemote) {
                let res;
                if (merged === null)  res = await CloudClient.deleteDoc(key, remote.version);
                else if (!remote)     res = await CloudClient.createDoc(key, merged);
                else                  res = await CloudClient.updateDoc(key, merged, remote.version);
                if (res.conflict) { fetchRemote = true; continue; }          // quelqu'un est passé avant : on relit et on refusionne
                if (!res.ok) throw errOf(res);
                pushed = true;
                version = merged === null ? null : res.doc.version;
            }

            let wroteLocal = false;
            if (!eqLocal) {
                if (L().get(key) !== localRaw) return { raced: true, pushed };   // modifié pendant la synchro : on ne l'écrase pas
                const ok = merged === null ? L().remove(key) : L().set(key, JSON.stringify(merged));
                if (!ok) throw coded('storage');
                wroteLocal = true;
                reloadMemory(key);
            }
            if (!SyncMeta.setBase(key, merged === null ? null : JSON.stringify(merged))) throw coded('storage');
            SyncMeta.setVersion(key, version);
            if (stamp !== undefined) SyncMeta.clearDirty(key, stamp);
            return { pushed, wroteLocal };
        }
        throw coded('conflict');
    }

    function needsWork(key, mode, dirty, remoteVers) {
        if (mode !== 'merge') return true;                                   // premier passage : tout est examiné
        if (dirty[key] !== undefined) return true;
        const rv = remoteVers.has(key) ? remoteVers.get(key) : null;
        if (rv !== SyncMeta.version(key)) return true;                       // changé (ou supprimé) côté serveur
        if (!fullScan) return false;
        const lraw = L().get(key), braw = SyncMeta.base(key);                // rattrapage : modifié hors ligne / déconnecté ?
        if (lraw === null && braw === null) return false;
        const lp = parseStrict(lraw), bp = parseStrict(braw);
        return !lp.ok || !same(lp.value, bp.ok ? bp.value : null);
    }

    // ─── Un passage complet ───────────────────────────────────────────────────
    async function cycle() {
        await Auth.refreshIfNeeded();
        const it = currentIntent();
        if (!it) return { waiting: true };
        const mode = it.done ? 'merge' : it.strategy;

        const meta = await CloudClient.listVersions();
        if (!meta.ok) throw errOf(meta);
        const remoteVers = new Map(meta.docs.map(d => [d.key, d.version]));

        const keys = new Set();
        L().keys().forEach(k => { if (SyncModel.isSynced(k)) keys.add(k); });
        remoteVers.forEach((v, k) => { if (SyncModel.isSynced(k)) keys.add(k); });
        SyncMeta.baseKeys().forEach(k => { if (SyncModel.isSynced(k)) keys.add(k); });

        const dirty = SyncMeta.dirtySnapshot();
        const out = { mode, pushed: [], pulled: [], skipped: [], raced: [] };
        for (const key of [...keys].sort()) {
            if (!needsWork(key, mode, dirty, remoteVers)) continue;
            const r = await syncKey(key, mode, remoteVers);
            if (r.skipped) out.skipped.push(key);
            if (r.raced)   out.raced.push(key);
            if (r.pushed)  out.pushed.push(key);
            if (r.wroteLocal) out.pulled.push(key);
        }
        if (!it.done && !out.raced.length) SyncIntent.set(Object.assign({}, it, { done: true, doneAt: Date.now() }));
        refreshViews(out.pulled);
        return out;
    }

    async function withLock(fn) {                                            // un seul onglet synchronise à la fois
        if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request)
            return navigator.locks.request('chays-sync', { ifAvailable: true }, lock => (lock ? fn() : LOCKED));
        return fn();
    }

    async function handleError(e) {
        const code = e.code || 'server';
        if (code === 'auth') {
            if (++authFails <= 2) {
                const r = await Auth.refresh();
                if (r.ok) { schedule(300, true); return { error: 'auth', retrying: true }; }
            }
            setStatus('error', 'Session expirée : reconnectez-vous.');
            return { error: 'auth' };
        }
        if (code === 'config')  { setStatus('error', 'Service de compte non configuré.'); return { error: code }; }
        if (code === 'storage') { setStatus('error', 'Stockage de l\'appareil plein : synchronisation suspendue.'); return { error: code }; }
        if (code === 'quota')   { setStatus('error', 'Limite du compte atteinte (500 documents ou 20 Mo) : synchronisation suspendue.'); return { error: code }; }
        const offline = code === 'network';
        setStatus(offline ? 'offline' : 'error', offline ? 'Hors ligne : modifications gardées sur cet appareil.' : 'Erreur de synchronisation : nouvel essai automatique.');
        schedule(BACKOFF[Math.min(backoffIdx++, BACKOFF.length - 1)], true);
        return { error: code };
    }

    async function runOnce() {
        if (!active()) return { skipped: 'inactive' };
        setStatus('busy', 'Synchronisation…');
        try {
            const r = await withLock(cycle);
            if (r === LOCKED) { schedule(2000, true); return { locked: true }; }
            if (r.waiting)    { setStatus('busy', 'En attente de votre choix de première synchronisation…'); return r; }
            backoffIdx = 0; authFails = 0; fullScan = false;
            setStatus('ok', 'À jour · ' + hhmm(Date.now()));
            if (typeof touchDevice === 'function') touchDevice();       // liste des appareils (Compte › Appareils), au plus 1×/h
            if (r.raced.length) schedule(1000, true);
            return r;
        } catch (e) { return handleError(e); }
    }

    function run() {
        if (running) { again = true; return running; }
        again = false;
        running = runOnce().finally(() => { running = null; if (again) schedule(500, true); });
        return running;
    }

    // ─── Planification ────────────────────────────────────────────────────────
    function schedule(ms, uncapped) {
        if (!active()) return;
        const now = Date.now();
        if (!timer) pendingSince = now;
        clearTimeout(timer);
        const wait = uncapped ? ms : Math.max(0, Math.min(ms, MAX_WAIT_MS - (now - pendingSince)));
        timer = setTimeout(() => { timer = null; run(); }, wait);
    }

    function syncNow() {
        clearTimeout(timer); timer = null;
        fullScan = true; backoffIdx = 0; authFails = 0;
        return run();
    }

    function start() {
        if (typeof Auth === 'undefined' || !Auth.configured()) return;
        Auth.onChange(ev => {
            if (ev === 'signed-in')  { fullScan = true; backoffIdx = 0; authFails = 0; schedule(300, true); }
            if (ev === 'signed-out' || ev === 'expired') { clearTimeout(timer); timer = null; }
        });
        SyncMeta.onDirty(() => schedule(DEBOUNCE_MS));
        if (typeof window !== 'undefined') {
            window.addEventListener('chays-sync-intent', () => { fullScan = true; schedule(0, true); });
            window.addEventListener('online',  () => { backoffIdx = 0; schedule(300, true); });
            window.addEventListener('offline', () => { if (active()) setStatus('offline', 'Hors ligne : modifications gardées sur cet appareil.'); });
        }
        if (typeof document !== 'undefined')
            document.addEventListener('visibilitychange', () => { if (active()) schedule(document.hidden ? 0 : 300, true); });
        setInterval(() => { if (active() && !running && !(typeof document !== 'undefined' && document.hidden)) schedule(0, true); }, POLL_MS);
        if (active()) { fullScan = true; schedule(1500, true); }
    }

    return { start, syncNow, status: () => status, onStatus: fn => { statusListeners.push(fn); } };
})();

SyncEngine.start();
