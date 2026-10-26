/**
 * core/avatarPhoto.js
 * ──────────────────────────────────────────────────────────────────────────
 * Photo de profil : choix d'une image, recadrage carré dans un canvas, envoi au compte.
 *
 *   AvatarPhoto.src()      → image à afficher (data: URL de 128 px) ou null (avatar dessiné)
 *   AvatarPhoto.pick()     → choix du fichier, puis fenêtre de recadrage (glisser, zoom)
 *   AvatarPhoto.remove()   → retire la photo (et le fichier en ligne)
 *   AvatarPhoto.purge()    → supprime tout le dossier en ligne de l'utilisateur (avant suppression du compte)
 *   AvatarPhoto.onChange(fn) : appelé quand la photo change (avatar de la barre et du profil à redessiner)
 *
 * Avec un compte : WebP 256 px (qualité 0,85) dans le seau Supabase privé « avatars », chemin
 * {uid}/avatar-{horodatage}.webp (règles RLS : chacun son dossier, supabase/schema.sql) ; la préférence
 * synchronisée appSettings.avatarPhoto retient ce chemin. Chaque appareil garde une copie de 128 px
 * (chessTrainer_avatarLocal : { path, data }), téléchargée au besoin avec la session.
 * Sans compte : seule la copie locale de 128 px existe (path 'local'), rien ne part en ligne.
 */

'use strict';

const AvatarPhoto = (function () {
    const LOCAL_KEY = 'chessTrainer_avatarLocal';
    const BUCKET = 'avatars', SIZE = 256, THUMB = 128, QUALITY = .85;
    const listeners = [];
    let fetching = null;

    const cfg = () => (typeof CLOUD_CONFIG !== 'undefined' ? CLOUD_CONFIG : { url: '' });
    const storageUrl = p => cfg().url.replace(/\/+$/, '') + '/storage/v1/object' + p;
    const signedIn = () => typeof Auth !== 'undefined' && Auth.isSignedIn();
    const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { /* abonné défaillant : ignoré */ } });
    const readLocal = () => { const v = dataStore.getJSON(LOCAL_KEY, null); return v && typeof v.data === 'string' && /^data:image\//.test(v.data) ? v : null; };

    async function headers(extra) {
        if (Auth.refreshIfNeeded) await Auth.refreshIfNeeded();
        const s = Auth.session();
        return Object.assign({ apikey: cfg().anonKey, Authorization: 'Bearer ' + (s && s.access_token) }, extra || {});
    }

    // ─── Affichage ────────────────────────────────────────────────────────────
    function src() {
        const want = appSettings.avatarPhoto, local = readLocal();
        if (!want) return local && local.path === 'local' && !signedIn() ? local.data : null;
        if (local && local.path === want) return local.data;
        if (signedIn() && !fetching) fetching = download(want).finally(() => { fetching = null; });
        return null;
    }

    // Copie de 128 px d'une photo du compte (autre appareil, ou copie locale effacée).
    async function download(path) {
        try {
            const r = await fetch(storageUrl(`/authenticated/${BUCKET}/${path}`), { headers: await headers() });
            if (!r.ok) return;
            const img = await loadImage(URL.createObjectURL(await r.blob()));
            const c = document.createElement('canvas');
            c.width = c.height = THUMB;
            c.getContext('2d').drawImage(img, 0, 0, THUMB, THUMB);
            dataStore.setJSON(LOCAL_KEY, { path, data: c.toDataURL('image/webp', QUALITY) });
            emit();
        } catch (e) { /* hors ligne : avatar dessiné en attendant */ }
    }

    const loadImage = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });

    // ─── Recadrage ────────────────────────────────────────────────────────────
    function pick() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            const f = input.files && input.files[0];
            if (!f) return;
            try { openCropper(await loadImage(URL.createObjectURL(f))); }
            catch (e) { reportError('photo de profil', e, { notify: true, message: 'Image illisible : choisissez un fichier JPEG, PNG ou WebP.' }); }
        };
        input.click();
    }

    // Fenêtre de recadrage : l'image couvre le cadre carré ; on la déplace au doigt ou à la souris, on zoome au curseur.
    function openCropper(img) {
        const V = 260;                                            // côté du cadre à l'écran
        const base = V / Math.min(img.width, img.height);
        const st = { zoom: 1, x: 0, y: 0 };                      // décalage du centre, en pixels du cadre
        const box = document.createElement('div');
        box.className = 'avp-layer';
        box.innerHTML = `<div class="avp-dialog" role="dialog" aria-modal="true" aria-label="Recadrer la photo">
            <b class="avp-title">Recadrer la photo</b>
            <canvas class="avp-canvas" width="${V * 2}" height="${V * 2}" style="width:${V}px;height:${V}px" aria-label="Aperçu : glissez pour déplacer"></canvas>
            <label class="avp-zoom"><span>Zoom</span><input type="range" min="1" max="3" step="0.01" value="1" aria-label="Zoom"></label>
            <div class="avp-actions"><button type="button" class="btn" data-avp="cancel">Annuler</button><button type="button" class="btn btn-primary" data-avp="ok">Enregistrer</button></div>
        </div>`;
        document.body.appendChild(box);
        const cv = box.querySelector('canvas'), ctx = cv.getContext('2d'), range = box.querySelector('input');
        const clampPos = () => {
            const s = base * st.zoom, mx = Math.max(0, (img.width * s - V) / 2), my = Math.max(0, (img.height * s - V) / 2);
            st.x = Math.max(-mx, Math.min(mx, st.x)); st.y = Math.max(-my, Math.min(my, st.y));
        };
        // Rectangle source (pixels de l'image) visible dans le cadre.
        const source = () => { const s = base * st.zoom, side = V / s; return [img.width / 2 - st.x / s - side / 2, img.height / 2 - st.y / s - side / 2, side]; };
        const draw = () => {
            clampPos();
            const [sx, sy, side] = source();
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.drawImage(img, sx, sy, side, side, 0, 0, cv.width, cv.height);
        };
        let drag = null;
        cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, ox: st.x, oy: st.y }; cv.setPointerCapture(e.pointerId); });
        cv.addEventListener('pointermove', e => { if (!drag) return; st.x = drag.ox + e.clientX - drag.x; st.y = drag.oy + e.clientY - drag.y; draw(); });
        cv.addEventListener('pointerup', () => { drag = null; });
        range.addEventListener('input', () => { st.zoom = Number(range.value); draw(); });
        const close = () => box.remove();
        box.addEventListener('click', async e => {
            const a = e.target.closest('[data-avp]');
            if (!a) return;
            if (a.dataset.avp === 'cancel') return close();
            a.disabled = true;
            const [sx, sy, side] = source();
            const out = document.createElement('canvas');
            out.width = out.height = SIZE;
            out.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
            const ok = await save(out);
            if (ok) close(); else a.disabled = false;
        });
        box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
        draw();
        range.focus();
    }

    // ─── Enregistrement ───────────────────────────────────────────────────────
    async function save(canvas) {
        const thumb = document.createElement('canvas');
        thumb.width = thumb.height = THUMB;
        thumb.getContext('2d').drawImage(canvas, 0, 0, THUMB, THUMB);
        const data = thumb.toDataURL('image/webp', QUALITY);
        if (!signedIn()) {
            dataStore.setJSON(LOCAL_KEY, { path: 'local', data });
            emit();
            return true;
        }
        const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', QUALITY));
        const uid = Auth.user().id, path = `${uid}/avatar-${Date.now()}.webp`, old = appSettings.avatarPhoto;
        try {
            const r = await fetch(storageUrl(`/${BUCKET}/${path}`), { method: 'POST', body: blob, headers: await headers({ 'Content-Type': 'image/webp', 'x-upsert': 'true' }) });
            if (!r.ok) throw new Error('envoi refusé (' + r.status + ')');
        } catch (e) {
            reportError('photo de profil', e, { notify: true, message: 'La photo n’a pas pu être envoyée : vérifiez la connexion (et que le seau « avatars » existe, cf. supabase/schema.sql).' });
            return false;
        }
        dataStore.setJSON(LOCAL_KEY, { path, data });
        setPref('avatarPhoto', path);
        if (old && old !== path) removeRemote([old]);
        emit();
        return true;
    }

    function removeRemote(paths) {
        const uid = signedIn() && Auth.user().id;
        const mine = paths.filter(p => uid && p.startsWith(uid + '/'));
        if (!mine.length) return Promise.resolve();
        return headers({ 'Content-Type': 'application/json' })
            .then(h => fetch(storageUrl(`/${BUCKET}`), { method: 'DELETE', headers: h, body: JSON.stringify({ prefixes: mine }) }))
            .catch(() => { /* fichier orphelin : sans conséquence, supprimé avec le compte */ });
    }

    function remove() {
        const old = appSettings.avatarPhoto;
        dataStore.remove(LOCAL_KEY);
        if (old) { setPref('avatarPhoto', ''); removeRemote([old]); }
        emit();
    }

    // Tout le dossier de l'utilisateur, avant la suppression du compte.
    async function purge() {
        if (!signedIn()) return;
        try {
            const uid = Auth.user().id;
            const r = await fetch(storageUrl(`/list/${BUCKET}`), { method: 'POST', headers: await headers({ 'Content-Type': 'application/json' }),
                                                                 body: JSON.stringify({ prefix: uid + '/', limit: 100 }) });
            const files = r.ok ? await r.json() : [];
            await removeRemote(files.map(f => `${uid}/${f.name}`));
        } catch (e) { /* le compte est supprimé quand même : delete_my_account() vide aussi le dossier */ }
        dataStore.remove(LOCAL_KEY);
    }

    return { src, pick, remove, purge, save, onChange: fn => listeners.push(fn) };
})();
