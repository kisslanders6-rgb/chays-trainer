#!/usr/bin/env node
/**
 * install-endgame.js — branche le module Finales dans Chays Trainer, sans rien recopier à la main.
 * À lancer à la RACINE du projet (là où se trouve index.html) :   node install-endgame.js
 *
 * - modifie index.html, style.css, js/app.js, js/modules/openings/openingsLogic.js, openingsUI.js, sw.js, manifest.json ;
 * - ré-exécutable sans risque : une modification déjà présente est reconnue et ignorée ;
 * - une copie « .bak-finales » de chaque fichier est faite avant sa première modification ;
 * - si une ancre est introuvable (fichier modifié à la main), le script le dit et NE touche PAS à ce fichier.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const results = [];
let failures = 0;

function log(status, file, name) { results.push(`${status}  ${file} — ${name}`); if (status.startsWith('✗')) failures++; }

// steps : [{ name, done(text) -> bool, apply(text) -> string | null }]
function patch(rel, steps, opts = {}) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { log('✗', rel, 'fichier introuvable (lancez le script à la racine du projet)'); return; }
    const original = fs.readFileSync(p, 'utf8');
    let text = original;
    const pending = [];
    for (const s of steps) {
        if (s.done(text)) { log('=', rel, `${s.name} (déjà fait)`); continue; }
        const out = s.apply(text);
        if (out == null || out === text) { log('✗', rel, `${s.name} : ancre introuvable, étape ignorée`); continue; }
        text = out; pending.push(s.name);
    }
    if (text !== original) {
        const bak = p + '.bak-finales';
        if (!fs.existsSync(bak)) fs.writeFileSync(bak, original);
        fs.writeFileSync(p, text);
        pending.forEach(n => log('✓', rel, n));
    }
}

// ─── index.html ──────────────────────────────────────────────────────────────
const TAB_HTML = `<div id="home-tab-endgame" class="home-tab hidden">
                <div class="tab-title"><svg class="ico"><use href="#i-pawn"/></svg> Finales</div>
                <div class="tab-sub">Finales théoriques : l'adversaire répond tout seul et chaque coup est jugé. Les finales de pions sont vérifiées par un calcul exact.</div>
                <div id="endgame-panel"></div>
            </div>`;
const CARD_HTML = `<div class="endgame-card" id="endgame-card" data-modes="endgame"></div>
                    `;
const RETRY_BTN = `<button class="btn btn-grow" data-modes="endgame" onclick="retryEndgame()" title="Recommencer l'exercice">
                            <svg class="ico"><use href="#i-rotate-ccw"/></svg> Recommencer
                        </button>
                        `;
const TOOLS_ROW = `<div class="controls controls-tools" data-modes="endgame">
                        <button class="btn btn-tool" onclick="flipBoard()" title="Retourner l'échiquier (F)">
                            <svg class="ico"><use href="#i-arrow-up-down"/></svg>Retourner
                        </button>
                        <button class="btn btn-tool is-exit" onclick="goHome('endgame')" title="Quitter l'exercice">
                            <svg class="ico"><use href="#i-x"/></svg>Quitter
                        </button>
                    </div>
                    `;
patch('index.html', [
    { name: 'onglet Finales (panneau du catalogue)',
      done: t => t.includes('id="endgame-panel"'),
      apply: t => { const re = /<div id="home-tab-endgame"[^>]*>[\s\S]*?prochainement\.<\/div>\s*<\/div>\s*<\/div>/; return re.test(t) ? t.replace(re, TAB_HTML) : null; } },
    { name: 'carte d\'objectif dans le panneau de jeu',
      done: t => t.includes('id="endgame-card"'),
      apply: t => t.includes('<div class="status-bar" id="status-bar">') ? t.replace('<div class="status-bar" id="status-bar">', CARD_HTML + '<div class="status-bar" id="status-bar">') : null },
    { name: 'bouton Indice actif en mode Finales',
      done: t => t.includes('data-modes="play,training,endgame"'),
      apply: t => t.includes('data-modes="play,training" onclick="showHint()"') ? t.replace('data-modes="play,training" onclick="showHint()"', 'data-modes="play,training,endgame" onclick="showHint()"') : null },
    { name: 'bouton Recommencer',
      done: t => t.includes('onclick="retryEndgame()"'),
      apply: t => { const a = '<button class="btn btn-primary btn-grow" data-modes="preview"'; return t.includes(a) ? t.replace(a, RETRY_BTN + a) : null; } },
    { name: 'actions secondaires (Retourner / Quitter)',
      done: t => /controls-tools" data-modes="endgame"/.test(t),
      apply: t => { const a = '<div class="controls controls-tools" data-modes="preview">'; return t.includes(a) ? t.replace(a, TOOLS_ROW + a) : null; } }
]);

// ─── style.css ───────────────────────────────────────────────────────────────
const CSS_START = '/* ═════ DEBUT : MODULE FINALES (ne pas modifier entre DEBUT et FIN) ═════ */';
const CSS_END   = '/* ═════ FIN : MODULE FINALES ═════ */';
(function css() {
    const rel = 'style.css', p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { log('✗', rel, 'fichier introuvable'); return; }
    const src = path.join(ROOT, 'endgame-additions.css');
    if (!fs.existsSync(src)) { log('✗', rel, 'endgame-additions.css introuvable'); return; }
    const block = `${CSS_START}\n${fs.readFileSync(src, 'utf8').trim()}\n${CSS_END}\n`;
    let text = fs.readFileSync(p, 'utf8'), out;
    const i = text.indexOf(CSS_START), j = text.indexOf(CSS_END);
    if (i >= 0 && j > i) out = text.slice(0, i) + block + text.slice(j + CSS_END.length).replace(/^\n/, '');   // mise à jour du bloc
    else out = text.replace(/\s*$/, '\n') + '\n' + block;
    if (out === text) { log('=', rel, 'styles Finales (déjà à jour)'); return; }
    const bak = p + '.bak-finales';
    if (!fs.existsSync(bak)) fs.writeFileSync(bak, text);
    fs.writeFileSync(p, out);
    log('✓', rel, i >= 0 ? 'styles Finales mis à jour' : 'styles Finales ajoutés');
})();

// ─── js/app.js ───────────────────────────────────────────────────────────────
patch('js/app.js', [
    { name: 'switchHomeTab → initEndgame()',
      done: t => t.includes('initEndgame()'),
      apply: t => { const a = "if (tab === 'training') initTraining();"; return t.includes(a) ? t.replace(a, a + "\n    if (tab === 'endgame')  initEndgame();") : null; } },
    { name: 'goHome → stopEndgame()',
      done: t => t.includes('stopEndgame'),
      apply: t => { const a = "if (typeof stopTraining === 'function') stopTraining();"; return t.includes(a) ? t.replace(a, a + "\n    if (typeof stopEndgame === 'function') stopEndgame();") : null; } }
]);

// ─── js/modules/openings/openingsLogic.js ────────────────────────────────────
patch('js/modules/openings/openingsLogic.js', [
    { name: 'handleClick : clics bloqués pendant la réponse adverse',
      done: t => t.includes("gameMode === 'endgame' && endgameState.busy"),
      apply: t => { const re = /(\n([ \t]*))if \(gameMode === 'preview'\) return;[^\n]*/; return re.test(t) ? t.replace(re, m => m + `\n${m.match(/\n([ \t]*)/)[1]}if (gameMode === 'endgame' && endgameState.busy) return;`) : null; } },
    { name: 'executePlayerMove → answerEndgameMove()',
      done: t => t.includes('answerEndgameMove'),
      apply: t => { const a = "if (gameMode === 'training') { answerTrainingMove(entry, from, to, promo, movStr); return; }"; return t.includes(a) ? t.replace(a, "if (gameMode === 'endgame') { answerEndgameMove(from, to, promo); return; }\n    " + a) : null; } },
    { name: 'showHint → endgameHint()',
      done: t => t.includes('endgameHint()'),
      apply: t => { const a = 'function showHint() {'; return t.includes(a) ? t.replace(a, a + "\n    if (gameMode === 'endgame') { endgameHint(); return; }") : null; } }
]);

// ─── js/modules/openings/openingsUI.js ───────────────────────────────────────
patch('js/modules/openings/openingsUI.js', [
    { name: 'barre de coups verrouillée en Finales',
      done: t => t.includes("'locked', gameMode === 'training' || gameMode === 'endgame'"),
      apply: t => { const a = "bar.classList.toggle('locked', gameMode === 'training');"; return t.includes(a) ? t.replace(a, "bar.classList.toggle('locked', gameMode === 'training' || gameMode === 'endgame');") : null; } },
    { name: 'navigation (clic sur un coup, flèches) désactivée en Finales',
      done: t => !t.includes("if (gameMode === 'training') return;"),
      apply: t => t.includes("if (gameMode === 'training') return;") ? t.split("if (gameMode === 'training') return;").join("if (gameMode === 'training' || gameMode === 'endgame') return;") : null },
    { name: 'glisser-déposer bloqué pendant la réponse adverse',
      done: t => t.includes("gameMode === 'endgame' && endgameState.busy) return false"),
      apply: t => { const a = "if (gameMode === 'preview') return false;"; return t.includes(a) ? t.replace(a, a + "\n    if (gameMode === 'endgame' && endgameState.busy) return false;") : null; } }
]);

// ─── sw.js (nouvelle version du cache) et manifest.json (raccourci) ──────────
patch('sw.js', [
    { name: 'VERSION du cache → v3',
      done: t => !/const VERSION = 'v[12]';/.test(t),
      apply: t => /const VERSION = 'v[12]';/.test(t) ? t.replace(/const VERSION = 'v[12]';/, "const VERSION = 'v3';") : null }
]);
(function manifest() {
    const rel = 'manifest.json', p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { log('=', rel, 'absent (facultatif)'); return; }
    try {
        const raw = fs.readFileSync(p, 'utf8'), m = JSON.parse(raw);
        m.shortcuts = m.shortcuts || [];
        if (m.shortcuts.some(s => /tab=endgame/.test(s.url || ''))) { log('=', rel, 'raccourci Finales (déjà fait)'); return; }
        m.shortcuts.push({ name: 'Finales', short_name: 'Finales', url: '/?tab=endgame' });
        const bak = p + '.bak-finales';
        if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw);
        fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
        log('✓', rel, 'raccourci Finales ajouté');
    } catch (e) { log('✗', rel, 'JSON illisible, non modifié'); }
})();

// ─── js/modules/endgame/endgame.js : présence ────────────────────────────────
log(fs.existsSync(path.join(ROOT, 'js/modules/endgame/endgame.js')) ? '=' : '✗', 'js/modules/endgame/endgame.js', 'module (fourni dans l\'archive)');

console.log('\nInstallation du module Finales\n' + '─'.repeat(60));
results.forEach(r => console.log(r));
console.log('─'.repeat(60));
console.log(failures ? `${failures} étape(s) en échec : voir ci-dessus (rien n'a été cassé ; les .bak-finales permettent de revenir en arrière).`
                     : 'Terminé. Rechargez l\'application (Ctrl/Cmd + Maj + R) ; en console, endgameSelfTest() contrôle le catalogue.');
process.exit(failures ? 1 : 0);
