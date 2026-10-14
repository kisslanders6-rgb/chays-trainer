#!/usr/bin/env python3
"""Étape 4 — ajoute les balises <link>/<script> à index.html et la liste de cache de sw.js.
Idempotent : peut être relancé sans risque. À lancer depuis la racine du projet :
    python3 scripts/apply-step4.py
"""
import pathlib, re, sys

def patch_index(p):
    t = p.read_text(encoding='utf-8'); orig = t
    if 'css/account.css' not in t:
        t = re.sub(r'([ \t]*)(<link rel="stylesheet" href="style\.css"\s*/?>)',
                   lambda m: f'{m.group(1)}{m.group(2)}\n{m.group(1)}<link rel="stylesheet" href="css/account.css" />', t, 1)
    # Chaîne de chargement : storageAdapter → syncModel → cloudConfig → cloudClient → cloudAdapter → auth (AVANT storage.js)
    chain = ['syncModel', 'cloudConfig', 'cloudClient', 'cloudAdapter', 'auth']
    anchor = re.search(r'([ \t]*)<script src="js/core/storageAdapter\.js"></script>', t)
    if not anchor:
        print('✗ index.html : balise storageAdapter.js introuvable (étape 1 appliquée ?)'); return False
    missing = [n for n in chain if f'js/core/{n}.js' not in t]
    if missing:
        ind = anchor.group(1)
        block = ''.join(f'\n{ind}<script src="js/core/{n}.js"></script>' for n in missing)
        t = t[:anchor.end()] + block + t[anchor.end():]
    if 'js/core/accountUI.js' not in t:
        t, n = re.subn(r'([ \t]*)(<script src="js/app\.js"></script>)',
                       lambda m: f'{m.group(1)}{m.group(2)}\n{m.group(1)}<script src="js/core/accountUI.js"></script>', t, 1)
        if not n: print('✗ index.html : balise app.js introuvable'); return False
    if t != orig: p.write_text(t, encoding='utf-8'); print('remplacé    index.html')
    else: print('déjà fait   index.html')
    return True

def patch_sw(p):
    if not p.exists(): print('ABSENT       sw.js (non bloquant)'); return True
    t = p.read_text(encoding='utf-8'); orig = t
    want = ['css/account.css'] + [f'js/core/{n}.js' for n in ['syncModel', 'cloudConfig', 'cloudClient', 'cloudAdapter', 'auth', 'accountUI']]
    missing = [w for w in want if f"'{w}'" not in t]
    if missing:
        t, n = re.subn(r'(const CORE = \[\s*)', lambda m: m.group(1) + ', '.join(f"'{w}'" for w in missing) + ',\n    ', t, 1)
        if not n: print('✗ sw.js : liste CORE introuvable'); return False
    if missing:
        t = re.sub(r"VERSION = 'v(\d+)'", lambda m: f"VERSION = 'v{int(m.group(1)) + 1}'", t, 1)
    if t != orig: p.write_text(t, encoding='utf-8'); print('remplacé    sw.js')
    else: print('déjà fait   sw.js')
    return True

ok = patch_index(pathlib.Path('index.html')) & patch_sw(pathlib.Path('sw.js'))
print('\nTerminé.' if ok else '\nÀ corriger à la main (voir ci-dessus).')
sys.exit(0 if ok else 1)
