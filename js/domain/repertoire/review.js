/**
 * domain/repertoire/review.js
 * ──────────────────────────────────────────────────────────────────────────
 * Répétition espacée : échéances, programme des révisions, score de maîtrise, note d'un passage.
 */

'use strict';

const DAY_MS           = 86400000;

const REVIEW_GROWTH    = 2.5;

// Rythme des révisions (Paramètres › Jeu) : Doux espace davantage les révisions, Intensif les rapproche.
const REVIEW_RHYTHM    = { soft: 3.2, std: REVIEW_GROWTH, intense: 1.8 };

function reviewGrowth() {
    return (typeof appSettings !== 'undefined' && REVIEW_RHYTHM[appSettings.rhythm]) || REVIEW_GROWTH;
}

const REVIEW_MAX_DAYS  = 180;

const REVIEW_RETRY_MS  = 10 * 60000;

// Intervalle (jours) estimé pour une position sans planning : 0 = jamais revue.
function impliedInterval(e) {
    if (!e.lastReviewed || !e.attempts) return 0;
    const rate = e.failures / e.attempts;
    return rate > 0.34 ? 1 : e.failures ? 3 : Math.min(30, 1 + e.attempts);
}

const dueOf = e => e.due || (e.lastReviewed ? e.lastReviewed + impliedInterval(e) * DAY_MS : 0);

const isDue = (e, now = Date.now()) => dueOf(e) <= now;

// Un seul programme par répertoire (les deux couleurs), lu par l'Entraînement, l'accueil, les Statistiques et
// la puce de répertoire, pour que tous les chiffres concordent :
//   - révisions : positions déjà travaillées (attempts > 0), le jour de leur échéance ; un retard compte aujourd'hui ;
//   - nouvelles : positions jamais révisées, au plus newPerDay() par jour (= objectif quotidien), les réponses
//     « Traitée depuis » (prio) d'abord, puis dans l'ordre d'enregistrement et de la ligne. Les suivantes attendent
//     les jours d'après : 30 coups ajoutés d'un coup ne font plus un pic de 30 aujourd'hui et rien ensuite.
function newPerDay() {
    return Math.max(1, (typeof appSettings !== 'undefined' && appSettings.dailyGoal) || 10);
}

// plan.dayOf(couleur, clé) : jour prévu (0 = aujourd'hui) ; plan.today(…) ; plan.forecast(filtre, jours) ;
// plan.next(filtre) : instant de la prochaine révision après aujourd'hui (Infinity s'il n'y en a pas).
// filtre(couleur, clé) facultatif : la portée affichée (une couleur, une ouverture).
function reviewPlan(rep = currentRepertoire, now = Date.now()) {
    const d0 = new Date(now), start = i => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime();
    const items = repertoireRows(rep);
    // Nouvelle = jamais révisée et déjà échue (une échéance future explicite est respectée comme une révision).
    items.forEach(x => { x.fresh = !x.e.attempts && dueOf(x.e) <= now; });
    const fresh = items.filter(x => x.fresh)
        .sort((a, b) => (b.e.prio ? 1 : 0) - (a.e.prio ? 1 : 0) || (a.e.created || 0) - (b.e.created || 0) || (a.e.ply || 0) - (b.e.ply || 0));
    const k = newPerDay();
    fresh.forEach((x, i) => { x.day = Math.floor(i / k); x.at = start(x.day); });
    items.forEach(x => {
        if (x.fresh) return;
        const d = dueOf(x.e);
        x.at = d;
        if (d <= now) { x.day = 0; return; }
        let i = Math.max(0, Math.floor((d - start(0)) / DAY_MS));
        while (i > 0 && d < start(i)) i--;
        while (d >= start(i + 1)) i++;
        x.day = i;
    });
    const byId = new Map(items.map(x => [x.color + '|' + x.key, x]));
    const scope = filter => filter ? items.filter(x => filter(x.color, x.key)) : items;
    const dayOf = (color, key) => { const x = byId.get(color + '|' + key); return x ? x.day : Infinity; };
    return {
        dayOf,
        today: (color, key) => dayOf(color, key) === 0,
        forecast(filter, days = 7) {
            const out = new Array(days).fill(0);
            scope(filter).forEach(x => { if (x.day < days) out[x.day]++; });
            return out;
        },
        next: filter => scope(filter).filter(x => x.day > 0).reduce((m, x) => Math.min(m, x.at), Infinity)
    };
}

// De 0 à 100, il suit les derniers passages : une erreur ancienne s'efface au fil des réussites, ce que le taux
// cumulé failures / attempts ne permettait pas. Erreur : il reste 40 % du score. Réussite : il gagne 35 % de ce qui
// manque, 10 % seulement si la révision n'était pas due (réussir tout de suite après ne prouve pas grand-chose).
const MASTERY_START     = 60;

const MASTERY_KEEP      = 0.4;

const MASTERY_GAIN_DUE  = 0.35;

const MASTERY_GAIN_SOON = 0.1;

// Sans score enregistré (position d'avant ce système) : déduit des compteurs, les niveaux ne changent donc pas.
const _masteryFrom = (attempts, failures) => attempts > 0 ? 100 * (1 - failures / attempts) : MASTERY_START;

const masteryOf = e => Number.isFinite(e.mastery) ? e.mastery : _masteryFrom(e.attempts, e.failures);

// Appelé après la mise à jour des compteurs : le score d'avant ne doit pas compter ce passage.
function _nextMastery(entry, ok, wasDue) {
    const m = Number.isFinite(entry.mastery) ? entry.mastery : _masteryFrom(entry.attempts - 1, entry.failures - (ok ? 0 : 1));
    return Math.round(ok ? m + (wasDue ? MASTERY_GAIN_DUE : MASTERY_GAIN_SOON) * (100 - m) : m * MASTERY_KEEP);
}

// Une note par passage (une seule, cf. answerTrainingMove). File « À revoir » : une erreur y fait entrer ou y ramène
// à zéro ; seule une réussite à l'échéance avance (10 min, puis 1, 3 et 7 jours) ; la troisième fait sortir de la file.
function recordReview(entry, ok) {
    const now = Date.now();
    const wasDue = isDue(entry, now), prev = entry.interval || impliedInterval(entry);
    entry.mastery = _nextMastery(entry, ok, wasDue);
    entry.lastReviewed = now;
    if (ok) delete entry.prio;                 // réponse « Traitée depuis » enfin retrouvée : priorité levée
    if (!ok) {
        entry.interval = 0;
        entry.due = now + REVIEW_RETRY_MS;
        entry.relearn = 0;
    } else if (wasDue && Number.isInteger(entry.relearn)) {
        entry.interval = RELEARN_DAYS[entry.relearn];
        entry.due = now + entry.interval * DAY_MS;
        if (entry.relearn + 1 >= RELEARN_DAYS.length) delete entry.relearn; else entry.relearn++;
    } else if (wasDue) {
        entry.interval = prev ? Math.min(REVIEW_MAX_DAYS, Math.round(prev * reviewGrowth() * 10) / 10) : 1;
        entry.due = now + entry.interval * DAY_MS;
    } else if (!entry.due) {                   // révision anticipée d'une ancienne position : son planning devient explicite
        entry.interval = prev;
        entry.due = now + prev * DAY_MS;
    }
    logActivity(ok);
}
