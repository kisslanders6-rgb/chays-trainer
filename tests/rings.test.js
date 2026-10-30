// Lancer : node tests/rings.test.js   — anneau de progression commun (Ring, js/core/rings.js).
const fs = require('fs'), assert = require('assert');
const { JSDOM } = require('jsdom');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const dom = new JSDOM('<div id="h"></div>', { runScripts: 'outside-only' });
const win = dom.window;
const utils = fs.readFileSync('js/core/utils.js', 'utf8');
win.eval(utils.match(/const _ESC_MAP[^\n]*\n/)[0] + utils.match(/function escapeHtml[^\n]*\n/)[0] + 'window.escapeHtml = escapeHtml;');
win.eval(fs.readFileSync('js/core/rings.js', 'utf8') + '\nwindow.Ring = Ring;');   // 'use strict' : eval garde ses noms pour lui
const host = win.document.getElementById('h');
const render = html => { host.innerHTML = html; return host.firstElementChild; };
const offset = el => Number(el.querySelector('circle.v').getAttribute('stroke-dashoffset'));
const dash = el => Number(el.querySelector('circle.v').getAttribute('stroke-dasharray'));

t('Ring.html échappe le libellé et le sous-titre', () => {
    const el = render(win.Ring.html({ value: 1, max: 2, label: '<b>x</b>', sub: '"&"' }));
    assert.strictEqual(el.querySelector('.ring-txt b').textContent, '<b>x</b>');
    assert.strictEqual(el.querySelector('.ring-txt small').textContent, '"&"');
    assert(!el.querySelector('.ring-txt b b'));
});

t('Ring.html : .is-done dès que la valeur atteint le maximum', () => {
    assert(!render(win.Ring.html({ value: 2, max: 3 })).classList.contains('is-done'));
    assert(render(win.Ring.html({ value: 3, max: 3 })).classList.contains('is-done'));
    assert(render(win.Ring.html({ value: 5, max: 3 })).classList.contains('is-done'));
    assert(!render(win.Ring.html({ value: 0, max: 0 })).classList.contains('is-done'), 'objectif nul : pas « atteint »');
});

t('Ring.html : décalage du trait de la circonférence (vide) à 0 (plein), borné au-delà du maximum', () => {
    const empty = render(win.Ring.html({ value: 0, max: 4 }));
    assert(Math.abs(offset(empty) - dash(empty)) < .2);
    const half = render(win.Ring.html({ value: 2, max: 4 }));
    assert(Math.abs(offset(half) - dash(half) / 2) < .2);
    assert.strictEqual(offset(render(win.Ring.html({ value: 4, max: 4 }))), 0);
    assert.strictEqual(offset(render(win.Ring.html({ value: 9, max: 4 }))), 0);
    const neg = render(win.Ring.html({ value: -3, max: 4 }));
    assert(Math.abs(offset(neg) - dash(neg)) < .2);
});

t('Ring.html : rôle image et libellé, ou caché quand il est décoratif', () => {
    const el = render(win.Ring.html({ value: 3, max: 5, ariaLabel: 'Objectif du jour : 3 sur 5' }));
    assert.strictEqual(el.getAttribute('role'), 'img');
    assert.strictEqual(el.getAttribute('aria-label'), 'Objectif du jour : 3 sur 5');
    assert.strictEqual(render(win.Ring.html({ value: 1, max: 5 })).getAttribute('aria-label'), '1 sur 5');
    const deco = render(win.Ring.html({ value: 1, max: 5, decorative: true }));
    assert.strictEqual(deco.getAttribute('aria-hidden'), 'true');
    assert(!deco.hasAttribute('role'));
    assert.strictEqual(render(win.Ring.html({ value: 1, max: 5, size: 22 })).style.getPropertyValue('--ring-size'), '22px');
});

t('Ring.chip : bouton à data-action / data-arg, nombre réussi au centre, « / max » à droite', () => {
    const el = render(win.Ring.chip({ value: 4, max: 5, text: 'Mats <élémentaires>', action: 'egJump', arg: 'mats' }));
    assert.strictEqual(el.tagName, 'BUTTON');
    assert.strictEqual(el.getAttribute('type'), 'button');
    assert.strictEqual(el.dataset.action, 'egJump');
    assert.strictEqual(el.dataset.arg, 'mats');
    assert.strictEqual(el.querySelector('.ring-txt b').textContent, '4');
    assert.strictEqual(el.querySelector('.ring-chip-max').textContent, '/ 5');
    assert(el.textContent.includes('Mats <élémentaires>'));
    assert.strictEqual(el.getAttribute('aria-label'), 'Mats <élémentaires> : 4 sur 5');
    assert.strictEqual(el.querySelector('.ring').getAttribute('aria-hidden'), 'true');
    assert(!render(win.Ring.chip({ value: 0, max: 2, text: 'x', action: 'a' })).hasAttribute('data-arg'));
    assert.strictEqual(render(win.Ring.chip({ value: 0, max: 2, text: 'x', action: 'a', current: true })).getAttribute('aria-current'), 'true');
});

console.log(`\n${n} tests réussis.`);
