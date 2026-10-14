/**
 * core/auth.js
 * ──────────────────────────────────────────────────────────────────────────
 * Étape 4 : comptes utilisateurs (Supabase Auth / GoTrue), sans dépendance : appels fetch.
 * Aucune interface ici (cf. accountUI.js). Sans configuration (cloudConfig.js vide) ou sans
 * compte connecté, rien n'est installé : l'application reste en stockage local pur.
 *
 *   Auth.signIn / signUp / signOut / recover / updatePassword   → { ok, … } ou { ok:false, code, message (FR) }
 *   Auth.refresh()          rafraîchit le jeton (aussi automatique, 60 s avant l'expiration)
 *   Auth.onChange(fn)       fn(événement, données) : signed-in | signed-out | refreshed | expired | notice
 *   Auth.takeNotice()       message issu d'un lien d'e-mail (confirmation, réinitialisation, lien expiré)
 *
 * Effets de bord à la connexion : CloudClient.setSession(), SyncMeta.bindOwner() (remise à zéro si
 * c'est un autre compte que la dernière fois) et installSyncingAdapter(). À la déconnexion :
 * retour au stockage local pur. La session est conservée dans la clé locale chessTrainer_session
 * (jamais synchronisée). Prérequis : storageAdapter, syncModel, cloudConfig, cloudClient, cloudAdapter.
 */

'use strict';

// Choix fait à la première connexion sur cet appareil (consommé par le moteur de synchro, étape 5) :
//   { user, strategy: 'merge' | 'upload' | 'download', at }
const SyncIntent = {
    KEY: 'chessTrainer_syncIntent',
    get() { try { const o = JSON.parse(LocalStorageAdapter.get(this.KEY)); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } },
    set(o) { return LocalStorageAdapter.set(this.KEY, JSON.stringify(o)); },
    clear() { return LocalStorageAdapter.remove(this.KEY); }
};

const Auth = (function () {
    const SESSION_KEY = 'chessTrainer_session';
    const TIMEOUT_MS  = 15000;
    const MARGIN_S    = 60;
    const L = () => LocalStorageAdapter;

    const cfg        = () => (typeof CLOUD_CONFIG !== 'undefined' && CLOUD_CONFIG) || {};
    const configured = () => !!(cfg().url && cfg().anonKey);
    const api        = p => cfg().url.replace(/\/+$/, '') + '/auth/v1' + p;
    const nowS       = () => Math.floor(Date.now() / 1000);
    const enc        = encodeURIComponent;
    const redirect   = () => (typeof location !== 'undefined' ? enc(location.origin + location.pathname) : '');

    let session = null, refreshTimer = null, refreshing = null, notice = null;
    const listeners = [];
    const emit = (ev, data) => listeners.forEach(fn => { try { fn(ev, data); } catch (e) {} });

    // ─── Réseau ───────────────────────────────────────────────────────────────
    async function request(path, opts) {
        const { method = 'POST', body, token } = opts || {};
        if (!configured()) return { error: 'config' };
        const headers = { apikey: cfg().anonKey, 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        const ctrl  = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
        try {
            const res  = await fetch(api(path), { method, headers, signal: ctrl ? ctrl.signal : undefined,
                                                  body: body === undefined ? undefined : JSON.stringify(body) });
            const text = await res.text();
            let json = {};
            if (text) { try { json = JSON.parse(text); } catch (e) {} }
            return { ok: res.ok, status: res.status, json };
        } catch (e) {
            return { error: 'network' };
        } finally { if (timer) clearTimeout(timer); }
    }

    // Erreur du service → { code, message } (messages en français pour l'interface).
    function describe(r) {
        if (r.error === 'network') return { code: 'network', message: 'Connexion impossible : vérifiez votre réseau.' };
        if (r.error === 'config')  return { code: 'config',  message: "Le service de compte n'est pas configuré." };
        const j = r.json || {}, code = String(j.error_code || j.error || ''), msg = String(j.msg || j.message || j.error_description || '');
        if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg))
            return { code: 'invalid_credentials', message: 'E-mail ou mot de passe incorrect.' };
        if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg))
            return { code: 'email_not_confirmed', message: 'Adresse e-mail pas encore confirmée : ouvrez le message de confirmation reçu.' };
        if (code === 'user_already_exists' || /already (registered|exists)/i.test(msg))
            return { code: 'user_exists', message: 'Un compte existe déjà avec cette adresse : connectez-vous.' };
        if (code === 'same_password' || /should be different/i.test(msg))
            return { code: 'same_password', message: "Choisissez un mot de passe différent de l'ancien." };
        if (code === 'weak_password' || /password should be|weak password/i.test(msg))
            return { code: 'weak_password', message: 'Mot de passe trop faible : 8 caractères minimum.' };
        if (r.status === 429 || /rate.?limit/i.test(code + msg))
            return { code: 'rate_limit', message: 'Trop de tentatives : réessayez dans quelques minutes.' };
        if (code === 'validation_failed' || /invalid.*email|unable to validate email/i.test(msg))
            return { code: 'invalid_email', message: 'Adresse e-mail invalide.' };
        return { code: 'server', message: `Erreur du service de compte (${r.status || '?'}).` };
    }
    const failure = r => Object.assign({ ok: false }, describe(r));

    // ─── Session ──────────────────────────────────────────────────────────────
    function toSession(j) {
        return { access_token: j.access_token, refresh_token: j.refresh_token,
                 expires_at: Number(j.expires_at) || nowS() + (Number(j.expires_in) || 3600),
                 user: { id: j.user && j.user.id, email: j.user && j.user.email } };
    }

    function apply(s) {
        session = s;
        if (s) L().set(SESSION_KEY, JSON.stringify(s)); else L().remove(SESSION_KEY);
        if (typeof CloudClient !== 'undefined') CloudClient.setSession(s);
        scheduleRefresh();
    }

    // Lie la session à cet appareil : renvoie true si un AUTRE compte y était rattaché (suivi remis à zéro).
    function activate(s) {
        const switched = SyncMeta.bindOwner(s.user.id);
        installSyncingAdapter();
        return switched;
    }

    function scheduleRefresh() {
        clearTimeout(refreshTimer); refreshTimer = null;
        if (!session) return;
        const delay = Math.max(5, session.expires_at - nowS() - MARGIN_S) * 1000;
        refreshTimer = setTimeout(refresh, Math.min(delay, 2147483647));
    }
    function retryLater() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 30000); }

    function refresh() {
        if (!session) return Promise.resolve({ ok: false, code: 'no_session' });
        if (refreshing) return refreshing;
        refreshing = (async () => {
            const r = await request('/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
            if (!r.error && r.ok && r.json.access_token) {
                const s = toSession(Object.assign({ user: session.user }, r.json));
                apply(s); emit('refreshed', { session: s });
                return { ok: true, session: s };
            }
            if (r.error || r.status >= 500 || r.status === 429) { retryLater(); return { ok: false, code: r.error || 'server' }; }   // on garde la session
            apply(null); uninstallSyncingAdapter(); emit('expired', {});                                                       // jeton définitivement refusé
            return { ok: false, code: 'expired' };
        })().finally(() => { refreshing = null; });
        return refreshing;
    }

    function refreshIfNeeded() {
        return session && session.expires_at - nowS() < MARGIN_S ? refresh() : Promise.resolve({ ok: true });
    }

    // ─── Actions ──────────────────────────────────────────────────────────────
    async function signIn(email, password) {
        const r = await request('/token?grant_type=password', { body: { email, password } });
        if (r.error || !r.ok || !r.json.access_token) return failure(r);
        const s = toSession(r.json);
        apply(s);
        const switched = activate(s);
        emit('signed-in', { session: s, switched, fresh: true });
        return { ok: true, session: s, switched };
    }

    async function signUp(email, password) {
        const r = await request('/signup?redirect_to=' + redirect(), { body: { email, password } });
        if (r.error || !r.ok) return failure(r);
        if (r.json.access_token) {                                   // confirmation d'e-mail désactivée : déjà connecté
            const s = toSession(r.json);
            apply(s);
            const switched = activate(s);
            emit('signed-in', { session: s, switched, fresh: true });
            return { ok: true, session: s, switched, needsConfirmation: false };
        }
        return { ok: true, needsConfirmation: true };
    }

    async function signOut() {
        if (session) await request('/logout?scope=local', { token: session.access_token });      // au mieux ; la session locale est effacée quoi qu'il arrive
        apply(null);
        uninstallSyncingAdapter();
        emit('signed-out', {});
        return { ok: true };
    }

    async function recover(email) {
        const r = await request('/recover?redirect_to=' + redirect(), { body: { email } });
        return r.error || !r.ok ? failure(r) : { ok: true };
    }

    async function updatePassword(password) {
        if (!session) return { ok: false, code: 'no_session', message: 'Session expirée : recommencez depuis le lien reçu par e-mail.' };
        const r = await request('/user', { method: 'PUT', token: session.access_token, body: { password } });
        return r.error || !r.ok ? failure(r) : { ok: true };
    }

    // ─── Liens reçus par e-mail (#access_token=… confirmation / réinitialisation, #error=… lien expiré) ──
    function readHash() {
        if (typeof location === 'undefined' || !location.hash || location.hash.length < 2) return null;
        const p = new URLSearchParams(location.hash.slice(1));
        const clean = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} };
        if (p.get('error')) {
            const c = p.get('error_code') || p.get('error');
            clean();
            return { error: c === 'otp_expired' ? 'Ce lien a expiré ou a déjà été utilisé : recommencez la démarche.'
                                                : (p.get('error_description') || 'Lien invalide.').replace(/\+/g, ' ') };
        }
        if (p.get('access_token') && p.get('refresh_token')) {
            const h = { type: p.get('type') || 'signin', access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
                        expires_at: Number(p.get('expires_at')) || nowS() + (Number(p.get('expires_in')) || 3600) };
            clean();
            return h;
        }
        return null;
    }

    function setNotice(n) { notice = n; emit('notice', n); }

    async function handleLink(h) {
        if (h.error) { setNotice({ kind: 'error', message: h.error }); return; }
        const r = await request('/user', { method: 'GET', token: h.access_token });
        if (r.error || !r.ok || !r.json.id) { setNotice({ kind: 'error', message: 'Lien invalide ou expiré : recommencez la démarche.' }); return; }
        const s = { access_token: h.access_token, refresh_token: h.refresh_token, expires_at: h.expires_at, user: { id: r.json.id, email: r.json.email } };
        apply(s);
        const switched = activate(s);
        emit('signed-in', { session: s, switched, fresh: true });
        setNotice({ kind: h.type === 'recovery' ? 'recovery' : 'confirmed' });
    }

    // ─── Démarrage ────────────────────────────────────────────────────────────
    function init() {
        if (!configured()) return;
        let s = null;
        try { s = JSON.parse(L().get(SESSION_KEY)); } catch (e) {}
        if (s && s.access_token && s.refresh_token && s.user && s.user.id) {
            session = s;                                              // restauration synchrone : le suivi des modifications démarre tout de suite
            if (typeof CloudClient !== 'undefined') CloudClient.setSession(s);
            activate(s);
            scheduleRefresh();
            if (s.expires_at - nowS() < MARGIN_S) refresh();
        }
        const h = readHash();
        if (h) handleLink(h);
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfNeeded(); });
    }

    return {
        configured, init, refresh, refreshIfNeeded, signIn, signUp, signOut, recover, updatePassword,
        onChange: fn => { listeners.push(fn); },
        takeNotice: () => { const n = notice; notice = null; return n; },
        session: () => session,
        user: () => (session ? session.user : null),
        isSignedIn: () => !!session
    };
})();

Auth.init();
