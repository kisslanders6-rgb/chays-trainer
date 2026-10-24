/**
 * core/auth.js
 * ──────────────────────────────────────────────────────────────────────────
 * Comptes utilisateurs (Supabase Auth / GoTrue), sans dépendance : appels fetch.
 * Aucune interface ici (cf. accountUI.js). Sans configuration (cloudConfig.js vide) ou sans
 * compte connecté, rien n'est installé : l'application reste en stockage local pur.
 *
 *   Auth.signIn / signUp / signOut / recover / updatePassword   → { ok, … } ou { ok:false, code, message (FR) }
 *   Auth.providers()        fournisseurs externes activés côté Supabase (ex. ['google']), mis en cache
 *   Auth.signInWithProvider(p)  redirige vers le fournisseur ; le retour est traité par init() :
 *                           Google avec googleClientId (cloudConfig.js) → directement chez Google (OpenID Connect,
 *                           #id_token=…) : la fenêtre Google affiche l'application, pas l'adresse Supabase ;
 *                           sinon → via Supabase (#access_token=…)
 *   Auth.signInWithIdToken(p, jeton, nonce)  connexion avec un jeton d'identité vérifié par Supabase
 *   Auth.deleteAccount()    supprime le compte et ses données en ligne (fonction delete_my_account)
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

// Choix fait à la première connexion sur cet appareil (consommé par syncEngine.js) :
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
    // Adresse de retour des e-mails (confirmation, réinitialisation). Uniquement en http(s) : ouverte en file://
    // l'adresse serait invalide (« requested path is invalid ») ; sans redirect_to, Supabase utilise alors le « Site URL ».
    const redirectQuery = () => (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
        ? '?redirect_to=' + enc(location.origin + location.pathname) : '');

    let session = null, refreshTimer = null, refreshing = null, notice = null;
    const listeners = [];
    const emit = (ev, data) => listeners.forEach(fn => { try { fn(ev, data); } catch (e) { reportError('auth : écouteur ' + ev, e); } });

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
            if (text) { try { json = JSON.parse(text); } catch (e) { /* réponse non JSON : traitée par le code HTTP */ } }
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
        const r = await request('/signup' + redirectQuery(), { body: { email, password } });
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
        const r = await request('/recover' + redirectQuery(), { body: { email } });
        return r.error || !r.ok ? failure(r) : { ok: true };
    }

    // Connexion sans mot de passe : un lien envoyé par e-mail (compte créé au besoin), traité par readHash.
    async function signInWithLink(email) {
        const r = await request('/otp' + redirectQuery(), { body: { email, create_user: true } });
        return r.error || !r.ok ? failure(r) : { ok: true };
    }

    // Changement d'adresse : un lien de confirmation part vers la nouvelle adresse.
    async function updateEmail(email) {
        if (!session) return { ok: false, code: 'no_session', message: 'Session expirée : reconnectez-vous.' };
        const r = await request('/user' + redirectQuery(), { method: 'PUT', token: session.access_token, body: { email } });
        return r.error || !r.ok ? failure(r) : { ok: true };
    }

    // Profil complet côté service (méthodes de connexion associées, date de création).
    async function fetchUser() {
        if (!session) return null;
        const r = await request('/user', { method: 'GET', token: session.access_token });
        return r.error || !r.ok ? null : r.json;
    }

    async function updatePassword(password) {
        if (!session) return { ok: false, code: 'no_session', message: 'Session expirée : recommencez depuis le lien reçu par e-mail.' };
        const r = await request('/user', { method: 'PUT', token: session.access_token, body: { password } });
        return r.error || !r.ok ? failure(r) : { ok: true };
    }

    // ─── Fournisseurs externes (Google…) ──────────────────────────────────────
    let providersCache = null;
    async function providers() {
        if (providersCache) return providersCache;
        const r = await request('/settings', { method: 'GET' });
        if (r.error || !r.ok) return [];
        const ext = r.json.external || {};
        providersCache = Object.keys(ext).filter(k => ext[k] === true && k !== 'email' && k !== 'phone');
        return providersCache;
    }

    // Google direct (OpenID Connect, réponse #id_token=…) : nonce et state gardés le temps de l'aller-retour.
    // Le nonce haché part chez Google, le nonce brut ira à Supabase qui compare les deux (cf. handleLink).
    const OIDC_KEY = 'chessTrainer_oidc';
    const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    const googleClientId = () => cfg().googleClientId || '';

    async function signInWithGoogleDirect() {
        const raw   = hex(crypto.getRandomValues(new Uint8Array(24)));
        const state = hex(crypto.getRandomValues(new Uint8Array(16)));
        const hashed = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
        L().set(OIDC_KEY, JSON.stringify({ nonce: raw, state, at: Date.now() }));
        location.assign('https://accounts.google.com/o/oauth2/v2/auth?client_id=' + enc(googleClientId())
            + '&redirect_uri=' + enc(location.origin + location.pathname) + '&response_type=id_token'
            + '&scope=' + enc('openid email profile') + '&nonce=' + hashed + '&state=' + state + '&prompt=select_account');
        return { ok: true };
    }

    // Quitte la page : le fournisseur (ou Supabase) renvoie ensuite vers cette adresse (traité par readHash).
    function signInWithProvider(provider) {
        if (!configured()) return { ok: false, code: 'config', message: "Le service de compte n'est pas configuré." };
        if (!/^https?:$/.test(location.protocol))
            return { ok: false, code: 'file', message: "La connexion avec Google n'est possible que depuis l'adresse en ligne de l'application." };
        if (provider === 'google' && googleClientId() && typeof crypto !== 'undefined' && crypto.subtle) return signInWithGoogleDirect();
        location.assign(api('/authorize?provider=' + enc(provider) + '&redirect_to=' + enc(location.origin + location.pathname)));
        return { ok: true };
    }

    // Jeton d'identité obtenu directement auprès du fournisseur (bouton « Se connecter avec Google ») :
    // Supabase vérifie sa signature, son destinataire (ID client) et le nonce brut.
    async function signInWithIdToken(provider, idToken, nonce) {
        const r = await request('/token?grant_type=id_token', { body: { provider, id_token: idToken, nonce } });
        if (r.error || !r.ok || !r.json.access_token) return failure(r);
        const s = toSession(r.json);
        apply(s);
        const switched = activate(s);
        emit('signed-in', { session: s, switched, fresh: true });
        return { ok: true, session: s, switched };
    }

    // Supprime définitivement le compte (et, par cascade, ses documents en ligne), puis déconnecte.
    async function deleteAccount() {
        if (!session) return { ok: false, code: 'no_session', message: 'Vous n\'êtes pas connecté.' };
        await refreshIfNeeded();
        let res;
        try {
            res = await fetch(cfg().url.replace(/\/+$/, '') + '/rest/v1/rpc/delete_my_account', {
                method: 'POST', body: '{}',
                headers: { apikey: cfg().anonKey, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }
            });
        } catch (e) { return { ok: false, code: 'network', message: 'Connexion impossible : vérifiez votre réseau.' }; }
        if (!res.ok) return { ok: false, code: 'server', message: `La suppression a échoué (${res.status}). Réessayez plus tard.` };
        apply(null);
        uninstallSyncingAdapter();
        emit('signed-out', { deleted: true });
        return { ok: true };
    }

    // ─── Liens reçus par e-mail (#access_token=… confirmation / réinitialisation, #error=… lien expiré) ──
    function readHash() {
        if (typeof location === 'undefined' || !location.hash || location.hash.length < 2) return null;
        const p = new URLSearchParams(location.hash.slice(1));
        const clean = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* adresse laissée telle quelle */ } };
        if (p.get('error')) {
            const c = p.get('error_code') || p.get('error');
            clean();
            if (p.get('state')) L().remove('chessTrainer_oidc');
            return { error: c === 'otp_expired' ? 'Ce lien a expiré ou a déjà été utilisé : recommencez la démarche.'
                          : c === 'access_denied' && p.get('state') ? 'Connexion Google annulée.'
                                                : (p.get('error_description') || 'Lien invalide.').replace(/\+/g, ' ') };
        }
        if (p.get('id_token')) {                                     // retour de Google (OpenID Connect)
            const h = { type: 'id_token', id_token: p.get('id_token'), state: p.get('state') };
            clean();
            return h;
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
        if (h.error) { L().remove(OIDC_KEY); setNotice({ kind: 'error', message: h.error }); return; }
        if (h.type === 'id_token') {
            let o = null;
            try { o = JSON.parse(L().get(OIDC_KEY)); } catch (e) { /* illisible : aucune connexion en cours */ }
            L().remove(OIDC_KEY);
            if (!o || !o.state || o.state !== h.state || Date.now() - o.at > 600000) {
                setNotice({ kind: 'error', message: 'Connexion Google interrompue ou expirée : recommencez.' });
                return;
            }
            const r = await signInWithIdToken('google', h.id_token, o.nonce);
            setNotice(r.ok ? { kind: 'signed-in' } : { kind: 'error', message: r.message });
            return;
        }
        const r = await request('/user', { method: 'GET', token: h.access_token });
        if (r.error || !r.ok || !r.json.id) { setNotice({ kind: 'error', message: 'Lien invalide ou expiré : recommencez la démarche.' }); return; }
        const s = { access_token: h.access_token, refresh_token: h.refresh_token, expires_at: h.expires_at, user: { id: r.json.id, email: r.json.email } };
        apply(s);
        const switched = activate(s);
        emit('signed-in', { session: s, switched, fresh: true });
        setNotice({ kind: h.type === 'recovery' ? 'recovery' : h.type === 'signup' ? 'confirmed' : 'signed-in' });
    }

    // ─── Démarrage ────────────────────────────────────────────────────────────
    function init() {
        if (!configured()) return;
        let s = null;
        try { s = JSON.parse(L().get(SESSION_KEY)); } catch (e) { /* illisible : déconnecté */ }
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
        configured, init, refresh, refreshIfNeeded, signIn, signUp, signOut, recover, updatePassword, signInWithLink, updateEmail, fetchUser,
        providers, signInWithProvider, signInWithIdToken, deleteAccount,
        onChange: fn => { listeners.push(fn); },
        takeNotice: () => { const n = notice; notice = null; return n; },
        session: () => session,
        user: () => (session ? session.user : null),
        isSignedIn: () => !!session
    };
})();

Auth.init();
