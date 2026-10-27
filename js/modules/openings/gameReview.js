/**
 * modules/openings/gameReview.js
 * ──────────────────────────────────────────────────────────────────────────
 * « Analyser une partie » : on colle le PGN d'une partie jouée (Chess.com, Lichess…) et l'on
 * cherche le premier demi-coup qui sort du répertoire actif pour la couleur choisie.
 *   - coup de MON camp différent de la réponse enregistrée → erreur d'ouverture :
 *     attempts + 1, failures + 1, révision remise à plus tard (comme un mauvais coup dans « Jouer ») ;
 *   - coup ADVERSE menant à une position sans réponse de mon camp → nouveauté adverse
 *     (aucune erreur comptée).
 *   - déviation déjà TRAITÉE : la réponse qui la couvre a été enregistrée APRÈS la partie (champ created
 *     de l'entrée, ou verdict noté au journal lors d'une analyse précédente) → « Traitée depuis »,
 *     rien n'est compté ; une réponse jamais réussie passe en tête de la révision du jour (prio).
 * Les transpositions sont naturelles : la base est indexée par position, pas par ordre de coups.
 * L'échiquier est ensuite placé APRÈS le coup déviant, avec toute la partie dans l'historique :
 * ◀ montre la dernière position théorique, ▶ la suite de la partie.
 * Chaque partie analysée est notée au journal synchronisé (chessTrainer_gameLedger) : « déjà analysée »,
 * et une erreur n'est comptée qu'une fois par partie, répertoire et couleur, sur tous les appareils.
 * Lecture du PGN : outils de pgn.js (seule la ligne principale est suivie).
 */

'use strict';

const REVIEWED_GAMES_KEY  = 'chessTrainer_reviewedGames';

let _reviewColor = 'w';
let _reviewTab   = 'online';          // onglet ouvert en dernier : « Mes parties en ligne » ou « Coller un PGN »

// ─── LECTURE DE LA PARTIE ─────────────────────────────────────────────────────

// Parties d'un texte PGN : [{ headers, sans }] (variantes et commentaires ignorés).
function pgnGames(text) {
    return _pgnSplitGames(_pgnTokenize(text || '')).map(g => ({ headers: g.headers, sans: _pgnParseLine(g.toks, { i: 0 }, true).map(m => m.san) }));
}

// Première partie d'un texte PGN ; null si aucune.
function pgnMainLine(text) {
    return pgnGames(text)[0] || null;
}

// ─── DÉTECTION DE LA DÉVIATION ────────────────────────────────────────────────
// Fonction pure (le moteur est restauré) : ne modifie ni la base ni l'affichage.
//   sans  : coups SAN de la partie · color : camp de l'utilisateur ('w' | 'b')
//   db    : base de ce camp (openingDB) · opp : réponses adverses connues (oppSeen)
//   playedAt : date de la partie (ms) ; une réponse enregistrée après (created) ne fait pas sortir du répertoire
//              mais rend la déviation « traitée ». 0 : date inconnue, règle désactivée.
// Renvoie {
//   moves     : [{ uci, san }] — toute la partie, jusqu'au premier coup illisible exclu
//   illegal   : { ply, san } | null
//   deviation : null (100 % théorique) | {
//       ply      : indice (0-based) du coup déviant dans `moves`
//       by       : 'me' | 'opp'
//       key      : position AVANT le coup déviant
//       expected : { uci, san } | null — ma réponse enregistrée (by 'me')
//       known    : la réponse adverse était déjà repérée, sans réponse de mon camp (by 'opp')
//       endOfLine: plus aucune réponse adverse couverte ici : fin de la préparation (by 'opp')
//       treated  : la réponse qui couvre cette déviation date d'après la partie · answerKey : sa position } }

function detectDeviation(sans, color, db, opp, playedAt = 0) {
    const res = { moves: [], illegal: null, deviation: null };
    _withEngineSnapshot(() => {
        parseFEN(INIT_FEN);
        for (let ply = 0; ply < sans.length; ply++) {
            const uci = _resolveSan(sans[ply]);
            if (!uci) { res.illegal = { ply, san: sans[ply] }; break; }
            if (!res.deviation) res.deviation = _deviationAt(uci, ply, color, db, opp, playedAt);
            res.moves.push({ uci, san: _applyUciRaw(uci) });
        }
    });
    return res;
}

// Le coup `uci` (pas encore joué) sort-il du répertoire ? null s'il y reste.
function _deviationAt(uci, ply, color, db, opp, playedAt) {
    const key = positionKey();
    const newer = e => playedAt > 0 && !!e && e.created > playedAt;          // réponse enregistrée après la partie
    if (turn === color) {
        const e = db[key];
        if (e && e.move === uci) return null;
        if (newer(e)) return { ply, by: 'me', key, expected: null, treated: true, answerKey: key };
        return { ply, by: 'me', key, expected: e ? { uci: e.move, san: e.san } : null };
    }
    const next = Chess.key(Chess.play(Chess.snapshot(), uci));
    if (db[next] && !newer(db[next])) return null;
    if (db[next]) return { ply, by: 'opp', key, treated: true, answerKey: next };
    let endOfLine = true;
    _forEachChild(() => { if (db[positionKey()]) endOfLine = false; });
    return { ply, by: 'opp', key, known: (opp[key] || []).includes(uci), endOfLine };
}

// ─── JOURNAL DES PARTIES ANALYSÉES (synchronisé) ─────────────────────────────
// chessTrainer_gameLedger : identifiant de partie → {
//   src     : 'lichess' | 'chesscom' | 'pgn' · at : date de la partie (0 : inconnue)
//   first / last : première et dernière analyse
//   vs      : adversaire (en-têtes White / Black)
//   v       : { 'rép|couleur': { kind, ply, by, at, path? } }   verdict de la dernière analyse ; path (coups UCI) :
//             nouveauté ou hors répertoire, la position où ma réponse manque (accueil : « Nouveautés à traiter »)
//   counted : { 'rép|couleur': { at } } }                 erreur comptée : une seule fois, sur tous les appareils
// L'ancienne liste chessTrainer_reviewedGames (signatures, propre à l'appareil) reste lue pour ne rien recompter.

const GAME_LEDGER_KEY  = 'chessTrainer_gameLedger';
const GAME_LEDGER_KEEP = 1500;

function _fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
}

// Identifiant stable : adresse de la partie (Link Chess.com, Site Lichess), sinon empreinte des en-têtes et des coups.
function gameIdOf(headers, sans) {
    const url = [headers.Link, headers.Site].find(u => typeof u === 'string' && /^https?:\/\//.test(u.trim()));
    if (url) return url.trim().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
    return 'pgn:' + _fnv1a([headers.White, headers.Black, headers.UTCDate || headers.Date, headers.UTCTime || headers.StartTime || '', sans.join(' ')].join('|'));
}

const _gameSrc = id => /^lichess\./.test(id) ? 'lichess' : /^chess\.com\//.test(id) ? 'chesscom' : 'pgn';

// Date de la partie (ms, UTC) d'après les en-têtes ; 0 si inconnue. Sans heure : début de la journée
// (une réponse enregistrée ce jour-là compte comme postérieure : au bénéfice du joueur).
function gamePlayedAt(h) {
    const d = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(h.UTCDate || h.EndDate || h.Date || '');
    if (!d) return 0;
    const t = /^(\d{1,2}):(\d{2}):(\d{2})/.exec(h.UTCTime || h.EndTime || h.StartTime || '') || [0, 0, 0, 0];
    const ms = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]);
    return Number.isFinite(ms) ? ms : 0;
}

function readLedger() {
    const l = dataStore.getJSON(GAME_LEDGER_KEY, null);
    return l && typeof l === 'object' && !Array.isArray(l) ? l : {};
}

// Les parties les moins récemment analysées partent d'abord ; celles où une erreur a été comptée en dernier.
function writeLedger(l) {
    const ids = Object.keys(l);
    if (ids.length > GAME_LEDGER_KEEP) {
        const counted = id => (l[id].counted && Object.keys(l[id].counted).length ? 1 : 0);
        ids.sort((a, b) => (counted(a) - counted(b)) || ((l[a].last || 0) - (l[b].last || 0)))
           .slice(0, ids.length - GAME_LEDGER_KEEP).forEach(id => { delete l[id]; });
    }
    dataStore.setJSON(GAME_LEDGER_KEY, l);
}

// Ancienne signature (chessTrainer_reviewedGames) : seulement relue.
function _gameSignature(headers, sans, color = playerColor, rep = currentRepertoire) {
    const id = headers.Link || headers.Site && /^https?:/.test(headers.Site) && headers.Site
            || [headers.White, headers.Black, headers.Date, headers.UTCTime || headers.EndTime || ''].join('|');
    return `${rep}|${color}|${id}|${sans.length}`;
}

function _legacyCounted(sig) {
    const list = dataStore.getJSON(REVIEWED_GAMES_KEY, []);
    return Array.isArray(list) && list.includes(sig);
}

// Compare une partie au répertoire `rep` (camp `color`), compte l'erreur au besoin et note le verdict dans
// `ledger` (lu et écrit par l'appelant : une seule écriture pour un lot de parties).
//   base : { db, opp, save } — save() est appelé si db a changé (erreur comptée, priorité posée)
// Renvoie { r, kind, counted, prev, answer, ply, by } :
//   kind    : 'theory' | 'mistake' | 'out' | 'novelty' | 'treated' (null : premier coup illisible, rien n'est noté)
//   counted : 'counted' | 'already' | null
//   prev    : { first, kind } si la partie avait déjà été analysée pour ce répertoire et cette couleur
//   ply, by : demi-coup et camp de la déviation retenue · answer : { key, san } de la réponse ajoutée depuis
function reviewGame(game, color, rep, base, ledger) {
    const now = Date.now(), id = gameIdOf(game.headers, game.sans), scope = rep + '|' + color;
    const g = ledger[id] || null, pv = g && g.v && g.v[scope] || null;
    const at = gamePlayedAt(game.headers);
    const known = Math.min(at || Infinity, (g && g.first) || Infinity);   // la partie précède sa première analyse
    const r = detectDeviation(game.sans, color, base.db, base.opp, Number.isFinite(known) ? known : 0);
    if (!r.moves.length) return { r, kind: null, counted: null, prev: null, answer: null };

    const d = r.deviation;
    let kind = !d ? 'theory' : d.treated ? 'treated' : d.by === 'opp' ? 'novelty' : d.expected ? 'mistake' : 'out';
    let ply = d ? d.ply : -1, by = d ? d.by : null, answerKey = d && d.treated ? d.answerKey : null;
    // Entrées sans date (d'avant octobre 2026) : la déviation notée à une analyse précédente fait foi,
    // la réponse attendue après elle a été préparée depuis.
    if (kind === 'mistake' && pv && ['novelty', 'out', 'treated'].includes(pv.kind) && pv.ply <= d.ply) {
        kind = 'treated'; ply = pv.ply; by = pv.by || (pv.kind === 'novelty' ? 'opp' : 'me'); answerKey = d.key;
    }

    let counted = null;
    if (kind === 'mistake') {
        if ((g && g.counted && g.counted[scope]) || _legacyCounted(_gameSignature(game.headers, game.sans, color, rep))) counted = 'already';
        else {
            const e = base.db[d.key];
            e.attempts++;
            e.failures++;
            recordReview(e, false);
            base.save();
            counted = 'counted';
        }
    }
    const ans = answerKey ? base.db[answerKey] : null;
    if (ans && ans.attempts === ans.failures && !ans.prio) { ans.prio = now; base.save(); }   // jamais réussie

    const entry = ledger[id] = g || { src: _gameSrc(id), at, first: now, last: now, v: {}, counted: {} };
    entry.v = entry.v || {};
    entry.counted = entry.counted || {};
    if (!entry.at && at) entry.at = at;
    const vs = color === 'w' ? game.headers.Black : game.headers.White;
    if (vs && vs !== '?') entry.vs = String(vs).slice(0, 40);
    entry.last = now;
    entry.v[scope] = { kind, ply, by, at: now };
    if (kind === 'novelty' || kind === 'out')      // position où ma réponse manque : après le coup adverse, ou avant le mien
        entry.v[scope].path = r.moves.slice(0, kind === 'novelty' ? ply + 1 : ply).map(m => m.uci);
    if (counted === 'counted') entry.counted[scope] = { at: now };
    return { r, kind, counted, prev: pv ? { first: g.first, kind: pv.kind } : null,
             answer: ans ? { key: answerKey, san: ans.san } : null, ply, by };
}

// ─── MODALE ───────────────────────────────────────────────────────────────────

function showGameReview() {
    _reviewColor = playerColor;
    document.getElementById('review-target').textContent = currentRepertoire;
    document.getElementById('review-text').value = '';
    document.getElementById('review-result').innerHTML = '';
    _paintReviewColor();
    document.getElementById('review-overlay').classList.remove('hidden');
    setReviewTab(_reviewTab);
}

function closeGameReview() {
    document.getElementById('review-overlay').classList.add('hidden');
}

function setReviewColor(c) { _reviewColor = c; _paintReviewColor(); }

function _paintReviewColor() {
    ColorScope.render(document.getElementById('review-color'), { options: ['w', 'b'], value: _reviewColor, onChange: setReviewColor, label: 'Ma couleur dans cette partie' });
}

// Couleur jouée dans la partie par l'un de vos pseudos (profil, dernier pseudo des parties en ligne), sinon null.
function _profileColor(headers) {
    const names = [typeof appSettings !== 'undefined' && appSettings.lichessUser, typeof appSettings !== 'undefined' && appSettings.chesscomUser,
                   typeof _onlinePrefs === 'function' && _onlinePrefs().user].filter(Boolean);
    for (const u of names) { const c = _userColor(headers, u); if (c) return c; }
    return null;
}

// html : figurines du jeu actif (HTML échappé) ; sinon texte simple (barre d'état).
const _plyLabel = (ply, san, html) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'} ${(html ? formatSan : formatSanText)(san, ply % 2 ? 'b' : 'w')}`;

function runGameReview() {
    const out  = document.getElementById('review-result');
    const note = (cls, msg) => { out.innerHTML = `<div class="pgn-note ${cls}">${msg}</div>`; };
    const game = pgnMainLine(document.getElementById('review-text').value);

    if (!game || !game.sans.length) { note('err', 'Aucune partie reconnue : collez le PGN complet (exporté depuis Chess.com ou Lichess).'); return; }
    if (game.headers.FEN && game.headers.FEN.split(' ')[0] !== INIT_FEN.split(' ')[0]) {
        note('err', 'Cette partie commence depuis une position personnalisée : elle ne peut pas être comparée au répertoire.'); return;
    }
    const auto = _profileColor(game.headers);                          // votre pseudo figure dans la partie : sa couleur l'emporte
    if (auto && auto !== _reviewColor) setReviewColor(auto);

    const rep = currentRepertoire, color = _reviewColor;
    const same = color === playerColor && _gameScreenShown() && gameMode === 'play';   // base en mémoire à jour
    const db = same ? openingDB : readDBFor(rep, color);
    const base = { db, opp: same ? oppSeen : readOppFor(rep, color),
                   save: same ? saveDB : () => dataStore.set(dbKeyFor(rep, color), JSON.stringify(db)) };
    const ledger = readLedger();
    const res = reviewGame(game, color, rep, base, ledger);
    if (!res.kind) { note('err', `Premier coup illisible ou illégal : <strong>${escapeHtml(res.r.illegal.san)}</strong>.`); return; }
    writeLedger(ledger);

    openPlay(color);
    recordGameFrequencies([game], () => color);                        // onglet « Adversaire » (une fois par partie)
    closeGameReview();
    showReviewResult(res);
}

const _shortDate = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

// Place l'échiquier après le coup déviant (toute la partie dans l'historique) et résume le verdict.
// res : résultat de reviewGame.
function showReviewResult(res) {
    const r = res.r, d = r.deviation;
    loadPositionFromPath(r.moves.map(m => m.uci));
    navGo(d ? res.ply : r.moves.length - 1);               // après le coup déviant ; ◀ = dernière position théorique

    const illegal = r.illegal ? ` Coup illisible (${r.illegal.san}) : partie lue jusqu'au coup précédent.` : '';
    const seen = res.prev ? `Partie déjà analysée le ${_shortDate(res.prev.first).replace(/\.$/, '')}. ` : '';
    const at = d ? _plyLabel(res.ply, r.moves[res.ply].san) : '';
    if (res.kind === 'theory') {
        setStatus('✓ Partie 100 % théorique', 'ok', `${seen}Aucun coup n'est sorti du répertoire (${r.moves.length} demi-coups).${illegal}`);
    } else if (res.kind === 'treated') {
        const ans = res.answer ? formatSanText(res.answer.san, res.answer.key.split(' ')[1] === 'b' ? 'b' : 'w') : 'une réponse';
        setStatus(`✓ Traitée depuis : ${at}`, 'ok',
            seen + (res.by === 'opp' ? `Ce coup vous avait sorti de votre préparation. ` : `Votre répertoire n'avait pas encore de réponse ici. `)
            + `Vous avez ajouté ${ans} depuis : rien n'est compté.${illegal}`);
    } else if (res.kind === 'mistake') {
        setStatus(`✗ Erreur d'ouverture : ${at}`, 'err',
            (res.counted === 'already' ? `${seen || 'Partie déjà analysée. '}Erreur non recomptée. ` : 'Erreur comptée. ') + `◀ pour retrouver le bon coup.${illegal}`);
    } else if (res.kind === 'out') {
        setStatus(`Hors répertoire : ${at}`, 'info', `${seen}Votre répertoire n'a pas encore de réponse ici.${illegal}`);
    } else {
        setStatus(`Nouveauté adverse : ${at}`, 'hint',
            seen + (d.endOfLine ? 'Vous étiez au bout de votre préparation. ' : d.known ? 'Réponse déjà repérée, toujours non couverte. ' : 'Coup absent de votre répertoire. ')
            + `Aucune erreur comptée.${illegal}`);
    }
    if (typeof refreshTree === 'function') refreshTree();
    if (window.innerWidth < 920) document.getElementById('board').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
