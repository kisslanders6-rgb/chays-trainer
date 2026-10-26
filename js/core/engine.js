/**
 * core/engine.js
 * ──────────────────────────────────────────────────────────────────────────
 * Moteur d'analyse Stockfish (WebAssembly, décrit par engine/manifest.json) dans un Web Worker, piloté en UCI.
 * Rien n'est téléchargé avant le premier calcul ; ensuite le service worker le garde hors ligne.
 *
 *   Engine.analyse(fen, { multipv, depth, movetime }, onInfo) → { stop(), done }
 *       depth 0 et movetime 0 : calcul sans fin (jusqu'à stop()).
 *       onInfo(lines), au plus 10 fois par seconde. Une ligne : { multipv, depth, seldepth, score: { cp } | { mate },
 *       wdl: [gain, nulle, perte] | null, pv: [uci…], nodes, nps } ; score et wdl du point de vue des BLANCS.
 *       done : Promise<{ best, lines, cancelled }> (best : coup UCI, null si annulé avant de commencer).
 *   Engine.bestMove(fen, opts) → Promise<{ uci, score } | null>
 *   Engine.load() → Promise (appelé tout seul au premier calcul)
 *   Engine.status() → 'absent' | 'loading' | 'ready' | 'error' ; Engine.onStatus(fn) ; Engine.info()
 *   Engine.reload() : arrête le moteur ; le prochain calcul recharge la variante choisie.
 *
 * Deux réseaux (appSettings.engineNet, propre à l'appareil) :
 *   'lite' : moteur embarqué (≈ 1,8 Mo, engine/<version>/) ;
 *   'full' : moteur complet, dont le .wasm (≈ 99 Mo) n'est pas dans le dépôt. Engine.full.download()
 *            le télécharge depuis unpkg (adresse et empreinte sha256 dans le manifeste), vérifie l'empreinte
 *            et le garde dans le cache « chays-engine » ; il est ensuite passé au Worker par une URL blob:
 *            (fragment # du script, lu par stockfish.js). Tant qu'il n'est pas téléchargé : réseau léger.
 *   Engine.full.status() → Promise<'absent' | 'ready'> · Engine.full.download(onProgress) → { cancel(), done }
 *   Engine.full.remove() · Engine.full.size()
 *
 * Un seul calcul à la fois : un nouveau calcul arrête le précédent (« stop », puis attente de son
 * « bestmove ») avant de démarrer ; seul le dernier demandé attend son tour, les autres sont annulés.
 * Variante : multi-thread si la page est isolée (crossOriginIsolated, en-têtes de vercel.json), sinon
 * mono-thread. Fils et mémoire : appSettings.engineThreads / engineHash (propres à l'appareil).
 * Tout calcul s'arrête quand la page passe en arrière-plan.
 */

'use strict';

const Engine = (function () {
    const ENGINE_CACHE = 'chays-engine';
    let manifest = null, variant = null, worker = null, state = 'absent', loading = null, error = '', blobUrl = null;
    let threads = 0, hash = 0, wdlOn = false, gen = 0;          // gen : un chargement abandonné (reload) ne termine jamais
    let cur = null, next = null, waiting = null;
    const listeners = new Set();
    const INFO_EVERY_MS = 100;

    function setState(s) {
        state = s;
        listeners.forEach(fn => { try { fn(s); } catch (e) { if (typeof reportError === 'function') reportError('moteur', e); } });
    }
    const send = cmd => worker.postMessage(cmd);
    const waitLine = test => new Promise(resolve => { waiting = { test, resolve }; });
    const cores = () => (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    const setting = (k, d) => (typeof appSettings !== 'undefined' && appSettings[k]) || d;

    function wantedThreads() {
        if (!variant || !variant.threads) return 1;
        const max = Math.max(1, cores() - 1), v = setting('engineThreads', 0);
        return Math.min(max, v > 0 ? v : Math.max(1, Math.floor(cores() / 2)));
    }

    const isolated = () => typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated && typeof SharedArrayBuffer === 'function';

    async function readManifest() {
        if (!manifest) manifest = await (await fetch('engine/manifest.json', { cache: 'no-cache' })).json();
        return manifest;
    }

    // Variante d'un réseau adaptée à la page : multi-thread si elle est isolée, sinon mono-thread.
    const pick = net => manifest.variants.find(v => v.net === net && v.threads === isolated())
                     || manifest.variants.find(v => v.net === net && !v.threads);

    function load() {
        if (state === 'ready') return Promise.resolve();
        if (loading) return loading;
        setState('loading');
        const my = ++gen, live = () => { if (my !== gen) throw new Error('remplacé'); };
        const p = loading = (async () => {
            await readManifest();
            live();
            variant = pick('lite');
            let url = variant.js.path;
            if (setting('engineNet', 'lite') === 'full' && typeof caches !== 'undefined') {
                const full = pick('full'), hit = full && await (await caches.open(ENGINE_CACHE)).match(full.wasm.url);
                if (hit) {                                                  // moteur complet téléchargé : passé au Worker en blob:
                    const blob = await hit.blob();
                    live();
                    if (blobUrl) URL.revokeObjectURL(blobUrl);
                    blobUrl = URL.createObjectURL(blob);
                    variant = full;
                    url = `${full.js.path}#${encodeURIComponent(blobUrl)}`;
                }
            }
            worker = new Worker(url);
            worker.onmessage = e => onLine(String(e.data));
            worker.onerror = e => fail(e.message || 'le moteur s\'est arrêté');
            const ok = waitLine(l => l === 'uciok');
            send('uci');
            await ok;
            live();
            threads = hash = 0;
            wdlOn = false;
            await applyOptions();
            live();
            setState('ready');
            pruneOldEngines();
        })().catch(e => { if (my === gen) fail(e && e.message || String(e)); throw e; })
            .finally(() => { if (loading === p) loading = null; });
        return p;
    }

    function fail(msg) {
        error = msg;
        if (worker) { try { worker.terminate(); } catch (e) { /* déjà arrêté */ } }
        worker = null;
        [cur, next].forEach(j => { if (j) j.resolve({ best: null, lines: j.lines, cancelled: true }); });
        cur = next = null;
        setState('error');
    }

    // Fils, mémoire et WDL : envoyés seulement s'ils ont changé ; « isready » attend que tout soit appliqué.
    async function applyOptions() {
        const t = wantedThreads(), h = setting('engineHash', 64);
        if (t !== threads) { send(`setoption name Threads value ${t}`); threads = t; }
        if (h !== hash) { send(`setoption name Hash value ${h}`); hash = h; }
        if (!wdlOn) { send('setoption name UCI_ShowWDL value true'); wdlOn = true; }
        const ok = waitLine(l => l === 'readyok');
        send('isready');
        await ok;
    }

    // Fichiers d'une ancienne version encore en cache (le service worker les purge aussi à son activation).
    const current = url => { const p = new URL(url).pathname; return p.includes(`/engine/${manifest.version}/`) || p.includes(`/stockfish@${manifest.version}/`); };
    function pruneOldEngines() {
        if (typeof caches === 'undefined') return;
        caches.open(ENGINE_CACHE).then(c => c.keys().then(reqs => reqs.filter(r => !current(r.url)).forEach(r => c.delete(r))))
            .catch(() => {});
    }

    // Arrêt complet : le prochain calcul recharge le moteur (changement de réseau, moteur complet téléchargé…).
    function reload() {
        [cur, next].forEach(j => { if (j) j.resolve({ best: null, lines: j.lines, cancelled: true }); });
        cur = next = null;
        gen++;                                                          // le chargement en cours, s'il y en a un, est abandonné
        loading = null;
        if (waiting) { const w = waiting; waiting = null; w.resolve(null); }
        if (worker) { try { worker.terminate(); } catch (e) { /* déjà arrêté */ } }
        worker = null;
        variant = null;
        if (state !== 'absent') setState('absent');
    }

    // ─── Moteur complet : téléchargement vérifié, gardé dans le cache ─────────
    const full = {
        async size() { await readManifest(); const v = pick('full'); return v ? v.wasm.bytes : 0; },
        async status() {
            if (typeof caches === 'undefined') return 'absent';
            await readManifest();
            const v = pick('full');
            return v && await (await caches.open(ENGINE_CACHE)).match(v.wasm.url) ? 'ready' : 'absent';
        },
        // onProgress(reçu, total). done : Promise<true> une fois vérifié et rangé ; rejetée en cas d'échec
        // (message lisible), ou d'annulation (message « annulé »).
        download(onProgress) {
            const ctrl = new AbortController();
            const done = (async () => {
                await readManifest();
                const v = pick('full');
                if (!v) throw new Error('aucun moteur complet dans cette version');
                let res;
                try { res = await fetch(v.wasm.url, { signal: ctrl.signal, mode: 'cors', credentials: 'omit' }); }
                catch (e) { throw new Error(ctrl.signal.aborted ? 'annulé' : 'serveur injoignable (unpkg)'); }
                if (!res.ok || !res.body) throw new Error(`serveur indisponible (unpkg, code ${res.status})`);
                const total = v.wasm.bytes, reader = res.body.getReader(), parts = [];
                let got = 0;
                try {
                    for (;;) {
                        const { done: end, value } = await reader.read();
                        if (end) break;
                        parts.push(value);
                        got += value.length;
                        if (onProgress) onProgress(got, total);
                    }
                } catch (e) { throw new Error(ctrl.signal.aborted ? 'annulé' : 'téléchargement interrompu'); }
                const blob = new Blob(parts, { type: 'application/wasm' });
                parts.length = 0;
                const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
                    .map(b => b.toString(16).padStart(2, '0')).join('');
                if (blob.size !== total || hash !== v.wasm.sha256) throw new Error('fichier reçu altéré (empreinte différente) : rien n’a été gardé');
                await (await caches.open(ENGINE_CACHE)).put(v.wasm.url, new Response(blob, { headers: { 'Content-Type': 'application/wasm' } }));
                if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
                if (setting('engineNet', 'lite') === 'full') reload();
                return true;
            })();
            return { cancel: () => ctrl.abort(), done };
        },
        async remove() {
            if (typeof caches === 'undefined') return;
            await readManifest();
            const c = await caches.open(ENGINE_CACHE);
            await Promise.all(manifest.variants.filter(v => v.wasm.url).map(v => c.delete(v.wasm.url)));
            if (variant && variant.net === 'full') reload();
        }
    };

    // ─── Lecture des réponses UCI ─────────────────────────────────────────────
    function parseInfo(line, white) {
        if (!line.startsWith('info ') || line.indexOf(' pv ') < 0 || / (lower|upper)bound /.test(line)) return null;
        const tok = line.split(' '), o = { multipv: 1, wdl: null };
        for (let i = 1; i < tok.length; i++) {
            const k = tok[i];
            if (['depth', 'seldepth', 'multipv', 'nodes', 'nps'].includes(k)) o[k] = Number(tok[++i]);
            else if (k === 'score') { const kind = tok[++i], v = Number(tok[++i]); o.score = kind === 'mate' ? { mate: v } : { cp: v }; }
            else if (k === 'wdl') o.wdl = [Number(tok[++i]), Number(tok[++i]), Number(tok[++i])];
            else if (k === 'pv') { o.pv = tok.slice(i + 1).filter(Boolean); break; }
        }
        if (!o.score || !o.pv || !o.pv.length) return null;
        if (!white) {                                                   // UCI : point de vue du camp au trait
            o.score = o.score.mate !== undefined ? { mate: -o.score.mate } : { cp: -o.score.cp };
            if (o.wdl) o.wdl = o.wdl.slice().reverse();
        }
        return o;
    }

    function onLine(line) {
        if (waiting && waiting.test(line)) { const w = waiting; waiting = null; w.resolve(line); return; }
        const j = cur;
        if (!j) return;
        if (line.startsWith('bestmove')) { finish(j, line.split(' ')[1]); return; }
        const info = parseInfo(line, j.white);
        if (!info) return;
        if (info.multipv === 1 && info.depth > j.depth) {               // nouvelle profondeur : les lignes secondaires suivent
            j.depth = info.depth;
            j.lines.length = Math.min(j.lines.length, j.multipv);
        }
        j.lines[info.multipv - 1] = info;
        emit(j, false);
    }

    function emit(j, now) {
        if (!j.onInfo) return;
        const fire = () => { j.timer = null; j.last = Date.now(); try { j.onInfo(j.lines.filter(Boolean)); } catch (e) { if (typeof reportError === 'function') reportError('analyse', e); } };
        if (now) { clearTimeout(j.timer); fire(); return; }
        if (j.timer) return;
        j.timer = setTimeout(fire, Math.max(0, INFO_EVERY_MS - (Date.now() - j.last)));
    }

    function finish(j, best) {
        emit(j, true);
        cur = null;
        j.resolve({ best: best && best !== '(none)' ? best : null, lines: j.lines.filter(Boolean), cancelled: false });
        pump();
    }

    // ─── File : un calcul en cours, au plus un en attente ─────────────────────
    function pump() {
        if (!next) return;
        if (state !== 'ready') { load().then(pump, () => {}); return; }
        if (cur) { stopJob(cur); return; }
        cur = next;
        next = null;
        start(cur);
    }

    async function start(j) {
        await applyOptions();
        if (j !== cur || !worker) return;                               // moteur rechargé entre-temps : calcul déjà clos
        if (j.stopping) { cur = null; j.resolve({ best: null, lines: [], cancelled: true }); pump(); return; }
        send(`setoption name MultiPV value ${j.multipv}`);
        send(`position fen ${j.fen}`);
        send(j.opts.depth ? `go depth ${j.opts.depth}` : j.opts.movetime ? `go movetime ${j.opts.movetime}` : 'go infinite');
    }

    function stopJob(j) {
        if (j === next) { next = null; j.resolve({ best: null, lines: [], cancelled: true }); return; }
        if (j === cur && !j.stopping) { j.stopping = true; if (worker) send('stop'); }
    }

    function analyse(fen, opts = {}, onInfo) {
        let resolve;
        const done = new Promise(r => { resolve = r; });
        const j = { fen, opts, onInfo, resolve, lines: [], depth: 0, last: 0, timer: null, stopping: false,
                    multipv: Math.min(5, Math.max(1, opts.multipv || 1)), white: fen.split(' ')[1] !== 'b' };
        if (next) stopJob(next);
        next = j;
        pump();
        return { stop: () => stopJob(j), done };
    }

    const bestMove = (fen, opts = {}) => analyse(fen, Object.assign({}, opts, { multipv: 1 })).done
        .then(r => (r.best ? { uci: r.best, score: r.lines[0] ? r.lines[0].score : null } : null));

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => { if (document.hidden) { if (next) stopJob(next); if (cur) stopJob(cur); } });
    }

    return {
        load, analyse, bestMove, reload, full,
        stop: () => { if (next) stopJob(next); if (cur) stopJob(cur); },
        status: () => state,
        error: () => error,
        onStatus: fn => { listeners.add(fn); return () => listeners.delete(fn); },
        info: () => (manifest && variant ? { name: manifest.name, version: manifest.version, variant: variant.id, threads: variant.threads ? threads || wantedThreads() : 1, net: variant.net, license: manifest.license, source: manifest.source } : null),
        isolated,
        _parseInfo: parseInfo
    };
})();
