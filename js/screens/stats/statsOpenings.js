/**
 * screens/stats/statsOpenings.js
 * ──────────────────────────────────────────────────────────────────────────
 * Statistiques › Par ouverture : un sélecteur et une seule fiche, quelle que soit la taille du répertoire.
 *   Sélecteur : recherche par nom ou par coups, « À travailler d'abord », familles, carte maîtrise × résultats.
 *     Fenêtre posée sous <body> : dans l'onglet, une requête de conteneur capterait le position: fixed du tiroir de téléphone.
 *   Fiche : diagnostic, score, écart à l'attendu, performance, maîtrise, évolution, sorties du répertoire, réponses adverses, coups à connaître (les 5 moins sus, le reste déplié à la demande).
 * Le rattachement d'une partie : la position la plus avancée de mon répertoire qu'elle a atteinte (les transpositions comptent).
 * Sans position enregistrée, la partie rejoint son ouverture nommée (« Hors répertoire »). Calculs : OpeningReport.
 * Seules les positions déjà travaillées forment les groupes, comme l'Entraînement (_assignOpenings).
 */

'use strict';

const StatsOpenings = (function () {
    const ROWS = 5, AFTER_PLIES = 4, PRIORITY = 3, MIN_OUT = 2, MIN_MAP = 3, REPLIES = 6, SWAPS = 3;
    const OTHER = 'Autres positions';
    const st = { ctx: null, scope: '', cur: null, picked: false, period: 12, mode: 'list', q: '', active: -1, all: new Set(), list: [], reached: new Map() };

    const pct = v => `${Math.round(v)} %`;
    const num1 = v => Math.abs(v).toLocaleString(I18n.locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const slot = () => document.getElementById('stats-lines');
    const evalText = cp => I18n.mark(`${cp >= 0 ? '+' : '−'}${(Math.abs(cp) / 100).toLocaleString(I18n.locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    const share = (g, l) => g.all.length ? g.counts[l] / g.all.length : 0;
    const lostOf = g => g.stats.n >= MIN_MAP && g.stats.lost > 0 ? g.stats.lost : 0;
    const fairDelta = t => t.n >= MIN_MAP ? t.delta : null;                      // sur une ou deux parties, l'écart ne veut rien dire

    const DIAG = {
        learn: ['À apprendre', (m, lost) => `Maîtrise de ${m} sur 100, et ${lost} points de moins que prévu. Apprendre ses positions fragiles est le gain le plus direct.`],
        replace: ['À remplacer ?', (m, lost, ev) => `Vous la connaissez (${m} sur 100), mais vous sortez de l'ouverture à ${ev} et perdez ${lost} points. La ligne elle-même mérite un examen.`],
        through: ['À jouer en entier', (m, lost, ev) => `L'ouverture se passe bien (${ev} à la sortie), puis ${lost} points partent. Le travail est dans le milieu de partie typique.`],
        losing: ['Sue mais perdante', (m, lost) => `Vous la connaissez (${m} sur 100), mais elle rapporte ${lost} points de moins que prévu. Regardez où les parties tournent après l'ouverture.`],
        consolidate: ['À consolider', m => `Elle rapporte plus que prévu sans être bien sue (${m} sur 100). Ces points restent fragiles face à de meilleurs joueurs.`],
        keep: ['À garder', () => 'Bien sue et rentable. Une révision régulière suffit.']
    };

    // ─── DONNÉES ─────────────────────────────────────────────────────────────
    function since() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() - st.period + 1, 1).getTime(); }

    function build() {
        const { rows, rp } = st.ctx, map = new Map(), owner = new Map(rows.map(r => [r.side + '|' + r.k, r])), from = since();
        const group = (key, side, name, html, path) => {
            if (!map.has(key)) map.set(key, { key, side, name, html, path, all: [], items: [], games: [], recent: [] });
            return map.get(key);
        };
        rows.forEach(r => group(r.gKey, r.side, r.gName, r.gHtml, r.gPath).all.push(r));
        st.reached = new Map();
        StatsGames.analysed().filter(x => statsColor === 'all' || x.g.color === statsColor).forEach(x => {
            const leftAtOnce = x.a.dev && x.a.dev.by === 'me' && x.a.mine.length === 1;     // quitté dès mon premier coup : une autre ouverture
            const home = leftAtOnce ? null : x.a.mine.slice().reverse().map(k => owner.get(x.g.color + '|' + k)).find(Boolean);
            const name = x.a.op ? x.a.op.name : OTHER;
            const gr = home ? map.get(home.gKey) : group(`${x.g.color}|${name}`, x.g.color, name, escapeHtml(name), x.a.op ? x.a.op.path : []);
            gr.games.push(x);
            if (x.g.at < from) return;
            gr.recent.push(x);
            x.a.mine.forEach(k => { const id = x.g.color + '|' + k; if (!st.reached.has(id)) st.reached.set(id, []); st.reached.get(id).push(x.g); });
        });
        map.forEach(g => {
            g.counts = _countLevels(g.all);
            g.items = g.all.filter(r => statsFilter === 'all' || r.lv === statsFilter);
            g.due = g.all.filter(r => rp.today(r.side, r.k)).length;
            g.mastery = g.all.length ? Math.round(g.all.reduce((s, r) => s + masteryOf(r.e), 0) / g.all.length) : null;
            g.stats = OpeningReport.summarize(g.recent.map(x => x.g));
        });
        st.list = [...map.values()].filter(g => statsFilter === 'all' ? g.all.length || g.stats.n >= MIN_OUT : g.items.length).sort((a, b) =>
            lostOf(b) - lostOf(a) || share(b, 'weak') - share(a, 'weak') || share(b, 'fragile') - share(a, 'fragile') || share(b, 'progress') - share(a, 'progress') || b.all.length - a.all.length || b.stats.n - a.stats.n);
        // Tant que rien n'a été choisi, la fiche suit le classement : les parties arrivent après le premier rendu.
        if (!st.picked || !st.list.some(g => g.key === st.cur)) st.cur = st.list.length ? st.list[0].key : null;
    }
    const current = () => st.list.find(g => g.key === st.cur) || null;

    // ─── PETITS ÉLÉMENTS ─────────────────────────────────────────────────────
    const delta = (d, unit) => d === null ? '<span class="so-delta">–</span>'
        : `<span class="so-delta ${d >= 0 ? 'up' : 'down'}"><i aria-hidden="true">${d >= 0 ? '▲' : '▼'}</i>${I18n.mark(`${d >= 0 ? '+' : '−'}${num1(d)}${unit || ''}`)}</span>`;
    const wdlBar = t => t.n ? `<span class="so-wdl" role="img" aria-label="${I18n.mark(`${t.w} / ${t.d} / ${t.l}`)}">${[['w', t.w], ['d', t.d], ['l', t.l]].filter(([, n]) => n).map(([k, n]) => `<i class="sg-${k}" style="flex:${n}"></i>`).join('')}</span>` : '';
    const sideDot = s => `<span class="so-dot ${s}" aria-hidden="true"></span>`;
    const metaOf = g => g.all.length ? `${_plural(g.stats.n, 'partie')} · maîtrise ${g.mastery} / 100` : `${_plural(g.stats.n, 'partie')} · hors répertoire`;

    function monthsChart(list) {
        const W = 360, H = 138, L = 4, R = 34, T = 8, B = 20, band = (W - L - R) / list.length, bw = Math.min(26, band * .62), y = v => T + (100 - v) * (H - T - B) / 100;
        const name = t => I18n.mark(new Date(t).toLocaleDateString(I18n.locale(), { month: 'short' }));
        const every = list.length > 6 ? 2 : 1;
        let bars = '', ticks = '';
        list.forEach((m, i) => {
            const x = L + band * i + (band - bw) / 2;
            if (i % every === (list.length - 1) % every) ticks += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${name(m.at)}</text>`;
            if (!m.n) return;
            const top = y(m.score), r = Math.min(3, y(0) - top);
            bars += `<g><title>${I18n.mark(`${name(m.at)} · ${m.n} · ${Math.round(m.score)} %${m.expected === null ? '' : ` / ${Math.round(m.expected)} %`}`)}</title><rect x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}" fill="transparent"/><path class="so-bar-real" d="M${x},${y(0)}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${y(0)}Z"/>${m.expected === null ? '' : `<line class="so-exp" x1="${x - 2}" x2="${x + bw + 2}" y1="${y(m.expected)}" y2="${y(m.expected)}"/>`}</g>`;
        });
        const grid = [0, 50, 100].map(v => `<line class="${v ? 'g' : 'b'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${W - R + 5}" y="${y(v) + 3}">${v} %</text>`).join('');
        return `<svg class="so-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score par mois et score attendu">${grid}${bars}${ticks}</svg>`;
    }

    function histChart(hist) {
        const keys = Object.keys(hist).map(Number);
        if (!keys.length) return '';
        const lo = Math.max(1, Math.min(...keys) - 1), hi = Math.max(lo + 6, Math.max(...keys) + 1), cols = hi - lo + 1;
        const W = 360, H = 112, L = 4, R = 4, T = 6, B = 20, band = (W - L - R) / cols, bw = band * .66, max = Math.max(...keys.map(k => hist[k].me + hist[k].gap)), y = v => (H - B) - v * (H - T - B) / max;
        let g = `<line class="b" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
        for (let m = lo; m <= hi; m++) {
            const x = L + band * (m - lo) + (band - bw) / 2, d = hist[m];
            if ((m - lo) % (cols > 12 ? 2 : 1) === 0) g += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${m}</text>`;
            if (!d) continue;
            const y1 = y(d.me), y2 = y(d.me + d.gap);
            g += `<g><title>${I18n.mark(`${m} · ${d.gap} / ${d.me}`)}</title>${d.me ? `<rect class="so-bar-me" x="${x}" y="${y1}" width="${bw}" height="${(H - B) - y1}"/>` : ''}${d.gap ? `<rect class="so-bar-gap" x="${x}" y="${y2}" width="${bw}" height="${Math.max(1, y1 - y2 - (d.me ? 2 : 0))}" rx="2"/>` : ''}<rect x="${L + band * (m - lo)}" y="${T}" width="${band}" height="${H - T - B}" fill="transparent"/></g>`;
        }
        return `<svg class="so-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sorties du répertoire par numéro de coup">${g}</svg>`;
    }

    // ─── FICHE ───────────────────────────────────────────────────────────────
    function headHTML(g) {
        const s = g.stats, exit = s.n ? OpeningReport.detail(g.recent, g.path.length).exitEval : null, id = OpeningReport.diagnose(s.n, s.delta, g.mastery, exit), d = id && DIAG[id];
        const text = !g.all.length ? 'Hors de votre répertoire : aucune position travaillée pour cette ouverture.'
            : !s.n ? 'Aucune de vos parties récentes ne passe par cette ouverture.'
            : !d ? `Trop peu de parties pour juger (${s.n}).` : d[1](g.mastery, num1(s.lost), exit === null ? '' : evalText(exit));
        return `<div class="so-head vel-card vel-dark">
            ${g.path.length ? `<div class="so-board">${_miniBoardHTML({ side: g.side, path: g.path }, true)}</div>` : ''}
            <div class="so-head-txt">
                <span class="st-eyebrow">${g.side === 'w' ? 'Blancs' : 'Noirs'}${g.all.length ? ` · ${_plural(g.all.length, 'position')}` : ''}</span>
                <h4 class="so-name">${g.html}</h4>
                ${g.path.length && g.name !== _movesLabel(g.path) ? `<small class="so-moves">${_movesLabel(g.path, true)}</small>` : ''}
                ${d ? `<span class="so-diag">${d[0]}</span>` : ''}
                <p>${text}</p>
                ${g.all.length ? `<div class="so-acts">${g.due ? `<button type="button" class="btn btn-soft st-golink" data-action="statsGoTraining" data-arg="${escapeHtml('due:' + g.key)}">Réviser cette ouverture ${ico('chevron-right')}</button>` : ''}<span>${g.due ? `${g.due} à réviser sur ${g.all.length}` : 'À jour'}</span></div>` : ''}
            </div></div>`;
    }

    function kpisHTML(g) {
        const s = g.stats;
        return `<div class="so-kpis">
            <div class="so-card so-kpi"><span>Score</span><b>${s.n ? pct(s.score) : '–'}</b><small>${_plural(s.n, 'partie')}</small>${wdlBar(s)}</div>
            <div class="so-card so-kpi"><span>Face à l'attendu</span><b>${delta(fairDelta(s), ' pt')}</b><small>${s.expected === null ? 'Elo inconnu' : `Attendu : ${pct(s.expected)}`}</small></div>
            <div class="so-card so-kpi"><span>Performance</span><b>${s.perf === null ? '–' : s.perf}</b><small>Elo équivalent</small></div>
            <div class="so-card so-kpi"><span>Maîtrise</span><b>${g.mastery === null ? '–' : `${g.mastery} / 100`}</b><small>Entraînement</small></div>
        </div>`;
    }

    function gamesHTML(g) {
        const s = g.stats;
        if (!s.n) {
            const none = !StatsGames.analysed().length;
            return `<p class="st-sub so-empty">${none ? (StatsGames.pending() ? 'Comparaison avec vos parties…' : "Reliez un compte dans l'onglet Parties pour voir vos résultats réels.") : 'Aucune partie sur cette période.'}</p>`;
        }
        const r = OpeningReport.detail(g.recent, g.path.length), months = OpeningReport.months(g.recent.map(x => x.g), st.period, Date.now());
        const above = months.filter(m => m.n && m.expected !== null && m.score >= m.expected).length, played = months.filter(m => m.n).length;
        const hist = histChart(r.hist), replies = r.replies.filter(x => x.n >= 2).slice(0, REPLIES), swaps = r.swaps.slice(0, SWAPS);
        const STATE = { covered: 'Couvert', missing: 'Manquant', end: 'Fin de préparation' };
        const fact = (l, v) => `<div class="so-fact"><span>${l}</span><b>${v}</b></div>`;
        return `<div class="so-grid">
            <div class="so-card so-c7"><h5>Score par mois</h5><p class="st-sub">${above} mois sur ${played} au-dessus de l'attendu</p>
                <div class="so-leg"><span><i class="so-bar-real"></i>Score réel</span><span><i class="so-exp"></i>Score attendu</span></div>${monthsChart(months)}</div>
            <div class="so-card so-c5"><h5>Votre préparation</h5><p class="st-sub">Dans vos parties réelles</p>
                ${fact('Répertoire suivi', pct(r.followed))}
                ${fact('Score en le suivant', r.kept.n ? pct(r.kept.score) : '–')}
                ${fact('Score en le quittant', r.left.n ? pct(r.left.score) : '–')}
                ${fact('Réponses couvertes', pct(r.coverage))}
                ${fact('Sortie moyenne', `coup ${r.exitMove}`)}
                ${r.exitEval === null ? '' : fact('Évaluation à la sortie', evalText(r.exitEval))}
                ${r.exitGood.n >= 3 ? fact('Score après une bonne sortie', pct(r.exitGood.score)) : ''}
                ${r.exitBad.n >= 3 ? fact('Score après une mauvaise sortie', pct(r.exitBad.score)) : ''}
                ${r.exitClock === null ? '' : fact('Avance à l\'horloge', `${r.exitClock >= 0 ? '+' : '−'}${Math.abs(Math.round(r.exitClock))} %`)}</div>
            ${hist ? `<div class="so-card so-c6"><h5>Où le répertoire s'arrête</h5><p class="st-sub">Numéro du coup, hors fins de ligne préparées</p>
                <div class="so-leg"><span><i class="so-bar-gap"></i>Réponse manquante</span><span><i class="so-bar-me"></i>Sortie de votre fait</span></div>${hist}</div>` : ''}
            ${replies.length ? `<div class="so-card so-c6"><h5>Réponses adverses</h5><p class="st-sub">Les plus jouées après cette ligne</p>
                <div class="so-table">${replies.map(x => `<div class="so-tr"><span class="so-mv">${_moveLabel(x, false, true)}</span><span class="so-share"><i style="width:${Math.max(4, x.share * .6)}%"></i>${pct(x.share)}</span><span class="so-num">${pct(x.t.score)}</span><span class="so-state ${x.state}">${STATE[x.state]}</span></div>`).join('')}</div></div>` : ''}
            ${swaps.length ? `<div class="so-card so-c12"><h5>Coups joués à la place</h5><p class="st-sub">Votre réflexe, à la place du coup prévu</p>
                ${swaps.map(x => `<button type="button" class="so-swap" data-action="statsPreview" data-arg="${escapeHtml(g.side + ':' + x.key)}" data-origin="${escapeHtml(g.name)}"><span class="so-mv">${_moveLabel({ ply: x.ply, san: x.played }, false, true)}</span><span class="so-instead">au lieu de <span class="so-mv">${_moveLabel({ ply: x.ply, san: x.expected }, false, true)}</span></span><small>${_plural(x.n, 'partie')} · ${pct(x.t.score)}</small>${ico('chevron-right')}</button>`).join('')}</div>` : ''}
        </div>`;
    }

    // Derniers coups avant ma réponse : sans eux, « 4… e6 » ne dit pas de quelle position il s'agit.
    function afterHTML(path) {
        if (!path || path.length < 2) return 'Premier coup de la partie';
        try {
            const sans = _pathToSans(path.slice(0, -1)), from = Math.max(0, sans.length - AFTER_PLIES);
            const line = sans.slice(from).map((s, k) => {
                const i = from + k, n = Math.floor(i / 2) + 1, w = i % 2 === 0;
                return `${w ? `${n}. ` : k ? '' : `${n}… `}${formatSan(s, w ? 'w' : 'b')}`;
            }).join(' ');
            return `Après <span class="so-line">${from ? '… ' : ''}${line}</span>`;
        } catch (e) { return ''; }
    }

    function positionsHTML(g) {
        if (!g.all.length) return '';
        const now = Date.now(), items = g.items.slice().sort(_byWorst), shown = st.all.has(g.key) ? items : items.slice(0, ROWS);
        const games = r => { const list = st.reached.get(r.side + '|' + r.k) || []; if (!list.length) return '<i class="so-none">–</i>'; return `${_plural(list.length, 'partie')} · ${pct(OpeningReport.summarize(list).score)}`; };
        const rows = shown.map(r => {
            const d = isDue(r.e, now), m = Math.round(masteryOf(r.e));
            return `<div class="st-row">
                <span class="st-move">${_moveLabel(r.e, false, true)}<small class="so-after">${afterHTML(r.e.path)}</small></span>
                <span class="st-lvl">${_lvMark(r.lv)}${STATS_LEVELS[r.lv].one}</span>
                <span class="st-errs lv-${r.lv}" title="${r.e.failures} err. / ${r.e.attempts}"><span class="st-rate" aria-hidden="true"><i style="width:${Math.max(3, m)}%"></i></span><span class="st-n">${m} / 100</span></span>
                <span class="so-games">${games(r)}</span>
                <span class="st-when ${d ? 'on' : ''}">${d ? 'Aujourd’hui' : dueInLabel(dueOf(r.e))}</span>
                <span class="st-acts">
                    <button type="button" class="st-ibtn pri" data-action="statsTrain" data-arg="${_statsArg(r)}" title="S'entraîner sur cette position (compte comme un essai)" aria-label="S'entraîner sur ${escapeHtml(_moveLabel(r.e))}">${ico('play')}</button>
                    <button type="button" class="st-ibtn" data-action="statsPreview" data-arg="${_statsArg(r)}" data-origin="${escapeHtml(g.name)}" title="Voir la position" aria-label="Voir ${escapeHtml(_moveLabel(r.e))}">${ico('eye')}</button>
                </span></div>`;
        }).join('');
        const more = items.length > ROWS ? `<button type="button" class="st-more" data-action="statsOpMore" data-arg="${escapeHtml(g.key)}" aria-expanded="${items.length === shown.length}">${items.length === shown.length ? 'Réduire' : `Afficher les ${items.length - shown.length} autres coups`}</button>` : '';
        return `<div class="so-card so-pos"><h5>Vos coups à connaître</h5><p class="st-sub">${_plural(items.length, 'coup')} de votre répertoire dans cette ouverture, du moins su au mieux su.</p>
            ${levelBarHTML(g.counts)}
            <div class="st-rows"><div class="st-row st-row-hd" aria-hidden="true"><span>Coup</span><span>Niveau</span><span>Maîtrise</span><span>Parties</span><span>Révision</span><span></span></div>${rows}${more}</div></div>`;
    }

    function chipsHTML() {
        const { rows, counts } = st.ctx;
        return [['all', 'Toutes', rows.length], ...STATS_MASTERY_LEVELS.map(l => [l, STATS_LEVELS[l].label, counts[l]]), [STATS_STATE, STATS_LEVELS[STATS_STATE].label, counts[STATS_STATE]]].map(([id, label, n]) =>
            `${id === STATS_STATE ? '<span class="stats-chip-sep" aria-hidden="true"></span>' : ''}<button type="button" class="stats-chip ${statsFilter === id ? 'active' : ''} ${id === 'all' ? 'all' : 'lv-' + id}${id === STATS_STATE ? ' is-state' : ''}" aria-pressed="${statsFilter === id}" data-action="statsFilter" data-arg="${id}" ${n ? '' : 'disabled'}>
                ${id === 'all' ? '' : _lvMark(id)}${label} <b>${n}</b></button>`).join('');
    }

    function inner() {
        const g = current(), title = `<div class="st-h"><div class="st-h-title"><h3>Par ouverture</h3><span class="st-sub">${_plural(st.list.length, 'ouverture')} · ${_sideName(statsColor)}</span></div></div>
            <div class="stats-filters" role="group" aria-label="Filtrer par niveau">${chipsHTML()}</div>`;
        if (!g) return `${title}<div class="st-lines"><div class="empty-tab">Aucune position à ce niveau.</div></div>`;
        const meta = `${g.side === 'w' ? 'Blancs' : 'Noirs'} · ${metaOf(g)}`;
        return `${title}<div class="so-wrap">
            <div class="so-bar">
                <button type="button" class="so-trigger" id="so-trigger" data-action="statsOpOpen" aria-haspopup="dialog" aria-expanded="false">${sideDot(g.side)}<span class="so-txt"><b>${g.html}</b><small>${meta}</small></span>${ico('chevron-down')}</button>
                <button type="button" class="so-step" data-action="statsOpStep" data-arg="-1" title="Précédente à travailler" aria-label="Précédente à travailler">${ico('chevron-left')}</button>
                <button type="button" class="so-step" data-action="statsOpStep" data-arg="1" title="Suivante à travailler" aria-label="Suivante à travailler">${ico('chevron-right')}</button>
                <div class="tr-seg so-period" role="group" aria-label="Période">${[3, 6, 12].map(p => `<button type="button" class="tr-seg-btn${st.period === p ? ' active' : ''}" aria-pressed="${st.period === p}" data-action="statsOpPeriod" data-arg="${p}">${p} mois</button>`).join('')}</div>
            </div>
            <div class="so-fiche">${headHTML(g)}${kpisHTML(g)}${gamesHTML(g)}${positionsHTML(g)}</div>
        </div>`;
    }

    function sectionHTML(ctx) {
        st.ctx = ctx;
        const scope = currentRepertoire + '|' + statsColor;
        if (scope !== st.scope) { st.scope = scope; st.cur = null; st.picked = false; st.all = new Set(); }
        build();
        return `<section class="st-sec st-card st-card-flush edge-card" id="stats-lines" data-pane="openings">${inner()}</section>`;
    }

    function paint() {
        const s = slot();
        if (!s || !st.ctx) return;
        build();
        s.innerHTML = inner();
        if (pickerEl()) renderPicker();
    }

    // ─── SÉLECTEUR ───────────────────────────────────────────────────────────
    const pickerEl = () => document.getElementById('so-picker');
    const optHTML = g => `<button type="button" class="so-opt" role="option" tabindex="-1" aria-selected="${g.key === st.cur}" data-action="statsOpPick" data-arg="${escapeHtml(g.key)}">${sideDot(g.side)}<span class="so-txt"><b>${g.html}</b><small>${metaOf(g)}</small></span>${wdlBar(g.stats)}${delta(fairDelta(g.stats))}</button>`;
    const searchable = g => { let moves = ''; try { moves = `${_movesLabel(g.path)} ${_pathToSans(g.path).join(' ')}`; } catch (e) { /* chemin illisible */ } return norm(`${g.name} ${I18n.t(g.name)} ${moves}`); };

    function mapHTML(list) {
        const pts = list.filter(g => g.stats.n >= MIN_MAP && g.stats.delta !== null && g.mastery !== null);
        if (!pts.length) return `<p class="so-none">Il faut au moins ${MIN_MAP} parties dans une ouverture travaillée pour la placer sur la carte.</p>`;
        const lim = Math.min(40, Math.max(15, Math.ceil(Math.max(...pts.map(g => Math.abs(g.stats.delta))) / 5) * 5));
        const W = 340, H = 300, L = 30, R = 8, T = 12, B = 30, x = v => L + v * (W - L - R) / 100, y = v => T + (lim - Math.max(-lim, Math.min(lim, v))) * (H - T - B) / (2 * lim);
        let g = [-lim, 0, lim].map(v => `<line class="${v ? 'g' : 'b'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}</text>`).join('');
        g += [0, OpeningReport.KNOWN, 100].map(v => `<line class="${v === OpeningReport.KNOWN ? 'b' : 'g'}" x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}"/><text x="${x(v)}" y="${H - B + 13}" text-anchor="middle">${v}</text>`).join('');
        g += `<text class="q" x="${x(1)}" y="${T + 10}">À consolider</text><text class="q" x="${x(99)}" y="${T + 10}" text-anchor="end">À garder</text><text class="q" x="${x(1)}" y="${H - B - 5}">À apprendre</text><text class="q" x="${x(99)}" y="${H - B - 5}" text-anchor="end">Sue mais perdante</text>
            <text x="${(L + W - R) / 2}" y="${H - 3}" text-anchor="middle">Maîtrise à l'entraînement</text><text transform="translate(9 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Points face à l'attendu</text>`;
        pts.slice().sort((a, b) => b.stats.n - a.stats.n).forEach(o => {
            const r = 4 + Math.min(10, Math.sqrt(o.stats.n) * .8), cx = x(o.mastery), cy = y(o.stats.delta);
            const label = `${o.name} · ${o.mastery} / 100 · ${o.stats.delta >= 0 ? '+' : '−'}${num1(o.stats.delta)} pt`;
            g += `<g class="so-point${o.key === st.cur ? ' sel' : ''}" tabindex="0" role="button" data-action="statsOpPick" data-arg="${escapeHtml(o.key)}" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title><circle cx="${cx}" cy="${cy}" r="${Math.max(r, 12)}" fill="transparent"/><circle class="m ${o.stats.delta >= 0 ? 'up' : 'down'}" cx="${cx}" cy="${cy}" r="${r}"/></g>`;
        });
        return `<svg class="so-chart so-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Carte des ouvertures, maîtrise et résultats">${g}</svg><p class="so-note">Point plus gros : plus de parties. Touchez un point pour ouvrir sa fiche.</p>`;
    }

    function listHTML(list) {
        const q = norm(st.q.trim());
        if (q) {
            const hits = list.filter(g => searchable(g).includes(q));
            return hits.length ? hits.map(optHTML).join('') : `<p class="so-none">Aucune ouverture ne correspond. Essayez un nom ou un coup.</p>`;
        }
        const head = t => `<div class="so-group">${t}</div>`, rep = list.filter(g => g.all.length), out = list.filter(g => !g.all.length), fam = new Map();
        rep.forEach(g => { const k = `${g.side === 'w' ? 'Blancs' : 'Noirs'} · ${g.name.split(' · ')[0]}`; if (!fam.has(k)) fam.set(k, []); fam.get(k).push(g); });
        return `${list.length > PRIORITY + 2 ? head("À travailler d'abord") + list.slice(0, PRIORITY).map(optHTML).join('') : ''}
            ${[...fam.keys()].sort((a, b) => a.localeCompare(b, I18n.locale())).map(k => head(k) + fam.get(k).map(optHTML).join('')).join('')}
            ${out.length ? head('Hors répertoire') + out.map(optHTML).join('') : ''}`;
    }

    function renderPicker() {
        const box = pickerEl();
        if (!box) return;
        box.querySelectorAll('[data-action="statsOpMode"]').forEach(b => { const on = b.dataset.arg === st.mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
        box.querySelector('.so-p-search').hidden = st.mode === 'map';
        box.querySelector('.so-p-body').innerHTML = st.mode === 'map' ? mapHTML(st.list) : listHTML(st.list);
        st.active = -1;
    }

    function place() {
        const box = pickerEl(), t = document.getElementById('so-trigger');
        if (!box || !t) return;
        const r = t.getBoundingClientRect();
        box.style.setProperty('--so-top', `${Math.round(r.bottom + 6)}px`);
        box.style.setProperty('--so-left', `${Math.round(r.left)}px`);
    }

    function open() {
        if (pickerEl()) { close(); return; }
        const back = document.createElement('div'), box = document.createElement('div');
        back.id = 'so-backdrop';
        back.addEventListener('click', () => close());
        box.id = 'so-picker';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Choisir une ouverture');
        box.innerHTML = `<span class="so-grab" aria-hidden="true"></span><div class="so-p-head">
            <input class="so-p-search online-input" type="search" placeholder="Nom ou coups : Najdorf, Cf3…" aria-label="Chercher une ouverture" autocomplete="off" spellcheck="false">
            <div class="tr-seg" role="group" aria-label="Affichage"><button type="button" class="tr-seg-btn" data-action="statsOpMode" data-arg="list">Liste</button><button type="button" class="tr-seg-btn" data-action="statsOpMode" data-arg="map">Carte</button></div>
        </div><div class="so-p-body" role="listbox" aria-label="Ouvertures"></div>`;
        document.body.append(back, box);
        st.q = '';
        const input = box.querySelector('.so-p-search');
        input.addEventListener('input', () => { st.q = input.value; renderPicker(); });
        box.addEventListener('keydown', onKey);
        box.addEventListener('focusout', e => { if (e.relatedTarget && !box.contains(e.relatedTarget)) close(); });
        renderPicker();
        place();
        window.addEventListener('scroll', place, true);
        const t = document.getElementById('so-trigger');
        if (t) t.setAttribute('aria-expanded', 'true');
        if (st.mode === 'list' && !matchMedia('(pointer: coarse)').matches) input.focus();
    }

    function close(focus = true) {
        const box = pickerEl();
        if (!box) return;
        box.remove();
        document.getElementById('so-backdrop').remove();
        window.removeEventListener('scroll', place, true);
        const t = document.getElementById('so-trigger');
        if (t) { t.setAttribute('aria-expanded', 'false'); if (focus) t.focus(); }
    }

    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        const point = e.target.closest('.so-point');
        if (point && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(point.dataset.arg); return; }
        if (!e.target.matches('.so-p-search') && !e.target.matches('.so-opt')) return;
        const box = pickerEl(), opts = [...box.querySelectorAll('.so-opt')];
        if (!opts.length) return;
        if (e.key === 'Enter') { e.preventDefault(); pick((opts[st.active] || opts[0]).dataset.arg); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        st.active = (st.active + (e.key === 'ArrowDown' ? 1 : (st.active < 0 ? 0 : -1)) + opts.length) % opts.length;
        opts.forEach((o, i) => o.classList.toggle('active', i === st.active));
        opts[st.active].scrollIntoView({ block: 'nearest' });
    }

    function pick(key) { st.cur = key; st.picked = true; paint(); close(); }
    function step(dir) {
        const i = st.list.findIndex(g => g.key === st.cur);
        if (i < 0) return;
        st.cur = st.list[(i + dir + st.list.length) % st.list.length].key;
        st.picked = true;
        paint();
    }

    registerActions({
        statsOpOpen: open,
        statsOpPick: pick,
        statsOpMode: m => { st.mode = m; renderPicker(); },
        statsOpStep: d => step(Number(d)),
        statsOpPeriod: p => { st.period = Number(p); st.picked = true; paint(); },
        statsOpMore: k => {
            const closing = st.all.delete(k);
            if (!closing) st.all.add(k);
            paint();
            const card = closing && slot().querySelector('.so-pos');          // replié : la carte reste à l'écran
            if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
        }
    });
    Bus.on('games:analysed', paint);
    Bus.on('games:evaluated', paint);

    return { sectionHTML, reset: () => { st.cur = null; st.picked = false; }, close };
})();
