# Spec — Anti-underground des branches + aération du layout

Date : 2026-06-27
Fichiers touchés : `inspector/layout.js`, `lib/snapshot.mjs`, `test/snapshot.test.mjs`, `test/layout.test.mjs` (nouveau)

## Contexte

Deux défauts visuels constatés sur l'instance OpenClaw (capture du 2026-06-27) :

1. **Des branches passent sous les socles.** Les îlots posent un anneau/disque à
   `y = origin[1] - 1.6` (`scene-v2.js:475`), mais certains nœuds descendent sous ce plan.
   Cause : dans `layout.js place()`, le tronc (root, `dir = [0,1,0]`) éclate ses enfants
   jusqu'à `theta = rootSpread = 1.5` rad (≈ 86°). Une branche de 1er niveau quasi-horizontale
   a une base `basis(dir)` dont un des vecteurs `U`/`V` porte une forte composante verticale ;
   ses descendantes peuvent alors pointer **vers le bas** (`dir[1] < 0`) et plonger sous le
   socle. Idem pour les fleurs de fichiers : le bloom racine (`root.pos = [0,0,0]`) se répartit
   en sphère de rayon `r` autour du tip et descend jusqu'à `~ -r`, sous l'anneau.

2. **Le layout est trop serré.** `rootLen` (10 hôte / 5,6 conteneur), `decay 0.66` et
   `fileSpread 0.5` produisent un rendu cramé. L'utilisateur veut des branches plus grandes
   et plus espacées — un rendu plus aéré.

## Objectifs

1. **Garantie géométrique** : aucun nœud (branche ou fichier) ne descend sous le plan du
   socle. Pas un réglage qu'on espère — une invariante vérifiable.
2. **Rendu plus grand et aéré** : branches plus longues, sous-branches et blooms plus espacés.

## Non-objectifs

- Repenser l'algorithme de layout (fibonacci-sphere conservé).
- Modifier le placement des îlots autrement que le rayon de l'anneau (`placeOrigins`).
- Toucher au rendu THREE (matériaux, veines, halos), aux étiquettes, à la recherche.

## Décision d'architecture

`rootLen` reste **au source** (`lib/snapshot.mjs`) — unique source de vérité par îlot, pas de
multiplicateur dupliqué côté front. Les autres réglages (`decay`, `rootSpread`, `childSpread`,
`fileSpread`) restent les **défauts de `layout.js`** : module math partagé, donc `scene.js` et
`scene-v2.js` en bénéficient tous deux.

_Alternative écartée_ : scaler `rootLen` dans `scene-v2.js` au call `layout(...)`. Introduit un
facteur magique qui diverge de la valeur backend → deux sources de vérité.

## Détail — `inspector/layout.js`

### Garde verticale sur les branches (anti-underground n°1)

Dans `place()`, passer la déclaration `const dir = norm(...)` (l. 67) en `let`, puis **avant**
`c.dir = dir` relever la composante verticale sous un plancher et renormaliser :

```js
const MIN_DIR_Y = 0.06; // ~3,4° au-dessus de l'horizontale
let dir = norm(add(/* … existant … */));
if (dir[1] < MIN_DIR_Y) dir = norm([dir[0], MIN_DIR_Y, dir[2]]);
c.dir = dir;
```

Réutiliser `dir` (et non une nouvelle variable) laisse intactes les lignes suivantes qui s'en
servent (`c.pos = add(node.pos, scale(dir, len))`).

Effet : chaque segment a `dir[1] > 0`, donc `y` est **monotone croissant** depuis le tronc
(`root.pos[1] = 0`). Conséquence directe : tout `node.pos[1] >= 0 > -1.6` (le socle). Aucune
branche ne peut descendre sous le socle, quelle que soit la profondeur ou le spread.

Remarque : avec `rootSpread = 1.3`, `theta` max au 1er niveau donne `dir[1] = cos(1.3) ≈ 0.27`,
au-dessus du plancher — la garde ne touche donc que les branches profondes qui pointaient vers
le bas, sans aplatir le tronc.

### Plancher sur les fleurs de fichiers (anti-underground n°2)

Dans la boucle `childFiles` (l. 88-105), après `f.pos = add(tip, scale(norm(local), r))`,
clamper la hauteur au plancher du socle :

```js
const FLOOR_Y = -1.3; // juste au-dessus de l'anneau (-1.6)
if (f.pos[1] < FLOOR_Y) f.pos[1] = FLOOR_Y;
```

Les blooms reposent sur le socle au lieu de le traverser. (Le clamp est en coordonnées locales
pré-`translate` ; tous les îlots ont `origin[1] = 0`, donc le socle est à `y = -1.6` aussi bien
en local qu'en monde.)

### Réglages d'aération (défauts de `layout()`)

| Param         | Actuel | Nouveau  |
| ------------- | ------ | -------- |
| `decay`       | 0.66   | **0.72** |
| `rootSpread`  | 1.5    | **1.3**  |
| `childSpread` | 0.9    | **0.95** |
| `fileSpread`  | 0.5    | **0.7**  |

`lengthByMass` (0.5) et `rootSpread`→`childSpread` décroissance inchangés.

## Détail — `lib/snapshot.mjs`

| Emplacement                             | Actuel | Nouveau |
| --------------------------------------- | ------ | ------- |
| `parseHosts(..., rootLen = 10)` (l. 59) | 10     | **13**  |
| container `rootLen: 5.6` (l. 169)       | 5,6    | **7,5** |
| `placeOrigins` `const R = 26` (l. 51)   | 26     | **32**  |

`R` passe à 32 pour que les îlots agrandis ne se chevauchent pas sur l'anneau de placement.

## Détail — tests

### `test/snapshot.test.mjs`

Mettre à jour l'assertion l. 57 :
`assert.deepEqual(h[0], { root: "/app", name: "openclaw", rootLen: 13 });`

Le test `placeOrigins` (l. 47-52) n'assert pas `R` → reste vert.

### `test/layout.test.mjs` (nouveau)

Test unitaire de l'invariante anti-underground. Construire un petit arbre synthétique
(`{ type:'dir', depth:0, count, children:[…] }` avec quelques niveaux de dossiers et fichiers,
champs `id`/`count` renseignés pour `hash()` et `mass`), appeler `layout(root)`, parcourir tous
les nœuds et vérifier `node.pos[1] >= -1.6` pour tout nœud avec `pos`. Cas couverts : arbre
profond, dossier à enfant unique, dossier riche en fichiers.

## Vérification

- **Automatique** : `node --test test/layout.test.mjs test/snapshot.test.mjs` — l'invariante
  `pos[1] >= socle` et les valeurs `rootLen` sont vérifiées sans rendu.
- **Visuelle** : l'utilisateur recharge son instance OpenClaw et fournit une capture. Les
  valeurs cosmétiques (`decay`, spreads, `rootLen`, `R`) sont des points de départ ajustables
  à l'œil ; on itère si le rendu est trop dense/épars ou si des îlots se touchent encore.

## Risques

- `decay 0.72` + `rootLen 13` agrandissent l'emprise des arbres → risque de chevauchement
  d'îlots malgré `R = 32`. Mitigé par l'itération visuelle ; `R` est le levier si besoin.
- Le clamp `FLOOR_Y` aplatit le bas des blooms très denses (effet « posé sur une table »).
  Acceptable visuellement ; ajustable si jugé trop net.
