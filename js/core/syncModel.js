/**
 * core/syncModel.js
 * ──────────────────────────────────────────────────────────────────────────
 * MODÈLE DE DONNÉES ET RÈGLES DE FUSION du stockage hybride (utilisé par syncEngine.js).
 * Fonctions PURES : aucun DOM, aucun réseau, aucun accès au stockage.
 *
 * Unité de synchronisation = une clé de stockage (un « document » JSON).
 *   chessTrainer_repertoires     'list'      noms des répertoires
 *   openingDB_{rép}_{couleur}    'db'        position → { move, san, attempts, failures, path?, ply?, lastReviewed?, interval?, due?, created?, prio? }
 *   openingOpp_{rép}_{couleur}   'opp'       position → [coups UCI adverses connus]
 *   chessTrainer_trash           'trash'     [{ id, type, deletedAt, … }]
 *   chessTrainer_endgames        'endgames'  exercice → { tries, wins, perfect, best, last }
 *   chessTrainer_activity        'activity'  jour (AAAA-MM-JJ) → { a: essais, f: erreurs }
 *   chessTrainer_prefs           'prefs'     préférence → { v: valeur, at: date du choix } (échiquier, pièces, flèches)
 *   chessTrainer_gameLedger      'games'     partie analysée → { src, at, first, last, v: { 'rép|couleur': verdict }, counted: { … } }
 * Tout le reste (mode clair / sombre, sons, options d'entraînement, état de sauvegarde…)
 * reste LOCAL à l'appareil.
 *
 * Fusion À TROIS POINTS : merge(base, local, remote)
 *   base   = dernière version synchronisée avec succès (copie locale conservée)
 *   local  = version actuelle de cet appareil
 *   remote = version actuelle sur le serveur
 * La base permet (1) de calculer des deltas de compteurs exacts, (2) de distinguer
 * « supprimé » de « jamais eu » sans « tombstones ».
 * Chaque fusion est SYMÉTRIQUE (merge(b,l,r) = merge(b,r,l)) : deux appareils qui fusionnent
 * dans l'ordre inverse obtiennent exactement le même résultat, sans ping-pong.
 *
 * Valeur absente (clé / entrée inexistante) = null.
 */

'use strict';

const SyncModel = (function () {

    // ─── Portée ───────────────────────────────────────────────────────────────
    function kindOf(key) {
        if (key === 'chessTrainer_repertoires') return 'list';
        if (key === 'chessTrainer_trash')       return 'trash';
        if (key === 'chessTrainer_endgames')    return 'endgames';
        if (key === 'chessTrainer_activity')    return 'activity';
        if (key === 'chessTrainer_prefs')       return 'prefs';
        if (key === 'chessTrainer_gameLedger')  return 'games';
        if (typeof key === 'string' && key.startsWith('openingDB_'))  return 'db';
        if (typeof key === 'string' && key.startsWith('openingOpp_')) return 'opp';
        return null;
    }
    const isSynced = key => kindOf(key) !== null;

    // ─── Outils ───────────────────────────────────────────────────────────────
    function stable(v) {
        if (v === undefined || v === null) return 'null';
        if (typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
        return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    }
    const same  = (a, b) => stable(a) === stable(b);
    const clone = v => (v === null || v === undefined) ? null : JSON.parse(JSON.stringify(v));
    const num   = x => (Number.isFinite(x) ? x : 0);
    const minStr = (a, b) => (a == null ? b : b == null ? a : (a <= b ? a : b));

    // Échelle commune : cas triviaux (identiques, un seul côté a changé, suppression vs modification).
    // La modification l'emporte toujours sur la suppression (aucune perte de données).
    function ladder(b, l, r, specific) {
        if (same(l, r)) return clone(l);
        if (same(l, b)) return clone(r);
        if (same(r, b)) return clone(l);
        if (l == null) return clone(r);
        if (r == null) return clone(l);
        return specific(b, l, r);
    }

    // Fusion à trois points d'un ensemble de valeurs primitives. Ordre déterministe (symétrique) :
    // éléments de la base (dans l'ordre de la base) puis nouveautés triées.
    function mergeSet(base, local, remote) {
        const B = new Set(base || []), L = new Set(local || []), R = new Set(remote || []);
        const keep = x => B.has(x) ? (L.has(x) && R.has(x)) : (L.has(x) || R.has(x));
        const out = [], seen = new Set();
        (base || []).forEach(x => { if (keep(x) && !seen.has(x)) { out.push(x); seen.add(x); } });
        const added = [];
        [...L, ...R].forEach(x => { if (!B.has(x) && keep(x) && !seen.has(x)) { added.push(x); seen.add(x); } });
        added.sort((a, c) => (stable(a) < stable(c) ? -1 : stable(a) > stable(c) ? 1 : 0));
        return out.concat(added);
    }

    // Fusion d'une table clé → valeur, entrée par entrée.
    function mergeMap(base, local, remote, mergeValue) {
        base = base || {}; local = local || {}; remote = remote || {};
        const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
        const out = {};
        [...keys].sort().forEach(k => {
            const v = ladder(base[k] ?? null, local[k] ?? null, remote[k] ?? null, mergeValue);
            if (v !== null) out[k] = v;
        });
        return out;
    }

    // ─── Bases d'ouvertures ───────────────────────────────────────────────────
    function later(l, r) {                                   // la plus récente (lastReviewed), égalité → coup le plus grand
        const a = num(l.lastReviewed), c = num(r.lastReviewed);
        if (a !== c) return a > c ? l : r;
        return l.move >= r.move ? l : r;
    }

    function pickPath(a, b) {
        if (!a || !a.length) return b && b.length ? b : null;
        if (!b || !b.length) return a;
        if (a.length !== b.length) return a.length < b.length ? a : b;
        return stable(a) <= stable(b) ? a : b;
    }

    function combineSameMove(b, l, r) {
        const sameBase = b && b.move === l.move;
        const ba = sameBase ? num(b.attempts) : 0, bf = sameBase ? num(b.failures) : 0;
        const la = num(l.attempts), ra = num(r.attempts), lf = num(l.failures), rf = num(r.failures);
        const attempts = Math.max(la, ra, la + ra - ba);                       // base + delta local + delta distant
        const failures = Math.min(attempts, Math.max(lf, rf, lf + rf - bf));
        const out = { move: l.move, san: minStr(l.san, r.san) || l.move, attempts, failures };
        const path = pickPath(l.path, r.path);
        if (path) { out.path = path.slice(); out.ply = path.length; }
        const lr = Math.max(num(l.lastReviewed), num(r.lastReviewed));
        if (lr > 0) out.lastReviewed = lr;
        // Planning de révision : celui du passage le plus récent (égalité → échéance la plus lointaine).
        const s = [l, r].reduce((x, y) => (num(y.lastReviewed) - num(x.lastReviewed) || num(y.due) - num(x.due) || num(y.interval) - num(x.interval)) > 0 ? y : x);
        if (num(s.due) > 0) { out.due = s.due; out.interval = num(s.interval); }
        const created = [l.created, r.created].filter(x => num(x) > 0);        // première date d'enregistrement connue
        if (created.length) out.created = Math.min(...created);
        // Priorité : celle du passage le plus récent (elle est levée par une réussite) ; sinon l'une ou l'autre.
        const prio = num(l.lastReviewed) === num(r.lastReviewed) ? Math.max(num(l.prio), num(r.prio)) : num(s.prio);
        if (prio > 0) out.prio = prio;
        return out;
    }

    function mergeEntry(b, l, r) {
        if (l.move !== r.move) {
            // Réponse remplacée : le remplacement (statistiques remises à zéro) l'emporte sur de simples compteurs.
            if (b && l.move === b.move) return clone(r);
            if (b && r.move === b.move) return clone(l);
            return clone(later(l, r));                                          // remplacée des deux côtés : la plus récente
        }
        return combineSameMove(b, l, r);
    }

    const mergeDB = (b, l, r) => mergeMap(b, l, r, mergeEntry);

    // ─── Réponses adverses connues ────────────────────────────────────────────
    function mergeOpp(b, l, r) {
        const out = mergeMap(b, l, r, (bb, ll, rr) => mergeSet(bb, ll, rr));
        Object.keys(out).forEach(k => { if (!out[k].length) delete out[k]; });
        return out;
    }

    // ─── Liste des répertoires ────────────────────────────────────────────────
    const mergeList = (b, l, r) => mergeSet(b, l, r);

    // ─── Corbeille ────────────────────────────────────────────────────────────
    function mergeTrash(b, l, r) {
        const by = arr => { const m = {}; (arr || []).forEach(it => { if (it && it.id) m[it.id] = it; }); return m; };
        const merged = mergeMap(by(b), by(l), by(r), (bb, ll, rr) => {
            const a = num(ll.count), c = num(rr.count);                        // restauration partielle : le plus petit reste
            if (a !== c) return clone(a < c ? ll : rr);
            return clone(stable(ll) <= stable(rr) ? ll : rr);
        });
        return Object.values(merged).sort((x, y) => (y.deletedAt - x.deletedAt) || (x.id < y.id ? -1 : 1));
    }

    // ─── Progression des finales ──────────────────────────────────────────────
    function mergeProgress(b, l, r) {
        const bt = b ? num(b.tries) : 0, bw = b ? num(b.wins) : 0;
        const tries = Math.max(num(l.tries), num(r.tries), num(l.tries) + num(r.tries) - bt);
        const wins  = Math.max(num(l.wins),  num(r.wins),  num(l.wins)  + num(r.wins)  - bw);
        const bests = [l.best, r.best].filter(x => num(x) > 0);
        return { tries, wins, perfect: !!(l.perfect || r.perfect),
                 best: bests.length ? Math.min(...bests) : 0, last: Math.max(num(l.last), num(r.last)) };
    }
    const mergeEndgames = (b, l, r) => mergeMap(b, l, r, mergeProgress);

    // ─── Journal d'activité (essais / erreurs par jour) ───────────────────────
    function mergeDay(b, l, r) {
        const ba = b ? num(b.a) : 0, bf = b ? num(b.f) : 0;
        const a = Math.max(num(l.a), num(r.a), num(l.a) + num(r.a) - ba);
        return { a, f: Math.min(a, Math.max(num(l.f), num(r.f), num(l.f) + num(r.f) - bf)) };
    }
    const mergeActivity = (b, l, r) => mergeMap(b, l, r, mergeDay);

    // ─── Préférences d'affichage : le choix le plus récent l'emporte, champ par champ ──
    function mergePref(b, l, r) {
        const a = num(l.at), c = num(r.at);
        if (a !== c) return clone(a > c ? l : r);
        return clone(stable(l) >= stable(r) ? l : r);                    // même date : choix déterministe
    }
    const mergePrefs = (b, l, r) => mergeMap(b, l, r, mergePref);

    // ─── Journal des parties analysées ────────────────────────────────────────
    // Verdict : le plus récent (at) l'emporte. Erreur comptée : la première, gardée à vie (jamais recomptée).
    function mergeGame(b, l, r) {
        const pos = [l.first, r.first].filter(x => num(x) > 0);
        const out = { src: minStr(l.src, r.src) || '', at: Math.max(num(l.at), num(r.at)),
                      first: pos.length ? Math.min(...pos) : 0, last: Math.max(num(l.last), num(r.last)) };
        out.v = mergeMap(b && b.v, l.v, r.v, (bb, ll, rr) => mergePref(bb, ll, rr));
        out.counted = mergeMap(b && b.counted, l.counted, r.counted, (bb, ll, rr) => {
            const a = num(ll.at), c = num(rr.at);
            if (a !== c) return clone(a < c ? ll : rr);
            return clone(stable(ll) <= stable(rr) ? ll : rr);
        });
        return out;
    }
    const mergeGames = (b, l, r) => mergeMap(b, l, r, mergeGame);

    // ─── Point d'entrée ───────────────────────────────────────────────────────
    const MERGERS = { db: mergeDB, opp: mergeOpp, list: mergeList, trash: mergeTrash, endgames: mergeEndgames, activity: mergeActivity, prefs: mergePrefs, games: mergeGames };

    // Valeurs déjà décodées (null = absent). Renvoie la valeur fusionnée (null = supprimée).
    function merge(key, base, local, remote) {
        const kind = kindOf(key);
        if (!kind) throw new Error('Clé non synchronisée : ' + key);
        return ladder(base ?? null, local ?? null, remote ?? null, MERGERS[kind]);
    }

    // Variante sur chaînes brutes (telles que stockées). JSON invalide = traité comme absent.
    function parse(raw) { if (raw == null) return null; try { return JSON.parse(raw); } catch (e) { return null; } }
    function mergeRaw(key, baseRaw, localRaw, remoteRaw) {
        const v = merge(key, parse(baseRaw), parse(localRaw), parse(remoteRaw));
        return v === null ? null : JSON.stringify(v);
    }

    return { kindOf, isSynced, merge, mergeRaw, same };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { SyncModel };
