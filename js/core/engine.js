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
 *
 * Un seul calcul à la fois : un nouveau calcul arrête le précédent (« stop », puis attente de son
 * « bestmove ») avant de démarrer ; seul le dernier demandé attend son tour, les autres sont annulés.
 * Variante : multi-thread si la page est isolée (crossOriginIsolated, en-têtes de vercel.json), sinon
 * mono-thread. Fils et mémoire : appSettings.engineThreads / engineHash (propres à l'appareil).
 * Tout calcul s'arrête quand la page passe en arrière-plan.
 */

'use strict';

const Engine = (function () {
    let manifest = null, variant = null, worker = null, state = 'absent', loading = null, error = '';
    let threads = 0, hash = 0, wdlOn = false;
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

    function load() {
        if (state === 'ready') return Promise.resolve();
        if (loading) return loading;
        setState('loading');
        loading = (async () => {
            manifest = await (await fetch('engine/manifest.json', { cache: 'no-cache' })).json();
            const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated && typeof SharedArrayBuffer === 'function';
            variant = manifest.variants.find(v => v.threads === isolated) || manifest.variants.find(v => !v.threads);
            worker = new Worker(variant.js.path);
            worker.onmessage = e => onLine(String(e.data));
            worker.onerror = e => fail(e.message || 'le moteur s\'est arrêté');
            const ok = waitLine(l => l === 'uciok');
            send('uci');
            await ok;
            threads = hash = 0;
            wdlOn = false;
            await applyOptions();
            setState('ready');
            pruneOldEngines();
        })().catch(e => { fail(e && e.message || String(e)); throw e; }).finally(() => { loading = null; });
        return loading;
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
    function pruneOldEngines() {
        if (typeof caches === 'undefined') return;
        caches.open('chays-engine').then(c => c.keys().then(reqs => reqs
            .filter(r => !new URL(r.url).pathname.includes(`/engine/${manifest.version}/`)).forEach(r => c.delete(r))))
            .catch(() => {});
    }

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
        load, analyse, bestMove,
        stop: () => { if (next) stopJob(next); if (cur) stopJob(cur); },
        status: () => state,
        error: () => error,
        onStatus: fn => { listeners.add(fn); return () => listeners.delete(fn); },
        info: () => (manifest && variant ? { name: manifest.name, version: manifest.version, variant: variant.id, threads: variant.threads ? threads || wantedThreads() : 1, net: variant.net, license: manifest.license, source: manifest.source } : null),
        _parseInfo: parseInfo
    };
})();
