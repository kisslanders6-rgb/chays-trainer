/**
 * screens/games/autoReview.js
 * ──────────────────────────────────────────────────────────────────────────
 * Parties relues toutes seules (refonte « Chays sans détour », lot 5). Quelques secondes après le lancement, au plus une
 * fois toutes les AUTO_REVIEW_EVERY, les dernières parties de chaque compte relié (pseudos `chesscomUser` / `lichessUser`
 * du Compte) passent par la même analyse qu'« Analyser mes parties » (analyzeOnlineGames, onlineGames.js) : mêmes
 * verdicts au journal `chessTrainer_gameLedger`, même règle de comptage (une erreur par partie, répertoire et couleur).
 * Les nouveautés et les sorties deviennent l'étape « Après vos parties » du plan d'Aujourd'hui (_homeSteps).
 * Hors ligne, sans pseudo ou en cas d'erreur réseau : rien, en silence ; la fenêtre d'import reste pour le PGN collé.
 * Dernier passage : clé locale `chessTrainer_autoReviewAt` (propre à l'appareil, ni sauvegardée ni synchronisée).
 */

'use strict';

const AutoReview = (function () {
    const KEY = 'chessTrainer_autoReviewAt', EVERY = 6 * 3600e3, COUNT = 20, DELAY = 4000;
    let running = false;

    const accounts = () => [['chesscom', (appSettings.chesscomUser || '').trim()], ['lichess', (appSettings.lichessUser || '').trim()]].filter(([, u]) => u);
    const due = now => now - (Number(dataStore.getJSON(KEY, 0)) || 0) >= EVERY;

    // force : ignore l'intervalle (tests, appel direct). Renvoie le résumé cumulé, ou null si rien n'a été tenté.
    async function run({ force = false } = {}) {
        const now = Date.now(), list = accounts();
        if (running || !list.length || (!force && !due(now))) return null;
        if (typeof Net !== 'undefined' && !Net.online()) return null;
        running = true;
        const total = { games: 0, novelties: 0, newMistakes: 0 };
        try {
            for (const [site, user] of list) {
                let games;
                try { games = site === 'lichess' ? await fetchLichessGames(user, COUNT) : await fetchChesscomGames(user, COUNT); }
                catch (e) { continue; }                                     // pseudo introuvable, réseau : l'autre compte peut répondre
                if (!games.length) continue;
                const res = analyzeOnlineGames(games, user);
                recordGameFrequencies(games, g => _userColor(g.headers, user));
                total.games += res.summary.games;
                total.novelties += res.summary.novelties;
                total.newMistakes += res.summary.newMistakes;
            }
            dataStore.setJSON(KEY, now);
            if (total.games) {
                if (_gameScreenShown() && gameMode === 'play') loadDB();     // erreurs comptées : base active rechargée
                if (typeof refreshTree === 'function') refreshTree();
                Bus.emit('games:reviewed', total);
            }
        } finally { running = false; }
        return total;
    }

    if (typeof window !== 'undefined') window.addEventListener('load', () => setTimeout(() => { run().catch(e => reportError('parties relues au lancement', e)); }, DELAY));

    return { run, accounts, KEY, EVERY };
})();
