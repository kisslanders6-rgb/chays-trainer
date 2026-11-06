/**
 * core/i18n.js
 * ──────────────────────────────────────────────────────────────────────────
 * Langue de l'interface. Le français reste la langue du code : un texte français sert de clé.
 * Une couche observe la page (MutationObserver) et remplace, avant l'affichage, les textes et les attributs
 * title, aria-label, placeholder, alt. Le code continue d'écrire du français ; il n'a pas à connaître la langue.
 *   Sauf : ce qui ne passe pas par la page (voix, titre, boîtes natives) et ce qui relit la page → I18n.t(texte).
 *
 * Dictionnaire d'une langue : { "texte français": "traduction" }. Une clé peut porter des trous : {0}, {1} (recopiés
 * en re-traduisant leur contenu), et {n} (un nombre). « 5 à réviser » se lit donc « {n} à réviser ».
 * « a|b » dans une traduction : singulier | pluriel, pour les langues dont le pluriel n'est pas un « s » final.
 * translate="no" protège un élément (noms donnés par l'utilisateur, coups).
 *
 * Langues : EMBEDDED, mises en cache hors ligne dès l'installation (sw.js) ; les autres sont des paquets
 * à télécharger (lang/<id>.json, comme le moteur complet), gardés dans le cache chays-lang.
 * Le dictionnaire actif est recopié dans chays_langPack : il doit être là, sans attendre, au premier rendu
 * (hors de chessTrainer_* : ni sauvegarde, ni synchronisation). Changer de langue recharge la page.
 */

'use strict';

const I18n = (function () {
    const LANGS = {
        fr:        { label: 'Français',          locale: 'fr-FR', letters: 'CFTDR' },
        en:        { label: 'English',           locale: 'en-GB', letters: 'NBRQK' },
        es:        { label: 'Español',           locale: 'es-ES', letters: 'CATDR' },
        'zh-Hans': { label: '简体中文',           locale: 'zh-CN', letters: 'NBRQK' },
        de:        { label: 'Deutsch',           locale: 'de-DE', letters: 'SLTDK' },
        'pt-PT':   { label: 'Português (Portugal)', locale: 'pt-PT', letters: 'CBTDR' },
        'pt-BR':   { label: 'Português (Brasil)', locale: 'pt-BR', letters: 'CBTDR' },
        ru:        { label: 'Русский',           locale: 'ru-RU', letters: ['К', 'С', 'Л', 'Ф', 'Кр'] },
        ja:        { label: '日本語',             locale: 'ja-JP', letters: 'NBRQK' },
        hi:        { label: 'हिन्दी',               locale: 'hi-IN', letters: 'NBRQK' },
        ar:        { label: 'العربية',            locale: 'ar',    letters: 'NBRQK', rtl: true }
    };
    const EMBEDDED = ['fr', 'en', 'es', 'zh-Hans'];
    const PACK_KEY = 'chays_langPack', CACHE = 'chays-lang';
    const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
    const SKIP = 'script,style,textarea,[translate="no"],.move-token,.pgn-text';

    let lang = 'fr', dict = null, patterns = [], htmlPatterns = [];
    const memo = new Map(), outputs = new Set(), missing = new Set();

    // ─── CHARGEMENT ──────────────────────────────────────────────────────────
    const prefLang = () => {
        try {
            const v = JSON.parse(dataStore.get('chessTrainer_settings') || '{}').lang;
            return LANGS[v] ? v : 'fr';
        } catch (e) { return 'fr'; }
    };
    const esc = s => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

    const spaces = t => t.replace(/[\u00a0\u202f]/g, ' ');

    // Un trou prend n'importe quel texte seulement si la phrase autour est assez longue pour être sûre.
    // « {0} sur {1} » (peu de lettres) n'accepte qu'un nombre ou un mot court : sinon il avalerait toute phrase avec « sur ».
    const WIDE = '(.*?)', NARROW = '([\\d.,]+ ?\\S{0,3}|\\S{0,10})';
    function install(id, table) {
        lang = id; dict = {}; patterns = []; htmlPatterns = []; memo.clear();
        Object.keys(table).forEach(raw => {
            const k = spaces(raw);
            dict[k] = table[raw];
            if (!/\{\d\}/.test(k)) return;
            const letters = k.replace(/<[^>]+>|\{\d\}/g, '').replace(/[^\p{L}]/gu, '').length;
            if (!letters) return;
            const order = [...k.matchAll(/\{(\d)\}/g)].map(m => m[1]);
            // Un trou annoncé par la ponctuation (« Aperçu : {0} », « {0} : … ») reste large, même dans une phrase courte.
            const parts = k.split(/\{\d\}/);
            const source = parts.map((part, i) => esc(part) + (i === parts.length - 1 ? '' :
                letters >= 12 || /[:·«]\s*$/.test(part) || /^\s*[:·»]/.test(parts[i + 1]) ? WIDE : NARROW)).join('');
            (/<[a-z]/.test(k) ? htmlPatterns : patterns).push({ re: new RegExp('^' + source + '$', 's'), order, out: table[raw], size: letters });
        });
        const bySize = (a, b) => b.size - a.size;                                 // la phrase la plus précise d'abord
        patterns.sort(bySize); htmlPatterns.sort(bySize);
    }

    // ─── TRADUCTION D'UN TEXTE ───────────────────────────────────────────────
    function lookup(raw, list = patterns) {
        const text = spaces(raw);
        if (Object.prototype.hasOwnProperty.call(dict, text)) return dict[text];
        const nums = text.match(/\d[\d\s.,]*\d|\d/g);
        if (nums) {
            const hit = dict[text.replace(/\d[\d\s.,]*\d|\d/g, '{n}')];
            if (hit !== undefined) { let i = 0; return hit.replace(/\{n\}/g, () => nums[i++]); }
        }
        for (const p of list) {
            const m = p.re.exec(text);
            if (!m) continue;
            const vals = {};
            p.order.forEach((id, i) => { vals[id] = translate(m[i + 1]); });
            // « Zug|Züge » : le français marque son pluriel par un trou (« coup{1} » vaut « s ») ; ces langues ont leur propre forme.
            const forms = p.out.split('|');
            const out = forms.length > 1 ? forms[Object.values(vals).some(v => v === 's' || v === 'x') ? 1 : 0] : p.out;
            return out.replace(/\{(\d)\}/g, (_, id) => vals[id]);
        }
        return null;
    }

    function translate(raw) {
        if (!dict || !raw) return raw;
        if (memo.has(raw)) return memo.get(raw);
        if (outputs.has(raw.trim())) return raw;
        const whole = /\p{L}/u.test(raw) ? lookup(raw.trim()) : null;        // avec sa ponctuation : « Je veux… »
        if (whole !== null) {
            const out = raw.replace(raw.trim(), () => whole);
            memo.set(raw, out);
            outputs.add(out.trim());
            return out;
        }
        const lead = raw.match(/^[\s ·•:,…-]*/)[0], trail = raw.slice(lead.length).match(/[\s ·•:,…-]*$/)[0];
        const core = raw.slice(lead.length, raw.length - trail.length);
        let out = raw;
        if (core && /\p{L}/u.test(core)) {
            const hit = lookup(core);
            if (hit !== null) out = lead + hit + trail;
            else if (!outputs.has(core)) missing.add(core);
        }
        memo.set(raw, out);
        outputs.add(out.trim());
        return out;
    }

    // ─── PAGE ────────────────────────────────────────────────────────────────
    const skipped = el => !el || !el.closest || !!el.closest(SKIP);

    function doText(node) {
        if (skipped(node.parentElement)) return;
        const v = node.data, out = translate(v);
        if (out !== v) node.data = out;
    }
    function doAttrs(el) {
        if (skipped(el)) return;
        ATTRS.forEach(a => {
            const v = el.getAttribute(a);
            if (!v) return;
            const out = translate(v);
            if (out !== v) el.setAttribute(a, out);
        });
    }
    // Une phrase avec des mots en valeur (« une <b>date</b> de révision ») se traduit entière : l'ordre des mots change
    // d'une langue à l'autre. Sinon, chaque morceau est traduit à part (walk).
    const INLINE = /^(B|STRONG|EM|I|KBD|CODE|U)$/;
    function doBlock(el) {
        if (el.nodeType !== 1 || !el.firstElementChild || skipped(el)) return false;
        if (![...el.children].every(c => INLINE.test(c.tagName) && !c.attributes.length)) return false;
        const html = el.innerHTML.replace(/\s+/g, ' ').trim();
        if (outputs.has(html)) return true;
        const hit = lookup(html, htmlPatterns);
        if (hit === null) return false;
        outputs.add(hit);
        el.innerHTML = hit;
        return true;
    }
    function walk(root) {
        if (root.nodeType === 3) return doText(root);
        if (root.nodeType !== 1 && root.nodeType !== 11) return;
        if (root.nodeType === 1) { if (skipped(root)) return; doAttrs(root); if (doBlock(root)) return; }
        for (let n = root.firstChild; n; n = n.nextSibling) walk(n);
    }

    function start() {
        if (lang === 'fr') return;
        document.documentElement.lang = lang;
        document.documentElement.dir = LANGS[lang].rtl ? 'rtl' : 'ltr';
        document.title = translate(document.title);
        const nativeAlert = window.alert, nativeConfirm = window.confirm;     // boîtes natives : hors de la page
        window.alert = m => nativeAlert.call(window, translate(String(m)));
        window.confirm = m => nativeConfirm.call(window, translate(String(m)));
        walk(document.body);
        new MutationObserver(list => list.forEach(m => {
            if (m.type === 'characterData') doText(m.target);
            else if (m.type === 'attributes') doAttrs(m.target);
            else if (!doBlock(m.target)) m.addedNodes.forEach(walk);
        })).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }

    // ─── PAQUETS ─────────────────────────────────────────────────────────────
    const cacheOpen = () => (typeof caches !== 'undefined' ? caches.open(CACHE) : Promise.resolve(null));
    const url = id => `lang/${id}.json`;

    async function hasPack(id) {
        if (EMBEDDED.includes(id)) return true;
        const c = await cacheOpen();
        return !!(c && await c.match(url(id)));
    }
    // onProgress(fraction) tant que la taille est connue.
    async function download(id, onProgress) {
        const res = await fetch(url(id), { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const total = Number(res.headers.get('content-length')) || 0;
        const copy = res.clone();
        if (onProgress && total && res.body) {
            const r = res.body.getReader();
            let got = 0;
            for (;;) {
                const { done, value } = await r.read();
                if (done) break;
                got += value.length;
                onProgress(Math.min(1, got / total));
            }
        }
        const c = await cacheOpen();
        if (c) await c.put(url(id), copy);
    }
    async function removePack(id) {
        if (EMBEDDED.includes(id) || id === lang) return;
        const c = await cacheOpen();
        if (c) await c.delete(url(id));
    }
    async function readPack(id) {
        const c = EMBEDDED.includes(id) ? null : await cacheOpen();
        const hit = c && await c.match(url(id));
        return (hit || await fetch(url(id))).json();
    }
    // Recopie le dictionnaire puis recharge ; une erreur (hors ligne, stockage plein) laisse la langue actuelle.
    async function use(id) {
        if (id !== 'fr') dataStore.set(PACK_KEY, JSON.stringify({ id, dict: await readPack(id) }));
        else dataStore.remove(PACK_KEY);
        if (typeof setPref === 'function') setPref('lang', id);
        location.reload();
    }

    // ─── DÉMARRAGE ───────────────────────────────────────────────────────────
    (function boot() {
        const id = prefLang();
        if (id === 'fr') return;
        try {
            const pack = JSON.parse(dataStore.get(PACK_KEY) || 'null');
            if (pack && pack.id === id) { install(id, pack.dict); return; }
        } catch (e) { /* copie abîmée : relue ci-dessous */ }
        // Copie absente (stockage vidé) : français pour cette fois, la langue revient au prochain lancement.
        readPack(id).then(d => dataStore.set(PACK_KEY, JSON.stringify({ id, dict: d }))).catch(() => {});
    })();
    start();

    return {
        LANGS, EMBEDDED, start, use, download, removePack, hasPack,
        t: text => translate(text),
        lang: () => lang,
        locale: () => LANGS[lang].locale,
        letters: () => LANGS[lang].letters,
        missing: () => [...missing],
        install
    };
})();
