/**
 * core/cloudClient.js
 * ──────────────────────────────────────────────────────────────────────────
 * Étape 3 : client bas niveau de la table `documents` (Supabase / PostgREST), sans dépendance :
 * simples appels fetch. Ne touche NI au stockage local NI à l'interface ; l'authentification
 * (obtenir / rafraîchir le jeton) est l'étape 4 — ici on reçoit une session via setSession().
 *
 * Toutes les méthodes renvoient une Promise qui ne rejette JAMAIS :
 *   { ok: true, … }
 *   { ok: false, conflict: true }                 version dépassée (ou ligne déjà créée / disparue)
 *   { ok: false, error: 'network' | 'auth' | 'config' | 'server', status?, message? }
 *
 * Les valeurs `data` sont échangées DÉCODÉES (objets / tableaux), pas en chaîne.
 * Prérequis : cloudConfig.js (CLOUD_CONFIG), supabase/schema.sql exécuté.
 */

'use strict';

const CloudClient = (function () {
    const TIMEOUT_MS = 15000;
    const PAGE       = 1000;
    let session = null;

    const cfg        = () => (typeof CLOUD_CONFIG !== 'undefined' && CLOUD_CONFIG) || {};
    const configured = () => !!(cfg().url && cfg().anonKey);
    const endpoint   = () => cfg().url.replace(/\/+$/, '') + '/rest/v1/documents';
    const enc        = encodeURIComponent;

    function deviceId() {                                   // identifiant d'appareil (diagnostic seulement)
        try {
            if (typeof LocalStorageAdapter !== 'undefined') {
                let id = LocalStorageAdapter.get('chessTrainer_deviceId');
                if (!id) { id = 'd' + Math.random().toString(36).slice(2, 10); LocalStorageAdapter.set('chessTrainer_deviceId', id); }
                return id;
            }
        } catch (e) {}
        return 'unknown';
    }

    function setSession(s) { session = s && s.access_token ? { access_token: s.access_token, user: s.user || null } : null; }
    const hasSession = () => !!session;

    async function call(method, query, body, extra) {
        if (!configured()) return { error: 'config' };
        if (!session)      return { error: 'auth', status: 401 };
        const headers = { apikey: cfg().anonKey, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' };
        if (method !== 'GET') headers.Prefer = 'return=representation';
        Object.assign(headers, extra || {});
        const ctrl  = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
        try {
            const res  = await fetch(endpoint() + query, { method, headers, signal: ctrl ? ctrl.signal : undefined,
                                                           body: body === undefined ? undefined : JSON.stringify(body) });
            const text = await res.text();
            let json = null;
            if (text) { try { json = JSON.parse(text); } catch (e) {} }
            return { status: res.status, ok: res.ok, json };
        } catch (e) {
            return { error: 'network' };
        } finally { if (timer) clearTimeout(timer); }
    }

    function fail(r) {
        if (r.error) return { ok: false, error: r.error, status: r.status };
        if (r.status === 401 || r.status === 403) return { ok: false, error: 'auth', status: r.status };
        return { ok: false, error: 'server', status: r.status, message: r.json && (r.json.message || r.json.error) };
    }

    const rowOf = j => (Array.isArray(j) ? j[0] : j) || null;
    const docOf = r => ({ key: r.key, data: r.data, version: r.version, updated_at: r.updated_at });
    const where = (key, version) => `?key=eq.${enc(key)}&version=eq.${Number(version)}`;

    // Liste paginée (blocs de 1000) avec les colonnes demandées.
    async function pagedList(select) {
        const docs = [];
        for (let from = 0; ; from += PAGE) {
            const r = await call('GET', `?select=${select}&order=key.asc`, undefined,
                                 { 'Range-Unit': 'items', Range: `${from}-${from + PAGE - 1}` });
            if (r.status === 416) break;
            if (r.error || !r.ok) return fail(r);
            const page = Array.isArray(r.json) ? r.json : [];
            page.forEach(x => docs.push(select === 'key,version' ? { key: x.key, version: x.version } : docOf(x)));
            if (page.length < PAGE) break;
        }
        return { ok: true, docs };
    }

    // Tous les documents de l'utilisateur, contenu compris.
    const listDocs = () => pagedList('key,data,version,updated_at');

    // Clés et versions seulement (pas de contenu) : sert à savoir ce qui a changé sur le serveur.
    const listVersions = () => pagedList('key,version');

    async function getDoc(key) {
        const r = await call('GET', `?key=eq.${enc(key)}&select=key,data,version,updated_at`);
        if (r.error || !r.ok) return fail(r);
        const row = rowOf(r.json);
        return { ok: true, doc: row ? docOf(row) : null };
    }

    // Création : échoue en conflit si la ligne existe déjà (un autre appareil est passé avant).
    async function createDoc(key, data) {
        const r = await call('POST', '', { key, data, device: deviceId() });
        if (r.status === 409) return { ok: false, conflict: true };
        if (r.error || !r.ok) return fail(r);
        const row = rowOf(r.json);
        return row ? { ok: true, doc: docOf(row) } : { ok: false, error: 'server', status: r.status };
    }

    // Mise à jour conditionnelle : n'écrit que si la version serveur est encore `expectedVersion`.
    async function updateDoc(key, data, expectedVersion) {
        const r = await call('PATCH', where(key, expectedVersion), { data, device: deviceId() });
        if (r.error || !r.ok) return fail(r);
        const row = rowOf(r.json);
        return row ? { ok: true, doc: docOf(row) } : { ok: false, conflict: true };
    }

    // Suppression conditionnelle (même règle de version).
    async function deleteDoc(key, expectedVersion) {
        const r = await call('DELETE', where(key, expectedVersion));
        if (r.error || !r.ok) return fail(r);
        return rowOf(r.json) ? { ok: true } : { ok: false, conflict: true };
    }

    return { configured, setSession, hasSession, listDocs, listVersions, getDoc, createDoc, updateDoc, deleteDoc };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { CloudClient };
