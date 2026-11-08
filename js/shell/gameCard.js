/**
 * shell/gameCard.js
 * ──────────────────────────────────────────────────────────────────────────
 * Carte de contexte de l'écran de jeu sur téléphone (sous 600 px, « Tableau ») : au-dessus de l'échiquier, un anneau
 * et trois chiffres propres au mode, autour de la barre d'état et des suites adverses déjà présentes dans #game-card.
 *   Entraînement (séance guidée) : position sur le total ; justes, erreurs, série.
 *   Aperçu des Statistiques : maîtrise ; essais, échecs, révision.
 *   Jouer : positions du répertoire, numéro du coup, état de la position (pas d'anneau).
 *   Finales et Analyse : rien de plus, leurs panneaux occupent la carte.
 * Redessinée sur 'ui:refresh' (setStatus, Suite.refresh, rendu de l'échiquier). La hauteur disponible décide en CSS de ce
 * qui se montre (section « TABLEAU » de css/game.css).
 */

'use strict';

const GameCard = (function () {
    const MQ = '(max-width: 599px)';
    const LONG_TITLE = 22;           // au-delà, le titre de la barre d'état reste en petit (.is-long)
    let previewOf = { t: null, e: null };
    const inGame = () => { const gs = document.getElementById('game-screen'); return !!gs && !gs.classList.contains('hidden'); };

    // Ce que la carte montre dans le mode courant : { ring?, tiles? }, ou null.
    function model() {
        if (gameMode === 'training') {
            const S = trainingState.session;
            if (!S || !S.items || S.kind === 'timed' || S.kind === 'line') return null;
            const n = S.items.length, pos = Math.min(n, (S.cur >= 0 ? S.cur : S.i) + 1);
            const res = [...S.results.values()], ok = res.filter(r => r.ok).length;
            return {
                ring: { value: pos, max: n, label: String(pos), sub: 'sur ' + n, ariaLabel: `Position ${pos} sur ${n}` },
                tiles: [[ok, 'Justes', 'is-ok'], [res.length - ok, 'Erreurs', 'is-err'], [trainingState.combo, 'Série', '']]
            };
        }
        if (gameMode === 'preview') {
            const t = statsPreviewTarget;
            if (!t) return null;
            if (previewOf.t !== t) previewOf = { t, e: readDBFor(currentRepertoire, t.color)[t.key] };   // relue une fois par aperçu
            const e = previewOf.e;
            if (!e) return null;
            const m = Math.round(masteryOf(e));
            return {
                ring: { value: m, max: 100, label: String(m), sub: 'maîtrise', ariaLabel: `Maîtrise ${m} sur 100` },
                tiles: [[e.attempts, 'Essais', ''], [e.failures, 'Échecs', 'is-err'], [isDue(e, Date.now()) ? 'Auj.' : dueInLabel(dueOf(e)), 'Révision', '']]
            };
        }
        if (gameMode === 'play') {
            const state = turn !== playerColor ? 'Adverse' : openingDB[positionKey()] ? 'Connue' : 'Nouvelle';
            return { tiles: [[Object.keys(openingDB).length, 'Positions', ''], [Math.floor(moveHistory.length / 2) + 1, 'Coup', ''], [state, 'Position', '']] };
        }
        return null;
    }

    function tilesHTML(tiles) {
        return tiles.map(([v, l, cls]) => `<div class="gc-tile${cls ? ' ' + cls : ''}"><b>${escapeHtml(String(v))}</b><small>${escapeHtml(l)}</small></div>`).join('');
    }

    function paint(el, html) {
        el.hidden = !html;
        if (el.innerHTML !== html) el.innerHTML = html;
    }

    function refresh() {
        const ring = document.getElementById('gc-ring'), tiles = document.getElementById('gc-tiles');
        if (!ring || !tiles) return;
        let m = null;
        try { if (matchMedia(MQ).matches && inGame()) m = model(); } catch (e) { if (typeof reportError === 'function') reportError('gameCard', e); }
        paint(ring, m && m.ring ? Ring.html({ ...m.ring, size: 84, stroke: 6 }) : '');
        paint(tiles, m && m.tiles ? tilesHTML(m.tiles) : '');
        const title = document.querySelector('#status-bar .status-title');
        document.getElementById('game-card').classList.toggle('is-long', gameMode === 'endgame' || gameMode === 'analysis' || !!title && title.textContent.length > LONG_TITLE);
    }

    Bus.on('ui:refresh', refresh);

    return { refresh, model };
})();
