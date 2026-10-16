/**
 * modules/endgame/egExercises.js
 * ──────────────────────────────────────────────────────────────────────────
 * Catalogue des exercices de finales (FEN, objectif, théorie, conseils) et auto-vérification.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  2. CATALOGUE
// ═══════════════════════════════════════════════════════════════════════════
// kind  'mate' : mat élémentaire — défense du roi seul par mini-moteur (négamax),
//                coup du joueur jugé : pat ? pièce abandonnée ? trop lent ?
//       'kpk'  : roi + pion contre roi — verdict EXACT (base calculée au besoin), défense parfaite.
// goal  'mate' | 'win' (promotion inévitable) | 'draw' (nulle : prise du pion, pat, ou `hold` coups tenus)
// player 'w' | 'b' : le joueur a toujours le trait au départ.
const ENDGAME_CATEGORIES = [
    { id: 'mats',  label: 'Mats élémentaires', desc: 'Technique pure : confiner le roi et le mater sans pat.' },
    { id: 'pions', label: 'Finales de pions',  desc: 'Roi + pion contre roi : carré, opposition, cases clés. Verdict exact à chaque coup.' },
    { id: 'tours', label: 'Finales de tours',  desc: 'Les deux positions fondamentales : Lucena (gagner) et Philidor (annuler).' }
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
        id: 'rook-lucena', cat: 'tours', kind: 'script', goal: 'win', player: 'w', level: 3,
        title: 'Position de Lucena',
        fen: '3K4/3P2k1/8/8/8/8/r7/5R2 w - - 0 1',
        line: ['f1f4', 'a2a1', 'd8e7', 'a1e1', 'e7d6', 'e1d1', 'd6e6', 'd1e1', 'e6d5', 'e1d1', 'f4d4', 'd1d4', 'd5d4', 'g7f7', 'd7d8q'],
        tips: ['Le roi est enfermé devant son pion : il faut construire un « pont » avec la Tour sur la 4e rangée.',
               'Gardez le roi noir coupé sur la colonne f, et préparez l\'interposition de la Tour sur la 4e rangée.'],
        theory: 'Lucena : 1.Rf4! (le pont) Ra1 2.Ke7 Re1+ 3.Kd6 Rd1+ 4.Ke6 Re1+ 5.Kd5 Rd1+ 6.Rd4! Rxd4+ 7.Kxd4 : le pion se promeut (d8=Q). Le roi sort de devant son pion, et la Tour, protégée par le roi, s\'interpose sur la 4e rangée pour casser les échecs.'
    },
    {
        id: 'rook-philidor', cat: 'tours', kind: 'rules', goal: 'draw', player: 'b', level: 3, hold: 12,
        title: 'Position de Philidor',
        fen: '4k3/8/r7/3KP3/8/7R/8/8 b - - 0 1', beta: true,
        tips: ['Tant que le pion n\'a pas atteint la 6e rangée, gardez la Tour noire sur la 6e rangée et le roi sur sa dernière rangée.',
               'Dès que le pion avance en e6, passez avec la Tour sur la 1re rangée pour donner des échecs par derrière.'],
        theory: 'Défense de Philidor : la Tour reste sur la 6e rangée (elle interdit au roi blanc d\'avancer) tant que le pion n\'est pas en 6e ; dès qu\'il avance, la Tour passe derrière et donne échec sur échec, le roi noir restant sur sa dernière rangée.'
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
        if (ex.kind === 'script') {
            let cur = st;
            ex.line.forEach((u, i) => {
                const m = _egParseUci(u);
                if (!EG.legalMoves(cur).includes(m)) { problems.push(`coup illégal dans la ligne : ${u} (n°${i + 1})`); return; }
                cur = EG.make(cur, m);
            });
        }
        if (ex.kind === 'rules') {
            const ok = EG.legalMoves(st).filter(m => !_egPhilidorCheck(st, m));
            if (!ok.length) problems.push('aucun coup de défense conforme');
        }
        if (ex.kind === 'kpk') {
            const pr = EG.kpkProbe(st), expectWin = ex.goal === 'win';
            if (pr.invalid) problems.push('position invalide pour la base KPK');
            else if (pr.win !== expectWin) problems.push(`verdict théorique « ${pr.win ? 'gain' : 'nulle'} » ≠ objectif « ${ex.goal} »`);
            if (EG.kpkMoves(st).filter(x => x.info.win === (ex.goal === 'win')).length === 0) problems.push('aucun coup correct');
        }
        return { id: ex.id, ok: !problems.length, problems };
    });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ENDGAME_EXERCISES, ENDGAME_CATEGORIES, endgameSelfTest };
