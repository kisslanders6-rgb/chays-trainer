// Lancer : node tests/uncaught.test.js   — filet des erreurs imprévues (utils.js) : trace toujours, message visible au démarrage seulement.
const { scriptPath } = require('./_app.js');
const { JSDOM } = require('jsdom');
const fs = require('fs'), assert = require('assert');
const dom = new JSDOM('<div id="error-toast" class="hidden"><span id="error-toast-text"></span></div>', { runScripts: 'outside-only' });
const w = dom.window, warnings = [];
w.console.warn = (...a) => warnings.push(a.join(' '));
w.eval(fs.readFileSync(scriptPath('utils.js'), 'utf8').replace("setTimeout(() => { _bootPhase = false; }, 3000)", 'window.__endBoot = () => { _bootPhase = false; }'));
const box = w.document.getElementById('error-toast');

w.dispatchEvent(new w.ErrorEvent('error', { message: 'panne au chargement' }));
assert.strictEqual(warnings.length, 1, 'erreur tracée');
assert(!box.classList.contains('hidden'), 'au démarrage, message visible');
console.log('ok   démarrage : erreur tracée et affichée');

box.classList.add('hidden');
w.dispatchEvent(new w.Event('load')); w.__endBoot();
const ev = new w.Event('unhandledrejection'); ev.reason = new Error('promesse rejetée');
w.dispatchEvent(ev);
assert.strictEqual(warnings.length, 2, 'rejet tracé');
assert(box.classList.contains('hidden'), 'une fois lancée, l\'application reste discrète');
console.log('ok   après le démarrage : trace seule\n\n2 tests réussis.');
