/**
 * shell/palette.js
 * ──────────────────────────────────────────────────────────────────────────
 * Palette de recherche (point B) : une seule porte d'entrée, ouverte par la loupe de la barre du haut ou par
 * ⌘F (Ctrl+F hors Mac), ⌘K en plus pour les habitués.
 *   Résultats : actions, ouvertures du répertoire, positions (dès qu'on tape un chiffre), répertoires, réglages,
 *   finales, autres ouvertures (ouvertes dans l'Analyse, rien n'est écrit) et Aide.
 *   Sans texte : les choix récents (chessTrainer_paletteRecent, propre à l'appareil), puis les suggestions.
 *
 * ⌘F ne confisque pas la recherche du navigateur : une seconde pression (palette ouverte) la laisse passer.
 * Dans une fenêtre qui a sa propre recherche, ⌘F va dans ce champ ; derrière une autre fenêtre, rien n'est intercepté.
 * En séance guidée, ce qui ferait quitter la séance n'est pas proposé (leave) : on ne l'abandonne pas par mégarde.
 *
 * Palette.results(q, index) est pure : tous les mots doivent se trouver, le titre compte plus que le détail.
 * Clavier : ↑ ↓ pour parcourir, Entrée pour ouvrir, Échap pour fermer. Le focus reste dans le champ, et les touches
 * s'arrêtent à la couche : les raccourcis de l'application n'agissent pas pendant la saisie.
 */

'use strict';

const Palette = (function () {
    const RECENT_KEY = 'chessTrainer_paletteRecent', RECENT_MAX = 5, GROUP_MAX = 5;
    const GROUPS = ['Récents', 'Suggestions', 'Actions', 'Ouvertures', 'Positions', 'Répertoires', 'Réglages', 'Finales', 'Autres ouvertures', 'Aide'];
    const LOW = ['Autres ouvertures', 'Aide'];
    const isMac = () => /Mac|iPhone|iPad/.test((navigator && navigator.platform) || '');
    const keyLabel = () => (isMac() ? '⌘F' : 'Ctrl F');
    const SIDE = { w: 'Blancs', b: 'Noirs' };

    let layer = null, opener = null, index = [], shown = [], sel = 0;

    // ─── RECHERCHE ────────────────────────────────────────────────────────────
    const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    // 0 : absent. Plus le mot est tôt et dans le titre, plus le score monte.
    function wordScore(word, title, small, words) {
        if (title.startsWith(word)) return 6;
        if ((' ' + title).includes(' ' + word)) return 5;
        if (title.includes(word)) return 4;
        if ((' ' + words).includes(' ' + word)) return 3;
        if (small.includes(word)) return 2;
        return words.includes(word) ? 1 : 0;
    }

    function results(q, items, recent = []) {
        const words = norm(q).split(/\s+/).filter(Boolean);
        if (!words.length) {
            const rec = recent.map(id => items.find(x => x.id === id)).filter(Boolean).map(x => ({ ...x, group: 'Récents' }));
            const seen = new Set(rec.map(x => x.id));
            return rec.concat(items.filter(x => x.suggest && !seen.has(x.id)).map(x => ({ ...x, group: 'Suggestions' })));
        }
        const hits = [];
        items.forEach(x => {
            if (x.needsDigit && !/\d/.test(q)) return;
            const title = norm(I18n.t(x.title)) + ' ' + norm(x.title), small = norm(I18n.t(x.small || '')), kw = norm(x.words);
            let score = 0;
            for (const w of words) {
                const s = wordScore(w, title, small, kw);
                if (!s) return;
                score += s;
            }
            if (recent.includes(x.id)) score += 1;
            hits.push({ ...x, score });
        });
        // Les groupes gardent leurs meilleurs résultats ; le groupe du meilleur résultat passe en tête,
        // sauf ce qui n'est pas à l'utilisateur ou n'est qu'une explication (LOW), toujours après.
        const byGroup = new Map();
        hits.sort((a, b) => b.score - a.score).forEach(x => {
            const g = byGroup.get(x.group) || [];
            if (g.length < GROUP_MAX) g.push(x);
            byGroup.set(x.group, g);
        });
        return [...byGroup.entries()]
            .sort((a, b) => LOW.includes(a[0]) - LOW.includes(b[0]) || b[1][0].score - a[1][0].score || GROUPS.indexOf(a[0]) - GROUPS.indexOf(b[0]))
            .flatMap(e => e[1]);
    }

    // ─── CATALOGUE ───────────────────────────────────────────────────────────
    const gameOpen = () => {
        const gs = document.getElementById('game-screen');
        return !!gs && gs.style.display !== 'none' && !gs.classList.contains('hidden');
    };
    const inSession = () => typeof trainingState !== 'undefined' && !!trainingState.session;
    // Quitte l'écran de jeu avant une action lancée depuis l'accueil.
    const fromHome = fn => () => { if (gameOpen()) goHome(); fn(); };

    function actionItems() {
        const a = (id, icon, title, small, words, run, extra = {}) => ({ id: 'act:' + id, group: 'Actions', icon, title, small, words, run, ...extra });
        const due = reviewPlan(currentRepertoire).forecast(null, 1)[0] || 0;
        const list = [
            a('play', 'crown', 'Jouer', 'Onglet', 'accueil répertoire', () => goHome('play'), { leave: true, keys: ['1'] }),
            a('stats', 'bar-chart', 'Statistiques', 'Onglet', 'maîtrise régularité progrès', () => goHome('stats'), { leave: true, keys: ['2'] }),
            a('training', 'target', 'Entraînement', 'Onglet', 'exercices séance', () => goHome('training'), { leave: true, keys: ['3'] }),
            a('endgame', 'pawn', 'Finales', 'Onglet', 'exercices', () => goHome('endgame'), { leave: true, keys: ['4'] }),
            a('daily', 'target', 'Révision du jour', due ? `${due} à réviser aujourd’hui` : 'Rien à réviser aujourd’hui', 'réviser répétition espacée séance',
                fromHome(() => startDailyReview()), { leave: true, keys: ['L'], suggest: due > 0, off: !due }),
            a('weak', 'target', 'Points faibles', 'Exercice d’Entraînement', 'erreurs fragiles', () => { if (gameOpen()) goHome(); openTrainingFrom({ focus: 'weak' }); }, { leave: true }),
            a('white', 'crown', 'Jouer les Blancs', 'Ajouter ou revoir une ligne', 'nouvelle ligne', fromHome(() => startGame('w')), { leave: true, suggest: !due }),
            a('black', 'crown', 'Jouer les Noirs', 'Ajouter ou revoir une ligne', 'nouvelle ligne', fromHome(() => startGame('b')), { leave: true, suggest: !due }),
            a('analysis', 'cpu', 'Analyse', 'Moteur et brouillon', 'stockfish moteur évaluation', () => UI_ACTIONS.helpAnalysis(), { leave: true, suggest: true }),
            a('games', 'microscope', 'Analyser mes parties', 'Lichess, Chess.com, PGN collé', 'importer lichess chesscom chess.com', () => showGameReview(), { leave: true, suggest: true }),
            a('import', 'upload', 'Importer un PGN', 'Ajouter des lignes au répertoire', 'fichier', () => showPgnImport(), { leave: true }),
            a('newrep', 'plus', 'Nouveau répertoire', 'Créer un répertoire', 'créer ajouter', () => createRepertoirePrompt(), { leave: true }),
            a('trash', 'trash', 'Corbeille', 'Restaurer ce qui a été supprimé', 'supprimé restaurer', () => showTrash(), { leave: true }),
            a('settings', 'settings', 'Paramètres', 'Fenêtre', 'réglages options préférences', () => showSettings(), { keys: [','] }),
            a('account', 'user', 'Compte', 'Profil et synchronisation', 'connexion profil synchronisation avatar', () => AccountUI.open()),
            a('help', 'help', 'Aide', 'Fenêtre', 'comment ça marche guide', () => showHelp(), { keys: ['?'] }),
            a('theme', 'palette', 'Mode clair ou sombre', 'Changer de thème', 'thème nuit jour', () => toggleTheme(), { keys: ['D'] }),
            a('sound', 'volume', 'Couper ou remettre les sons', 'Sons', 'son muet silence volume', () => setPref('sound', !appSettings.sound), { keys: ['M'] })
        ];
        if (gameOpen()) list.push(
            a('flip', 'arrow-left-right', 'Retourner l’échiquier', 'Partie en cours', 'inverser', () => flipBoard(), { keys: ['F'] }),
            a('pgn', 'external-link', 'Copier la partie en PGN', 'Partie en cours', 'exporter copier', () => copyGamePgn(document.querySelector('.moves-export')), { keys: ['C'] }));
        return list;
    }

    // Ouvertures et positions du répertoire actif (même regroupement que les Statistiques).
    function repertoireItems() {
        const rows = repertoireRows().map(r => ({ side: r.color, k: r.key, e: r.e, path: r.e.path && r.e.path.length ? r.e.path : null }));
        const items = [];
        groupByOpening(rows).filter(g => g.named).forEach(g => items.push({
            id: `op:${g.side}|${g.name}`, group: 'Ouvertures', icon: 'book', title: g.name,
            small: `${SIDE[g.side]} · ${g.n} position${g.n > 1 ? 's' : ''}`, words: _movesLabel(g.path), leave: true,
            run: fromHome(() => { startGame(g.side); loadPositionFromPath(g.path); setStatus(g.name, 'info', 'Continuez la ligne depuis cette position.'); })
        }));
        rows.filter(r => r.path).forEach(r => {
            const line = _movesLabel(r.path.slice(0, -1)) || 'Position initiale';
            items.push({
                id: `pos:${r.side}|${r.k}`, group: 'Positions', icon: 'target', title: line, needsDigit: true,
                small: `${SIDE[r.side]} · réponse ${formatSanText(r.e.san, r.side)}`, words: _movesLabel(r.path).replace(/\d+\.+\s*/g, ''), leave: true,
                run: fromHome(() => openStatsPreview(r.side, r.k))
            });
        });
        return { items, names: new Set(rows.map(r => r.op && r.op.name).filter(Boolean)) };
    }

    function otherItems(known) {
        const items = [], seen = new Set();
        OPENING_NAMES_SRC.forEach(line => {
            const name = line.split('|')[0];
            if (known.has(name) || seen.has(name)) return;
            seen.add(name);
            items.push({
                id: 'other:' + name, group: 'Autres ouvertures', icon: 'cpu', title: name, small: 'Ouvrir dans l’Analyse', leave: true,
                run: () => {
                    const moves = line.split('|')[1];
                    let path = null;
                    resolveOpeningNames();
                    _withEngineSnapshot(() => {
                        parseFEN(INIT_FEN);
                        path = moves.split(' ').map(san => { const u = _sanToUci(san); _applyUciRaw(u); return u; });
                    });
                    if (gameOpen()) goHome();
                    openAnalysis(path);
                }
            });
        });
        return items;
    }

    function helpItems() {
        const items = [];
        HELP_TASKS.forEach(t => items.push({ id: 'task:' + t.id, group: 'Aide', icon: t.icon, title: t.title, small: t.steps, leave: true, run: () => { const x = HELP_TARGETS[t.to]; UI_ACTIONS[x.action](x.arg); } }));
        HELP_GUIDES.forEach(g => items.push({ id: 'guide:' + g.id, group: 'Aide', icon: g.icon, title: g.title, small: g.sub, run: () => showHelp('g-' + g.id) }));
        HELP_FAQ.forEach(([fq, fa]) => items.push({ id: 'faq:' + fq, group: 'Aide', icon: 'help', title: fq, small: 'Question fréquente', words: fa.replace(/<[^>]+>/g, ''), run: () => showHelp('faq') }));
        return items;
    }

    function buildIndex() {
        const session = inSession(), rep = repertoireItems();
        const reps = loadRepertoireList().filter(n => n !== currentRepertoire).map(n => ({
            id: 'rep:' + n, group: 'Répertoires', icon: 'book', title: n, small: repertoireNote(n) || 'Changer de répertoire', leave: true,
            run: () => { if (gameOpen()) switchGameRepertoire(n); else selectRepertoire(n); }
        }));
        const finals = ENDGAME_EXERCISES.map(ex => ({
            id: 'eg:' + ex.id, group: 'Finales', icon: 'pawn', title: ex.title, leave: true,
            small: (ENDGAME_CATEGORIES.find(c => c.id === ex.cat) || {}).label || 'Finale', run: fromHome(() => startEndgame(ex.id))
        }));
        const all = [...actionItems(), ...rep.items, ...reps, ...settingsSearchIndex(), ...finals, ...otherItems(rep.names), ...helpItems()];
        return session ? all.filter(x => !x.leave) : all;
    }

    // ─── MÉMOIRE DES CHOIX ───────────────────────────────────────────────────
    function readRecent() {
        try {
            const v = JSON.parse(dataStore.get(RECENT_KEY));
            return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, RECENT_MAX) : [];
        } catch (e) { return []; }
    }
    const remember = id => dataStore.set(RECENT_KEY, JSON.stringify([id, ...readRecent().filter(x => x !== id)].slice(0, RECENT_MAX)));

    // ─── AFFICHAGE ───────────────────────────────────────────────────────────
    const keysHTML = ks => ks.map(k => `<kbd>${escapeHtml(k)}</kbd>`).join('');

    function render(q) {
        shown = results(q, index, readRecent());
        sel = 0;
        const list = layer.querySelector('.pal-list'), input = layer.querySelector('.pal-input');
        let html = '', group = '';
        shown.forEach((x, i) => {
            if (x.group !== group) {
                if (group) html += '</div>';
                html += `<div role="group" aria-label="${escapeHtml(x.group)}"><div class="pal-h" aria-hidden="true">${escapeHtml(x.group)}</div>`;
                group = x.group;
            }
            html += `<div class="pal-row" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === 0}">
                <span class="pal-ico">${ico(x.icon)}</span><span class="pal-txt"><b>${escapeHtml(x.title)}</b>${x.small ? `<small>${escapeHtml(x.small)}</small>` : ''}</span>
                ${x.keys ? `<span class="pal-keys">${keysHTML(x.keys)}</span>` : ''}</div>`;
        });
        if (group) html += '</div>';
        list.innerHTML = html || `<div class="pal-empty" role="status">Rien sur « ${escapeHtml(q)} »</div>`;
        list.scrollTop = 0;
        input.setAttribute('aria-expanded', String(shown.length > 0));
        if (shown.length) input.setAttribute('aria-activedescendant', 'pal-0'); else input.removeAttribute('aria-activedescendant');
    }

    function select(i) {
        if (!shown.length) return;
        sel = (i + shown.length) % shown.length;
        layer.querySelectorAll('.pal-row').forEach((el, n) => {
            el.setAttribute('aria-selected', String(n === sel));
            if (n === sel && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
        });
        layer.querySelector('.pal-input').setAttribute('aria-activedescendant', 'pal-' + sel);
    }

    function choose(i) {
        const x = shown[i];
        if (!x) return;
        remember(x.id);
        close(false);
        x.run();
    }

    function open() {
        if (layer) { layer.querySelector('.pal-input').select(); return; }
        opener = document.activeElement;
        try { index = buildIndex(); } catch (e) { reportError('palette de recherche', e); index = []; }
        layer = document.createElement('div');
        layer.className = 'pal-layer';
        layer.innerHTML = `<div class="pal-backdrop" data-pal="close"></div>
            <div class="pal-box" role="dialog" aria-modal="true" aria-label="Rechercher">
                <label class="pal-field">${ico('search')}<input class="pal-input" type="text" role="combobox" aria-controls="pal-list" aria-autocomplete="list" aria-expanded="false"
                    aria-label="Rechercher une action, une ouverture, un réglage" placeholder="Une action, une ouverture, un réglage…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
                <div class="pal-list" id="pal-list" role="listbox" aria-label="Résultats"></div>
                <div class="pal-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> parcourir</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>Échap</kbd> fermer</span><span class="pal-native"><kbd>${keyLabel()}</kbd> recherche du navigateur</span></div>
            </div>`;
        document.body.appendChild(layer);
        const input = layer.querySelector('.pal-input');
        input.addEventListener('input', () => render(input.value));
        layer.addEventListener('keydown', onKey);
        // Le focus reste dans le champ : le clavier du téléphone ne se referme pas au toucher d'une ligne.
        layer.addEventListener('mousedown', e => { if (e.target !== input) e.preventDefault(); });
        layer.addEventListener('click', e => {
            if (e.target.closest('[data-pal="close"]')) return close();
            const row = e.target.closest('.pal-row');
            if (row) choose(Number(row.dataset.i));
        });
        layer.addEventListener('mousemove', e => {
            const row = e.target.closest('.pal-row');
            if (row && Number(row.dataset.i) !== sel) {
                sel = Number(row.dataset.i);
                layer.querySelectorAll('.pal-row').forEach((el, n) => el.setAttribute('aria-selected', String(n === sel)));
                input.setAttribute('aria-activedescendant', 'pal-' + sel);
            }
        });
        render('');
        input.focus();
    }

    function close(restore = true) {
        if (!layer) return;
        layer.remove();
        layer = null;
        if (restore && opener && opener.focus && document.contains(opener)) opener.focus();
        opener = null;
    }

    // Touches arrêtées à la couche, sauf ⌘F / ⌘K que le gestionnaire du document a déjà traités.
    function onKey(e) {
        if (e.metaKey || e.ctrlKey) return;
        e.stopPropagation();
        if (e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); if (!e.isComposing) choose(sel); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'Tab') e.preventDefault();
    }

    // ─── ⌘F ET ⌘K ────────────────────────────────────────────────────────────
    function onShortcut(e) {
        if (e.altKey || e.shiftKey || !(isMac() ? e.metaKey : e.ctrlKey)) return;
        const k = String(e.key).toLowerCase();
        if (k !== 'f' && k !== 'k') return;
        if (layer) {                                  // seconde pression de ⌘F : la recherche du navigateur s'ouvre
            close();
            if (k === 'k') e.preventDefault();
            return;
        }
        const overlay = document.querySelector('.overlay:not(.hidden), .rp-layer');
        if (overlay) {
            const input = overlay.querySelector('[data-pn="search"]');
            if (input && document.activeElement !== input) { e.preventDefault(); input.focus(); }
            return;
        }
        e.preventDefault();
        open();
    }
    document.addEventListener('keydown', onShortcut, true);

    registerActions({ paletteOpen: () => open() });
    const btn = document.getElementById('palette-btn');
    if (btn) btn.title = `Rechercher (${keyLabel()})`;

    return { open, close, results, isOpen: () => !!layer };
})();
