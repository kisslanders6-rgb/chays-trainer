/**
 * screens/stats/statsInsights.js
 * ──────────────────────────────────────────────────────────────────────────
 * Statistiques › Parties : filtres communs (période, site, cadence), posés dans la barre de contexte de l'onglet à côté de la
 * couleur, et lus aussi par Ouvertures et par « À faire » ; vues Bilan, Temps, Qualité et Positions.
 * Qualité : Stockfish évalue les parties pendant que la vue est ouverte et visible (GameEval), Chess.com d'abord ; les résultats sont gardés.
 * Choisir un site ou une cadence règle aussi la courbe d'Elo (préférences eloSite, eloSpeed). Calculs : GameInsights, OpeningReport.
 * Période, site et cadence sont retrouvés au prochain lancement (chessTrainer_gameFilters, propre à l'appareil).
 * Chaque carte répond à une question et le dit en une phrase ; une phrase n'apparaît qu'avec assez de parties (GameInsights.MIN).
 */

'use strict';

const StatsInsights = (function () {
    const MIN = GameInsights.MIN, SPEEDS = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', classical: 'Classique', daily: 'Par correspondance' };
    const FILTERS_KEY = 'chessTrainer_gameFilters';
    function readFilters() {
        const s = dataStore.getJSON(FILTERS_KEY, null) || {};
        return { period: [0, 3, 6, 12].includes(s.period) ? s.period : 12, site: GameArchive.SITE_NAME[s.site] ? s.site : 'all', speed: SPEEDS[s.speed] ? s.speed : 'all' };
    }
    const st = { ...readFilters(), view: 'bilan', paused: false, evalError: '', shown: 0 };
    const saveFilters = () => dataStore.setJSON(FILTERS_KEY, { period: st.period, site: st.site, speed: st.speed });
    const pct = v => `${Math.round(v)} %`;
    const signed = v => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`;
    const num1 = v => v.toLocaleString(I18n.locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const fair = t => t.n >= MIN;
    const delta = d => d === null ? '–' : `<span class="so-delta ${d >= 0 ? 'up' : 'down'}"><i aria-hidden="true">${d >= 0 ? '▲' : '▼'}</i>${I18n.mark(`${d >= 0 ? '+' : '−'}${num1(Math.abs(d))} pt`)}</span>`;
    const card = (cls, title, take, inner) => `<div class="so-card ${cls}"><h5>${title}</h5>${take ? `<p class="st-sub">${take}</p>` : ''}${inner}</div>`;
    const legend = items => `<div class="so-leg">${items.map(([c, l]) => `<span><i class="${c}"></i>${l}</span>`).join('')}</div>`;
    const tile = (label, value, sub) => `<div><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
    const hbar = (label, v, n) => `<div class="si-hbar"><span>${label}</span><span class="si-track"><i style="width:${Math.max(1, Math.min(100, v))}%"></i></span><b>${pct(v)}</b>${n === undefined ? '' : `<small>${n}</small>`}</div>`;

    // ─── FILTRES ─────────────────────────────────────────────────────────────
    function since() {
        if (!st.period) return 0;
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth() - st.period + 1, 1).getTime();
    }
    // anyTime : sans la période (la fiche d'ouverture garde toutes les parties pour les rattacher, et date elle-même).
    const keeper = anyTime => { const from = anyTime ? 0 : since(); return g => g.at >= from && (st.site === 'all' || g.site === st.site) && (st.speed === 'all' || g.speed === st.speed) && (statsColor === 'all' || g.color === statsColor); };
    const keep = (g, anyTime) => keeper(anyTime)(g);

    // Période, site et cadence : dans la barre de contexte des Statistiques (#stats-filters).
    function filtersHTML(games) {
        const sites = [...new Set(games.map(g => g.site))], speeds = Object.keys(SPEEDS).filter(s => games.some(g => g.speed === s));
        // Un choix gardé sans partie correspondante (compte retiré) n'enferme pas sur une page vide, et reste écrit pour le jour où il revient.
        if (!sites.includes(st.site)) st.site = 'all';
        if (!speeds.includes(st.speed)) st.speed = 'all';
        const dd = (value, action, aria, options, cls) => dropdownHTML({ value, action, aria, options, cls: `dd-sm ${cls || ''}` });
        return `<div class="si-bar">
            ${dd(String(st.period), 'statsInPeriod', 'Période', [['3', '3 mois'], ['6', '6 mois'], ['12', '12 mois'], ['0', 'Tout']])}
            ${sites.length > 1 ? dd(st.site, 'statsInSite', 'Site', [['all', 'Tous les sites'], ...sites.map(s => [s, GameArchive.SITE_NAME[s]])]) : ''}
            ${speeds.length > 1 ? dd(st.speed, 'statsInSpeed', 'Cadence', [['all', 'Toutes les cadences'], ...speeds.map(s => [s, SPEEDS[s]])], 'dd-end') : ''}
        </div>`;
    }

    function viewsHTML() {
        return `<div class="tr-seg si-views" role="group" aria-label="Vue">${[['bilan', 'Bilan'], ['temps', 'Temps'], ['qualite', 'Qualité'], ['positions', 'Positions'], ['repertoire', 'Répertoire']].map(([v, l]) => `<button type="button" class="tr-seg-btn${st.view === v ? ' active' : ''}" aria-pressed="${st.view === v}" data-action="statsInView" data-arg="${v}">${l}</button>`).join('')}</div>`;
    }

    // ─── GRAPHIQUES ──────────────────────────────────────────────────────────
    const monthName = t => I18n.mark(new Date(t).toLocaleDateString(I18n.locale(), { month: 'short' }));

    function perfChart(months) {
        const pts = months.filter(m => m.perf !== null);
        if (pts.length < 2) return '<p class="st-sub">Pas encore assez de mois joués.</p>';
        const W = 300, H = 118, L = 4, R = 36, T = 10, B = 18, vals = pts.map(p => p.perf), lo = Math.floor(Math.min(...vals) / 50) * 50, hi = Math.max(lo + 50, Math.ceil(Math.max(...vals) / 50) * 50);
        const x = i => L + i * (W - L - R) / Math.max(1, months.length - 1), y = v => T + (hi - v) * (H - T - B) / (hi - lo), at = m => months.indexOf(m);
        const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(at(p)).toFixed(1)},${y(p.perf).toFixed(1)}`).join(''), end = pts[pts.length - 1];
        return `<div class="st-trend"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${I18n.pair(I18n.t('Performance'), `${pts[0].perf} → ${end.perf}`)}">
            ${[lo, (lo + hi) / 2, hi].map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${W - R + 4}" y="${y(v) + 3}">${Math.round(v)}</text>`).join('')}
            <path class="ln" d="${line}"/>${pts.map(p => `<circle class="pt${p === end ? ' end' : ''}" cx="${x(at(p))}" cy="${y(p.perf)}" r="${p === end ? 3.5 : 2.5}"><title>${I18n.mark(`${monthName(p.at)} · ${p.perf} · ${p.n}`)}</title></circle>`).join('')}
            <text class="ax" x="${L}" y="${H - 4}">${monthName(months[0].at)}</text><text class="ax" x="${W - R}" y="${H - 4}" text-anchor="end">${monthName(months[months.length - 1].at)}</text></svg></div>`;
    }

    // Barres de score sur 0-100 %, avec le score attendu en repère s'il est connu.
    function scoreBars(items) {
        const W = 360, H = 150, L = 4, R = 34, T = 14, B = 22, band = (W - L - R) / items.length, bw = Math.min(34, band * .6), y = v => T + (100 - v) * (H - T - B) / 100;
        let g = [0, 50, 100].map(v => `<line class="${v ? 'g' : 'b'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${W - R + 5}" y="${y(v) + 3}">${v} %</text>`).join('');
        items.forEach(({ label, t }, i) => {
            const x = L + band * i + (band - bw) / 2;
            g += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${label}</text>`;
            if (!t.n) return;
            const top = y(t.score), r = Math.min(3, y(0) - top);
            g += `<g><title>${I18n.mark(`${label} · ${t.n} · ${Math.round(t.score)} %${t.expected === null ? '' : ` / ${Math.round(t.expected)} %`}`)}</title><path class="so-bar-real" d="M${x},${y(0)}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${y(0)}Z"/>${t.expected === null ? '' : `<line class="so-exp" x1="${x - 3}" x2="${x + bw + 3}" y1="${y(t.expected)}" y2="${y(t.expected)}"/>`}<text class="v" x="${x + bw / 2}" y="${top - 4}" text-anchor="middle">${Math.round(t.score)}</text></g>`;
        });
        return `<svg class="so-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score par tranche">${g}</svg>`;
    }

    function heatHTML(h) {
        const days = [0, 1, 2, 3, 4, 5, 6].map(d => I18n.mark(new Date(2024, 0, 1 + d).toLocaleDateString(I18n.locale(), { weekday: 'short' })));
        const slots = ['0-4', '4-8', '8-12', '12-16', '16-20', '20-24'];
        const color = t => t.n < MIN ? '' : `background:color-mix(in oklab, ${t.score >= 50 ? 'var(--new)' : 'var(--lv-fragile)'} ${Math.min(100, Math.abs(t.score - 50) * 6)}%, var(--bg-inset))`;
        const text = c => `${days[c.day]}, ${slots[c.slot]} h`;
        const take = h.best && h.worst ? `Meilleur créneau : ${text(h.best)} (${pct(h.best.t.score)}). Le moins bon : ${text(h.worst)} (${pct(h.worst.t.score)}).` : 'Il faut plus de parties par créneau pour comparer.';
        return card('so-c6', 'Quand jouez-vous le mieux ?', take, `<div class="si-heat" role="img" aria-label="Score par jour et par tranche horaire"><span></span>${slots.map(s => `<span>${s}</span>`).join('')}${h.grid.map((row, d) => `<span class="d">${days[d]}</span>${row.map((t, s) => `<i style="${color(t)}" title="${I18n.mark(`${days[d]}, ${slots[s]} h · ${t.n} · ${t.n ? pct(t.score) : '–'}`)}"></i>`).join('')}`).join('')}</div><div class="si-ramp">Sous 50 % <i></i> Au-dessus</div>`);
    }

    function clockChart(curve, exitMove) {
        const pts = curve.points, W = 360, H = 170, L = 4, R = 72, T = 10, B = 22, last = pts[pts.length - 1].move, top = Math.max(100, ...pts.map(p => Math.max(p.me, p.opp)));
        const x = m => L + (m - 1) * (W - L - R) / Math.max(1, last - 1), y = v => T + (top - v) * (H - T - B) / top;
        const path = k => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.move).toFixed(1)},${y(p[k]).toFixed(1)}`).join(''), end = pts[pts.length - 1], near = Math.abs(y(end.me) - y(end.opp)) < 14, nudge = near ? 7 : 0, high = end.me >= end.opp;
        let g = [0, 50, 100].map(v => `<line class="${v ? 'g' : 'b'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L + 2}" y="${y(v) - 3}">${v} %</text>`).join('');
        if (exitMove && exitMove <= last) g += `<line class="b" x1="${x(exitMove)}" x2="${x(exitMove)}" y1="${T}" y2="${H - B}"/><text x="${x(exitMove) + 4}" y="${T + 9}">Sortie du répertoire</text>`;
        g += `<path class="si-line opp" d="${path('opp')}"/><path class="si-line me" d="${path('me')}"/><circle class="si-dot opp" cx="${x(last)}" cy="${y(end.opp)}" r="4"/><circle class="si-dot me" cx="${x(last)}" cy="${y(end.me)}" r="4"/>
            <text class="v" x="${x(last) + 8}" y="${y(end.me) + 3 + (high ? -nudge : nudge)}">Vous</text><text class="v" x="${x(last) + 8}" y="${y(end.opp) + 3 + (high ? nudge : -nudge)}">Adversaire</text>`;
        const step = last > 40 ? 20 : 10;
        for (let m = step; m <= last; m += step) g += `<text x="${x(m)}" y="${H - 6}" text-anchor="middle">${m}</text>`;
        pts.forEach(p => { g += `<rect x="${x(p.move) - 3}" y="${T}" width="6" height="${H - T - B}" fill="transparent"><title>${I18n.mark(`${p.move} · ${Math.round(p.me)} % / ${Math.round(p.opp)} %`)}</title></rect>`; });
        return `<svg class="so-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Temps restant par coup">${g}</svg>`;
    }

    function volumeCharts(v) {
        const W = 360, L = 4, R = 4, band = (W - L - R) / v.months.length, bw = band * .62, maxN = Math.max(1, ...v.months.map(m => m.n)), maxD = Math.max(10, ...v.months.map(m => Math.abs(m.delta || 0)));
        const every = v.months.length > 6 ? 2 : 1;
        const top = 60, topBars = v.months.map((m, i) => { const h = m.n * (top - 4) / maxN, x = L + band * i + (band - bw) / 2; return m.n ? `<rect class="so-bar-real" x="${x}" y="${top - h}" width="${bw}" height="${h}" rx="2"><title>${I18n.mark(`${monthName(m.at)} · ${m.n}`)}</title></rect>` : ''; }).join('');
        const mid = 34, delta = v.months.map((m, i) => { if (m.delta === null) return ''; const h = Math.max(1, Math.abs(m.delta) * 30 / maxD), x = L + band * i + (band - bw) / 2; return `<rect class="${m.delta >= 0 ? 'so-bar-real' : 'so-bar-me'}" x="${x}" y="${m.delta >= 0 ? mid - h : mid}" width="${bw}" height="${h}" rx="2"><title>${I18n.mark(`${monthName(m.at)} · ${signed(m.delta)}`)}</title></rect>`; }).join('');
        const ticks = v.months.map((m, i) => (v.months.length - 1 - i) % every ? '' : `<text x="${L + band * i + band / 2}" y="82" text-anchor="middle">${monthName(m.at)}</text>`).join('');
        return `<p class="si-cap">Parties par mois</p><svg class="so-chart" viewBox="0 0 ${W} ${top + 2}" role="img" aria-label="Parties par mois"><line class="b" x1="${L}" x2="${W - R}" y1="${top}" y2="${top}"/>${topBars}</svg>
            <p class="si-cap">Variation d'Elo</p><svg class="so-chart" viewBox="0 0 ${W} 88" role="img" aria-label="Variation d'Elo par mois"><line class="b" x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}"/>${delta}${ticks}</svg>`;
    }

    // ─── BILAN ───────────────────────────────────────────────────────────────
    function bilanHTML(games, list) {
        if (list.length < MIN) return '<p class="st-sub">Trop peu de parties avec ces filtres.</p>';
        const s = OpeningReport.summarize(list), months = OpeningReport.months(list, st.period || 12, Date.now());
        const LABEL = ['+150', '+50/+150', '±50', '−150/−50', '−150'], gaps = GameInsights.byGap(list).map((t, i) => ({ label: LABEL[i], t }));
        const worst = gaps.filter(x => fair(x.t) && x.t.delta !== null).sort((a, b) => a.t.delta - b.t.delta)[0];
        const gapTake = worst && worst.t.delta < -2 ? `Votre plus gros manque : écart ${worst.label}, ${pct(worst.t.score)} au lieu de ${pct(worst.t.expected)} attendus.` : 'Vous tenez ce que votre Elo prédit, quel que soit l\'adversaire.';
        const se = GameInsights.sessions(list), rankNames = ['1re partie', '2e partie', '3e partie', '4e partie', '5e et plus'], afterNames = ['Après 1 défaite', 'Après 2 défaites', 'Après 3 et plus'];
        const first = se.ranks[0], fifth = se.ranks[4];
        const sessionTake = fair(first) && fair(fifth) ? `Votre score passe de ${pct(first.score)} à la première partie à ${pct(fifth.score)} à partir de la cinquième.` : `Sessions sur la période : ${se.count}.`;
        const bars = (names, list2) => names.map((n, i) => fair(list2[i]) ? hbar(n, list2[i].score, list2[i].n) : '').join('');
        const en = GameInsights.ends(list), endRows = [['resign', 'Abandon'], ['mate', 'Mat'], ['time', 'Temps'], ['abandon', 'Forfait'], ['other', 'Autre']];
        const endBars = part => endRows.filter(([k]) => part[k] >= .5).sort((a, b) => part[b[0]] - part[a[0]]).map(([k, l]) => hbar(l, part[k])).join('');
        const scope = eloScope(games), vol = scope.length ? GameInsights.volume(scope, st.period || 12, Date.now()) : null;
        const volTake = vol && vol.high !== null ? `Vos mois les plus joués rapportent ${signed(vol.high)} Elo en moyenne, les autres ${signed(vol.low)}.` : 'Il faut quatre mois joués au moins pour comparer.';
        return `<div class="so-kpis">
                <div class="so-card so-kpi"><span>Score</span><b>${pct(s.score)}</b><small>${_plural(s.n, 'partie')}</small></div>
                <div class="so-card so-kpi"><span>Face à l'attendu</span><b>${delta(s.delta)}</b><small>${s.expected === null ? 'Elo inconnu' : `Attendu : ${pct(s.expected)}`}</small></div>
                <div class="so-card so-kpi"><span>Performance</span><b>${s.perf === null ? '–' : s.perf}</b><small>Elo équivalent</small></div>
                <div class="so-card so-kpi"><span>Gains</span><b>${s.w}</b><small>${_plural(s.d, 'nulle')} · ${_plural(s.l, 'perte')}</small></div>
            </div>
            <div class="so-grid">
                ${card('so-c6', 'Votre niveau mois par mois', '', perfChart(months))}
                ${card('so-c6', 'Contre qui perdez-vous des points ?', gapTake, `${legend([['so-bar-real', 'Score réel'], ['so-exp', 'Score attendu']])}${scoreBars(gaps)}<p class="si-cap">Elo de l'adversaire moins le vôtre</p>`)}
                ${heatHTML(GameInsights.heat(list))}
                ${card('so-c6', 'Savez-vous vous arrêter ?', sessionTake, `${bars(rankNames, se.ranks)}${se.after.some(fair) ? `<p class="si-cap">Juste après des défaites</p>${bars(afterNames, se.after)}` : ''}`)}
                ${en.wins.n + en.losses.n ? card('so-c6', 'Comment finissent vos parties ?', en.losses.n && en.wins.n ? `Le temps décide ${pct(en.losses.time)} de vos défaites et ${pct(en.wins.time)} de vos gains.` : '', `<div class="si-two"><div><h6>Gains</h6>${endBars(en.wins)}</div><div><h6>Défaites</h6>${endBars(en.losses)}</div></div>`) : ''}
                ${vol ? card('so-c6', 'Jouer plus vous fait-il monter ?', volTake, volumeCharts(vol)) : ''}
            </div>`;
    }

    // Parties de la courbe d'Elo affichée : site et cadence du niveau choisi.
    function eloScope(games) {
        const level = GameArchive.level();
        return level ? games.filter(g => g.site === level.site && g.speed === level.speed && keep({ ...g, site: st.site === 'all' ? g.site : st.site, speed: st.speed === 'all' ? g.speed : st.speed })) : [];
    }

    function recordsHTML(games) {
        const level = GameArchive.level();
        if (!level) return '';
        const r = GameInsights.records(games.filter(g => g.site === level.site && g.speed === level.speed));
        if (!r) return '';
        const date = I18n.mark(new Date(r.bestAt).toLocaleDateString(I18n.locale(), { day: 'numeric', month: 'short', year: 'numeric' }));
        return `<div class="sg-tiles si-rec">${tile('Meilleur Elo', r.best, date)}${tile('Plus longue série', r.streak, 'gains d\'affilée')}${tile('Plus forte baisse', r.drop ? `−${r.drop}` : '0', 'depuis un sommet')}</div>`;
    }

    // ─── TEMPS ───────────────────────────────────────────────────────────────
    function tempsHTML(list, rows) {
        const curve = GameInsights.timeCurve(list);
        if (curve.points.length < 5) return '<p class="st-sub">Pas assez de parties avec horloge pour ces filtres. Les parties par correspondance n\'en ont pas.</p>';
        const exit = GameInsights.exitClock(rows), z = GameInsights.zeitnot(list), lead = GameInsights.leadAtMove(list), th = GameInsights.thinking(rows);
        const exitMove = rows.length ? Math.max(1, Math.round(rows.reduce((a, r) => a + r.a.path.length, 0) / rows.length / 2)) : 0;
        const at20 = curve.points.find(p => p.move === GameInsights.LEAD_MOVE);
        const LABEL = ['−20', '−20/−5', '±5', '+5/+20', '+20'], bars = lead.map((t, i) => ({ label: LABEL[i], t: { ...t, expected: null } }));
        const behind = lead[0], ahead = lead[4];
        return `<div class="so-grid">
            ${card(exit.n >= MIN ? 'so-c7' : 'so-c12 si-cap-w', 'Où dépensez-vous votre temps ?', at20 ? `Au coup ${at20.move}, il vous reste ${pct(at20.me)} de votre temps, contre ${pct(at20.opp)} à vos adversaires.` : '', `${legend([['si-key me', 'Vous'], ['si-key opp', 'Adversaire']])}${clockChart(curve, exitMove)}<p class="si-cap">Temps restant en % du temps initial, par numéro de coup</p>`)}
            ${exit.n >= MIN ? card('so-c5', 'Votre préparation vous fait-elle gagner du temps ?', `À la sortie du répertoire, votre horloge a ${signed(exit.lead)} points de temps face à l'adversaire.`, `<div class="sg-tiles">${tile('Avance moyenne', `${signed(exit.lead)} %`, 'du temps initial')}${fair(exit.ahead) ? tile('Score en avance', pct(exit.ahead.score), _plural(exit.ahead.n, 'partie')) : ''}${fair(exit.behind) ? tile('Score en retard', pct(exit.behind.score), _plural(exit.behind.n, 'partie')) : ''}</div>`) : ''}
            ${card('so-c6', 'Tombez-vous en zeitnot ?', z.share === null ? '' : `${pct(z.share)} de vos coups sont joués sous 10 % du temps, ${pct(z.oppShare)} chez vos adversaires.`, `<div class="sg-tiles">${fair(z.withIt) ? tile('Score avec zeitnot', pct(z.withIt.score), _plural(z.withIt.n, 'partie')) : ''}${fair(z.without) ? tile('Score sans zeitnot', pct(z.without.score), _plural(z.without.n, 'partie')) : ''}</div>`)}
            ${card('so-c6', 'Le temps au coup 20 compte-t-il ?', fair(behind) && fair(ahead) ? `En retard d'au moins 20 points : ${pct(behind.score)}. En avance d'autant : ${pct(ahead.score)}.` : '', `${scoreBars(bars)}<p class="si-cap">Votre temps moins celui de l'adversaire, en points</p>`)}
            ${th.n >= MIN ? card('so-c12', 'Réfléchissez-vous quand la préparation s\'arrête ?', `Premier coup hors répertoire : ${num1(th.first)} s, contre ${num1(th.usual)} s ensuite.`, `<div class="sg-tiles">${tile('Premier coup', `${num1(th.first)} s`)}${tile('Coups suivants', `${num1(th.usual)} s`)}${fair(th.thought) ? tile('Score en réfléchissant', pct(th.thought.score), _plural(th.thought.n, 'partie')) : ''}${fair(th.quick) ? tile('Score en jouant vite', pct(th.quick.score), _plural(th.quick.n, 'partie')) : ''}</div>`) : ''}
        </div>`;
    }

    // ─── QUALITÉ ─────────────────────────────────────────────────────────────
    const fmt1 = v => v === null ? '–' : num1(v);
    const pawn = cp => I18n.mark(`${cp >= 0 ? '+' : '−'}${num1(Math.abs(cp) / 100)}`);

    function evalBarHTML(games) {
        const left = GameEval.pending(games).length, total = games.filter(g => g.ev || g.sans.length >= 8).length, done = total - left;
        if (!left) return `<p class="st-sub si-eval" id="si-eval">Toutes vos parties sont analysées (Stockfish, profondeur ${GameEval.DEPTH}).</p>`;
        return `<div class="so-card si-eval" id="si-eval"><div class="si-eval-h"><b>Analyse Stockfish</b><span>${done} / ${total}</span>
                <button type="button" class="st-link" data-action="statsInEval">${st.paused ? 'Reprendre' : 'Mettre en pause'}</button></div>
            <span class="si-track"><i style="width:${total ? Math.round(100 * done / total) : 0}%"></i></span>
            ${st.evalError || st.paused ? `<p class="st-sub">${st.evalError ? escapeHtml(st.evalError) : 'En pause.'}</p>` : ''}</div>`;
    }

    function accuracyChart(months) {
        const pts = months.filter(m => m.accuracy !== null);
        if (pts.length < 2) return '<p class="st-sub">Pas encore assez de mois analysés.</p>';
        const W = 300, H = 118, L = 4, R = 36, T = 10, B = 18, vals = pts.map(p => p.accuracy), lo = Math.floor(Math.min(...vals) / 5) * 5, hi = Math.max(lo + 5, Math.ceil(Math.max(...vals) / 5) * 5);
        const x = m => L + months.indexOf(m) * (W - L - R) / Math.max(1, months.length - 1), y = v => T + (hi - v) * (H - T - B) / (hi - lo), end = pts[pts.length - 1];
        const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join('');
        return `<div class="st-trend"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Précision par mois">
            ${[lo, (lo + hi) / 2, hi].map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${W - R + 4}" y="${y(v) + 3}">${Math.round(v)} %</text>`).join('')}
            <path class="ln" d="${line}"/>${pts.map(p => `<circle class="pt${p === end ? ' end' : ''}" cx="${x(p)}" cy="${y(p.accuracy)}" r="${p === end ? 3.5 : 2.5}"><title>${I18n.mark(`${monthName(p.at)} · ${Math.round(p.accuracy)} % · ${p.n}`)}</title></circle>`).join('')}
            <text class="ax" x="${L}" y="${H - 4}">${monthName(months[0].at)}</text><text class="ax" x="${W - R}" y="${H - 4}" text-anchor="end">${monthName(months[months.length - 1].at)}</text></svg></div>`;
    }

    function phaseChart(q) {
        const names = ['Ouverture', 'Milieu de partie', 'Finale'], W = 360, H = 118, L = 104, R = 16, T = 8, B = 22, x = v => L + Math.max(0, v - 40) * (W - L - R) / 60, row = (H - T - B) / 3;
        let g = [40, 70, 100].map(v => `<line class="g" x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}"/><text x="${x(v)}" y="${H - 6}" text-anchor="middle">${v} %</text>`).join('');
        names.forEach((n, i) => {
            const a = q.me.phases[i], b = q.opp.phases[i], y = T + row * (i + .5);
            g += `<text x="0" y="${y + 3.5}">${n}</text>`;
            if (a === null || b === null) return;
            g += `<g><title>${I18n.mark(`${Math.round(a)} % / ${Math.round(b)} %`)}</title><line class="b" x1="${x(a)}" x2="${x(b)}" y1="${y}" y2="${y}"/><circle class="si-dot opp" cx="${x(b)}" cy="${y}" r="5"/><circle class="si-dot me" cx="${x(a)}" cy="${y}" r="5"/></g>`;
        });
        return `<svg class="so-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Précision par phase">${g}</svg>`;
    }

    function evalCurve(pts) {
        const W = 360, H = 150, L = 4, R = 40, T = 8, B = 22, last = pts[pts.length - 1].move, lim = Math.max(50, ...pts.map(p => Math.ceil(Math.abs(p.cp) / 50) * 50));
        const x = m => L + (m - 1) * (W - L - R) / Math.max(1, last - 1), y = v => T + (lim - v) * (H - T - B) / (2 * lim), line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.move).toFixed(1)},${y(p.cp).toFixed(1)}`).join('');
        let g = [lim, 0, -lim].map(v => `<line class="${v ? 'g' : 'b'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${W - R + 5}" y="${y(v) + 3}">${pawn(v)}</text>`).join('');
        g += `<path class="si-line me" d="${line}"/>`;
        for (let m = 10; m <= last; m += 10) g += `<text x="${x(m)}" y="${H - 6}" text-anchor="middle">${m}</text>`;
        pts.forEach(p => { g += `<rect x="${x(p.move) - 4}" y="${T}" width="8" height="${H - T - B}" fill="transparent"><title>${I18n.mark(`${p.move} · ${pawn(p.cp)}`)}</title></rect>`; });
        return `<svg class="so-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évaluation moyenne par coup">${g}</svg>`;
    }

    function qualiteHTML(games, list, rows) {
        const bar = evalBarHTML(games), q = GameQuality.quality(list);
        if (q.games < MIN) return `${bar}<p class="st-sub">Les résultats apparaissent dès ${MIN} parties analysées avec ces filtres.</p>`;
        const worst = [0, 1, 2].filter(i => q.me.phases[i] !== null && q.opp.phases[i] !== null).sort((a, b) => (q.me.phases[a] - q.opp.phases[a]) - (q.me.phases[b] - q.opp.phases[b]))[0];
        const phase = I18n.t(['l\'ouverture', 'le milieu de partie', 'la finale'][worst]), gapPhase = q.me.phases[worst] - q.opp.phases[worst];
        const months = GameQuality.months(list, st.period || 12, Date.now()), buckets = GameQuality.exitBuckets(rows), LABEL = ['−1', '−1/−0,3', '±0,3', '+0,3/+1', '+1'], bars = buckets.map((t, i) => ({ label: LABEL[i], t: { ...t, expected: null } }));
        const best = buckets[4], low = buckets[0], c = q.conversion, r = q.resistance;
        return `${bar}<div class="so-kpis">
                <div class="so-card so-kpi"><span>Précision</span><b>${pct(q.me.accuracy)}</b><small>Adversaires : ${pct(q.opp.accuracy)}</small></div>
                <div class="so-card so-kpi"><span>Gaffes pour 40 coups</span><b>${fmt1(q.me.blunder)}</b><small>Adversaires : ${fmt1(q.opp.blunder)}</small></div>
                <div class="so-card so-kpi"><span>Erreurs pour 40 coups</span><b>${fmt1(q.me.mistake)}</b><small>Adversaires : ${fmt1(q.opp.mistake)}</small></div>
                <div class="so-card so-kpi"><span>Imprécisions pour 40 coups</span><b>${fmt1(q.me.inaccuracy)}</b><small>Adversaires : ${fmt1(q.opp.inaccuracy)}</small></div>
            </div>
            <div class="so-grid">
                ${card('so-c6', 'Votre précision progresse-t-elle ?', `Sur ${I18n.t(_plural(q.games, 'partie analysée', 'parties analysées'))}. Précision du site quand elle existe, sinon calcul Chays.`, accuracyChart(months))}
                ${card('so-c6', 'Où perdez-vous en qualité ?', gapPhase < 0 ? `Votre plus grand écart est dans ${phase} : ${num1(Math.abs(gapPhase))} points sous vos adversaires.` : 'Vous jouez au moins aussi précisément que vos adversaires dans chaque phase.', `${legend([['si-key me', 'Vous'], ['si-key opp', 'Adversaire']])}${phaseChart(q)}`)}
                ${card('so-c6', 'Transformez-vous vos avantages ?', '', `<div class="sg-tiles">${c.n ? tile('Avantages convertis', pct(c.score), _plural(c.n, 'partie')) : ''}${r.n ? tile('Positions sauvées', pct(r.score), _plural(r.n, 'partie')) : ''}</div>`)}
                ${card('so-c6', 'Voyez-vous les fautes adverses ?', '', `<div class="sg-tiles">${q.chances ? tile('Fautes adverses punies', pct(q.punished), _plural(q.chances, 'occasion')) : ''}${q.errors ? tile('Vos fautes non punies', pct(q.unpunished), _plural(q.errors, 'faute')) : ''}</div>`)}
                ${q.curve.length >= 5 ? card('so-c6', 'À quel moment la partie vous échappe-t-elle ?', '', `${evalCurve(q.curve)}<p class="si-cap">Numéro du coup</p>`) : ''}
                ${buckets.some(fair) ? card('so-c6', 'Votre sortie d\'ouverture décide-t-elle du résultat ?', fair(best) && fair(low) ? `Après une sortie à +1 ou mieux : ${pct(best.score)}. À −1 ou moins : ${pct(low.score)}.` : '', `${scoreBars(bars)}<p class="si-cap">Évaluation à la sortie, en pions</p>`) : ''}
            </div>`;
    }

    // ─── POSITIONS ───────────────────────────────────────────────────────────
    const STRUCTURES = { 'iqp+': 'Votre pion isolé en d', 'iqp-': 'Pion isolé adverse en d', 'hang+': 'Vos pions pendants', 'hang-': 'Pions pendants adverses', carlsbad: 'Structure de Carlsbad', maroczy: 'Étau de Maroczy', french: 'Chaîne française', kid: 'Chaîne est-indienne', open: 'Centre ouvert' };
    const ENDGAMES = { pawn: ['Finales de pions', 'pions'], rook: ['Finales de tours', 'tours'], queen: ['Finales de Dame', 'dame'], minor: ['Pièces mineures', 'mineures'], rookMinor: ['Tour + pièce', 'tour-piece'] };
    const IMBALANCES = [['exch+', 'Un échange de plus'], ['exch-', 'Un échange de moins'], ['minors+', 'Deux pièces contre une tour'], ['minors-', 'Une tour contre deux pièces'], ['piece+', 'Une pièce de plus'], ['piece-', 'Une pièce de moins'], ['pawn+', 'Un pion de plus'], ['pawn-', 'Un pion de moins'], ['even', 'Égalité matérielle']];
    const shortDelta = d => d === null ? '–' : I18n.mark(`${d >= 0 ? '+' : '−'}${num1(Math.abs(d))}`);
    const posRow = (label, t, extra) => `<div class="si-pos"><span>${label}</span><span class="si-track"><i style="width:${Math.max(1, Math.round(t.score))}%"></i></span><b>${pct(t.score)}</b><span class="so-delta ${t.delta === null ? '' : t.delta >= 0 ? 'up' : 'down'}">${t.delta === null ? '' : `<i aria-hidden="true">${t.delta >= 0 ? '▲' : '▼'}</i>`}${shortDelta(t.delta)}</span><small>${t.n}</small>${extra || ''}</div>`;
    const head = '<div class="si-pos si-pos-h" aria-hidden="true"><span></span><span>Score</span><span></span><span>Écart</span><span>Parties</span></div>';

    function positionsHTML(list) {
        const r = GamePositions.report(list);
        if (r.games < MIN) return `<p class="st-sub">${GamePositions.running() ? 'Lecture des positions de vos parties…' : 'Trop peu de parties avec ces filtres.'}</p>`;
        const q = r.queens, c = r.castling, known = l => l.filter(x => fair(x.t)).sort((a, b) => (b.t.delta ?? 0) - (a.t.delta ?? 0));
        const st = known(r.structures.filter(x => STRUCTURES[x.key])), eg = known(r.endgames.filter(x => ENDGAMES[x.key])), im = IMBALANCES.map(([k, l]) => ({ l, x: r.imbalances.find(y => y.key === k) })).filter(y => y.x && fair(y.x.t));
        const castleRows = [['Mêmes côtés', c.same], ['Côtés opposés', c.opposite], ['Vous sans roque', c.meNone], ['Adversaire sans roque', c.oppNone]].filter(([, t]) => fair(t));
        const worstEg = eg[eg.length - 1], top = st[0], low = st[st.length - 1];
        return `<div class="so-grid">
            ${fair(q.off) && fair(q.on) ? card('so-c6', 'Préférez-vous jouer avec ou sans dames ?', `Dames échangées : ${pct(q.off.score)}. Dames sur l'échiquier : ${pct(q.on.score)}.`, `${head}${posRow('Sans dames', q.off)}${posRow('Avec dames', q.on)}`) : ''}
            ${castleRows.length ? card('so-c6', 'Où êtes-vous à l\'aise pour roquer ?', fair(c.same) && fair(c.opposite) ? `Côtés opposés : ${pct(c.opposite.score)}. Mêmes côtés : ${pct(c.same.score)}.` : '', `${head}${castleRows.map(([l, t]) => posRow(l, t)).join('')}`) : ''}
            ${st.length ? card('so-c6', 'Quelles structures vous réussissent ?', st.length > 1 && top.t.delta !== null ? `La plus rentable : ${STRUCTURES[top.key]}. La moins rentable : ${STRUCTURES[low.key]}.` : 'Structure de pions au coup 15', `${head}${st.map(x => posRow(STRUCTURES[x.key], x.t)).join('')}`) : ''}
            ${eg.length ? card('so-c6', 'Quelles finales vous coûtent des points ?', worstEg.t.delta !== null && worstEg.t.delta < 0 ? `La plus coûteuse : ${ENDGAMES[worstEg.key][0]} (${shortDelta(worstEg.t.delta)} pt).` : 'Vous tenez ce qu\'on attend de vous dans chaque type de finale.', `${head}${eg.map(x => posRow(ENDGAMES[x.key][0], x.t, `<button type="button" class="st-link si-go" data-action="statsGoEndgame" data-arg="${ENDGAMES[x.key][1]}">S'entraîner</button>`)).join('')}`) : ''}
            ${im.length ? card('so-c12', 'Comment jouez-vous les déséquilibres ?', 'Premier déséquilibre matériel tenu au moins trois coups', `${head}${im.map(y => posRow(y.l, y.x.t)).join('')}`) : ''}
        </div>`;
    }

    // Lance ou poursuit l'analyse quand la vue Qualité est à l'écran.
    const viewVisible = () => { const el = document.getElementById('si-view'); return !!el && el.offsetParent !== null && !document.hidden; };
    const shouldRun = () => st.view === 'qualite' && !st.paused && viewVisible();
    function refreshView() {
        const el = document.getElementById('si-view'), games = StatsGames.games();
        if (el && games && st.view !== 'repertoire') el.innerHTML = viewHTML(games, StatsGames.analysed());
    }
    function pump() {
        const games = StatsGames.games();
        if (games) GamePositions.run(games, () => { if (st.view === 'positions') refreshView(); });
        if (!games || !shouldRun() || GameEval.running() || !GameEval.pending(games).length) return;
        st.evalError = '';
        st.shown = 0;
        GameEval.run(games, {
            shouldRun,
            onGame: () => { const box = document.getElementById('si-eval'); if (box && viewVisible()) { const fresh = document.createElement('div'); fresh.innerHTML = evalBarHTML(games); box.replaceWith(fresh.firstElementChild); } },
            onSaved: done => { if (done - st.shown >= 20) { st.shown = done; refreshView(); Bus.emit('games:evaluated'); } }
        }).catch(() => { st.evalError = 'Le moteur ne répond pas. Réessayez plus tard.'; }).then(() => { refreshView(); Bus.emit('games:evaluated'); });
    }

    // Contenu de la vue active, hors Répertoire (rendu par StatsGames).
    function viewHTML(games, rows) {
        const list = games.filter(keeper());
        if (st.view === 'positions') return `<div class="si-wrap">${positionsHTML(list)}</div>`;
        if (st.view === 'qualite') return `<div class="si-wrap">${qualiteHTML(games, list, rows.filter(r => keep(r.g)))}</div>`;
        if (st.view === 'temps') return `<div class="si-wrap">${tempsHTML(list, rows.filter(r => keep(r.g)))}</div>`;
        return `${recordsHTML(games)}<div class="si-wrap">${bilanHTML(games, list)}</div>`;
    }

    const repaint = () => StatsGames.repaint();
    registerActions({
        statsInPeriod: p => { st.period = Number(p); saveFilters(); initStats(); },
        statsInSite: s => { st.site = s; saveFilters(); if (s !== 'all') setPref('eloSite', s); initStats(); },
        statsInSpeed: s => { st.speed = s; saveFilters(); if (s !== 'all') setPref('eloSpeed', s); initStats(); },
        statsInView: v => { st.view = v; repaint(); pump(); },
        statsInEval: () => { st.paused = !st.paused; refreshView(); pump(); }
    });

    // show : vue ouverte par un constat « À faire » ; period : mois retenus (0 = tout), lu par la fiche d'ouverture.
    return { filtersHTML, viewsHTML, viewHTML, keep, pump, view: () => st.view, show: v => { st.view = v; }, period: () => st.period };
})();
