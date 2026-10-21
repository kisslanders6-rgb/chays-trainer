/**
 * modules/openings/gameReview.js
 * ──────────────────────────────────────────────────────────────────────────
 * « Analyser une partie » : on colle le PGN d'une partie jouée (Chess.com, Lichess…) et l'on
 * cherche le premier demi-coup qui sort du répertoire actif pour la couleur choisie.
 *   - coup de MON camp différent de la réponse enregistrée → erreur d'ouverture :
 *     attempts + 1, failures + 1, révision remise à plus tard (comme un mauvais coup dans « Jouer ») ;
 *   - coup ADVERSE menant à une position sans réponse de mon camp → nouveauté adverse
 *     (aucune erreur comptée).
 * Les transpositions sont naturelles : la base est indexée par position, pas par ordre de coups.
 * L'échiquier est ensuite placé APRÈS le coup déviant, avec toute la partie dans l'historique :
 * ◀ montre la dernière position théorique, ▶ la suite de la partie.
 * Une même partie (même répertoire, même couleur) n'est comptée qu'une fois.
 * Lecture du PGN : outils de pgn.js (seule la ligne principale est suivie).
 */

'use strict';

const REVIEWED_GAMES_KEY  = 'chessTrainer_reviewedGames';
const REVIEWED_GAMES_KEEP = 300;

let _reviewColor = 'w';

// ─── LECTURE DE LA PARTIE ─────────────────────────────────────────────────────

// Première partie d'un texte PGN : { headers, sans } (variantes et commentaires ignorés) ; null si aucune.
function pgnMainLine(text) {
    const g = _pgnSplitGames(_pgnTokenize(text || ''))[0];
    if (!g) return null;
    return { headers: g.headers, sans: _pgnParseLine(g.toks, { i: 0 }, true).map(m => m.san) };
}

// ─── DÉTECTION DE LA DÉVIATION ────────────────────────────────────────────────
// Fonction pure (le moteur est restauré) : ne modifie ni la base ni l'affichage.
//   sans  : coups SAN de la partie · color : camp de l'utilisateur ('w' | 'b')
//   db    : base de ce camp (openingDB) · opp : réponses adverses connues (oppSeen)
// Renvoie {
//   moves     : [{ uci, san }] — toute la partie, jusqu'au premier coup illisible exclu
//   illegal   : { ply, san } | null
//   deviation : null (100 % théorique) | {
//       ply      : indice (0-based) du coup déviant dans `moves`
//       by       : 'me' | 'opp'
//       key      : position AVANT le coup déviant
//       expected : { uci, san } | null — ma réponse enregistrée (by 'me')
//       known    : la réponse adverse était déjà repérée, sans réponse de mon camp (by 'opp')
//       endOfLine: plus aucune réponse adverse couverte ici : fin de la préparation (by 'opp') } }

function detectDeviation(sans, color, db, opp) {
    const res = { moves: [], illegal: null, deviation: null };
    _withEngineSnapshot(() => {
        parseFEN(INIT_FEN);
        for (let ply = 0; ply < sans.length; ply++) {
            const uci = _resolveSan(sans[ply]);
            if (!uci) { res.illegal = { ply, san: sans[ply] }; break; }
            if (!res.deviation) res.deviation = _deviationAt(uci, ply, color, db, opp);
            res.moves.push({ uci, san: _applyUciRaw(uci) });
        }
    });
    return res;
}

// Le coup `uci` (pas encore joué) sort-il du répertoire ? null s'il y reste.
function _deviationAt(uci, ply, color, db, opp) {
    const key = positionKey();
    if (turn === color) {
        const e = db[key];
        if (e && e.move === uci) return null;
        return { ply, by: 'me', key, expected: e ? { uci: e.move, san: e.san } : null };
    }
    const before = _engineState();
    _applyUciRaw(uci);
    const covered = !!db[positionKey()];
    _restoreEngine(before);
    if (covered) return null;
    let endOfLine = true;
    _forEachChild(() => { if (db[positionKey()]) endOfLine = false; });
    return { ply, by: 'opp', key, known: (opp[key] || []).includes(uci), endOfLine };
}

// ─── ERREUR D'OUVERTURE : COMPTAGE (une seule fois par partie) ────────────────

function _gameSignature(headers, sans) {
    const id = headers.Link || headers.Site && /^https?:/.test(headers.Site) && headers.Site
            || [headers.White, headers.Black, headers.Date, headers.UTCTime || headers.EndTime || ''].join('|');
    return `${currentRepertoire}|${playerColor}|${id}|${sans.length}`;
}

// Compte l'erreur sur l'entrée concernée. Renvoie 'counted' | 'already' | 'none' (aucune réponse enregistrée).
function recordReviewMistake(dev, sig) {
    const e = openingDB[dev.key];
    if (!e) return 'none';
    const seen = dataStore.getJSON(REVIEWED_GAMES_KEY, []);
    const list = Array.isArray(seen) ? seen : [];
    if (list.includes(sig)) return 'already';
    e.attempts++;
    e.failures++;
    recordReview(e, false);
    saveDB();
    list.push(sig);
    dataStore.setJSON(REVIEWED_GAMES_KEY, list.slice(-REVIEWED_GAMES_KEEP));
    return 'counted';
}

// ─── MODALE ───────────────────────────────────────────────────────────────────

function showGameReview() {
    _reviewColor = playerColor;
    document.getElementById('review-target').textContent = currentRepertoire;
    document.getElementById('review-text').value = '';
    document.getElementById('review-result').innerHTML = '';
    _paintReviewColor();
    document.getElementById('review-overlay').classList.remove('hidden');
    document.getElementById('review-text').focus();
}

function closeGameReview() {
    document.getElementById('review-overlay').classList.add('hidden');
}

function setReviewColor(c) { _reviewColor = c; _paintReviewColor(); }

function _paintReviewColor() {
    ['w', 'b'].forEach(c => {
        const b = document.getElementById('review-seg-' + c);
        b.classList.toggle('active', c === _reviewColor);
        b.setAttribute('aria-pressed', c === _reviewColor);
    });
}

const _plyLabel = (ply, san) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'} ${san}`;

function runGameReview() {
    const out  = document.getElementById('review-result');
    const note = (cls, msg) => { out.innerHTML = `<div class="pgn-note ${cls}">${msg}</div>`; };
    const game = pgnMainLine(document.getElementById('review-text').value);

    if (!game || !game.sans.length) { note('err', 'Aucune partie reconnue : collez le PGN complet (exporté depuis Chess.com ou Lichess).'); return; }
    if (game.headers.FEN && game.headers.FEN.split(' ')[0] !== INIT_FEN.split(' ')[0]) {
        note('err', 'Cette partie commence depuis une position personnalisée : elle ne peut pas être comparée au répertoire.'); return;
    }

    const same = _reviewColor === playerColor;
    const r = detectDeviation(game.sans, _reviewColor, same ? openingDB : readDBFor(currentRepertoire, _reviewColor),
                              same ? oppSeen : readOppFor(currentRepertoire, _reviewColor));
    if (!r.moves.length) { note('err', `Premier coup illisible ou illégal : <strong>${escapeHtml(r.illegal.san)}</strong>.`); return; }

    // Couleur choisie différente de la couleur affichée : on bascule sur l'autre base du répertoire.
    if (!same) {
        playerColor = _reviewColor;
        loadDB();
        showGameScreen(playerColor);
    }

    const d = r.deviation;
    const counted = d && d.by === 'me' ? recordReviewMistake(d, _gameSignature(game.headers, game.sans)) : null;

    closeGameReview();
    closeAdmin();
    loadPositionFromPath(r.moves.map(m => m.uci));
    navGo(d ? d.ply : r.moves.length - 1);                 // après le coup déviant ; ◀ = dernière position théorique

    const illegal = r.illegal ? ` Coup illisible ou illégal (${r.illegal.san}) : partie lue jusqu'au coup précédent.` : '';   // setStatus : texte brut
    if (!d) {
        setStatus(`✓ Aucun coup n'est sorti du répertoire (${r.moves.length} demi-coups lus) : partie 100 % théorique.${illegal}`, 'ok');
    } else {
        const at = _plyLabel(d.ply, r.moves[d.ply].san);
        if (d.by === 'me') {
            setStatus(counted === 'none'
                ? `Déviation à ${at} : votre répertoire n'a pas encore de réponse ici.${illegal}`
                : `✗ Erreur d'ouverture à ${at} : ce n'est pas votre coup de répertoire. `
                  + (counted === 'already' ? 'Partie déjà analysée : erreur non recomptée. ' : 'Erreur comptée. ')
                  + `◀ pour retrouver le bon coup.${illegal}`,
                counted === 'none' ? 'info' : 'err');
        } else {
            setStatus(`Nouveauté adverse à ${at} : `
                + (d.endOfLine ? 'vous étiez au bout de votre préparation. ' : d.known ? 'réponse déjà repérée, toujours non couverte. ' : 'coup absent de votre répertoire. ')
                + `Aucune erreur comptée.${illegal}`, 'hint');
        }
    }
    if (typeof refreshTree === 'function') refreshTree();
    if (window.innerWidth < 920) document.getElementById('board').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
