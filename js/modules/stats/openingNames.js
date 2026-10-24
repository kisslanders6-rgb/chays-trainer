/**
 * modules/stats/openingNames.js
 * ──────────────────────────────────────────────────────────────────────────
 * Noms français des ouvertures, pour regrouper les positions de l'onglet Statistiques.
 * Une entrée : « Nom|coups en notation anglaise depuis la position initiale ». Le nom d'une position
 * est celui de l'entrée la plus longue dont les coups sont le début de son chemin (cf. openingNameOf).
 * Plusieurs entrées peuvent porter le même nom (ordres de coups différents).
 * Les coups sont convertis en UCI au premier usage (resolveOpeningNames) : une entrée illégale est ignorée
 * (tests/stats.test.js vérifie qu'il n'y en a aucune).
 */

'use strict';

const OPENING_NAMES_SRC = [
    // ── Premiers coups ──
    'Ouverture du pion roi|e4',
    'Ouverture du pion dame|d4',
    'Partie anglaise|c4',
    'Ouverture Réti|Nf3',
    'Ouverture Bird|f4',
    'Ouverture Larsen|b3',
    'Ouverture hongroise|g3',
    'Ouverture Sokolsky|b4',
    'Ouverture Van Geet|Nc3',
    'Ouverture Van \'t Kruijs|e3',
    'Ouverture Mieses|d3',
    'Ouverture Saragosse|c3',

    // ── 1. e4 e5 ──
    'Partie ouverte|e4 e5',
    'Partie du cavalier roi|e4 e5 Nf3',
    'Partie du cavalier roi|e4 e5 Nf3 Nc6',
    'Défense Philidor|e4 e5 Nf3 d6',
    'Défense Philidor · Variante Hanham|e4 e5 Nf3 d6 d4 Nd7',
    'Défense Philidor · Variante d\'échange|e4 e5 Nf3 d6 d4 exd4',
    'Défense Petrov|e4 e5 Nf3 Nf6',
    'Défense Petrov · Variante classique|e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4',
    'Défense Petrov · Attaque Steinitz|e4 e5 Nf3 Nf6 d4',
    'Défense Petrov · Gambit Stafford|e4 e5 Nf3 Nf6 Nxe5 Nc6',
    'Défense Petrov · Variante des trois cavaliers|e4 e5 Nf3 Nf6 Nc3',
    'Contre-gambit letton|e4 e5 Nf3 f5',
    'Défense Damiano|e4 e5 Nf3 f6',
    'Contre-gambit Éléphant|e4 e5 Nf3 d5',
    'Partie italienne|e4 e5 Nf3 Nc6 Bc4',
    'Partie italienne · Giuoco Piano|e4 e5 Nf3 Nc6 Bc4 Bc5',
    'Partie italienne · Giuoco Pianissimo|e4 e5 Nf3 Nc6 Bc4 Bc5 d3',
    'Partie italienne · Giuoco Pianissimo|e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3',
    'Partie italienne · Giuoco Pianissimo|e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3',
    'Partie italienne · Variante c3|e4 e5 Nf3 Nc6 Bc4 Bc5 c3',
    'Partie italienne · Ligne principale|e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4',
    'Partie italienne · Gambit Evans|e4 e5 Nf3 Nc6 Bc4 Bc5 b4',
    'Partie italienne · Gambit Evans accepté|e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4',
    'Partie italienne · Variante 4. O-O|e4 e5 Nf3 Nc6 Bc4 Bc5 O-O',
    'Défense des deux cavaliers|e4 e5 Nf3 Nc6 Bc4 Nf6',
    'Défense des deux cavaliers · 4. Cg5|e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5',
    'Défense des deux cavaliers · Variante moderne|e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5',
    'Défense des deux cavaliers · Attaque Fegatello|e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7',
    'Défense des deux cavaliers · Contre-attaque Traxler|e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 Bc5',
    'Défense des deux cavaliers · 4. d3|e4 e5 Nf3 Nc6 Bc4 Nf6 d3',
    'Défense des deux cavaliers · 4. d4|e4 e5 Nf3 Nc6 Bc4 Nf6 d4',
    'Défense hongroise|e4 e5 Nf3 Nc6 Bc4 Be7',
    'Partie espagnole|e4 e5 Nf3 Nc6 Bb5',
    'Partie espagnole · Défense berlinoise|e4 e5 Nf3 Nc6 Bb5 Nf6',
    'Partie espagnole · Berlinoise, 4. d3|e4 e5 Nf3 Nc6 Bb5 Nf6 d3',
    'Partie espagnole · Finale berlinoise|e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8',
    'Partie espagnole · Défense Morphy|e4 e5 Nf3 Nc6 Bb5 a6',
    'Partie espagnole · Variante d\'échange|e4 e5 Nf3 Nc6 Bb5 a6 Bxc6',
    'Partie espagnole · Défense Steinitz différée|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 d6',
    'Partie espagnole · Variante d3|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 d3',
    'Partie espagnole · Variante ouverte|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4',
    'Partie espagnole · Variante Arkhangelsk|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O b5 Bb3 Bb7',
    'Partie espagnole · Variante néo-Arkhangelsk|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O b5 Bb3 Bc5',
    'Partie espagnole · Variante fermée|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7',
    'Partie espagnole · Variante fermée|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O',
    'Partie espagnole · Attaque Marshall|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5',
    'Partie espagnole · Anti-Marshall|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O a4',
    'Partie espagnole · Anti-Marshall|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O h3',
    'Partie espagnole · Variante Tchigorine|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5',
    'Partie espagnole · Variante Breyer|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8',
    'Partie espagnole · Variante Zaïtsev|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Bb7',
    'Partie espagnole · Défense classique|e4 e5 Nf3 Nc6 Bb5 Bc5',
    'Partie espagnole · Défense Cozio|e4 e5 Nf3 Nc6 Bb5 Nge7',
    'Partie espagnole · Gambit Schliemann|e4 e5 Nf3 Nc6 Bb5 f5',
    'Partie espagnole · Défense Steinitz|e4 e5 Nf3 Nc6 Bb5 d6',
    'Partie espagnole · Défense Bird|e4 e5 Nf3 Nc6 Bb5 Nd4',
    'Partie espagnole · Variante fianchetto|e4 e5 Nf3 Nc6 Bb5 g6',
    'Partie écossaise|e4 e5 Nf3 Nc6 d4',
    'Partie écossaise|e4 e5 Nf3 Nc6 d4 exd4 Nxd4',
    'Partie écossaise · Variante classique|e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5',
    'Partie écossaise · Variante Schmidt|e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6',
    'Partie écossaise · Variante Mieses|e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5',
    'Partie écossaise · Variante Steinitz|e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Qh4',
    'Gambit écossais|e4 e5 Nf3 Nc6 d4 exd4 Bc4',
    'Gambit Göring|e4 e5 Nf3 Nc6 d4 exd4 c3',
    'Partie Ponziani|e4 e5 Nf3 Nc6 c3',
    'Partie des trois cavaliers|e4 e5 Nf3 Nc6 Nc3',
    'Partie des quatre cavaliers|e4 e5 Nf3 Nc6 Nc3 Nf6',
    'Partie des quatre cavaliers · Variante écossaise|e4 e5 Nf3 Nc6 Nc3 Nf6 d4',
    'Partie des quatre cavaliers · Variante espagnole|e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5',
    'Partie des quatre cavaliers · Variante italienne|e4 e5 Nf3 Nc6 Nc3 Nf6 Bc4',
    'Partie des quatre cavaliers · Variante Glek|e4 e5 Nf3 Nc6 Nc3 Nf6 g3',
    'Partie des quatre cavaliers · Gambit Halloween|e4 e5 Nf3 Nc6 Nc3 Nf6 Nxe5',
    'Partie viennoise|e4 e5 Nc3',
    'Partie viennoise · 2…Cf6|e4 e5 Nc3 Nf6',
    'Partie viennoise · 2…Cc6|e4 e5 Nc3 Nc6',
    'Partie viennoise · Gambit viennois|e4 e5 Nc3 Nf6 f4',
    'Partie viennoise · Gambit viennois|e4 e5 Nc3 Nc6 f4',
    'Partie viennoise · 3. Fc4|e4 e5 Nc3 Nf6 Bc4',
    'Partie viennoise · Variante Frankenstein-Dracula|e4 e5 Nc3 Nf6 Bc4 Nxe4',
    'Partie viennoise · Variante fianchetto|e4 e5 Nc3 Nf6 g3',
    'Gambit du roi|e4 e5 f4',
    'Gambit du roi accepté|e4 e5 f4 exf4',
    'Gambit du roi accepté · Gambit du cavalier|e4 e5 f4 exf4 Nf3',
    'Gambit du roi accepté · Gambit du fou|e4 e5 f4 exf4 Bc4',
    'Gambit du roi refusé · Variante classique|e4 e5 f4 Bc5',
    'Gambit du roi · Contre-gambit Falkbeer|e4 e5 f4 d5',
    'Partie du fou|e4 e5 Bc4',
    'Partie du fou · Défense berlinoise|e4 e5 Bc4 Nf6',
    'Partie du centre|e4 e5 d4 exd4 Qxd4',
    'Gambit danois|e4 e5 d4 exd4 c3',
    'Attaque Parham|e4 e5 Qh5',

    // ── Défense sicilienne ──
    'Défense sicilienne|e4 c5',
    'Sicilienne · Variante Alapin|e4 c5 c3',
    'Sicilienne · Alapin, 2…d5|e4 c5 c3 d5',
    'Sicilienne · Alapin, 2…Cf6|e4 c5 c3 Nf6',
    'Sicilienne · Variante Alapin|e4 c5 Nf3 d6 c3',
    'Sicilienne · Variante Alapin|e4 c5 Nf3 Nc6 c3',
    'Sicilienne · Variante Alapin|e4 c5 Nf3 e6 c3',
    'Sicilienne · Variante fermée|e4 c5 Nc3',
    'Sicilienne · Variante fermée|e4 c5 Nc3 Nc6 g3',
    'Sicilienne · Attaque Grand Prix|e4 c5 Nc3 Nc6 f4',
    'Sicilienne · Attaque Grand Prix|e4 c5 f4',
    'Sicilienne · Gambit Smith-Morra|e4 c5 d4 cxd4 c3',
    'Sicilienne · Gambit de l\'aile|e4 c5 b4',
    'Sicilienne · Variante Bowdler|e4 c5 Bc4',
    'Sicilienne · Variante Rossolimo|e4 c5 Nf3 Nc6 Bb5',
    'Sicilienne · Variante Moscou|e4 c5 Nf3 d6 Bb5+',
    'Sicilienne · Variante Moscou, 3…Fd7|e4 c5 Nf3 d6 Bb5+ Bd7',
    'Sicilienne · Variante Moscou, 3…Cd7|e4 c5 Nf3 d6 Bb5+ Nd7',
    'Sicilienne · Variante O\'Kelly|e4 c5 Nf3 a6',
    'Sicilienne · Variante Nimzowitsch|e4 c5 Nf3 Nf6',
    'Sicilienne · Variante hyperaccélérée|e4 c5 Nf3 g6',
    'Sicilienne ouverte|e4 c5 Nf3 d6 d4',
    'Sicilienne ouverte|e4 c5 Nf3 Nc6 d4',
    'Sicilienne ouverte|e4 c5 Nf3 e6 d4',
    'Sicilienne · Variante Hongroise|e4 c5 Nf3 d6 d4 cxd4 Qxd4',
    'Sicilienne Najdorf|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6',
    'Sicilienne Najdorf · Attaque anglaise|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3',
    'Sicilienne Najdorf · 6. Fg5|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5',
    'Sicilienne Najdorf · Variante Opočenský|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be2',
    'Sicilienne Najdorf · Attaque Fischer-Sozine|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bc4',
    'Sicilienne Najdorf · Variante Adams|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 h3',
    'Sicilienne Najdorf · 6. f4|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 f4',
    'Sicilienne Najdorf · 6. g3|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 g3',
    'Sicilienne Najdorf · 6. f3|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 f3',
    'Sicilienne Dragon|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6',
    'Sicilienne Dragon · Attaque yougoslave|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3',
    'Sicilienne Dragon · Variante classique|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be2',
    'Sicilienne Dragon · Variante Levenfish|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 f4',
    'Sicilienne classique|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6',
    'Sicilienne classique|e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 d6',
    'Sicilienne classique · Attaque Richter-Rauzer|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6 Bg5',
    'Sicilienne classique · Attaque Sozine|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6 Bc4',
    'Sicilienne Scheveningue|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6',
    'Sicilienne Scheveningue · Attaque Keres|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6 g4',
    'Sicilienne Scheveningue · Attaque anglaise|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6 Be3',
    'Sicilienne · Dragon accéléré|e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6',
    'Sicilienne · Dragon accéléré, étau de Maroczy|e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 c4',
    'Sicilienne Sveshnikov|e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5',
    'Sicilienne Sveshnikov · Ligne principale|e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5',
    'Sicilienne · Variante Kalachnikov|e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 e5 Nb5 d6',
    'Sicilienne · Variante des quatre cavaliers|e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6',
    'Sicilienne · Variante Pin|e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nf6 Nc3 Bb4',
    'Sicilienne Taïmanov|e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6',
    'Sicilienne Kan|e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6',

    // ── Défense française ──
    'Défense française|e4 e6',
    'Française · Attaque est-indienne|e4 e6 d3',
    'Française · Variante d\'avance|e4 e6 d4 d5 e5',
    'Française · Avance, ligne principale|e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6',
    'Française · Variante d\'échange|e4 e6 d4 d5 exd5',
    'Française · Variante Tarrasch|e4 e6 d4 d5 Nd2',
    'Française · Tarrasch, 3…c5|e4 e6 d4 d5 Nd2 c5',
    'Française · Tarrasch, 3…Cf6|e4 e6 d4 d5 Nd2 Nf6',
    'Française · Variante Guimard|e4 e6 d4 d5 Nd2 Nc6',
    'Française · Variante Rubinstein|e4 e6 d4 d5 Nd2 dxe4',
    'Française · 3. Cc3|e4 e6 d4 d5 Nc3',
    'Française · Variante Rubinstein|e4 e6 d4 d5 Nc3 dxe4',
    'Française · Variante Winawer|e4 e6 d4 d5 Nc3 Bb4',
    'Française · Winawer, ligne principale|e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3',
    'Française · Variante classique|e4 e6 d4 d5 Nc3 Nf6',
    'Française · Variante Steinitz|e4 e6 d4 d5 Nc3 Nf6 e5',
    'Française · Variante MacCutcheon|e4 e6 d4 d5 Nc3 Nf6 Bg5 Bb4',
    'Française · Variante Burn|e4 e6 d4 d5 Nc3 Nf6 Bg5 dxe4',

    // ── Défense Caro-Kann ──
    'Défense Caro-Kann|e4 c6',
    'Caro-Kann · Variante des deux cavaliers|e4 c6 Nc3 d5 Nf3',
    'Caro-Kann · Variante d\'avance|e4 c6 d4 d5 e5',
    'Caro-Kann · Avance, variante Short|e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2',
    'Caro-Kann · Avance, 3…c5|e4 c6 d4 d5 e5 c5',
    'Caro-Kann · Avance, attaque Bayonet|e4 c6 d4 d5 e5 Bf5 g4',
    'Caro-Kann · Avance, variante Tal|e4 c6 d4 d5 e5 Bf5 h4',
    'Caro-Kann · Variante d\'échange|e4 c6 d4 d5 exd5 cxd5',
    'Caro-Kann · Attaque Panov|e4 c6 d4 d5 exd5 cxd5 c4',
    'Caro-Kann · Variante fantaisie|e4 c6 d4 d5 f3',
    'Caro-Kann · 3. Cc3|e4 c6 d4 d5 Nc3',
    'Caro-Kann · 3. Cd2|e4 c6 d4 d5 Nd2',
    'Caro-Kann · Variante classique|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5',
    'Caro-Kann · Variante classique|e4 c6 d4 d5 Nd2 dxe4 Nxe4 Bf5',
    'Caro-Kann · Variante Karpov|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7',
    'Caro-Kann · Variante Karpov|e4 c6 d4 d5 Nd2 dxe4 Nxe4 Nd7',
    'Caro-Kann · Variante Bronstein-Larsen|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Nxf6+ gxf6',

    // ── Autres défenses contre 1. e4 ──
    'Défense scandinave|e4 d5',
    'Scandinave · 2…Dxd5|e4 d5 exd5 Qxd5',
    'Scandinave · 3. Cc3 Da5|e4 d5 exd5 Qxd5 Nc3 Qa5',
    'Scandinave · 3. Cc3 Dd6|e4 d5 exd5 Qxd5 Nc3 Qd6',
    'Scandinave · 3. Cc3 Dd8|e4 d5 exd5 Qxd5 Nc3 Qd8',
    'Scandinave · Variante moderne|e4 d5 exd5 Nf6',
    'Défense Alekhine|e4 Nf6',
    'Alekhine · Variante moderne|e4 Nf6 e5 Nd5 d4 d6 Nf3',
    'Alekhine · Attaque des quatre pions|e4 Nf6 e5 Nd5 d4 d6 c4 Nb6 f4',
    'Alekhine · Variante d\'échange|e4 Nf6 e5 Nd5 d4 d6 c4 Nb6 exd6',
    'Défense Pirc|e4 d6',
    'Défense Pirc|e4 d6 d4 Nf6 Nc3 g6',
    'Pirc · Attaque autrichienne|e4 d6 d4 Nf6 Nc3 g6 f4',
    'Pirc · Variante classique|e4 d6 d4 Nf6 Nc3 g6 Nf3',
    'Pirc · Attaque 150|e4 d6 d4 Nf6 Nc3 g6 Be3',
    'Défense moderne|e4 g6',
    'Défense Owen|e4 b6',
    'Défense Nimzowitsch|e4 Nc6',
    'Défense Saint-Georges|e4 a6',

    // ── 1. d4 d5 ──
    'Partie du pion dame|d4 d5',
    'Gambit dame|d4 d5 c4',
    'Gambit dame accepté|d4 d5 c4 dxc4',
    'Gambit dame accepté · Variante classique|d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5',
    'Gambit dame refusé|d4 d5 c4 e6',
    'Gambit dame refusé · 3. Cc3|d4 d5 c4 e6 Nc3',
    'Gambit dame refusé · Variante d\'échange|d4 d5 c4 e6 Nc3 Nf6 cxd5',
    'Gambit dame refusé · Variante orthodoxe|d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7',
    'Gambit dame refusé · Variante Tartakover|d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6',
    'Gambit dame refusé · Variante Lasker|d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 Ne4',
    'Gambit dame refusé · Variante Cambridge Springs|d4 d5 c4 e6 Nc3 Nf6 Bg5 Nbd7 e3 c6 Nf3 Qa5',
    'Gambit dame refusé · Variante Ragozine|d4 d5 c4 e6 Nc3 Nf6 Nf3 Bb4',
    'Gambit dame refusé · 5. Ff4|d4 d5 c4 e6 Nc3 Nf6 Nf3 Be7 Bf4',
    'Gambit dame refusé · Défense Tarrasch|d4 d5 c4 e6 Nc3 c5',
    'Gambit dame refusé · Semi-Tarrasch|d4 d5 c4 e6 Nc3 Nf6 Nf3 c5',
    'Défense slave|d4 d5 c4 c6',
    'Slave · Variante d\'échange|d4 d5 c4 c6 cxd5 cxd5',
    'Slave · 4. e3|d4 d5 c4 c6 Nf3 Nf6 e3',
    'Slave · Variante principale|d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4',
    'Slave · Variante tchèque|d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5',
    'Slave · Variante Chebanenko|d4 d5 c4 c6 Nf3 Nf6 Nc3 a6',
    'Semi-slave|d4 d5 c4 c6 Nf3 Nf6 Nc3 e6',
    'Semi-slave|d4 d5 c4 e6 Nc3 c6',
    'Semi-slave|d4 d5 c4 e6 Nc3 Nf6 Nf3 c6',
    'Semi-slave · 5. e3|d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3',
    'Semi-slave · Variante de Merano|d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5',
    'Semi-slave · Variante Botvinnik|d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 Bg5 dxc4',
    'Semi-slave · Variante Moscou|d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 Bg5 h6',
    'Contre-gambit Albin|d4 d5 c4 e5',
    'Défense Tchigorine|d4 d5 c4 Nc6',
    'Défense baltique|d4 d5 c4 Bf5',
    'Système de Londres|d4 d5 Bf4',
    'Système de Londres|d4 d5 Nf3 Nf6 Bf4',
    'Système de Londres|d4 Nf6 Bf4',
    'Système de Londres|d4 Nf6 Nf3 e6 Bf4',
    'Système de Londres|d4 Nf6 Nf3 g6 Bf4',
    'Système de Londres|d4 Nf6 Nf3 d5 Bf4',
    'Système Jobava-Londres|d4 d5 Nc3 Nf6 Bf4',
    'Système Colle|d4 d5 Nf3 Nf6 e3',
    'Ouverture Veresov|d4 d5 Nc3 Nf6 Bg5',
    'Gambit Blackmar-Diemer|d4 d5 e4',

    // ── 1. d4 Cf6 ──
    'Défense indienne|d4 Nf6',
    'Attaque Trompowsky|d4 Nf6 Bg5',
    'Attaque Torre|d4 Nf6 Nf3 e6 Bg5',
    'Attaque Torre|d4 Nf6 Nf3 g6 Bg5',
    'Défense est-indienne|d4 Nf6 c4 g6',
    'Défense est-indienne|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6',
    'Est-indienne · Variante classique|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5',
    'Est-indienne · Variante Mar del Plata|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7',
    'Est-indienne · Variante Petrossian|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 d5',
    'Est-indienne · Variante Sämisch|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3',
    'Est-indienne · Attaque des quatre pions|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4',
    'Est-indienne · Variante Averbakh|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Be2 O-O Bg5',
    'Est-indienne · Variante fianchetto|d4 Nf6 c4 g6 Nf3 Bg7 g3',
    'Défense Grünfeld|d4 Nf6 c4 g6 Nc3 d5',
    'Grünfeld · Variante d\'échange|d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4',
    'Grünfeld · Variante russe|d4 Nf6 c4 g6 Nc3 d5 Nf3 Bg7 Qb3',
    'Grünfeld · 4. Ff4|d4 Nf6 c4 g6 Nc3 d5 Bf4',
    'Défense nimzo-indienne|d4 Nf6 c4 e6 Nc3 Bb4',
    'Nimzo-indienne · Variante Rubinstein|d4 Nf6 c4 e6 Nc3 Bb4 e3',
    'Nimzo-indienne · Variante classique|d4 Nf6 c4 e6 Nc3 Bb4 Qc2',
    'Nimzo-indienne · Variante Sämisch|d4 Nf6 c4 e6 Nc3 Bb4 a3',
    'Nimzo-indienne · Variante Leningrad|d4 Nf6 c4 e6 Nc3 Bb4 Bg5',
    'Nimzo-indienne · Variante Kmoch|d4 Nf6 c4 e6 Nc3 Bb4 f3',
    'Nimzo-indienne · 4. Cf3|d4 Nf6 c4 e6 Nc3 Bb4 Nf3',
    'Défense ouest-indienne|d4 Nf6 c4 e6 Nf3 b6',
    'Ouest-indienne · Variante Petrossian|d4 Nf6 c4 e6 Nf3 b6 a3',
    'Ouest-indienne · Variante fianchetto|d4 Nf6 c4 e6 Nf3 b6 g3',
    'Défense bogo-indienne|d4 Nf6 c4 e6 Nf3 Bb4+',
    'Ouverture catalane|d4 Nf6 c4 e6 g3',
    'Ouverture catalane|d4 Nf6 c4 e6 Nf3 d5 g3',
    'Catalane · Variante ouverte|d4 Nf6 c4 e6 g3 d5 Bg2 dxc4',
    'Catalane · Variante fermée|d4 Nf6 c4 e6 g3 d5 Bg2 Be7',
    'Défense Benoni|d4 Nf6 c4 c5 d5',
    'Benoni moderne|d4 Nf6 c4 c5 d5 e6',
    'Gambit Benko|d4 Nf6 c4 c5 d5 b5',
    'Gambit Benko accepté|d4 Nf6 c4 c5 d5 b5 cxb5 a6',
    'Gambit Budapest|d4 Nf6 c4 e5',
    'Défense vieille-indienne|d4 Nf6 c4 d6',

    // ── Autres réponses à 1. d4 ──
    'Défense hollandaise|d4 f5',
    'Hollandaise · Variante Leningrad|d4 f5 c4 Nf6 g3 g6',
    'Hollandaise · Variante Leningrad|d4 f5 g3 Nf6 Bg2 g6',
    'Hollandaise · Variante Stonewall|d4 f5 c4 Nf6 g3 e6 Bg2 d5',
    'Hollandaise · Variante classique|d4 f5 c4 Nf6 g3 e6 Bg2 Be7',
    'Hollandaise · Gambit Staunton|d4 f5 e4',
    'Défense moderne|d4 g6',
    'Défense anglaise|d4 e6 c4 b6',
    'Défense Englund|d4 e5',
    'Benoni ancienne|d4 c5',

    // ── Partie anglaise, Réti et autres ──
    'Anglaise · Sicilienne inversée|c4 e5',
    'Anglaise · Dragon inversé|c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5',
    'Anglaise · Variante des quatre cavaliers|c4 e5 Nc3 Nf6 Nf3 Nc6',
    'Anglaise · Variante symétrique|c4 c5',
    'Anglaise · Anglo-indienne|c4 Nf6',
    'Anglaise · Anglo-indienne, variante Mikenas|c4 Nf6 Nc3 e6 e4',
    'Anglaise · Anglo-Grünfeld|c4 Nf6 Nc3 d5',
    'Anglaise · Anglo-slave|c4 c6',
    'Anglaise · Anglo-hollandaise|c4 f5',
    'Anglaise · Anglo-française|c4 e6',
    'Ouverture Réti · 1…d5|Nf3 d5',
    'Ouverture Réti · Gambit Réti|Nf3 d5 c4',
    'Ouverture Réti · Attaque est-indienne|Nf3 d5 g3',
    'Ouverture Réti · Fianchetto roi|Nf3 Nf6 g3',
    'Ouverture Bird · Gambit From|f4 e5'
];

let _openingNames = null;   // Map « chemin UCI » → { name, path }

// Traduit un coup SAN (notation anglaise) en UCI sur l'état courant du moteur ; null si impossible.
function _sanToUci(san) {
    const s = san.replace(/[+#!?]/g, '');
    const color = turn;
    if (s === 'O-O' || s === 'O-O-O') {
        const r = color === 'w' ? '1' : '8';
        return 'e' + r + (s === 'O-O' ? 'g' : 'c') + r;
    }
    const m = s.match(/^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=([NBRQ]))?$/);
    if (!m) return null;
    const type = m[1] || 'P', to = squareToIdx(m[4]);
    const cands = [];
    for (let i = 0; i < 64; i++) {
        const p = board[i];
        if (!p || p.toUpperCase() !== type || (isWhite(p) ? 'w' : 'b') !== color) continue;
        if (m[2] && 'abcdefgh'[i % 8] !== m[2]) continue;
        if (m[3] && String(Math.floor(i / 8) + 1) !== m[3]) continue;
        if (getLegalMoves(i).includes(to)) cands.push(i);
    }
    return cands.length === 1 ? moveToStr(cands[0], to, m[5] ? m[5].toLowerCase() : '') : null;
}

// Construit la table au premier usage. Renvoie la liste des entrées illégales (vide en temps normal).
function resolveOpeningNames() {
    const bad = [];
    if (_openingNames) return bad;
    _openingNames = new Map();
    _withEngineSnapshot(() => OPENING_NAMES_SRC.forEach(line => {
        const [name, moves] = line.split('|');
        parseFEN(INIT_FEN);
        const path = [];
        for (const san of moves.split(' ')) {
            const u = _sanToUci(san);
            if (!u) { bad.push(line); return; }
            path.push(u);
            _applyUciRaw(u);
        }
        _openingNames.set(path.join(' '), { name, path });
    }));
    return bad;
}

// Ouverture d'un chemin UCI : l'entrée la plus longue qui en est le début ; null si aucune.
function openingNameOf(path) {
    resolveOpeningNames();
    for (let n = path.length; n > 0; n--) {
        const hit = _openingNames.get(path.slice(0, n).join(' '));
        if (hit) return hit;
    }
    return null;
}
