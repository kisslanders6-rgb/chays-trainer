/**
 * modules/endgame/egExercises.js
 * ──────────────────────────────────────────────────────────────────────────
 * Catalogue des exercices de finales (FEN, objectif, théorie, conseils) et auto-vérification.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  2. CATALOGUE
// ═══════════════════════════════════════════════════════════════════════════
// kind  'mate'   : mat élémentaire — défense du roi seul par mini-moteur (négamax),
//                  coup du joueur jugé : pat ? pièce abandonnée ? trop lent ?
//       'kpk'    : roi + pion contre roi — verdict EXACT (base calculée au besoin), défense parfaite.
//       'pawns'  : rois + plusieurs pions — solveur borné (EG.pawnValue) à l'horizon `horizon` (demi-coups).
//                  N'y figurent que des positions dont les gains tiennent dans l'horizon (vérifié hors ligne
//                  avec un horizon bien plus long) ; en défense, seul un coup PROUVÉ perdant est refusé.
//       (aucun) : exercice JUGÉ par le juge commun (egJudge.js) : tables Syzygy jusqu'à 7 pièces (API de Lichess,
//                  réponses gardées hors ligne), base KPK locale, sinon moteur (verdict estimé). L'adversaire
//                  calcule (egOpponent.js). Un coup est une erreur si le verdict théorique se dégrade.
//                  Fin d'un gain : mat, roi adverse seul, promotion (sauf until: 'capture'), prise de matériel
//                  (sauf until: 'promo'), ou `keep` coups gagnants joués ; `maxMoves` : au-delà, trop lent.
//                  Fin d'une nulle : pat, plus de matériel de gain adverse, dernier pion adverse pris, `hold` coups.
//                  plan : étapes données en indice. rules : règles de Philidor / Vancura, pour expliquer une erreur.
// goal  'mate' | 'win' | 'draw'
// player 'w' | 'b' : le joueur a toujours le trait au départ.
// solution / unique : coup attendu (UCI) et « un seul coup correct » — contrôlés par endgameSelfTest().
// Verdicts des exercices jugés : ENDGAME_VERDICTS (fin du fichier), écrit par scripts/check-endgames.mjs.
const ENDGAME_CATEGORIES = [
    { id: 'mats',  label: 'Mats élémentaires', desc: 'Technique pure : confiner le roi et le mater sans pat.' },
    { id: 'pions', label: 'Finales de pions',  desc: 'Carré, opposition, cases clés, triangulation, cases conjuguées, pion passé éloigné ou protégé, courses. Chaque coup est vérifié par le calcul.' },
    { id: 'tours', label: 'Finales de tours',  desc: 'Lucena, Philidor, Vancura, puis la règle de Tarrasch, le petit côté, le roi coupé, la Tour active. Jugées par les tables Syzygy.' },
    { id: 'dame', label: 'Finales de Dame',    desc: 'Dame contre pion sur la 7e (central, de fou, de tour) et Dame contre Tour.' },
    { id: 'mineures', label: 'Pièces mineures', desc: 'Cavalier ou Fou contre pion, Fou contre Cavalier, Fous de couleurs opposées : gagner avec la bonne pièce, annuler avec moins de matériel.' },
    { id: 'tour-piece', label: 'Tour + pièce', desc: 'Tour et Fou contre Tour : la position de Philidor (gagner) et la défense de Cochrane (annuler).' }
];

const ENDGAME_EXERCISES = [
    {
        id: 'kqk', cat: 'mats', kind: 'mate', goal: 'mate', player: 'w', level: 1,
        title: 'Roi + Dame contre Roi',
        fen: '8/8/8/4k3/8/8/8/1Q2K3 w - - 0 1',
        maxMoves: 20, defDepth: 4,
        tips: ['Gardez la Dame à un saut de cavalier du roi adverse : elle lui coupe un maximum de cases sans qu\'il puisse l\'approcher.',
               'Rétrécissez la zone pas à pas, puis amenez votre roi en renfort (opposition à deux cases).',
               'Avant chaque coup : le roi adverse garde-t-il au moins une case libre ? Sinon, c\'est pat.'],
        theory: 'Dame + Roi contre Roi se gagne toujours en dix coups environ. Confinez le roi sur un bord avec la Dame (à un saut de cavalier), avancez votre roi jusqu\'à l\'opposition, puis donnez mat. Le seul piège : le pat.'
    },
    {
        id: 'krk', cat: 'mats', kind: 'mate', goal: 'mate', player: 'w', level: 2,
        title: 'Roi + Tour contre Roi',
        fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
        maxMoves: 30, defDepth: 4,
        tips: ['Coupez le roi adverse avec la Tour sur une rangée ou une colonne, loin de lui (il ne doit jamais pouvoir la prendre).',
               'Méthode de la boîte : à chaque coup de Tour qui rétrécit la zone, avancez votre roi pour la soutenir.',
               'Quand les rois sont en opposition (une case entre eux), un échec de Tour repousse le roi vers le bord.'],
        theory: 'La technique de la « boîte » : la Tour délimite la zone de fuite, le roi s\'approche, et chaque opposition permet un échec qui rétrécit la boîte jusqu\'au bord. Maximum théorique : 16 coups.'
    },
    {
        id: 'krrk', cat: 'mats', kind: 'mate', goal: 'mate', player: 'w', level: 1,
        title: 'Deux Tours : le mat de l\'escalier',
        fen: '8/8/8/4k3/8/8/8/R3K2R w - - 0 1',
        maxMoves: 12, defDepth: 4,
        tips: ['Les deux Tours se relaient : l\'une coupe une rangée, l\'autre donne échec sur la rangée suivante.',
               'Si le roi adverse s\'approche d\'une Tour, éloignez-la à l\'autre bout de sa rangée, sans la laisser en prise.'],
        theory: 'Le « mat de l\'escalier » : les deux Tours montent tour à tour d\'une rangée et repoussent le roi jusqu\'au bord, où l\'une donne mat pendant que l\'autre coupe la rangée voisine. Le roi attaquant n\'est même pas nécessaire.'
    },
    {
        id: 'kbbk', cat: 'mats', kind: 'mate', goal: 'mate', player: 'w', level: 2,
        title: 'Roi + deux Fous contre Roi',
        fen: '8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1',
        maxMoves: 25, defDepth: 4,
        tips: ['Côte à côte, les deux Fous forment une barrière de diagonales voisines que le roi adverse ne peut pas franchir.',
               'Rapprochez votre roi et réduisez la zone vers un coin, sans jamais laisser le roi adverse sans case libre hors échec : ce serait pat.'],
        theory: 'Deux Fous matent toujours, en vingt coups au plus. Placés côte à côte, ils barrent deux diagonales voisines ; le roi fort vient les soutenir, et le roi adverse est repoussé vers un coin, n\'importe lequel, où tombe le mat.'
    },
    {
        id: 'kbnk', cat: 'mats', kind: 'mate', goal: 'mate', player: 'w', level: 3,
        title: 'Roi + Fou + Cavalier contre Roi',
        fen: '8/8/8/4k3/8/8/8/1N2KB2 w - - 0 1',
        maxMoves: 40, defDepth: 4,
        tips: ['Le mat n\'est possible que dans un coin de la couleur du Fou : ici a8 ou h1 (cases blanches).',
               'Repoussez d\'abord le roi vers un bord, puis faites-le glisser vers le bon coin : le Cavalier couvre les cases que le Fou ne peut pas contrôler.'],
        theory: 'Le plus difficile des mats élémentaires (33 coups au plus). Le roi adverse est d\'abord poussé vers un bord ; s\'il se réfugie dans un coin de la mauvaise couleur, on le chasse vers le bon coin avec la manœuvre en « W » du Cavalier, le Fou et le roi verrouillant les cases de fuite.'
    },
    {
        id: 'kpk-carre', cat: 'pions', kind: 'kpk', goal: 'win', player: 'w', level: 1,
        title: 'Règle du carré',
        fen: '8/8/8/8/3P4/7k/8/K7 w - - 0 1',
        tips: ['Le roi noir est hors du carré du pion d4 : comptez les coups qu\'il lui faut pour rattraper le pion.'],
        theory: 'Règle du carré : le côté du carré est le nombre de pas qui séparent le pion de sa case de promotion. Si le roi défenseur (au trait) ne peut pas entrer dans ce carré, le pion court à la promotion sans aide.'
    },
    {
        id: 'kpk-carre-def', cat: 'pions', kind: 'kpk', goal: 'draw', player: 'b', level: 1, hold: 6,
        title: 'Entrer dans le carré',
        fen: '8/8/8/8/3P4/7k/8/K7 b - - 0 1',
        tips: ['Le roi noir est un rang trop bas : un seul coup l\'amène dans le carré du pion.'],
        theory: '…Kg4 ! entre dans le carré : après d5 Kf5 d6 Ke6 d7 Kxd7, le roi rattrape le pion. Tout autre coup le laisse hors du carré : le pion se promeut.'
    },
    {
        id: 'kpk-opposition', cat: 'pions', kind: 'kpk', goal: 'win', player: 'w', level: 2,
        title: 'Prendre l\'opposition',
        fen: '8/3k4/8/2K5/3P4/8/8/8 w - - 0 1',
        tips: ['Deux rois face à face, une case entre eux : celui qui n\'a PAS le trait détient l\'opposition.',
               'Placez votre roi devant le pion, à deux cases du roi adverse, pour que ce soit à lui de jouer.'],
        theory: 'Un seul coup gagne : Kd5! prend l\'opposition (Kd5 face à Kd7, les Noirs au trait). Le roi noir doit céder du terrain, et le roi blanc gagne les cases clés devant le pion.'
    },
    {
        id: 'kpk-opposition-def', cat: 'pions', kind: 'kpk', goal: 'draw', player: 'b', level: 2, hold: 8,
        title: 'Tenir l\'opposition',
        fen: '8/4k3/8/3K4/2P5/8/8/8 b - - 0 1',
        tips: ['Le roi blanc menace d\'avancer : placez votre roi pour que ce soit à lui de jouer, face à face.',
               'Restez devant le pion, jamais sur le côté.'],
        theory: '…Kd7! reprend l\'opposition : le roi blanc ne peut plus avancer sans que le roi noir ne garde le contrôle des cases clés. La nulle se tient en gardant l\'opposition à chaque coup.'
    },
    {
        id: 'kpk-sixieme', cat: 'pions', kind: 'kpk', goal: 'win', player: 'w', level: 2,
        title: 'Cases clés : roi sur la 6e',
        fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
        tips: ['Le roi est déjà sur une case clé : ne vous précipitez pas, contournez le roi adverse sans lui laisser le pat.'],
        theory: 'Quand le roi fort occupe une case clé (ici la 6e rangée, devant ou à côté d\'un pion sur la 5e), la position est gagnée quel que soit le trait. Attention au pat avec un pion en 7e !'
    },
    {
        id: 'kpk-opposition-loin', cat: 'pions', kind: 'kpk', goal: 'win', player: 'w', level: 2,
        title: 'Opposition à distance',
        fen: '1k6/8/8/8/8/8/4P3/K7 w - - 0 1', solution: 'a1b2', unique: true,
        tips: ['Les rois sont loin l\'un de l\'autre : c\'est l\'opposition, et non la vitesse, qui décide.',
               'Placez votre roi sur la même colonne que le roi noir, avec un nombre impair de cases entre eux.'],
        theory: 'Un seul coup gagne : 1.Kb2 ! prend l\'opposition à distance (même colonne, cinq cases entre les rois, Noirs au trait). À chaque pas du roi noir, le roi blanc répond par un pas qui conserve cette opposition, jusqu\'à atteindre les cases clés devant son pion. Tout autre premier coup laisse l\'opposition aux Noirs : nulle.'
    },
    {
        id: 'kpk-opposition-loin-def', cat: 'pions', kind: 'kpk', goal: 'draw', player: 'b', level: 2, hold: 10,
        title: 'Opposition à distance (défense)',
        fen: '8/8/k7/8/8/8/1K2P3/8 b - - 0 1', solution: 'a6b6', unique: true,
        tips: ['Le roi blanc menace de gagner les cases clés devant son pion : prenez-lui l\'opposition, même de loin.',
               'Même colonne que le roi blanc, nombre impair de cases entre les deux rois.'],
        theory: 'Un seul coup annule : …Kb6 ! prend l\'opposition à distance (colonne b, trois cases entre les rois). Les Noirs la conservent ensuite à chaque coup en revenant vers le pion, et leur roi arrive à temps devant lui. Tout autre coup laisse le roi blanc prendre l\'opposition : le pion passe.'
    },
    {
        id: 'pions-eloigne', cat: 'pions', goal: 'win', player: 'w', level: 2, maxMoves: 25,
        title: 'Le pion passé éloigné',
        fen: '8/8/4k1p1/8/P3K3/8/6P1/8 w - - 0 1',
        plan: ['Le pion a est loin du roi noir : en avançant, il l\'attire sur l\'aile dame.',
               'Pendant que le roi noir court après lui, votre roi file vers le pion g6.',
               'Le pion a peut être sacrifié : c\'est le prix du pion g6, puis votre pion g va à dame.'],
        theory: 'Un pion passé éloigné est un leurre : le roi défenseur doit l\'arrêter, et pendant ce temps le roi attaquant gagne les pions de l\'autre aile. Les tables le confirment : presque tous les plans raisonnables gagnent, à condition de ne pas laisser le roi noir revenir.'
    },
    {
        id: 'pions-protege', cat: 'pions', goal: 'win', player: 'w', level: 2, maxMoves: 25,
        title: 'Le pion passé protégé',
        fen: '8/8/3k4/3P2p1/2P5/5K2/8/8 w - - 0 1',
        plan: ['Le pion d5, protégé par c4, retient le roi noir : il ne peut pas sortir du carré du pion.',
               'Votre roi est libre : il va prendre le pion g5.',
               'Ne poussez pas c5+ : le pion d5 perdrait sa protection, et c\'est nulle.'],
        theory: 'Un pion passé protégé immobilise le roi adverse sans coûter aucun effort au roi attaquant, qui gagne alors les pions de l\'autre aile. Seul 1.c5+ ? gâche tout : le pion d5 n\'est plus protégé, et le roi noir le prend.'
    },
    {
        id: 'kpk-noir', cat: 'pions', kind: 'kpk', goal: 'win', player: 'b', level: 3,
        title: 'Pion noir : le pas de côté',
        fen: '8/8/8/8/3p4/3k4/8/3K4 b - - 0 1',
        tips: ['Les règles sont les mêmes, à l\'envers : les Noirs avancent vers la 1re rangée.',
               'Face au roi blanc, un pas de côté permet de contourner l\'opposition.'],
        theory: 'Les règles sont symétriques. Le roi noir précède son pion, le roi blanc lui fait face sur la 1re rangée. Au trait, les Noirs gagnent par un pas de côté (…Kc3 ou …Ke3) qui contourne l\'opposition.'
    },
    {
        id: 'kpk-tour', cat: 'pions', kind: 'kpk', goal: 'draw', player: 'b', level: 3, hold: 8,
        title: 'Pion de tour : le coin',
        fen: '2k5/8/2K5/P7/8/8/8/8 b - - 0 1',
        tips: ['Avec un pion de colonne a, le roi défenseur nulle s\'il atteint le coin de promotion.'],
        theory: 'Un pion de colonne a ou h ne gagne pas si le roi défenseur atteint le coin de promotion : le roi attaquant manque de place d\'un côté, et les pats tombent dès que le roi noir touche a8 ou b8.'
    },
    {
        id: 'pions-percee', cat: 'pions', kind: 'pawns', goal: 'win', player: 'w', level: 3,
        title: 'La percée',
        fen: '6k1/ppp5/8/PPP5/8/8/8/6K1 w - - 0 1', horizon: 11, maxMoves: 8, solution: 'b5b6', unique: true,
        tips: ['Les rois sont trop loin : un sacrifice peut créer un pion passé que personne ne rattrapera.',
               'Sacrifiez le pion du milieu ; selon la prise, un second sacrifice libère le pion d\'à côté.'],
        theory: '1.b6 ! : si 1…cxb6 2.a6 ! bxa6 3.c6, et si 1…axb6 2.c6 ! bxc6 3.a6 — un pion blanc file à dame, hors de portée du roi noir. Tout autre premier coup laisse aux Noirs le temps de bloquer par …b6 : la percée n\'existe plus.'
    },
    {
        id: 'pions-reti', cat: 'pions', kind: 'pawns', goal: 'draw', player: 'w', level: 3, hold: 6,
        title: 'L\'étude de Réti',
        fen: '7K/8/k1P5/7p/8/8/8/8 w - - 0 1', horizon: 20, solution: 'h8g7', unique: true,
        tips: ['Le roi blanc paraît trop loin du pion h… mais un roi peut viser deux objectifs à la fois.',
               'Marchez en diagonale : vers le pion h et, en même temps, vers votre pion c.'],
        theory: '1.Kg7 ! h4 2.Kf6 ! : le roi menace à la fois de rattraper le pion h et de soutenir son pion c. Après 2…Kb6 3.Ke5 !, si 3…h3 4.Kd6 h2 5.c7, les deux camps vont à dame : nulle ; si 3…Kxc6 4.Kf4, le roi rattrape le pion h. Sur l\'échiquier, la diagonale est aussi courte que la ligne droite.'
    },
    {
        id: 'pions-majorite', cat: 'pions', goal: 'win', player: 'w', level: 3, maxMoves: 30,
        title: 'La majorité à l\'aile dame',
        fen: '8/p7/4k2p/8/1P2K2P/P7/8/8 w - - 0 1',
        plan: ['À l\'aile dame, deux pions contre un : la majorité crée un pion passé.',
               'Avancez-la (a4, b5) : le pion passé, loin des rois, détourne le roi noir.',
               'Votre roi profite de son absence pour gagner le pion h6.'],
        theory: 'La majorité de pions sur une aile donne un pion passé ; loin des rois, il devient un pion passé éloigné. Le roi défenseur doit s\'en occuper, et le roi attaquant gagne les pions restés sans défense.'
    },
    {
        id: 'pions-course', cat: 'pions', goal: 'win', player: 'w', level: 3, maxMoves: 10, until: 'capture',
        title: 'Course de pions : promotion avec échec',
        fen: '1k6/8/6P1/8/8/4p3/8/K7 w - - 0 1', solution: 'g6g7',
        plan: ['Les deux pions vont à dame. Le vôtre arrive le premier… et avec échec, car le roi noir est sur la 8e rangée.',
               'Après g8=D+, la nouvelle Dame doit arrêter le pion e : visez la case e1.',
               'Une Dame sur la 1re rangée (ou sur la colonne e) prend le pion ou la Dame adverse dès sa promotion.'],
        theory: '1.g7 ! : si 1…e2, 2.g8=D+ arrive avec échec (le roi noir est sur la 8e rangée), puis la Dame rejoint la 1re rangée et prend le pion ou la Dame qui naît en e1. Les Noirs préfèrent donc 1…Ra7 2.g8=D Ra6 3.Dg1 et le pion e3 tombe. Un coup de roi d\'abord (1.Rb1 ?) perd même la course.'
    },
    {
        id: 'pions-triangulation', cat: 'pions', goal: 'win', player: 'w', level: 4, maxMoves: 30,
        title: 'La triangulation',
        fen: '8/3k4/2p5/2P5/3P1K2/8/8/8 w - - 0 1', solution: 'f4f5', unique: true,
        plan: ['Le roi blanc vise d6 (ou e6–d6) ; le roi noir garde ces cases depuis d7 et e7.',
               'Aller droit au but (Re5) ne gagne pas : il faut perdre un temps.',
               'Tournez autour du roi noir (Rf5, Re5, Rf6…) : la même position revient, mais avec les Noirs au trait.'],
        theory: '1.Rf5 ! Re7 2.Re5 Rd7 3.Rf6 ! : le roi blanc tourne autour du roi noir, qui n\'a que deux cases. Après 3…Rc8 4.Re6 Rc7 5.Re7 Rc8 6.Rd6, le roi blanc est entré et la percée d5 décide. La triangulation transmet le trait à l\'adversaire : trois coups pour revenir là où deux suffisaient à l\'autre camp.'
    },
    {
        id: 'pions-conjuguees', cat: 'pions', goal: 'win', player: 'w', level: 5, maxMoves: 40,
        title: 'Les cases conjuguées',
        fen: '8/k7/3p4/p2P4/P7/8/K7/8 w - - 0 1', solution: 'a2b3', unique: true,
        plan: ['Le roi blanc veut prendre d6 (par e6 ou c6) ; le roi noir doit rester assez près pour l\'en empêcher.',
               'À chaque case du roi blanc correspond une case de défense du roi noir : prenez la bonne en premier.',
               'Le roi blanc fait le tour par l\'aile roi : le roi noir, lié au pion a5, ne peut pas suivre.'],
        theory: 'Un seul coup gagne : 1.Rb3 !. Le roi blanc menace b5 (pion a5) et part ensuite vers l\'aile roi (Rc4, Rd3, Rd4, Re4, Rf5, Rg6…) ; le roi noir, qui doit garder un œil sur a5, ne suit pas assez vite et le pion d6 tombe. Les cases conjuguées : à chaque case de l\'attaquant répond une seule case du défenseur ; qui s\'y place le premier gagne.'
    },
    {
        id: 'tours-4c3', cat: 'tours', goal: 'draw', player: 'b', level: 2, hold: 10,
        title: '4 contre 3 sur la même aile',
        fen: '2r3k1/5ppp/8/8/8/4P1P1/5P1P/3R2K1 b - - 0 1',
        plan: ['Quatre pions contre trois sur la même aile : la nulle est la règle, si vous ne faites pas de cadeau.',
               'Gardez vos pions liés et votre roi près d\'eux.',
               'Gardez la Tour active ; n\'échangez pas de pions sans raison.'],
        theory: 'Avec tous les pions sur la même aile, le camp qui a un pion de plus ne peut pas créer de pion passé assez fort : la nulle est théorique. Position de 11 pièces : trop pour les tables Syzygy, chaque coup est jugé par le moteur (verdict estimé).'
    },
    {
        id: 'rook-lucena', cat: 'tours', goal: 'win', player: 'w', level: 3, maxMoves: 20,
        title: 'Position de Lucena',
        fen: '3K4/3P2k1/8/8/8/8/r7/5R2 w - - 0 1',
        plan: ['Le roi est enfermé devant son pion : il faut construire un « pont » avec la Tour sur la 4e rangée.',
               'Gardez le roi noir coupé sur la colonne f, et préparez l\'interposition de la Tour sur la 4e rangée.'],
        theory: 'Lucena : 1.Tf4 ! (le pont) Ta1 2.Re7 Te1+ 3.Rd6 Td1+ 4.Re6 Te1+ 5.Rd5 Td1+ 6.Td4 ! : le roi sort de devant son pion, et la Tour, protégée par le roi, s\'interpose sur la 4e rangée pour casser les échecs. Les tables jugent chaque coup : d\'autres chemins gagnent aussi, mais le pont est la méthode à connaître.'
    },
    {
        id: 'rook-philidor', cat: 'tours', rules: 'philidor', goal: 'draw', player: 'b', level: 3, hold: 12,
        title: 'Position de Philidor',
        fen: '4k3/8/r7/3KP3/8/7R/8/8 b - - 0 1',
        plan: ['Tant que le pion n\'a pas atteint la 6e rangée, gardez la Tour noire sur la 6e rangée et le roi sur sa dernière rangée.',
               'Dès que le pion avance en e6, passez avec la Tour sur la 1re rangée pour donner des échecs par derrière.'],
        theory: 'Défense de Philidor : la Tour reste sur la 6e rangée (elle interdit au roi blanc d\'avancer) tant que le pion n\'est pas en 6e ; dès qu\'il avance, la Tour passe derrière et donne échec sur échec, le roi noir restant sur sa dernière rangée.'
    },
    {
        id: 'tours-tarrasch', cat: 'tours', goal: 'win', player: 'w', level: 3, keep: 12,
        title: 'Règle de Tarrasch : la Tour derrière le pion',
        fen: 'r7/6kp/8/P7/8/8/6KP/3R4 w - - 0 1',
        plan: ['Placez votre Tour derrière le pion passé : à chaque poussée, elle gagne de l\'espace.',
               'La Tour noire, devant le pion, est condamnée à rester passive.',
               'Poussez le pion pour l\'immobiliser, puis le roi blanc vient prendre le pion h7.'],
        theory: '1.Ta1 ! (la Tour derrière le pion, règle de Tarrasch) : la Tour noire est attachée à la colonne a et le roi noir ne peut pas s\'éloigner de l\'aile roi. Les Blancs avancent le pion, puis le roi vient l\'aider. Les tables acceptent aussi 1.Td5, mais tout autre coup laisse filer le gain.'
    },
    {
        id: 'tours-pion-course', cat: 'tours', goal: 'win', player: 'w', level: 3, maxMoves: 14, until: 'capture',
        title: 'Tour contre pion : la course',
        fen: '8/8/8/8/2k5/2p5/8/5RK1 w - - 0 1', solution: 'g1f2', unique: true,
        plan: ['La Tour seule n\'arrêtera pas le pion soutenu par son roi : votre roi doit revenir.',
               'Comptez les coups : le roi blanc doit atteindre la case du pion (ou de promotion) à temps.',
               'Quand le roi blanc approche, la Tour coupe le roi noir ou attaque le pion par derrière.'],
        theory: 'Un seul coup gagne : 1.Rf2 !, le roi rentre immédiatement (1…Rd3 2.Td1+ Rc2 3.Td6 et 4.Re2). Tout coup de Tour laisse le roi noir escorter son pion et c\'est nulle. Contre un pion soutenu, c\'est le roi qui gagne la course, la Tour ne fait que retarder.'
    },
    {
        id: 'rook-vancura', cat: 'tours', rules: 'vancura', goal: 'draw', player: 'b', level: 4, hold: 12,
        title: 'Position de Vancura',
        fen: 'R7/6k1/P4r2/8/2K5/8/8/8 b - - 0 1',
        plan: ['Le roi noir reste en g7 ou h7 : ailleurs, Th8 ! suivi de Th7+ enfile le roi et la Tour.',
               'La Tour attaque le pion de côté, depuis la 6e rangée ; si le roi blanc vient le soutenir, donnez-lui échec par derrière.',
               'Quand le pion arrive en 7e, la Tour passe derrière lui, sur la colonne a.'],
        theory: 'Défense de Vancura (pion de la colonne a en 6e, Tour blanche devant lui) : la Tour noire attaque le pion de côté, ce qui attache la Tour blanche à sa défense, et le roi noir reste dans le coin g7–h7. Quand le roi blanc approche, il reçoit des échecs ; quand le pion avance en 7e, la Tour noire se place derrière lui. Les Blancs ne peuvent pas progresser.'
    },
    {
        id: 'tours-coupe', cat: 'tours', goal: 'win', player: 'w', level: 4, keep: 12,
        title: 'Le roi coupé d\'une colonne',
        fen: '7r/8/5k2/3P4/3K4/8/8/R7 w - - 0 1',
        plan: ['Coupez le roi noir avec la Tour sur la colonne e : il ne doit pas rejoindre le pion.',
               'Avancez roi et pion ensemble ; la Tour noire ne peut que donner des échecs.',
               'Abritez votre roi devant le pion ; quand il ne reste plus d\'échec, le pion avance.'],
        theory: 'Deux coups gagnent : 1.Te1 ! (le roi noir est coupé sur la colonne f) et 1.Rc5. Avec le roi défenseur coupé d\'une seule colonne, le gain demande de la précision : roi et pion avancent ensemble, la Tour garde la coupure. Laissez le roi noir revenir devant le pion, et c\'est la défense de Philidor : nulle.'
    },
    {
        id: 'tours-petit-cote', cat: 'tours', goal: 'draw', player: 'b', level: 4, hold: 10,
        title: 'La défense du petit côté',
        fen: '4k3/8/4K3/4P3/8/8/7R/r7 b - - 0 1',
        plan: ['Le roi va du côté court, vers la colonne h (Rf8) : c\'est le côté où il y a le moins de colonnes.',
               'Votre Tour reste du côté long (colonne a), pour donner des échecs de côté, de loin.',
               'Échecs latéraux à au moins trois colonnes du roi blanc : sinon, il s\'approche de votre Tour.'],
        theory: 'Seuls …Rf8 (le roi vers le petit côté) et …Ta6+ annulent. Après …Rd8 ?, le roi part du côté long et la Tour blanche le coupe : la Tour noire n\'a plus de place pour donner des échecs latéraux. Règle : roi du côté court, Tour du côté long.'
    },
    {
        id: 'tours-active', cat: 'tours', goal: 'win', player: 'w', level: 4, keep: 12,
        title: 'Tour active contre Tour passive',
        fen: '8/r6p/5k2/P7/8/6P1/6K1/1R6 w - - 0 1', solution: 'b1b6', unique: true,
        plan: ['Activez la Tour avec un échec : elle prend la 6e rangée et soutient le pion a.',
               'La Tour noire, coincée devant le pion, ne peut que regarder.',
               'Avec la Tour noire passive, votre Tour finit par gagner le pion h7.'],
        theory: 'Un seul coup gagne : 1.Tb6+ !. Après 1…Re5 2.a6, la Tour noire doit quitter la colonne a pour chercher du jeu, et la Tour blanche, active, prend le pion h7 (Tb7, a7, Txh7). Une Tour active vaut souvent un pion : la Tour passive ne fait que défendre.'
    },
    {
        id: 'dame-pion-tour', cat: 'dame', goal: 'draw', player: 'b', level: 2, hold: 10,
        title: 'Dame contre pion de tour',
        fen: '7K/8/8/8/8/8/p7/1k1Q4 b - - 0 1',
        plan: ['Pion de tour : le roi noir s\'abrite dans le coin, devant ou à côté de son pion.',
               'Si la Dame lui enlève toutes ses cases, c\'est pat.',
               'Gardez le roi collé au pion : b2, a1, b1.'],
        theory: 'Contre un pion de tour sur la 7e, la Dame ne peut pas gagner de temps : quand le roi noir est en a1 devant son pion, il n\'a plus de coup, et la seule façon de l\'empêcher de bouger est le pat. Sauf si le roi blanc est tout près, c\'est nulle.'
    },
    {
        id: 'dame-pion-centre', cat: 'dame', goal: 'win', player: 'w', level: 3, maxMoves: 25, until: 'capture',
        title: 'Dame contre pion central sur la 7e',
        fen: '8/8/8/8/8/8/3pk3/K6Q w - - 0 1',
        plan: ['Échec après échec, la Dame force le roi noir à se placer devant son pion (en d1).',
               'Chaque fois que le roi noir bloque son pion, votre roi avance d\'un pas.',
               'Quand votre roi est assez près, Dame et roi prennent le pion.'],
        theory: 'Contre un pion central (ou de cavalier) sur la 7e, la Dame gagne toujours : par des échecs et des clouages, elle oblige le roi noir à se mettre devant son pion, ce qui donne un temps au roi blanc. On répète jusqu\'à ce que le roi blanc arrive.'
    },
    {
        id: 'dame-pion-fou', cat: 'dame', goal: 'draw', player: 'b', level: 3, hold: 10,
        title: 'Dame contre pion de fou : le pat',
        fen: '8/8/8/8/1Q6/8/1kp5/7K b - - 0 1',
        plan: ['Avec un pion de fou, le roi se réfugie dans le coin a1 : si la Dame prend le pion c2, c\'est pat.',
               'Ne bloquez pas votre pion en c1 : la Dame gagnerait le temps qui manque à son roi.',
               'Revenez sans cesse menacer la promotion.'],
        theory: 'Pion de fou (ou de tour) sur la 7e, roi blanc loin : nulle. Le défenseur va dans le coin (…Ra1) : si la Dame prend le pion, le roi noir est pat ; sinon, il menace à nouveau de promouvoir. …Rc1 ? bloque le pion et laisse au roi blanc le temps d\'approcher.'
    },
    {
        id: 'dame-tour', cat: 'dame', goal: 'win', player: 'w', level: 5, keep: 15,
        title: 'Dame contre Tour : la méthode de Philidor',
        fen: '4k3/4r3/8/4K3/8/8/8/Q7 w - - 0 1',
        plan: ['Repoussez le roi noir vers un bord avec la Dame et le roi, sans jamais laisser la Tour donner un échec gênant.',
               'Visez la position de Philidor : roi noir au bord, Tour collée à lui, roi blanc en face.',
               'Gagnez un temps avec la Dame pour mettre les Noirs au trait : la Tour doit s\'éloigner, et une fourchette la prend.'],
        theory: 'Dame contre Tour se gagne toujours (31 coups au plus, d\'après les tables), mais la technique est longue. La Dame et le roi refoulent le roi noir au bord ; la Tour reste collée à son roi pour éviter les fourchettes. Philidor a montré la position clé : les Noirs au trait doivent éloigner la Tour, et la Dame la prend par un échec double. Tenez le gain quinze coups face à la meilleure défense.'
    },
    {
        id: 'mineur-cavalier', cat: 'mineures', kind: 'pawns', goal: 'draw', player: 'b', level: 2, hold: 8,
        title: 'Le cavalier contre le pion',
        fen: '8/8/1P6/8/5k2/3n4/8/K7 b - - 0 1', horizon: 8,
        tips: ['Le pion est à deux pas de la promotion et votre roi est loin : seul le cavalier peut encore l\'arrêter.',
               'Placez le cavalier sur une case d\'où il contrôle b7 ou b8, et gardez-le hors de portée du roi blanc.'],
        theory: 'Seuls les coups de cavalier vers c5, e5 ou b4 annulent : de là, il contrôle b7 ou rejoint c6 à temps pour couvrir b8. Un coup de roi, même vers le pion, laisse 1.b7 et 2.b8=D. Ensuite, le cavalier tient la case de promotion jusqu\'au retour du roi noir.'
    },
    {
        id: 'mineur-fou-couleur', cat: 'mineures', kind: 'pawns', goal: 'draw', player: 'b', level: 2, hold: 8,
        title: 'Le Fou de la mauvaise couleur',
        fen: '8/8/4k3/7P/8/8/2K5/3B4 b - - 0 1', horizon: 8,
        tips: ['Le Fou blanc circule sur les cases blanches ; la case de promotion h8 est noire : il ne pourra jamais la contrôler.',
               'Courez vers le coin h8. Une fois votre roi devant le pion, rien ne peut l\'en déloger.'],
        theory: 'Roi, Fou et pion de la colonne h contre roi : si le Fou ne contrôle pas la case de promotion, le roi défenseur installé en h8 (ou g7–h8) annule toujours. Il suffit de rejoindre le coin à temps : …Rf7, …Rf6, …Re7 ou …Rf5 y parviennent ; s\'éloigner (…Rd6, …Rd5…) laisse le pion passer.'
    },
    {
        id: 'mineur-fou-pion-tour', cat: 'mineures', goal: 'win', player: 'w', level: 3, maxMoves: 15,
        title: 'Fou + pion de tour : barrer le coin',
        fen: '8/4k3/8/6KP/8/3B4/8/8 w - - 0 1',
        plan: ['Le Fou ne contrôle pas h8 : si le roi noir atteint le coin, c\'est nulle.',
               'Empêchez-le d\'arriver en f8, g7 ou h8 : votre roi et votre Fou lui barrent la route.',
               'Une fois le coin fermé, le pion avance sans risque.'],
        theory: 'Fou de la mauvaise couleur et pion de tour : le gain n\'existe que si le roi défenseur n\'atteint pas le coin. Ici 1.Rg6, 1.Rh6, 1.Fc4 ou 1.Fh7 lui ferment la route (1.h6 aussi) ; un coup quelconque le laisse rejoindre f8–g7, et c\'est nulle.'
    },
    {
        id: 'mineur-cavalier-pion', cat: 'mineures', goal: 'win', player: 'w', level: 3, maxMoves: 15,
        title: 'Cavalier + pion de tour : le pat',
        fen: 'k7/8/P1K5/8/8/8/8/6N1 w - - 0 1',
        plan: ['Attention : après a7 ?, le roi noir en a8 n\'a plus aucun coup : pat.',
               'Amenez d\'abord le Cavalier, ou placez le roi en b6.',
               'Le pion n\'avance que quand le roi noir a encore une case.'],
        theory: 'Cavalier et pion de tour contre roi gagnent, à condition d\'éviter le pat : 1.a7 ? Ra8… pas de coup, nulle. Il faut d\'abord rapprocher le Cavalier (Ce2, Cf3, Ch3) ou le roi (Rb6), puis pousser quand le roi noir peut encore bouger.'
    },
    {
        id: 'mineur-fou-cavalier', cat: 'mineures', goal: 'win', player: 'w', level: 3, maxMoves: 30,
        title: 'Fou contre Cavalier, pions sur les deux ailes',
        fen: '8/p1n5/4k3/8/P2K2P1/8/4B3/8 w - - 0 1',
        plan: ['Pions sur les deux ailes : le Fou, à longue portée, est plus fort que le Cavalier.',
               'Créez des menaces des deux côtés : le Cavalier ne peut pas tout couvrir.',
               'Ne poussez pas g5 trop tôt : le pion deviendrait une cible.'],
        theory: 'Avec des pions sur les deux ailes, le Fou surveille de loin les deux côtés à la fois ; le Cavalier, lent, ne peut pas. Les Blancs gagnent en centralisant le roi et en créant un second front. Seuls 1.g5 ? et 1.Fa6 ? laissent échapper le gain.'
    },
    {
        id: 'mineur-fous-opposes', cat: 'mineures', goal: 'draw', player: 'b', level: 4, hold: 10,
        title: 'Fous de couleurs opposées : la forteresse',
        fen: '8/8/4k3/8/4PP2/5K1b/3B4/8 b - - 0 1', solution: 'e6f6', unique: true,
        plan: ['Fous de couleurs opposées : un pion de plus, voire deux, ne suffisent souvent pas.',
               'Le roi se place devant un pion, sur une case que le Fou blanc ne peut pas attaquer.',
               'Votre Fou arrête l\'autre pion de loin ; sacrifiez-le seulement contre les deux pions.'],
        theory: 'Un seul coup annule : …Rf6 !. Le roi bloque le pion f (et surveille e5), le Fou noir tient la diagonale de l\'autre pion. Le Fou blanc ne peut jamais chasser le roi d\'une case de l\'autre couleur : c\'est la forteresse classique des Fous de couleurs opposées.'
    },
    {
        id: 'tf-cochrane', cat: 'tour-piece', goal: 'draw', player: 'b', level: 4, hold: 12,
        title: 'Tour + Fou contre Tour : la défense de Cochrane',
        fen: '2k5/7R/8/4K3/4B3/8/8/4r3 b - - 0 1',
        plan: ['Votre Tour cloue le Fou contre son roi : tant que le clouage dure, le roi blanc ne peut pas avancer.',
               'Gardez la Tour sur la colonne e, derrière le Fou (Te2, Te3).',
               'Ne prenez pas le Fou : …Txe4+ ? Rxe4 laisse Tour contre roi.'],
        theory: 'Défense de Cochrane : la Tour du défenseur cloue le Fou sur son roi. Le roi blanc doit perdre du temps pour décrocher, et le roi noir reste loin du coin dangereux. Les tables acceptent plusieurs coups (…Te2, …Te3, …Td1, …Tf1, …Rb8, …Rd8) ; …Txe4+ ? ou une Tour qui quitte la colonne perdent.'
    },
    {
        id: 'tf-philidor', cat: 'tour-piece', goal: 'win', player: 'w', level: 5, keep: 12,
        title: 'Tour + Fou contre Tour : la position de Philidor',
        fen: '3k4/8/3K2r1/3B4/8/8/8/5R2 w - - 0 1', solution: 'd5e6', unique: true,
        plan: ['Les rois se font face : la Tour blanche menace le mat sur la 8e rangée.',
               'Le Fou coupe la Tour noire de la 8e rangée (Fe6) et prépare la menace de mat.',
               'Faites manœuvrer la Tour pour forcer la Tour noire à quitter sa rangée, puis matez.'],
        theory: 'Un seul coup gagne : 1.Fe6 !. Le Fou empêche la Tour noire de défendre la 8e rangée et menace Tf8+. La suite (1…Re8 2.Tf2 Th6 3.Ta2 Rf8 4.Tg2…) force la Tour noire à céder : la position de Philidor se gagne toujours, en moins de trente coups.'
    }
];

const ENDGAME_BY_ID = {};
ENDGAME_EXERCISES.forEach(e => { ENDGAME_BY_ID[e.id] = e; });

const EG_SIDE = { w: 'Blancs', b: 'Noirs' };
function egObjective(ex) {
    const who = EG_SIDE[ex.player];
    return ex.goal === 'mate' ? `Les ${who} jouent et font mat`
         : ex.goal === 'win'  ? `Les ${who} jouent et gagnent`
         :                      `Les ${who} jouent et annulent`;
}

// Contrôle de cohérence du catalogue (console : endgameSelfTest()). Chaque exercice doit
// démarrer au trait du joueur, légalement, avec le verdict théorique annoncé.
function endgameSelfTest() {
    return ENDGAME_EXERCISES.map(ex => {
        const st = EG.fromFen(ex.fen), problems = [];
        if (st.stm !== (ex.player === 'w' ? 1 : -1)) problems.push('le joueur n\'a pas le trait');
        if (EG.attacked(st.b, EG.kingSq(st.b, -st.stm), st.stm)) problems.push('position illégale (roi adverse en échec)');
        if (!EG.legalMoves(st).length) problems.push('aucun coup légal');
        const men = ex.fen.split(' ')[0].replace(/[\d/]/g, '');
        if ((men.match(/K/g) || []).length !== 1 || (men.match(/k/g) || []).length !== 1) problems.push('il faut un roi de chaque camp');
        if (/[pP]/.test(ex.fen.split(' ')[0].split('/')[0] + ex.fen.split(' ')[0].split('/')[7])) problems.push('pion sur la 1re ou la 8e rangée');
        if (ex.rules) {
            const ok = EG.legalMoves(st).filter(m => !_egRules(ex).check(st, m));
            if (!ok.length) problems.push('aucun coup de défense conforme');
        }
        if (!ex.kind) {                                       // exercice jugé : verdict figé par scripts/check-endgames.mjs
            const v = ENDGAME_VERDICTS[ex.id];
            if (!v) problems.push('verdict absent : lancer node scripts/check-endgames.mjs');
            else {
                if (v.fen !== ex.fen) problems.push('FEN modifiée depuis la vérification : relancer node scripts/check-endgames.mjs');
                const want = ex.goal === 'win' ? 2 : 0;
                if (v.wdl !== want) problems.push(`verdict ${v.source} « ${v.wdl} » ≠ objectif « ${ex.goal} »`);
                if (!v.good.length) problems.push('aucun coup correct');
                if (ex.solution && !v.good.includes(ex.solution)) problems.push(`la solution annoncée (${ex.solution}) n'est pas jugée correcte`);
                if (ex.unique && v.good.length !== 1) problems.push(`${v.good.length} coups jugés corrects, un seul attendu`);
            }
            if (ex.goal === 'win' && !ex.keep && !ex.maxMoves) problems.push('gain sans limite (keep ou maxMoves)');
            if (ex.goal === 'draw' && !ex.hold) problems.push('nulle sans nombre de coups à tenir (hold)');
            if (!(ex.plan && ex.plan.length)) problems.push('plan absent');
        }
        if (ex.kind === 'pawns') {
            const v = EG.pawnValue(st, ex.horizon), moves = _egPawnMoves(st);
            if (ex.goal === 'win' && v !== 1) problems.push(`gain non prouvé à l'horizon ${ex.horizon}`);
            if (ex.goal === 'draw' && v === -1) problems.push('position perdue pour le joueur');
            const good = moves.filter(m => ex.goal === 'win' ? EG.pawnMoveValue(st, m, ex.horizon) === 1 : EG.pawnMoveValue(st, m, ex.horizon) >= 0);
            if (!good.length) problems.push('aucun coup correct');
            if (ex.solution && !good.some(m => _egUci(m) === ex.solution)) problems.push(`la solution annoncée (${ex.solution}) n'est pas jugée correcte`);
            if (ex.unique && good.length !== 1) problems.push(`${good.length} coups jugés corrects, un seul attendu`);
        }
        if (ex.kind === 'kpk') {
            const pr = EG.kpkProbe(st), expectWin = ex.goal === 'win';
            if (pr.invalid) problems.push('position invalide pour la base KPK');
            else if (pr.win !== expectWin) problems.push(`verdict théorique « ${pr.win ? 'gain' : 'nulle'} » ≠ objectif « ${ex.goal} »`);
            const good = EG.kpkMoves(st).filter(x => x.info.win === (ex.goal === 'win'));
            if (!good.length) problems.push('aucun coup correct');
            if (ex.solution && !good.some(x => _egUci(x.m) === ex.solution)) problems.push(`la solution annoncée (${ex.solution}) n'est pas jugée correcte`);
            if (ex.unique && good.length !== 1) problems.push(`${good.length} coups jugés corrects, un seul attendu`);
        }
        return { id: ex.id, ok: !problems.length, problems };
    });
}

// ─── VERDICTS (générés par scripts/check-endgames.mjs : ne pas modifier à la main) ───
// Par exercice jugé : FEN vérifiée, source (syzygy ou engine), résultat pour le joueur (2 gain, 0 nulle),
// coups qui gardent ce résultat.
const ENDGAME_VERDICTS = {
    'pions-eloigne': { fen: '8/8/4k1p1/8/P3K3/8/6P1/8 w - - 0 1', source: 'syzygy', wdl: 2, good: ['g2g4', 'e4f4', 'g2g3', 'a4a5', 'e4f3', 'e4e3', 'e4d4', 'e4d3'] },
    'pions-protege': { fen: '8/8/3k4/3P2p1/2P5/5K2/8/8 w - - 0 1', source: 'syzygy', wdl: 2, good: ['f3g4', 'f3g3', 'f3e4', 'f3e2', 'f3f2', 'f3g2', 'f3e3'] },
    'pions-majorite': { fen: '8/p7/4k2p/8/1P2K2P/P7/8/8 w - - 0 1', source: 'syzygy', wdl: 2, good: ['a3a4', 'b4b5', 'h4h5', 'e4d3', 'e4e3', 'e4f3', 'e4d4', 'e4f4'] },
    'pions-course': { fen: '1k6/8/6P1/8/8/4p3/8/K7 w - - 0 1', source: 'syzygy', wdl: 2, good: ['g6g7'] },
    'pions-triangulation': { fen: '8/3k4/2p5/2P5/3P1K2/8/8/8 w - - 0 1', source: 'syzygy', wdl: 2, good: ['f4f5'] },
    'pions-conjuguees': { fen: '8/k7/3p4/p2P4/P7/8/K7/8 w - - 0 1', source: 'syzygy', wdl: 2, good: ['a2b3'] },
    'tours-4c3': { fen: '2r3k1/5ppp/8/8/8/4P1P1/5P1P/3R2K1 b - - 0 1', source: 'engine', wdl: 0, good: ['f7f6', 'f7f5', 'g7g6', 'g7g5', 'h7h6', 'h7h5', 'c8e8', 'c8f8', 'c8b8', 'c8a8', 'g8h8', 'g8f8'] },
    'rook-lucena': { fen: '3K4/3P2k1/8/8/8/8/r7/5R2 w - - 0 1', source: 'syzygy', wdl: 2, good: ['f1f5', 'f1d1', 'f1f4', 'f1c1', 'f1f3', 'f1e1', 'f1g1', 'f1b1', 'f1h1', 'd8c7', 'd8e7', 'd8c8', 'd8e8'] },
    'rook-philidor': { fen: '4k3/8/r7/3KP3/8/7R/8/8 b - - 0 1', source: 'syzygy', wdl: 0, good: ['a6a1', 'a6a2', 'a6a4', 'a6a5', 'a6b6', 'a6g6', 'e8d7', 'e8e7', 'e8f7', 'e8d8', 'e8f8'] },
    'tours-tarrasch': { fen: 'r7/6kp/8/P7/8/8/6KP/3R4 w - - 0 1', source: 'syzygy', wdl: 2, good: ['d1a1', 'd1d5'] },
    'tours-pion-course': { fen: '8/8/8/8/2k5/2p5/8/5RK1 w - - 0 1', source: 'syzygy', wdl: 2, good: ['g1f2'] },
    'rook-vancura': { fen: 'R7/6k1/P4r2/8/2K5/8/8/8 b - - 0 1', source: 'syzygy', wdl: 0, good: ['f6f4', 'f6b6', 'f6e6', 'g7h7'] },
    'tours-coupe': { fen: '7r/8/5k2/3P4/3K4/8/8/R7 w - - 0 1', source: 'syzygy', wdl: 2, good: ['d4c5', 'a1e1'] },
    'tours-petit-cote': { fen: '4k3/8/4K3/4P3/8/8/7R/r7 b - - 0 1', source: 'syzygy', wdl: 0, good: ['a1a6', 'e8f8'] },
    'tours-active': { fen: '8/r6p/5k2/P7/8/6P1/6K1/1R6 w - - 0 1', source: 'syzygy', wdl: 2, good: ['b1b6'] },
    'dame-pion-tour': { fen: '7K/8/8/8/8/8/p7/1k1Q4 b - - 0 1', source: 'syzygy', wdl: 0, good: ['b1b2'] },
    'dame-pion-centre': { fen: '8/8/8/8/8/8/3pk3/K6Q w - - 0 1', source: 'syzygy', wdl: 2, good: ['h1e4', 'h1g2', 'h1h2', 'h1h5'] },
    'dame-pion-fou': { fen: '8/8/8/8/1Q6/8/1kp5/7K b - - 0 1', source: 'syzygy', wdl: 0, good: ['b2a1', 'b2a2'] },
    'dame-tour': { fen: '4k3/4r3/8/4K3/8/8/8/Q7 w - - 0 1', source: 'syzygy', wdl: 2, good: ['e5d5', 'e5d6', 'e5d4', 'e5f4', 'e5f5', 'e5f6'] },
    'mineur-fou-pion-tour': { fen: '8/4k3/8/6KP/8/3B4/8/8 w - - 0 1', source: 'syzygy', wdl: 2, good: ['h5h6', 'd3c4', 'g5g6', 'd3h7', 'g5h6'] },
    'mineur-cavalier-pion': { fen: 'k7/8/P1K5/8/8/8/8/6N1 w - - 0 1', source: 'syzygy', wdl: 2, good: ['c6b6', 'g1e2', 'g1f3', 'c6b5', 'g1h3', 'c6c5'] },
    'mineur-fou-cavalier': { fen: '8/p1n5/4k3/8/P2K2P1/8/4B3/8 w - - 0 1', source: 'syzygy', wdl: 2, good: ['a4a5', 'e2d1', 'e2f1', 'e2d3', 'e2f3', 'e2c4', 'd4c4', 'd4e4', 'd4c5', 'e2b5', 'd4c3', 'd4d3', 'd4e3'] },
    'mineur-fous-opposes': { fen: '8/8/4k3/8/4PP2/5K1b/3B4/8 b - - 0 1', source: 'syzygy', wdl: 0, good: ['e6f6'] },
    'tf-cochrane': { fen: '2k5/7R/8/4K3/4B3/8/8/4r3 b - - 0 1', source: 'syzygy', wdl: 0, good: ['e1d1', 'e1f1', 'e1e2', 'e1e3', 'c8b8', 'c8d8'] },
    'tf-philidor': { fen: '3k4/8/3K2r1/3B4/8/8/8/5R2 w - - 0 1', source: 'syzygy', wdl: 2, good: ['d5e6'] }
};
// ─── FIN DES VERDICTS ───

if (typeof module !== 'undefined' && module.exports) module.exports = { ENDGAME_EXERCISES, ENDGAME_CATEGORIES, ENDGAME_VERDICTS, endgameSelfTest };
