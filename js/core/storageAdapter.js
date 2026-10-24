/**
 * core/storageAdapter.js
 * ──────────────────────────────────────────────────────────────────────────
 * TOUS les accès au stockage passent par `dataStore`. Par défaut l'adaptateur est
 * LocalStorageAdapter ; quand un compte est connecté, cloudAdapter.js le remplace par un
 * adaptateur qui marque les clés synchronisables à envoyer (dataStore.setAdapter(...)),
 * sans que les modules appelants n'aient à changer.
 *
 * Contrat d'un adaptateur (SYNCHRONE — le reste de l'application ne sait pas attendre) :
 *   get(key)         → string | null   (jamais d'exception ; null si absent ou erreur)
 *   set(key, value)  → boolean         (true = écrit ; false = échec, ex. stockage plein)
 *   remove(key)      → boolean
 *   keys()           → string[]
 *
 * À charger AVANT storage.js.
 */

'use strict';

const LocalStorageAdapter = {
    name: 'local',
    get(key)        { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } },
    remove(key)     { try { localStorage.removeItem(key); return true; } catch (e) { return false; } },
    keys() {
        const out = [];
        try { for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); } catch (e) { /* stockage interdit : aucune clé */ }
        return out;
    }
};

const dataStore = {
    adapter: LocalStorageAdapter,

    setAdapter(a) { this.adapter = a || LocalStorageAdapter; },

    // Chaînes brutes
    get(key)         { return this.adapter.get(key); },
    // Une écriture refusée (stockage plein ou interdit) est toujours signalée à l'utilisateur.
    set(key, value)  {
        const ok = this.adapter.set(key, String(value));
        if (!ok && typeof reportError === 'function') reportError('écriture de ' + key, new Error('écriture refusée'), { notify: true, message: STORAGE_FULL_MSG });
        return ok;
    },
    remove(key)      { return this.adapter.remove(key); },
    keys()           { return this.adapter.keys(); },

    // JSON : getJSON renvoie `fallback` si la clé est absente OU si le JSON est invalide.
    getJSON(key, fallback = null) {
        const raw = this.get(key);
        if (raw === null) return fallback;
        try { return JSON.parse(raw); } catch (e) { return fallback; }
    },
    setJSON(key, value) { return this.set(key, JSON.stringify(value)); },

    // Écriture qui lève une exception en cas d'échec (pour les blocs try/catch existants).
    mustSet(key, value) {
        if (!this.set(key, value)) throw new Error('Stockage indisponible : ' + key);
    }
};
