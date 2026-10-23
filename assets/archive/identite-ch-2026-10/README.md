# Archive : identité « Ch » (octobre 2026)

Copie, à l'identique, de l'identité visuelle utilisée jusqu'au 23 octobre 2026, conservée pour référence.
Les originaux restent en place dans `assets/` tant que la nouvelle identité n'est pas intégrée.

| Fichier | Rôle d'origine |
|---|---|
| `icons/icon-192.png`, `icons/icon-512.png` | icônes PWA (manifest.json, `purpose: any`) : monogramme « Ch » |
| `icons/icon-maskable-512.png` | icône PWA maskable : affichée sur l'écran système Android au lancement |
| `icons/apple-touch-icon.png` | icône iOS (écran d'accueil) |
| `icons/favicon-32.png`, `icons/favicon-64.png` | favicons |
| `chaysTrainerlogo.png` | signature « Chays Trainer » (barre du haut, splash) |
| `chaysTrainerAndLogo.png` | logo complet de l'accueil (roi + signature) |
| `chlogo.png` | roi au trait de la barre du haut |

Les logos PNG sont teintés par masque CSS (`img[data-tint]`, js/core/icons.js) ; `js/core/logoData.js`
en contient une copie en data: URI pour l'ouverture en file://.
