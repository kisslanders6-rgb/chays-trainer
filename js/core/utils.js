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

// Filet : une erreur que personne n'a prévue laisse une trace ; au démarrage, elle se voit aussi (l'écran peut rester figé).
let _bootPhase = true;
window.addEventListener('load', () => setTimeout(() => { _bootPhase = false; }, 3000));
const _BOOT_ERROR_MSG = "Un problème est survenu au démarrage. Rechargez la page ; si cela continue, exportez une sauvegarde depuis Paramètres › Données.";
function _uncaught(err) { reportError('erreur imprévue', err, { notify: _bootPhase, message: _BOOT_ERROR_MSG }); }
window.addEventListener('error', e => { if (e.error || e.message) _uncaught(e.error || e.message); });
window.addEventListener('unhandledrejection', e => _uncaught(e.reason));

function hideErrorToast() {
    const box = document.getElementById('error-toast');
    if (box) box.classList.add('hidden');
}

registerActions({ hideErrorToast });

// Message commun quand le navigateur refuse une écriture (stockage plein ou interdit).
const STORAGE_FULL_MSG = "Enregistrement impossible : le stockage du navigateur est plein ou indisponible. Exportez une sauvegarde (Données › Exporter), puis libérez de la place (corbeille, répertoires inutiles).";

// Échéance lisible : « dans 3 h », « dans 4 j » (long : « dans 4 jours »).
function dueInLabel(t, long) {
    const min = Math.max(1, Math.round((t - Date.now()) / 60000));
    if (min < 60)   return `dans ${min} min`;
    if (min < 1440) return `dans ${Math.round(min / 60)} h`;
    const d = Math.round(min / 1440);
    return long ? `dans ${d} jour${d > 1 ? 's' : ''}` : `dans ${d} j`;
}

// ─── NOTATION DES COUPS ───────────────────────────────────────────────────────
