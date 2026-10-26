/**
 * core/utils.js
 * ──────────────────────────────────────────────────────────────────────────
 * Outils partagés par tous les modules :
 *   escapeHtml(s)        texte sûr à insérer dans du HTML (contenu ou attribut entre guillemets)
 *   registerActions({})  actions déclenchées par data-action dans le HTML généré :
 *                          <button data-action="startEndgame" data-arg="kq-k">…</button>
 *                        → UI_ACTIONS.startEndgame('kq-k', élément, événement)
 *   reportError(ctx, e)  erreur tracée en console ; avec { notify: true }, message visible (cf. plus bas)
 * Le HTML généré ne contient ainsi aucun code (pas d'onclick="…" construit par concaténation) :
 * une valeur venue de l'utilisateur, d'un import ou de la synchro ne peut pas devenir du script.
 * À charger avant les autres modules.
 */

'use strict';

const _ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => _ESC_MAP[c]); }

const UI_ACTIONS = {};
function registerActions(map) { Object.assign(UI_ACTIONS, map); }

function _runAction(e, type) {
    const el = e.target.closest && e.target.closest(`[data-${type}]`);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    const fn = UI_ACTIONS[el.dataset[type]];
    if (fn) fn(el.dataset.arg, el, e);
}

document.addEventListener('click',  e => _runAction(e, 'action'));
document.addEventListener('change', e => _runAction(e, 'change'));
document.addEventListener('keydown', e => {                 // éléments non-bouton activables au clavier
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-action]:not(button):not(input):not(select)')) {
        e.preventDefault();
        _runAction(e, 'action');
    }
});

// ─── ERREURS ──────────────────────────────────────────────────────────────────
// Une erreur attendue sans conséquence (stockage interdit en navigation privée, JSON illisible remplacé par
// une valeur par défaut) se commente sur place. Toute autre erreur passe par reportError : trace en console,
// et, quand l'utilisateur risque de perdre quelque chose (notify), message visible jusqu'à fermeture.

function reportError(context, err, opts = {}) {
    try { console.warn(`[Chays Trainer] ${context}`, err); } catch (e) { /* console indisponible */ }
    if (!opts.notify) return;
    const box = document.getElementById('error-toast');
    if (!box) return;
    document.getElementById('error-toast-text').textContent = opts.message || `Problème pendant : ${context}.`;
    box.classList.remove('hidden');
}

function hideErrorToast() {
    const box = document.getElementById('error-toast');
    if (box) box.classList.add('hidden');
}

registerActions({ hideErrorToast });

// Message commun quand le navigateur refuse une écriture (stockage plein ou interdit).
const STORAGE_FULL_MSG = "Enregistrement impossible : le stockage du navigateur est plein ou indisponible. Exportez une sauvegarde (Données › Exporter), puis libérez de la place (corbeille, répertoires inutiles).";

// ─── NOTATION DES COUPS ───────────────────────────────────────────────────────
// Les coups sont stockés en notation anglaise (N B R Q K), affichés selon le réglage « Écriture des coups » :
// lettres françaises (C F T D R), anglaises, ou figurines.
//   formatSan(san, couleur)     → HTML (échappé) : en mode figurines, la pièce du jeu actif, à la couleur du camp
//                                 (<span class="fig">, image lue dans --fig-wN… écrites par applyPieceSet).
//   formatSanText(san, couleur) → texte simple (barre d'état, title, copie) : figurines Unicode en mode figurines.
// Le jeu « Invisibles » n'a pas de dessin de pièce : les figurines repassent aux lettres françaises.
const _SAN_FR  = { N: 'C', B: 'F', R: 'T', Q: 'D', K: 'R' };
const _SAN_FIG = { w: { N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔' }, b: { N: '♞', B: '♝', R: '♜', Q: '♛', K: '♚' } };
const _FIG_NAMES = { N: 'Cavalier', B: 'Fou', R: 'Tour', Q: 'Dame', K: 'Roi' };
function _sanMode() {
    const s = typeof appSettings !== 'undefined' ? appSettings : { notation: 'en' };
    return s.notation === 'fig' && s.pieceSet === 'blindfold' ? 'fr' : s.notation || 'en';
}
function formatSanText(san, color) {
    const mode = _sanMode();
    if (!san || mode === 'en') return san || '';
    const map = mode === 'fig' ? _SAN_FIG[color === 'b' ? 'b' : 'w'] : _SAN_FR;
    return san.replace(/[NBRQK]/g, c => map[c]);
}
function formatSan(san, color) {
    if (!san) return '';
    if (_sanMode() !== 'fig') return escapeHtml(formatSanText(san, color));
    const c = color === 'b' ? 'b' : 'w';
    return escapeHtml(san).replace(/[NBRQK]/g, p => `<span class="fig fig-${c}" style="--f:var(--fig-${c}${p})" role="img" aria-label="${_FIG_NAMES[p]}"></span>`);
}
