/**
 * core/utils.js
 * ──────────────────────────────────────────────────────────────────────────
 * Outils partagés par tous les modules :
 *   escapeHtml(s)        texte sûr à insérer dans du HTML (contenu ou attribut entre guillemets)
 *   registerActions({})  actions déclenchées par data-action dans le HTML généré :
 *                          <button data-action="startEndgame" data-arg="kq-k">…</button>
 *                        → UI_ACTIONS.startEndgame('kq-k', élément, événement)
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
