/**
 * core/bus.js
 * ──────────────────────────────────────────────────────────────────────────
 * Petit bus d'événements synchrone : les données annoncent ce qui a changé, les écrans décident quoi redessiner.
 * Ainsi le stockage et la synchronisation n'ont pas à connaître les écrans.
 *   Bus.on(nom, fn)            abonne fn(données)
 *   Bus.emit(nom, données)     appelle les abonnés, dans l'ordre ; l'erreur de l'un n'arrête pas les autres
 * Événements : data:changed (clés reçues de la synchro) · data:imported · trash:restored · backup:changed ·
 * sync:status · i18n:lang · ui:refresh · elo:choice (site ou cadence de l'Elo).
 */

'use strict';

const Bus = (function () {
    const subs = {};
    return {
        on(name, fn) { (subs[name] = subs[name] || []).push(fn); },
        emit(name, data) {
            (subs[name] || []).forEach(fn => { try { fn(data); } catch (e) { reportError('événement ' + name, e); } });
        }
    };
})();
