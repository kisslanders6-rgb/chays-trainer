/**
 * modules/training/suite.js
 * ──────────────────────────────────────────────────────────────────────────
 * Capsule « Suite » de la barre du haut (#suite-chip) : toujours une suite proposée, au même endroit.
 * Son contenu suit le moment (Suite.state) :
 *   live   séance guidée en cours : « 7 / 14 », anneau de la séance, série sans faute (×N dès 3)
 *   retry  bilan avec des erreurs : « Revoir 2 erreurs »            (action trainingRetry)
 *   due    positions à réviser aujourd'hui : « 5 à réviser · ≈ 3 min » (startDailyReview)
 *   news   nouveautés des parties analysées à traiter          (onglet Jouer)
 *   done   objectif du jour atteint                             (onglet Entraînement)
 * Rien à proposer, contre-la-montre ou ligne complète (la barre de séance suffit) : capsule cachée.
 * Hors séance, l'anneau est l'objectif du jour (essais du jour / appSettings.dailyGoal).
 * Objectif atteint pendant une réponse : annonce une seule fois par jour (Suite.afterAnswer).
 */

'use strict';

const Suite = (function () {
    let toldDay = null;                         // jour où l'objectif atteint a déjà été annoncé

    const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;

    function state() {
        const S = trainingState.session;
        if (S && gameMode === 'training') {
            if (S.kind === 'timed' || S.kind === 'line') return null;
            const n = S.items.length, pos = Math.min(n, (S.cur >= 0 ? S.cur : S.i) + 1);
            return { kind: 'live', label: `${pos} / ${n}`, short: `${pos} / ${n}`, value: pos, max: n, combo: trainingState.combo };
        }
        const act = readActivity(), today = (act[dayStamp(Date.now())] || { a: 0 }).a, goal = appSettings.dailyGoal;
        const ring = { value: Math.min(today, goal), max: goal };
        const s = trainingState.lastSummary;
        const miss = s && s.kind !== 'timed' ? s.rows.filter(r => !r.ok).length : 0;
        if (miss) return { kind: 'retry', label: miss > 1 ? `Revoir ${miss} erreurs` : 'Revoir l’erreur', short: pl(miss, 'erreur', 'erreurs'), n: miss, action: 'suiteRetry', ...ring };
        const due = reviewPlan(currentRepertoire).forecast(null, 1)[0] || 0;
        if (due) {
            const min = Math.max(1, Math.round(due * TRAIN_SECONDS_PER_POSITION / 60));
            return { kind: 'due', label: `${due} à réviser · ≈ ${min} min`, short: `${due} · ${min} min`, n: due, action: 'suiteDue', ...ring };
        }
        const news = typeof HomePanels !== 'undefined' ? HomePanels.novelties().length : 0;
        if (news) return { kind: 'news', label: pl(news, 'nouveauté à traiter', 'nouveautés à traiter'), short: pl(news, 'nouveauté', 'nouveautés'), n: news, action: 'suiteNews', ...ring };
        if (today >= goal) return { kind: 'done', label: 'Objectif du jour atteint', short: 'Objectif atteint', action: 'suiteTraining', ...ring };
        return null;
    }

    function html(st) {
        // Le nombre au centre de l'anneau ne se montre que sur un petit écran, où le libellé est masqué.
        const ring = Ring.html({ value: st.value, max: Math.max(1, st.max), size: 24, stroke: 8, label: st.n ? String(st.n) : '', decorative: true });
        const combo = st.combo >= 3 ? `<span class="suite-combo">×${st.combo}</span>` : '';
        const body = `${ring}<span class="suite-k">${st.kind === 'live' ? 'Séance' : 'Suite'}</span><span class="suite-l">${escapeHtml(st.label)}</span><span class="suite-s">${escapeHtml(st.short)}</span>${combo}`;
        if (st.kind === 'live')
            return `<span class="suite-chip is-live" role="status" aria-label="Séance : position ${st.value} sur ${st.max}${st.combo >= 3 ? `, ${st.combo} sans faute` : ''}">${body}</span>`;
        return `<button type="button" class="suite-chip is-${st.kind}" data-action="${st.action}" title="${escapeHtml(st.label)}" aria-label="Suite : ${escapeHtml(st.label)}">${body}${ico('chevron-right')}</button>`;
    }

    function refresh() {
        const host = document.getElementById('suite-slot');
        if (!host) return;
        let st = null;
        try { st = state(); } catch (e) { reportError('capsule Suite', e); }
        const tabs = document.getElementById('topnav-tabs-setup');
        host.classList.toggle('in-game', !!(tabs && tabs.classList.contains('in-game')));
        const out = st ? html(st) : '';
        if (host.innerHTML !== out) host.innerHTML = out;
        host.hidden = !st;
    }

    // Après une réponse comptée en Entraînement : capsule à jour, et annonce de l'objectif du jour au moment où il est atteint.
    function afterAnswer() {
        const now = Date.now(), day = dayStamp(now), act = readActivity(), goal = appSettings.dailyGoal;
        if ((act[day] || { a: 0 }).a === goal && toldDay !== day) {
            toldDay = day;
            const streak = typeof _streak === 'function' ? _streak(act) : 0;
            if (typeof AccountUI !== 'undefined' && AccountUI.notify)
                AccountUI.notify(`Objectif du jour atteint · ${pl(goal, 'position', 'positions')}${streak > 1 ? ` · ${streak} jours d’affilée` : ''}`);
            const chip = document.querySelector('#suite-slot .suite-chip');
            if (chip) { chip.classList.remove('is-cheer'); void chip.offsetWidth; chip.classList.add('is-cheer'); }
        }
        refresh();
    }

    registerActions({
        suiteRetry: a => UI_ACTIONS.trainingRetry(a, null),
        suiteDue: () => startDailyReview(),
        suiteNews: () => switchHomeTab('play'),
        suiteTraining: () => switchHomeTab('training')
    });

    return { state, refresh, afterAnswer };
})();
