/**
 * modules/openings/homePanels.js
 * ──────────────────────────────────────────────────────────────────────────
 * Panneaux de l'accueil Jouer, à côté des sélecteurs (trois colonnes sur grand écran, css/home.css) :
 *   « Mes répertoires »      chaque répertoire, ses positions, ses révisions dues, sa maîtrise ; un clic le choisit.
 *   « Nouveautés à traiter » parties du journal (chessTrainer_gameLedger) arrêtées sur une nouveauté adverse ou une
 *                            position sans réponse, pour le répertoire actif, tant que la réponse n'est pas enregistrée.
 *                            Un clic ouvre Jouer sur cette position.
 *   « Dernières parties »    les parties analysées le plus récemment et leur verdict pour le répertoire actif.
 * Sur un écran étroit, seules les nouveautés restent (les répertoires ont leur puce, les parties leur fenêtre).
 * Suggestion unique « Essayer Noyer + Maestro » pour une installation antérieure restée sur Sauge + Merida
 * (chessTrainer_looksTip, propre à l'appareil : 'tried' ou 'no' ; il n'existe pas de notification générique).
 */

'use strict';

const HomePanels = (function () {
    const LIST_MAX = 5;
    const KINDS = { theory: ['Théorique', 'ok'], mistake: ['Erreur', 'err'], out: ['Hors répertoire', 'info'],
                    novelty: ['Nouveauté', 'warn'], treated: ['Traitée depuis', 'new'] };
    const date = t => (t ? new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');
    const srcName = id => ({ lichess: 'Partie Lichess', chesscom: 'Partie Chess.com' }[_gameSrc(id)] || 'PGN collé');
    let shown = [];                                   // nouveautés affichées (clic : index)

    // Fin de ligne : les quatre derniers demi-coups, numérotés (« … 7. Cf3 Cc6 8. Fb5 »).
    function lineTail(sans) {
        const from = Math.max(0, sans.length - 4);
        let out = from ? '… ' : '';
        sans.slice(from).forEach((san, k) => {
            const i = from + k, n = Math.floor(i / 2) + 1;
            out += (i % 2 === 0 ? `${n}. ` : k === 0 ? `${n}… ` : '') + formatSanText(san, i % 2 ? 'b' : 'w') + ' ';
        });
        return out.trim();
    }

    // Nouveautés du répertoire actif encore sans réponse : { id, color, path, at, vs, kind }.
    function novelties() {
        const ledger = readLedger(), out = [];
        ['w', 'b'].forEach(color => {
            const db = readDBFor(currentRepertoire, color), scope = currentRepertoire + '|' + color;
            Object.keys(ledger).forEach(id => {
                const g = ledger[id], v = g.v && g.v[scope];
                if (!v || !Array.isArray(v.path) || !['novelty', 'out'].includes(v.kind)) return;
                let key;
                try { key = Chess.key(Chess.replay(v.path)); } catch (e) { return; }
                if (!db[key]) out.push({ id, color, path: v.path, at: g.at || v.at, vs: g.vs, kind: v.kind });
            });
        });
        return out.sort((a, b) => b.at - a.at);
    }

    function repsHTML() {
        const now = Date.now();
        const rows = loadRepertoireList().map(name => {
            const all = Object.values(readDBFor(name, 'w')).concat(Object.values(readDBFor(name, 'b')));
            const due = all.filter(e => isDue(e, now)).length;
            const mastered = all.filter(e => e.attempts >= 3 && !e.failures).length;
            const pct = all.length ? Math.round(100 * mastered / all.length) : 0;
            const cur = name === currentRepertoire;
            return `<button type="button" class="hp-rep${cur ? ' is-cur' : ''}" data-action="selectRepertoire" data-arg="${escapeHtml(name)}" aria-pressed="${cur}">
                <span class="rp-ini" aria-hidden="true">${escapeHtml((name.trim()[0] || '?').toUpperCase())}</span>
                <span class="rp-txt"><b>${escapeHtml(name)}</b><small>${all.length} position${all.length > 1 ? 's' : ''}${due ? ` · ${due} à réviser` : ''}</small></span>
                <span class="hp-pct" title="${pct} % de positions maîtrisées"><i style="width:${pct}%"></i></span>
            </button>`;
        }).join('');
        return `<div class="hp-h"><h2>Mes répertoires</h2><button type="button" class="st-link" data-action="createRepertoire">Nouveau</button></div><div class="hp-list">${rows}</div>`;
    }

    function newsHTML() {
        const list = novelties();
        shown = list.slice(0, LIST_MAX);
        const head = `<div class="hp-h"><h2>Nouveautés à traiter</h2>${list.length ? `<span class="hp-n">${list.length}</span>` : ''}</div>`;
        if (!list.length) return head + `<p class="hp-empty">Aucune nouveauté en attente. Analysez vos parties : chaque coup adverse que votre répertoire ne couvre pas apparaîtra ici.
            <button type="button" class="toast-link" data-action="homeGames">Analyser mes parties</button></p>`;
        return head + `<div class="hp-list">${shown.map((x, i) => {
            const sans = _pathToSans(x.path), tail = lineTail(sans);
            return `<button type="button" class="hp-row" data-action="homeNovelty" data-arg="${i}">
                <span class="glyph" data-glyph="${x.color === 'w' ? 'K' : 'k'}">${PIECE_SVG[x.color === 'w' ? 'K' : 'k'] || ''}</span>
                <span class="rp-txt"><b>${escapeHtml(tail)}</b><small>${escapeHtml(x.vs ? 'contre ' + x.vs : srcName(x.id))}${x.at ? ' · ' + date(x.at) : ''} · ${x.kind === 'novelty' ? 'coup adverse inconnu' : 'votre coup manque'}</small></span>
                ${ico('chevron-right')}
            </button>`;
        }).join('')}</div>${list.length > LIST_MAX ? `<p class="hp-more">et ${list.length - LIST_MAX} de plus</p>` : ''}`;
    }

    function recentHTML() {
        const ledger = readLedger();
        const ids = Object.keys(ledger).filter(id => ['w', 'b'].some(c => ledger[id].v && ledger[id].v[currentRepertoire + '|' + c]))
            .sort((a, b) => (ledger[b].last || 0) - (ledger[a].last || 0)).slice(0, LIST_MAX);
        const head = `<div class="hp-h"><h2>Dernières parties</h2><button type="button" class="st-link" data-action="homeGames">Analyser</button></div>`;
        if (!ids.length) return head + `<p class="hp-empty">Aucune partie analysée pour ce répertoire.</p>`;
        return head + `<div class="hp-list">${ids.map(id => {
            const g = ledger[id], c = ['w', 'b'].find(k => g.v[currentRepertoire + '|' + k]), v = g.v[currentRepertoire + '|' + c];
            const [label, cls] = KINDS[v.kind] || ['', ''];
            return `<div class="hp-row is-static">
                <span class="glyph" data-glyph="${c === 'w' ? 'K' : 'k'}">${PIECE_SVG[c === 'w' ? 'K' : 'k'] || ''}</span>
                <span class="rp-txt"><b>${escapeHtml(g.vs ? 'contre ' + g.vs : srcName(id))}</b><small>${date(g.at || g.last)}</small></span>
                ${label ? `<span class="hp-kind ${cls}">${label}</span>` : ''}
            </div>`;
        }).join('')}</div>`;
    }

    // ─── Suggestion Noyer + Maestro ───────────────────────────────────────────
    const TIP_KEY = 'chessTrainer_looksTip';
    let tipUndo = null;                               // choix d'avant l'essai, le temps de pouvoir revenir en arrière
    function tipHTML() {
        if (tipUndo) return `<div class="looks-tip" role="status"><span><b>Noyer + Maestro appliqués.</b> Tout se règle dans Paramètres › Apparence.</span>
            <span class="looks-tip-acts"><button type="button" class="st-link" data-action="looksTip" data-arg="undo">Revenir à l'ancien</button><button type="button" class="st-link" data-action="looksTip" data-arg="close">OK</button></span></div>`;
        if (dataStore.get(TIP_KEY) !== null || dataStore.get('chessTrainer_looksDefaults') === null
            || appSettings.boardTheme !== 'classic' || appSettings.pieceSet !== 'merida') return '';
        return `<div class="looks-tip" role="note"><span class="looks-tip-sw" aria-hidden="true"></span>
            <span><b>Nouvelle apparence</b> L'échiquier Noyer et les pièces Maestro sont les nouveaux défauts. Les essayer ?</span>
            <span class="looks-tip-acts"><button type="button" class="btn btn-primary" data-action="looksTip" data-arg="try">Essayer</button><button type="button" class="st-link" data-action="looksTip" data-arg="no">Non merci</button></span></div>`;
    }
    function looksTip(arg) {
        if (arg === 'try') {
            tipUndo = { boardTheme: appSettings.boardTheme, pieceSet: appSettings.pieceSet };
            dataStore.set(TIP_KEY, 'tried');
            setPref('boardTheme', 'walnut');
            setPref('pieceSet', 'maestro');
        } else if (arg === 'undo' && tipUndo) {
            setPref('boardTheme', tipUndo.boardTheme);
            setPref('pieceSet', tipUndo.pieceSet);
            tipUndo = null;
        } else {
            if (arg === 'no') dataStore.set(TIP_KEY, 'no');
            tipUndo = null;
        }
        render();
    }

    function render() {
        const set = (id, fn) => { const el = document.getElementById(id); if (el) el.innerHTML = fn(); };
        set('looks-tip', tipHTML);
        set('hp-reps', repsHTML);
        set('hp-news', newsHTML);
        set('hp-recent', recentHTML);
    }

    function openNovelty(i) {
        const x = shown[Number(i)];
        if (!x) return;
        startGame(x.color);
        loadPositionFromPath(x.path);
        setStatus('Nouveauté à traiter', 'new', x.kind === 'novelty' ? 'Votre répertoire ne couvre pas ce coup : jouez votre réponse pour l\'enregistrer.'
                                                                    : 'Aucune réponse enregistrée ici : jouez votre coup pour l\'enregistrer.');
    }

    registerActions({ homeNovelty: openNovelty, homeGames: () => showGameReview(), looksTip });
    return { render, novelties };
})();
