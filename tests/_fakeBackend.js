// Faux backend Supabase (GoTrue + PostgREST) en mémoire, partagé par les tests de l'étape 4.
module.exports = function makeBackend(opts) {
    opts = Object.assign({ confirmEmail: false, expiresIn: 3600 }, opts);
    const users = new Map(), sessions = new Map(), docs = new Map();      // email → user ; access → user ; user id → Map(key → row)
    let seq = 0, refreshOf = new Map();
    const log = [];
    const res = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => body === undefined ? '' : JSON.stringify(body) });
    const issue = u => {
        const n = ++seq, at = 'at-' + n, rt = 'rt-' + n;
        sessions.set(at, u); refreshOf.set(rt, u);
        return { access_token: at, refresh_token: rt, expires_in: opts.expiresIn, expires_at: Math.floor(Date.now() / 1000) + opts.expiresIn, user: { id: u.id, email: u.email } };
    };
    async function fetch(url, o) {
        if (globalThis.__netDown) throw new TypeError('Failed to fetch');
        const u = new URL(url), p = u.pathname, h = o.headers || {}, body = o.body ? JSON.parse(o.body) : {};
        log.push(o.method + ' ' + p + u.search);
        if (!h.apikey) return res(401, { message: 'No API key' });
        const bearer = (h.Authorization || '').replace('Bearer ', ''), who = sessions.get(bearer);
        if (p === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
            const usr = users.get(body.email);
            if (!usr || usr.password !== body.password) return res(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
            if (!usr.confirmed) return res(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
            return res(200, issue(usr));
        }
        if (p === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
            const usr = refreshOf.get(body.refresh_token);
            if (!usr || globalThis.__refreshDenied) return res(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
            refreshOf.delete(body.refresh_token);
            return res(200, issue(usr));
        }
        if (p === '/auth/v1/signup') {
            if (body.password.length < 6) return res(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
            if (users.has(body.email) && !opts.confirmEmail) return res(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
            const usr = users.get(body.email) || { id: 'u' + (users.size + 1), email: body.email, password: body.password, confirmed: !opts.confirmEmail };
            users.set(body.email, usr);
            return res(200, opts.confirmEmail ? { id: usr.id, email: usr.email } : issue(usr));
        }
        if (p === '/auth/v1/logout') { sessions.delete(bearer); return res(204); }
        if (p === '/auth/v1/recover') return res(200, {});
        if (p === '/auth/v1/user') {
            if (!who) return res(401, { msg: 'invalid JWT' });
            if (o.method === 'GET') return res(200, { id: who.id, email: who.email });
            if (body.password === who.password) return res(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' });
            if (body.password.length < 6) return res(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
            who.password = body.password; return res(200, { id: who.id, email: who.email });
        }
        if (p === '/rest/v1/documents') {                                   // PostgREST minimal : liste seulement (suffit à l'interface)
            if (!who) return res(401, { message: 'JWT expired' });
            const tb = docs.get(who.id) || new Map();
            return res(200, [...tb.values()].map(r => ({ key: r.key, data: r.data, version: r.version, updated_at: 'now' })));
        }
        return res(404, {});
    }
    return {
        fetch, log, users, docs,
        addUser(email, password, confirmed = true) { const usr = { id: 'u' + (users.size + 1), email, password, confirmed }; users.set(email, usr); return usr; },
        addDoc(userId, key, data) { const tb = docs.get(userId) || docs.set(userId, new Map()).get(userId); tb.set(key, { key, data, version: 1 }); },
        token(usr) { return issue(usr); }
    };
};
