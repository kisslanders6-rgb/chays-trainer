/**
 * core/dialogs.js
 * ──────────────────────────────────────────────────────────────────────────
 * Fenêtres de l'application : saisie d'un texte, confirmation à deux ou trois issues.
 */

'use strict';

function askText(opts, onOk) {
    const overlay = document.getElementById('text-overlay');
    const form    = document.getElementById('text-form');
    const input   = document.getElementById('text-input');
    const err     = document.getElementById('text-error');
    document.getElementById('text-title').textContent = opts.title;
    document.getElementById('text-ok-btn').textContent = opts.ok || 'OK';
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';
    input.maxLength = opts.max || 60;
    err.textContent = '';
    overlay.classList.remove('hidden');
    input.focus();
    input.select();

    const close = () => {
        overlay.classList.add('hidden');
        form.onsubmit = null; input.oninput = null; overlay.onmousedown = null; overlay.onkeydown = null;
        document.getElementById('text-cancel-btn').onclick = null;
    };
    form.onsubmit = e => {
        e.preventDefault();
        const v = input.value.trim();
        const msg = !v && !opts.allowEmpty ? 'Le nom ne peut pas être vide.' : (opts.validate ? opts.validate(v) : '');
        if (msg) { err.textContent = msg; input.focus(); return; }
        close();
        onOk(v);
    };
    input.oninput = () => { err.textContent = ''; };
    document.getElementById('text-cancel-btn').onclick = close;
    overlay.onmousedown = e => { if (e.target === overlay) close(); };
    overlay.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
}

function askConfirm(message, onConfirm) {
    const overlay    = document.getElementById('confirm-overlay');
    document.getElementById('confirm-text').textContent = message;
    overlay.classList.remove('hidden');
    const okBtn     = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');
    const cleanup   = () => {
        overlay.classList.add('hidden');
        okBtn.onclick     = null;
        cancelBtn.onclick = null;
    };
    okBtn.onclick     = () => { cleanup(); onConfirm(); };
    cancelBtn.onclick = () => { cleanup(); };
}

// Confirmation à trois issues : cascade / ce coup seulement / annuler.
function askConfirmChoice(message, labels, onCascade, onSolo) {
    const overlay = document.getElementById('confirm-overlay');
    const actions = overlay.querySelector('.confirm-actions');
    const okBtn   = document.getElementById('confirm-ok-btn');
    const cancel  = document.getElementById('confirm-cancel-btn');
    let alt = document.getElementById('confirm-alt-btn');
    if (!alt) {
        alt = document.createElement('button');
        alt.id = 'confirm-alt-btn';
        alt.className = 'btn';
        actions.insertBefore(alt, okBtn);
    }
    document.getElementById('confirm-text').textContent = message;
    actions.style.flexDirection = 'column';
    okBtn.textContent = labels.cascade;  okBtn.style.order  = 0;
    alt.textContent   = labels.solo;     alt.style.order    = 1;  alt.style.display = '';
    cancel.style.order = 2;
    overlay.classList.remove('hidden');

    const cleanup = () => {
        overlay.classList.add('hidden');
        actions.style.flexDirection = '';
        okBtn.textContent = 'Confirmer';
        okBtn.style.order = cancel.style.order = '';
        alt.style.display = 'none';
        okBtn.onclick = alt.onclick = cancel.onclick = null;
    };
    okBtn.onclick  = () => { cleanup(); onCascade(); };
    alt.onclick    = () => { cleanup(); onSolo(); };
    cancel.onclick = cleanup;
}
