/**
 * core/onboarding.js
 * ──────────────────────────────────────────────────────────────────────────
 * Présentation de premier lancement : quatre écrans courts sur le principe de l'application
 * (une seule réponse par position, construire dans Jouer, réviser dans Entraînement, suivre ses progrès).
 *   - montrée une fois, après l'écran de lancement, à qui n'a encore aucune position enregistrée ;
 *   - un appareil qui a déjà des données ne la voit jamais (marquée « vue » sans l'afficher) ;
 *   - relançable depuis Aide › Premiers pas (showOnboarding).
 * État propre à l'appareil : « chessTrainer_onboarded » (jamais synchronisé).
 */

'use strict';

const ONBOARDING_KEY = 'chessTrainer_onboarded';

const ONBOARDING_STEPS = [
    { icon: 'crown', title: 'Une seule réponse par position',
      text: 'Votre répertoire retient <strong>un coup par position</strong> où c’est à vous de jouer : le vôtre. Le but est de le retrouver à chaque fois, quel que soit l’ordre de coups qui y mène.' },
    { icon: 'git-branch', title: 'Construire dans Jouer',
      text: 'Jouez <strong>vos coups et ceux de l’adversaire</strong>. Dans une position nouvelle, votre coup est enregistré. Rien n’est compté ici : explorez librement, ou importez vos lignes depuis un fichier PGN.' },
    { icon: 'target', title: 'Réviser dans Entraînement',
      text: 'L’application vous repose chaque position <strong>au bon moment</strong> : une réussite éloigne la prochaine révision, une erreur la ramène vite. Quelques minutes par jour suffisent.' },
    { icon: 'bar-chart', title: 'Suivre ses progrès',
      text: 'Les <strong>Statistiques</strong> montrent ce qui est maîtrisé et ce qui reste fragile. <strong>Mes parties en ligne</strong> compare vos parties Lichess et Chess.com à votre répertoire.' }
];

let _obStep = 0, _obReturnFocus = null;

function _obHasData() {
    return loadRepertoireList().some(rep => ['w', 'b'].some(c => Object.keys(readDBFor(rep, c)).length));
}

function _obRender() {
    const s = ONBOARDING_STEPS[_obStep], last = _obStep === ONBOARDING_STEPS.length - 1;
    const box = document.getElementById('onboarding-box');
    box.innerHTML = `
        <div class="ob-ico">${ico(s.icon)}</div>
        <h2 class="ob-title" id="onboarding-title">${s.title}</h2>
        <p class="ob-text">${s.text}</p>
        <div class="ob-dots" aria-label="Étape ${_obStep + 1} sur ${ONBOARDING_STEPS.length}">${ONBOARDING_STEPS.map((x, i) =>
            `<button type="button" class="ob-dot${i === _obStep ? ' is-on' : ''}" data-action="obGoto" data-arg="${i}" aria-label="Étape ${i + 1}"${i === _obStep ? ' aria-current="step"' : ''}></button>`).join('')}</div>
        <div class="ob-actions">
            ${_obStep ? `<button type="button" class="btn" data-action="obPrev">${ico('chevron-left')} Précédent</button>` : `<button type="button" class="btn" data-action="obClose">Passer</button>`}
            ${last ? `<button type="button" class="btn" data-action="obImport">${ico('upload')} Importer un PGN</button>
                      <button type="button" class="btn btn-primary" data-action="obClose" id="ob-primary">Commencer</button>`
                   : `<button type="button" class="btn btn-primary" data-action="obNext" id="ob-primary">Suivant ${ico('chevron-right')}</button>`}
        </div>`;
    const primary = document.getElementById('ob-primary');
    if (primary) primary.focus();
}

function showOnboarding() {
    _obStep = 0;
    _obReturnFocus = document.activeElement;
    document.getElementById('onboarding-overlay').classList.remove('hidden');
    _obRender();
}

function closeOnboarding() {
    dataStore.set(ONBOARDING_KEY, '1');
    document.getElementById('onboarding-overlay').classList.add('hidden');
    if (_obReturnFocus && _obReturnFocus.focus) _obReturnFocus.focus();
}

function _obGo(i) {
    _obStep = Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, i));
    _obRender();
}

registerActions({
    obNext:   () => _obGo(_obStep + 1),
    obPrev:   () => _obGo(_obStep - 1),
    obGoto:   i  => _obGo(Number(i)),
    obClose:  () => closeOnboarding(),
    obImport: () => { closeOnboarding(); showPgnImport(); }
});

document.addEventListener('keydown', e => {
    const ov = document.getElementById('onboarding-overlay');
    if (!ov || ov.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeOnboarding(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); _obGo(_obStep + 1); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); _obGo(_obStep - 1); }
});

// Premier lancement : après l'écran de lancement (classe « splashing » retirée de <html>).
(function initOnboarding() {
    if (dataStore.get(ONBOARDING_KEY)) return;
    if (_obHasData()) { dataStore.set(ONBOARDING_KEY, '1'); return; }
    const root = document.documentElement;
    if (!root.classList.contains('splashing')) { showOnboarding(); return; }
    const obs = new MutationObserver(() => {
        if (root.classList.contains('splashing')) return;
        obs.disconnect();
        showOnboarding();
    });
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
})();
