// Lancer : node scripts/update-engine.mjs [version]   — embarque Stockfish (paquet npm « stockfish », nmrugg)
//
// Télécharge le paquet (dernière version publiée, ou celle demandée), n'en garde que les deux moteurs
// « lite » (réseau neuronal léger, ≈ 1,8 Mo chacun) et la licence, les copie dans engine/<version>/,
// écrit engine/manifest.json (fichiers, tailles, empreintes sha256) et supprime les versions précédentes.
// L'application ne lit que le manifeste : changer de version ne demande aucune modification du code.
// Utilisé à la main et par .github/workflows/engine-update.yml. Ensuite : node tests/engine.test.js.
//
// Les moteurs « complets » (≈ 99 Mo chacun) ne sont pas embarqués : trop lourds pour le dépôt et le déploiement.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT    = fileURLToPath(new URL('..', import.meta.url));          // chemin décodé (accents du dossier)
const ENGINE  = join(ROOT, 'engine');
const wanted  = process.argv[2] || execFileSync('npm', ['view', 'stockfish', 'version'], { encoding: 'utf8' }).trim();
if (!/^\d+\.\d+\.\d+$/.test(wanted)) throw new Error('Version invalide : ' + wanted);

const current = existsSync(join(ENGINE, 'manifest.json')) ? JSON.parse(readFileSync(join(ENGINE, 'manifest.json'), 'utf8')).version : null;
if (current === wanted && !process.argv.includes('--force')) { console.log(`Stockfish ${wanted} déjà embarqué.`); process.exit(0); }

// Paquet téléchargé et extrait dans un dossier temporaire vide ; aucun de ses scripts n'est exécuté.
const tmp = mkdtempSync(join(tmpdir(), 'stockfish-'));
try {
    execFileSync('npm', ['pack', `stockfish@${wanted}`, '--ignore-scripts', '--pack-destination', tmp], { stdio: 'inherit' });
    const tgz = readdirSync(tmp).find(f => f.endsWith('.tgz'));
    execFileSync('tar', ['-xzf', join(tmp, tgz), '-C', tmp]);
    const pkg = join(tmp, 'package'), bin = join(pkg, 'bin');
    const major = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).buildVersion || wanted.split('.')[0];

    const dir = join(ENGINE, wanted);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const variants = [
        { id: 'lite',        threads: true,  base: `stockfish-${major}-lite` },
        { id: 'lite-single', threads: false, base: `stockfish-${major}-lite-single` }
    ].map(v => {
        const files = {};
        ['js', 'wasm'].forEach(ext => {
            const name = `${v.base}.${ext}`;
            cpSync(join(bin, name), join(dir, name));
            const data = readFileSync(join(dir, name));
            files[ext] = { path: `engine/${wanted}/${name}`, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
        });
        return { id: v.id, threads: v.threads, net: 'lite', js: files.js, wasm: files.wasm };
    });
    cpSync(join(pkg, 'Copying.txt'), join(dir, 'COPYING.txt'));

    const manifest = {
        name: 'Stockfish', version: wanted, major: String(major),
        license: 'GPL-3.0', source: 'https://github.com/nmrugg/stockfish.js', upstream: 'https://github.com/official-stockfish/Stockfish',
        variants
    };
    writeFileSync(join(ENGINE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

    // Anciennes versions : supprimées (le service worker purge aussi son cache).
    readdirSync(ENGINE).filter(f => f !== wanted && /^\d+\.\d+\.\d+$/.test(f) && statSync(join(ENGINE, f)).isDirectory())
        .forEach(f => rmSync(join(ENGINE, f), { recursive: true, force: true }));
    console.log(`Stockfish ${wanted} embarqué (${current ? 'remplace ' + current : 'première installation'}).`);
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
