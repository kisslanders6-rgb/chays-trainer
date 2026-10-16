// Faux backend Supabase (GoTrue + PostgREST) en mémoire, partagé par les tests de compte et de synchro.
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
        if (p === '/rest/v1/documents') {                                   // PostgREST : mêmes règles que supabase/schema.sql
            if (!who) return res(401, { message: 'JWT expired' });
            const tb = docs.get(who.id) || docs.set(who.id, new Map()).get(who.id);
            const eq = name => { const v = u.searchParams.get(name); return v && v.startsWith('eq.') ? v.slice(3) : null; };
            const key = eq('key'), ver = eq('version');
            const rows = () => [...tb.values()].filter(r => (key === null || r.key === key) && (ver === null || String(r.version) === ver));
            const sel = (u.searchParams.get('select') || '').split(',');
            const out = r => { const o = { key: r.key, version: r.version }; if (sel.includes('data') || !sel[0]) o.data = JSON.parse(JSON.stringify(r.data)); o.updated_at = 'now'; return o; };
            if (opts.onRest) opts.onRest(o.method, key, who, tb);          // crochet : permet de simuler un autre appareil entre deux requêtes
            if (o.method === 'GET') {
                let all = rows().sort((a, b) => (a.key < b.key ? -1 : 1)).map(out);
                const rg = h.Range && /^(\d+)-(\d+)$/.exec(h.Range);
                if (rg) { const from = +rg[1], to = +rg[2]; if (from > 0 && from >= all.length) return res(416, { message: 'range' }); all = all.slice(from, to + 1); }
                return res(rg ? 206 : 200, all);
            }
            if (o.method === 'POST') {
                if (tb.has(body.key)) return res(409, { code: '23505', message: 'duplicate key' });
                const row = { key: body.key, data: JSON.parse(JSON.stringify(body.data)), version: 1 };
                tb.set(body.key, row); return res(201, [out(row)]);
            }
            if (o.method === 'PATCH') {
                const hit = rows(); hit.forEach(r => { r.data = JSON.parse(JSON.stringify(body.data)); r.version += 1; });
                return res(200, hit.map(out));
            }
            if (o.method === 'DELETE') { const hit = rows(); hit.forEach(r => tb.delete(r.key)); return res(200, hit.map(out)); }
        }
        return res(404, {});
    }
    return {
        fetch, log, users, docs, sessions,
        addUser(email, password, confirmed = true) { const usr = { id: 'u' + (users.size + 1), email, password, confirmed }; users.set(email, usr); return usr; },
        addDoc(userId, key, data) { const tb = docs.get(userId) || docs.set(userId, new Map()).get(userId); tb.set(key, { key, data, version: 1 }); },
        doc(userId, key) { const tb = docs.get(userId); return tb && tb.get(key) ? tb.get(key) : null; },
        bump(userId, key, data) { const tb = docs.get(userId) || docs.set(userId, new Map()).get(userId); const r = tb.get(key); if (r) { r.data = data; r.version += 1; } else tb.set(key, { key, data, version: 1 }); },
        removeDoc(userId, key) { const tb = docs.get(userId); if (tb) tb.delete(key); },
        opts,
        token(usr) { return issue(usr); }
    };
};
