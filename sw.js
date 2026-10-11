/**
 * sw.js — service worker de Chays Trainer
 * ──────────────────────────────────────────────────────────────────────────
 * Rend l'application utilisable HORS LIGNE (tout est statique, les données sont
 * dans localStorage).
 *   - Code (HTML / JS / CSS / manifest) : réseau d'abord, cache en secours
 *     → en ligne, tu as toujours la dernière version déployée.
 *   - Images (pièces, textures, logos) : cache d'abord, rafraîchi en arrière-plan.
 * Si tu modifies un fichier d'image existant, incrémente VERSION pour forcer le rafraîchissement.
 */
const VERSION = 'v1';
const CACHE   = 'chays-trainer-' + VERSION;

const CORE = [
    './', 'index.html', 'style.css', 'manifest.json',
    'js/storage.js', 'js/app.js',
    'js/core/icons.js', 'js/core/backup.js', 'js/core/trash.js', 'js/core/settings.js', 'js/core/themeColor.js',
    'js/core/sound.js', 'js/core/pieces.js', 'js/core/chessEngine.js', 'js/core/mobile.js',
    'js/modules/openings/openingsLogic.js', 'js/modules/openings/openingsUI.js', 'js/modules/openings/treeView.js',
    'js/modules/stats/stats.js', 'js/modules/training/training.js', 'js/modules/endgame/endgame.js',
    'assets/favicon.png', 'assets/chlogo.png', 'assets/chaysTrainerlogo.png', 'assets/chaysTrainerAndLogo.png',
    'assets/boards/stone.webp', 'assets/boards/leather.webp', 'assets/boards/walnut.webp'
];

const SETS = ['merida', 'maestro', 'staunty', 'minimal-warmth', 'fantasy', 'chessnut', 'kiwen-suwi'];
const PIECES = SETS.flatMap(s => ['w', 'b'].flatMap(c => 'KQRBNP'.split('').map(t => `assets/pieces/${s}/${c}${t}.svg`)));

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(cache => Promise.all(CORE.concat(PIECES).map(u => cache.add(u).catch(() => {}))))   // un fichier absent n'empêche pas l'installation
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith('chays-trainer-') && k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

function isCode(req) {
    if (req.mode === 'navigate') return true;
    return /\.(?:html|js|css|json)$/.test(new URL(req.url).pathname);
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;            // polices Google, etc. : on ne s'en mêle pas

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
