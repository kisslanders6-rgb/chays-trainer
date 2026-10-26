/**
 * sw.js — service worker de Chays Trainer
 * ──────────────────────────────────────────────────────────────────────────
 * Rend l'application utilisable HORS LIGNE (tout est statique, les données sont
 * dans localStorage).
 *   - Code (HTML / JS / CSS / manifest) : réseau d'abord, cache en secours
 *     → en ligne, tu as toujours la dernière version déployée.
 *   - Images (pièces, textures, logos) : cache d'abord, rafraîchi en arrière-plan.
 *   - Police Inter (Google Fonts) : cache d'abord, mise en cache à la première visite en ligne.
 *   - Moteur Stockfish (engine/<version>/) : cache à part (ENGINE_CACHE), rempli au premier usage
 *     seulement (il n'alourdit pas l'installation) ; à l'activation, les fichiers d'une autre version
 *     que celle d'engine/manifest.json sont supprimés.
 * Si tu modifies un fichier d'image existant, incrémente VERSION pour forcer le rafraîchissement.
 *
 * Liste de mise en cache : construite à l'installation à partir des balises src / href d'index.html
 * (scripts, feuilles de style, logos, icônes), complétée par EXTRA (ressources citées seulement
 * dans le CSS ou le manifeste) et par toutes les pièces. Ajouter un script dans index.html suffit.
 */
const VERSION = 'v14';
const CACHE   = 'chays-trainer-' + VERSION;
const ENGINE_CACHE = 'chays-engine';
const ENGINE_FILE  = /\/engine\/\d+\.\d+\.\d+\//;

const EXTRA = [
    './', 'manifest.json',
    'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png',
    'assets/boards/stone.webp', 'assets/boards/leather.webp', 'assets/boards/walnut.webp'
];

// Ressources locales référencées par index.html (les liens externes et les ancres sont ignorés).
async function pageAssets() {
    try {
        const html = await (await fetch('index.html', { cache: 'no-cache' })).text();
        return [...html.matchAll(/\s(?:src|href)="([^"#:]+)"/g)].map(m => m[1]);
    } catch (e) { return ['index.html']; }
}

const SETS = ['merida', 'maestro', 'staunty', 'chrome', 'minimal-warmth', 'fantasy', 'chessnut', 'kiwen-suwi'];
const PIECES = SETS.flatMap(s => ['w', 'b'].flatMap(c => 'KQRBNP'.split('').map(t => `assets/pieces/${s}/${c}${t}.svg`)));

self.addEventListener('install', e => {
    e.waitUntil(
        Promise.all([caches.open(CACHE), pageAssets()])
            .then(([cache, page]) => Promise.all([...new Set(EXTRA.concat('index.html', page, PIECES))]
                .map(u => cache.add(u).catch(() => {}))))            // un fichier absent n'empêche pas l'installation
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith('chays-trainer-') && k !== CACHE).map(k => caches.delete(k))))
            .then(pruneEngine)
            .then(() => self.clients.claim())
    );
});

// Moteur : ne garde que les fichiers de la version annoncée par engine/manifest.json.
async function pruneEngine() {
    try {
        const { version } = await (await fetch('engine/manifest.json', { cache: 'no-cache' })).json();
        const cache = await caches.open(ENGINE_CACHE);
        const reqs  = await cache.keys();
        await Promise.all(reqs.filter(r => !new URL(r.url).pathname.includes(`/engine/${version}/`)).map(r => cache.delete(r)));
    } catch (e) { /* hors ligne : on réessaiera à la prochaine activation */ }
}

// Polices Google : la feuille (fonts.googleapis.com) et les fichiers (fonts.gstatic.com) ne changent pas.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

function isCode(req) {
    if (req.mode === 'navigate') return true;
    return /\.(?:html|js|css|json)$/.test(new URL(req.url).pathname);
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (FONT_HOSTS.includes(url.hostname)) {                    // police Inter : cache d'abord, pour l'avoir hors ligne
        e.respondWith(
            caches.match(req).then(hit => hit || fetch(req).then(res => {
                if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
                return res;
            }))
        );
        return;
    }
    if (url.origin !== self.location.origin) return;            // API Chess.com / Lichess / Supabase : on ne s'en mêle pas

    if (ENGINE_FILE.test(url.pathname)) {                        // moteur : fichiers versionnés, jamais modifiés
        e.respondWith(
            caches.open(ENGINE_CACHE).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
                if (res.ok) cache.put(req, res.clone());
                return res;
            })))
        );
        return;
    }

    if (isCode(req)) {
        e.respondWith(
            fetch(req)
                .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
                .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
        );
        return;
    }

    e.respondWith(
        caches.match(req).then(hit => {
            const net = fetch(req).then(res => {
                if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
                return res;
            }).catch(() => hit);
            return hit || net;
        })
    );
});
