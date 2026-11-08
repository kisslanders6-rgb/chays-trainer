/**
 * modules/stats/levels.js
 * ──────────────────────────────────────────────────────────────────────────
 * Niveaux de maîtrise d'une position, partagés par les Statistiques, l'Entraînement et l'arbre.
 */

'use strict';

const STATS_CONFIRM_TRIES = 3;

// Du plus fragile au plus sûr (ordre des barres, des filtres et des listes).
const STATS_LEVELS = {
    weak:     { label: 'À retravailler', one: 'À retravailler', rule: 'maîtrise sous 50 sur 100' },
    fragile:  { label: 'Fragiles',       one: 'Fragile',        rule: 'maîtrise de 50 à 69 sur 100' },
    progress: { label: 'En progrès',     one: 'En progrès',     rule: 'maîtrise de 70 à 84 sur 100' },
    solid:    { label: 'Solides',        one: 'Solide',         rule: 'maîtrise de 85 sur 100 ou plus' },
    unsure:   { label: 'À confirmer',    one: 'À confirmer',    rule: `aucune erreur, moins de ${STATS_CONFIRM_TRIES} essais` },
    mastered: { label: 'Maîtrisées',     one: 'Maîtrisée',      rule: `aucune erreur en ${STATS_CONFIRM_TRIES} essais ou plus, ou solide et réussie plusieurs révisions d'affilée` }
};

const STATS_LEVEL_ORDER = Object.keys(STATS_LEVELS);

function _level(e) {
    if (!e.failures) return e.attempts >= STATS_CONFIRM_TRIES ? 'mastered' : 'unsure';
    const m = masteryOf(e);
    if (m < STATS_WEAK_BELOW)     return 'weak';
    if (m < STATS_FRAGILE_BELOW)  return 'fragile';
    if (m < STATS_PROGRESS_BELOW) return 'progress';
    return e.attempts >= STATS_CONFIRM_TRIES && (e.interval || 0) >= STATS_SOLID_DAYS ? 'mastered' : 'solid';
}

