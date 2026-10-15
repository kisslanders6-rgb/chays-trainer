#!/usr/bin/env python3
"""Étape 5 — branche le moteur de synchro : balise <script> dans index.html et cache de sw.js.
Idempotent. À lancer depuis la racine du projet :   python3 scripts/apply-step5.py
"""
import pathlib, re, sys

def patch_index(p):
    t = p.read_text(encoding='utf-8')
    if 'js/core/syncEngine.js' in t:
        print('déjà fait   index.html'); return True
    t2, n = re.subn(r'([ \t]*)(<script src="js/core/accountUI\.js"></script>)',
                    lambda m: f'{m.group(1)}{m.group(2)}\n{m.group(1)}<script src="js/core/syncEngine.js"></script>', t, 1)
    if not n:
        print('✗ index.html : balise accountUI.js introuvable (étape 4 appliquée ?)'); return False
    p.write_text(t2, encoding='utf-8'); print('remplacé    index.html'); return True

def patch_sw(p):
    if not p.exists(): print('ABSENT       sw.js (non bloquant)'); return True
    t = p.read_text(encoding='utf-8')
    if "'js/core/syncEngine.js'" in t:
        print('déjà fait   sw.js'); return True
    t2, n = re.subn(r'(const CORE = \[\s*)', lambda m: m.group(1) + "'js/core/syncEngine.js',\n    ", t, 1)
    if not n: print('✗ sw.js : liste CORE introuvable'); return False
    t2 = re.sub(r"VERSION = 'v(\d+)'", lambda m: f"VERSION = 'v{int(m.group(1)) + 1}'", t2, 1)
    p.write_text(t2, encoding='utf-8'); print('remplacé    sw.js'); return True

ok = patch_index(pathlib.Path('index.html')) & patch_sw(pathlib.Path('sw.js'))
print('\nTerminé.' if ok else '\nÀ corriger à la main (voir ci-dessus).')
sys.exit(0 if ok else 1)
