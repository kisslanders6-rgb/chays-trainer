#!/bin/sh
# Régénère js/core/logoData.js à partir des logos teintés (<img data-tint>).
# À relancer après toute modification d'un de ces PNG. Depuis la racine du projet :
#     sh scripts/build-logo-data.sh
set -e
OUT=js/core/logoData.js
{
    echo "// Généré par scripts/build-logo-data.sh — ne pas modifier à la main."
    echo "// Logos en data: URI, utilisés comme masques CSS quand l'app est ouverte en file:// (cf. icons.js)."
    echo "const LOGO_DATA = {"
    for f in assets/chlogo.png assets/chaysTrainerlogo.png assets/chaysTrainerAndLogo.png; do
        printf "    '%s': 'data:image/png;base64,%s',\n" "$f" "$(base64 < "$f" | tr -d '\n')"
    done
    echo "};"
} > "$OUT"
echo "écrit $OUT"
