/**
 * screens/stats/statsGames.js
 * ──────────────────────────────────────────────────────────────────────────
 * Statistiques › Parties : ce que disent vos parties Chess.com et Lichess (GameArchive), rapportées à votre répertoire.
 *   Vues Bilan, Temps, Qualité, Positions (statsInsights.js) et Répertoire ; les filtres sont dans la barre de contexte.
 *   Elo : une courbe par site et par cadence (choix mémorisé, Chess.com par défaut).
 *   Répertoire : score selon que vous l'avez suivi ou quitté (detectDeviation) ; lignes qui coûtent le plus de points.
 * Analyse de toute l'archive par petits lots, pour ne pas figer l'écran. Une archive d'une version antérieure est retéléchargée à l'ouverture.
 */

'use strict';

const StatsGames = (function () {
    const CHUNK = 40, ANALYZED_PLIES = 40, OPENINGS_SHOWN = 6, COSTS_SHOWN = 3;
    const SITE_NAME = GameArchive.SITE_NAME;
    const ERRORS = { user: 'Pseudo introuvable sur ce site.', limit: 'Le site demande de patienter une minute. Réessayez ensuite.', http: 'Connexion impossible. Réessayez.' };

    const st = { games: null, busy: false, got: 0, error: '', note: '', again: false, form: false, formSite: 'chesscom', scope: '', seen: new Map(), analysing: false, series: [] };
    const users = () => ({ chesscom: appSettings.chesscomUser.trim(), lichess: appSettings.lichessUser.trim() });
    const slot = () => document.getElementById('stats-games');
    const linked = () => Object.entries(users()).filter(([, u]) => u);
    const pct = v => `${v} %`;

    // ─── ANALYSE AVEC LE RÉPERTOIRE ──────────────────────────────────────────
    const count = c => Object.keys(readDBFor(currentRepertoire, c)).length;
    const scopeNow = () => `${currentRepertoire}|${count('w')}|${count('b')}`;

    // Mes positions du répertoire atteintes par une partie, de la première à la plus avancée (la position du coup quitté comprise).
    function reachedKeys(path, color, db, dev) {
        const out = [];
        let pos = Chess.start();
        path.forEach((u, i) => {
            if ((i % 2 === 0) === (color === 'w')) { const k = Chess.key(pos); if (db[k]) out.push(k); }
            pos = Chess.play(pos, u);
        });
        if (dev && dev.by === 'me' && db[dev.key]) out.push(dev.key);
        return out;
    }

    async function analyse() {
        if (st.analysing) { st.again = true; return; }
        if (!st.games || !st.games.length) return;
        const scope = scopeNow();
        if (scope !== st.scope) { st.scope = scope; st.seen = new Map(); }
        const todo = st.games.filter(g => !st.seen.has(g.id));
        if (!todo.length) return;
        st.analysing = true;
        paint();
        const base = { w: { db: readDBFor(currentRepertoire, 'w'), opp: readOppFor(currentRepertoire, 'w') }, b: { db: readDBFor(currentRepertoire, 'b'), opp: readOppFor(currentRepertoire, 'b') } };
        for (let i = 0; i < todo.length; i += CHUNK) {
            todo.slice(i, i + CHUNK).forEach(g => {
                const r = detectDeviation(g.sans.slice(0, ANALYZED_PLIES), g.color, base[g.color].db, base[g.color].opp, g.at);
                const path = r.moves.map(m => m.uci), d = r.deviation, name = openingNameOf(path), kept = d ? path.slice(0, d.by === 'opp' ? d.ply + 1 : d.ply) : path;
                st.seen.set(g.id, { family: name ? name.name.split(' · ')[0] : '', op: name ? { name: name.name, path: name.path } : null, dev: d && !d.treated ? d : null, path: kept,
                                    mine: reachedKeys(kept, g.color, base[g.color].db, d), played: d && d.by === 'me' ? r.moves[d.ply] : null });
            });
            await new Promise(r => setTimeout(r));
        }
        st.analysing = false;
        paint();
        Bus.emit('games:analysed');
        if (st.again) { st.again = false; analyse(); }
    }

    // ─── RÉCUPÉRATION ────────────────────────────────────────────────────────
    // Lance une récupération sur chaque compte relié ; pull : GameArchive.sync ou backfill. Renvoie le nombre de parties écrites.
    async function run(pull) {
        if (st.busy) return 0;
        const list = linked();
        if (!list.length) return 0;
        st.busy = true; st.got = 0; st.error = ''; st.note = ''; paint();
        let added = 0, before = 0;
        try {
            for (const [site, user] of list) {
                added += await pull(site, user, n => { st.got = before + n; paint(); });
                before = st.got;
            }
        } catch (e) { st.error = ERRORS[e.message] || ERRORS.http; }
        st.games = await GameArchive.all();
        st.busy = false; st.form = false;
        paint();
        analyse();
        StatsInsights.pump();
        return added;
    }
    const sync = () => run(GameArchive.sync);
    async function backfill() {
        const added = await run(GameArchive.backfill);
        if (st.error) return;
        st.note = added ? _plural(added, 'partie ajoutée', 'parties ajoutées') : "Tout l'historique est déjà chargé.";
        paint();
    }

    // ─── RENDU ───────────────────────────────────────────────────────────────
    const dayLabel = t => I18n.mark(new Date(t).toLocaleDateString(I18n.locale(), { day: 'numeric', month: 'short', year: 'numeric' }));

    function chart(series) {
        st.series = series;
        if (series.length < 2) return '<p class="st-sub">Pas assez de parties classées sur cette période pour tracer une courbe.</p>';
        const W = 300, H = 118, L = 4, R = 36, T = 10, B = 18, vals = series.map(p => p.r);
        const lo = Math.floor(Math.min(...vals) / 50) * 50, hi = Math.max(lo + 50, Math.ceil(Math.max(...vals) / 50) * 50);
        const x = i => L + i * (W - L - R) / (series.length - 1), y = v => T + (hi - v) * (H - T - B) / (hi - lo);
        const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join('');
        const end = series.length - 1, dateOf = dayLabel;
        return `<div class="st-trend sg-chart" data-sg-chart><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${I18n.pair(I18n.t('Elo'), `${series[0].r} → ${series[end].r}`)}">
            ${[lo, (lo + hi) / 2, hi].map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${W - R + 4}" y="${y(v) + 3}">${Math.round(v)}</text>`).join('')}
            <path class="ar" d="${line}L${x(end)},${H - B}L${x(0)},${H - B}Z"/><path class="ln" d="${line}"/><circle class="pt end" cx="${x(end)}" cy="${y(series[end].r)}" r="3.5"/>
            <line class="sg-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" hidden/>
            <text class="ax" x="${L}" y="${H - 4}">${dateOf(series[0].at)}</text><text class="ax" x="${W - R}" y="${H - 4}" text-anchor="end">${dateOf(series[end].at)}</text></svg><span class="sg-tip" hidden></span></div>`;
    }

    function formHTML() {
        const site = st.formSite, u = users()[site];
        return `<div class="sg-form">
            <div class="tr-seg online-seg" role="radiogroup" aria-label="Site">${Object.entries(SITE_NAME).map(([id, name]) =>
                `<button type="button" class="tr-seg-btn${site === id ? ' active' : ''}" role="radio" aria-checked="${site === id}" data-action="statsGamesFormSite" data-arg="${id}">${name}</button>`).join('')}</div>
            <label class="online-field">${ico('user')}<input id="sg-user" class="online-input" type="text" autocomplete="username" spellcheck="false" autocapitalize="off" value="${escapeHtml(u)}" placeholder="Pseudo ${SITE_NAME[site]}" aria-label="Pseudo ${SITE_NAME[site]}"></label>
            ${st.error ? `<p class="sg-err" role="alert">${escapeHtml(st.error)}</p>` : ''}
            <button type="button" class="btn btn-soft" data-action="statsGamesSave">${ico('download')}Charger mes parties</button>
        </div>`;
    }

    const wdl = (name, t) => `<div class="sg-wdl"><span class="sg-wdl-n">${escapeHtml(name)}<small>${_plural(t.n, 'partie')}</small></span>
        <span class="sg-bar" role="img" aria-label="${I18n.mark(`${t.w} / ${t.d} / ${t.l}`)}">${[['w', t.w], ['d', t.d], ['l', t.l]].filter(([, n]) => n).map(([k, n]) => `<i class="sg-${k}" style="flex:${n}">${n}</i>`).join('')}</span><b>${pct(t.score)}</b></div>`;

    function eloHTML() {
        const level = GameArchive.level();
        if (!level) return '';
        const { site, speed, speeds } = level, mine = st.games.filter(g => g.site === site);
        // La courbe, l'écart, le score et la précision suivent la période de la barre de filtres.
        const from = StatsInsights.since(), all = GameArchive.eloSeries(mine, speed);
        if (!all.length) return '';
        const series = all.filter(p => p.at >= from), last = all[all.length - 1];
        const before = all.filter(p => p.at < from).pop() || series[0] || last, delta = last.r - before.r;
        const dTxt = `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}`, months = StatsInsights.period();
        const deltaLabel = months ? `${dTxt} sur ${months} mois` : `${dTxt} sur tout l'historique`;
        const inPeriod = mine.filter(g => g.speed === speed && g.at >= from);
        const inSpeed = GameArchive.tally(inPeriod);
        const acc = inPeriod.filter(g => Number.isFinite(g.accuracy));
        return `<div class="sg-head"><h4>Elo</h4><span class="st-sub">${SITE_NAME[site]} · ${(speeds.find(([s]) => s === speed) || ['', speed])[1]}</span></div>
            <div class="st-reg-kpis"><div><b>${last.r}</b><span>${deltaLabel}</span></div><div><b>${pct(inSpeed.score)}</b><span>${_plural(inSpeed.n, 'partie')}</span></div></div>
            ${chart(series)}
            ${acc.length >= 5 ? `<p class="st-sub">Précision moyenne ${pct(Math.round(acc.reduce((a, g) => a + g.accuracy, 0) / acc.length))} sur ${_plural(acc.length, 'partie analysée', 'parties analysées')}</p>` : ''}`;
    }

    function repertoireHTML() {
        const rows = st.games.map(g => ({ g, a: st.seen.get(g.id) })).filter(r => r.a && StatsInsights.keep(r.g));
        if (!rows.length) return st.analysing ? '<p class="st-sub">Comparaison avec votre répertoire…</p>' : '';
        const kept = GameArchive.tally(rows.filter(r => !r.a.dev || r.a.dev.by !== 'me').map(r => r.g)), left = GameArchive.tally(rows.filter(r => r.a.dev && r.a.dev.by === 'me').map(r => r.g));
        const fam = {};
        rows.forEach(r => { const k = r.a.family || 'Autres positions'; (fam[k] = fam[k] || []).push(r.g); });
        const openings = Object.entries(fam).sort((a, b) => b[1].length - a[1].length).slice(0, OPENINGS_SHOWN);
        const groups = {};
        rows.filter(r => r.a.dev).forEach(r => { const k = r.g.color + '|' + r.a.path.join(' '); (groups[k] = groups[k] || { color: r.g.color, path: r.a.path, by: r.a.dev.by, family: r.a.family, list: [] }).list.push(r.g); });
        st.costs = Object.values(groups).filter(c => c.list.length >= 2).map(c => ({ ...c, t: GameArchive.tally(c.list) })).filter(c => c.t.score < 50).sort((a, b) => (b.t.n * (100 - b.t.score)) - (a.t.n * (100 - a.t.score))).slice(0, COSTS_SHOWN);
        const color = c => GameArchive.tally(rows.filter(r => r.g.color === c).map(r => r.g));
        const gap = f => GameArchive.tally(rows.filter(r => Number.isFinite(r.g.opp) && f((r.g.opp0 ?? r.g.opp) - (r.g.me0 ?? r.g.me))).map(r => r.g));
        const tile = (l, t) => t.n ? `<div><small>${l}</small><b>${pct(t.score)}</b><span>${_plural(t.n, 'partie')}</span></div>` : '';
        return `<div class="sg-head"><h4>Votre répertoire</h4></div>
            <div class="sg-tiles">${tile('Répertoire suivi', kept)}${tile('Vous êtes sorti du répertoire', left)}</div>
            <div class="sg-head"><h4>Par famille d'ouverture</h4><span class="sg-leg"><i class="sg-w"></i>Gains <i class="sg-d"></i>Nulles <i class="sg-l"></i>Pertes</span></div>
            ${openings.map(([k, list]) => wdl(k, GameArchive.tally(list))).join('')}
            ${st.costs.length ? `<div class="sg-head"><h4>Ce qui vous coûte le plus</h4></div>${st.costs.map((c, i) => `<button type="button" class="sg-cost" data-action="statsGameLine" data-arg="${i}"><span><b>${c.family ? escapeHtml(c.family) : 'Autres positions'}</b><small>${_movesLabel(c.path.slice(-6), true) || ''}</small><small>${c.by === 'me' ? 'Votre coup sort du répertoire' : 'Réponse manquante'} · ${_plural(c.t.n, 'partie')} · ${pct(c.t.score)}</small></span>${ico('chevron-right')}</button>`).join('')}` : ''}
            <div class="sg-head"><h4>Selon la couleur et l'adversaire</h4></div>
            <div class="sg-tiles">${tile('Blancs', color('w'))}${tile('Noirs', color('b'))}${tile('Adversaire +50 Elo ou plus', gap(d => d > 50))}${tile('Adversaire −50 Elo ou moins', gap(d => d < -50))}</div>`;
    }

    function content() {
        const refresh = linked().length ? `<button type="button" class="st-ibtn" data-action="statsGamesSync" ${st.busy ? 'disabled' : ''} title="Mettre à jour" aria-label="Mettre à jour">${ico('rotate-ccw')}</button>` : '';
        const head = `<div class="st-h"><h3>Parties</h3>${st.games && st.games.length ? `<span class="st-sub">${_plural(st.games.length, 'partie')}</span>` : ''}${refresh}</div>`;
        if (st.games === null) return head + '<p class="st-sub">Chargement…</p>';
        if (st.busy) return head + `<p class="st-sub" role="status">Récupération des parties… ${st.got}</p>`;
        if (!st.games.length || st.form || !linked().length) return `${head}<p class="st-sub">Reliez un compte pour suivre votre Elo et vos résultats face à votre répertoire.</p>${formHTML()}`;
        const other = Object.keys(SITE_NAME).find(s => !users()[s]);
        const view = StatsInsights.view(), done = analysed();
        return `${head}${st.error ? `<p class="sg-err" role="alert">${escapeHtml(st.error)}</p>` : ''}${StatsInsights.viewsHTML()}
            ${view === 'bilan' ? eloHTML() : ''}${view === 'repertoire' ? repertoireHTML() : `<div id="si-view">${StatsInsights.viewHTML(st.games, done)}</div>`}
            ${st.note ? `<p class="st-sub" role="status">${escapeHtml(st.note)}</p>` : ''}
            <button type="button" class="st-link sg-add" data-action="statsGamesBackfill">Charger tout l'historique</button>
            ${other ? `<button type="button" class="st-link sg-add" data-action="statsGamesForm" data-arg="${other}">${SITE_NAME[other]} : ajouter un compte</button>` : ''}`;
    }

    // Repeint la section, puis ce qui autour dépend des parties : filtres de la barre, constats, compteurs d'onglets.
    function paint() { const s = slot(); if (s) { s.innerHTML = content(); statsSyncChrome(); } }

    // Appelé après chaque rendu des Statistiques.
    async function mount() {
        if (st.games === null) {
            st.games = await GameArchive.all();
            paint();
            if ((!st.games.length || GameArchive.outdated(st.games)) && linked().length && !(typeof Net !== 'undefined' && !Net.online())) sync();
        }
        analyse();
        StatsInsights.pump();
    }

    // ─── ACTIONS ─────────────────────────────────────────────────────────────
    function save() {
        const input = document.getElementById('sg-user');
        const value = input ? input.value.trim() : '';
        if (!value) { st.error = 'Saisissez un pseudo.'; paint(); return; }
        setPref(st.formSite === 'lichess' ? 'lichessUser' : 'chesscomUser', value);
        sync();
    }
    registerActions({
        statsGamesFormSite: s => { st.formSite = s; st.error = ''; paint(); },
        statsGamesForm: s => { st.formSite = s; st.form = true; st.error = ''; paint(); },
        statsGamesSave: save,
        statsGamesSync: sync,
        statsGamesBackfill: backfill,
        statsGameLine: i => { const c = st.costs && st.costs[Number(i)]; if (c) statsOpenLine(c.color, c.path); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'sg-user') save(); });
    document.addEventListener('pointermove', e => {
        const box = e.target.closest && e.target.closest('[data-sg-chart]');
        if (!box || st.series.length < 2) return;
        const r = box.getBoundingClientRect(), W = 300, L = 4, R = 36, fx = (e.clientX - r.left) / r.width * W;
        const i = Math.max(0, Math.min(st.series.length - 1, Math.round((fx - L) / (W - L - R) * (st.series.length - 1))));
        const px = L + i * (W - L - R) / (st.series.length - 1), line = box.querySelector('.sg-cross'), tip = box.querySelector('.sg-tip');
        line.removeAttribute('hidden'); line.setAttribute('x1', px); line.setAttribute('x2', px);
        tip.hidden = false;
        tip.textContent = I18n.mark(`${dayLabel(st.series[i].at)} · ${st.series[i].r}`);
        tip.style.left = `${Math.max(0, Math.min(r.width - tip.offsetWidth, px / W * r.width - tip.offsetWidth / 2))}px`;
    });

    Bus.on('elo:choice', paint);          // choix changé depuis Compte

    // Parties déjà croisées avec le répertoire actif ; vide tant que l'analyse de ce répertoire n'a pas commencé.
    function analysed() {
        if (!st.games || st.scope !== scopeNow()) return [];
        return st.games.map(g => ({ g, a: st.seen.get(g.id) })).filter(r => r.a);
    }
    const pending = () => st.games === null || st.analysing || st.busy;

    return { content, mount, analysed, pending, repaint: paint, games: () => st.games };
})();
