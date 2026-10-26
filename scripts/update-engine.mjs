// Lancer : node scripts/update-engine.mjs [version]   — embarque Stockfish (paquet npm « stockfish », nmrugg)
//
// Télécharge le paquet (dernière version publiée, ou celle demandée) et en garde, dans engine/<version>/ :
//   - les deux moteurs « lite » (réseau neuronal léger, ≈ 1,8 Mo chacun), .js et .wasm ;
//   - les .js des deux moteurs « complets » (≈ 33 Ko) : leurs .wasm (≈ 99 Mo chacun) ne sont PAS copiés,
//     trop lourds pour le dépôt ; l'application les télécharge à la demande depuis unpkg (CORS et CORP
//     ouverts) et vérifie leur empreinte sha256, notée ici dans le manifeste ;
//   - la licence.
// Écrit engine/manifest.json (fichiers, tailles, empreintes) et supprime les versions précédentes.
// L'application ne lit que le manifeste : changer de version ne demande aucune modification du code.
// Utilisé à la main et par .github/workflows/engine-update.yml. Ensuite : node tests/stockfish.test.js.

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
    const sha = data => createHash('sha256').update(data).digest('hex');
    const variants = [
        { id: 'lite',        threads: true,  net: 'lite', base: `stockfish-${major}-lite` },
        { id: 'lite-single', threads: false, net: 'lite', base: `stockfish-${major}-lite-single` },
        { id: 'full',        threads: true,  net: 'full', base: `stockfish-${major}` },
        { id: 'full-single', threads: false, net: 'full', base: `stockfish-${major}-single` }
    ].map(v => {
        const js = `${v.base}.js`, wasm = `${v.base}.wasm`;
        cpSync(join(bin, js), join(dir, js));
        const jsData = readFileSync(join(dir, js)), wasmData = readFileSync(join(bin, wasm));
        const out = { id: v.id, threads: v.threads, net: v.net,
                      js: { path: `engine/${wanted}/${js}`, bytes: jsData.length, sha256: sha(jsData) },
                      wasm: { bytes: wasmData.length, sha256: sha(wasmData) } };
        if (v.net === 'lite') { cpSync(join(bin, wasm), join(dir, wasm)); out.wasm.path = `engine/${wanted}/${wasm}`; }
        else out.wasm.url = `https://unpkg.com/stockfish@${wanted}/bin/${wasm}`;      // téléchargé à la demande
        return out;
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
