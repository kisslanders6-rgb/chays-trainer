/**
 * screens/openings/openingsTab.js
 * ──────────────────────────────────────────────────────────────────────────
 * Onglet « Ouvertures » (refonte « Chays sans détour », lot 3) : une page par ouverture.
 * La liste « miroir » et la fiche viennent de StatsOpenings (statsOpenings.js), qui vivaient dans Statistiques ›
 * Ouvertures ; la fiche gagne l'arbre des coups appris et « Réviser l'ouverture » (startOpeningReview, trainingUI.js).
 * Barre de contexte : répertoire, couleur (statsColor, partagée avec Progrès), période, site et cadence des parties.
 * Seules les positions déjà travaillées forment les groupes, comme dans Progrès (_statsRows).
 */

'use strict';

const OpeningsTab = (function () {
    const tab = () => document.getElementById('home-tab-openings');
    const visible = () => { const t = tab(); return !!t && !t.classList.contains('hidden'); };

    function scope() {
        ColorScope.render(document.getElementById('op-color'), { options: ['w', 'b', 'all'], value: statsColor,
            onChange: c => { statsColor = c; statsFilter = 'all'; StatsOpenings.reset(); statsRerender(); } });
        const rep = document.getElementById('op-rep');
        if (rep) rep.innerHTML = statsRepHTML();
        const box = document.getElementById('op-filters'), games = StatsGames.games();
        if (!box) return;
        const show = !!(games && games.length);
        box.innerHTML = show ? StatsInsights.filtersHTML(games) : '';
        box.hidden = !show;
    }

    function init() {
        const body = document.getElementById('op-body');
        if (!body) return;
        scope();
        const rows = _statsRows();
        if (!rows.length) {
            const sides = statsColor === 'all' ? ['w', 'b'] : [statsColor];
            const stored = sides.reduce((n, side) => n + Object.keys(readDBFor(currentRepertoire, side)).length, 0);
            body.innerHTML = `<section class="st-card st-empty edge-card"><span class="st-empty-i">${ico(stored ? 'book' : 'plus')}</span>
                <b>${stored ? 'Aucune ouverture travaillée' : 'Répertoire vide'}</b>
                <span>${stored ? `${_plural(stored, 'position enregistrée', 'positions enregistrées')}, aucune encore révisée. Les ouvertures apparaissent après la première séance.`
                    : `Aucune position dans « ${escapeHtml(currentRepertoire)} ».`}</span>
                ${stored ? `<button type="button" class="btn btn-primary" data-action="homeReview">${ico('play')}Commencer la révision</button>`
                    : `<button type="button" class="btn btn-primary" data-action="statsAddLine">${ico('plus')}Ajouter une ligne</button>`}</section>`;
            return;
        }
        _assignOpenings(rows);
        const counts = _countLevels(rows);
        if (statsFilter !== 'all' && !counts[statsFilter]) statsFilter = 'all';
        body.innerHTML = StatsOpenings.sectionHTML({ rows, counts, rp: reviewPlan(currentRepertoire, Date.now()) });
        Bus.emit('ui:refresh');
    }

    // Redessine seulement si l'onglet est affiché (sinon, il le sera à la prochaine ouverture).
    function refresh() { if (visible()) init(); }

    registerActions({ opAll: () => UI_ACTIONS.statsOpOpen() });

    return { init, refresh, visible };
})();
