# Spec — Virtualisation des étiquettes + transparence d'isolation

Date : 2026-06-23
Fichier touché : `inspector/scene-v2.js` (uniquement)

## Contexte

Depuis l'ajout du scan multi-racines (`/app` + `.openclaw`), la carte affiche ~44 000
fichiers et plusieurs milliers de dossiers. La navigation (orbite / zoom) est saccadée.
Le rendu 3D s'exécute **dans le navigateur du client** (le VPS ne fait que générer et
servir le JSON) ; la fluidité dépend donc à 100 % du poste local. Les optimisations
précédentes (rendu à la demande, raycast throttlé, passage étiquettes throttlé à ~15 fps)
ont réduit la _fréquence_ du travail mais pas son _coût unitaire_.

## Objectifs

1. **Fluidifier la navigation** à grande échelle sans changer ce qui est affiché ni le
   design (mêmes étiquettes, mêmes positions, mêmes couleurs, même comportement de
   révélation au zoom et d'anti-chevauchement).
2. **Isolation d'une branche** : tout ce qui n'appartient pas à la branche isolée
   (branches **et** fichiers) passe à **15 % d'opacité** (85 % de transparence), en
   conservant sa **vraie couleur**.

## Non-objectifs

- Réduction des données scannées (exclusion de dossiers) — écartée par l'utilisateur.
- Optimisation côté VPS — hors sujet, le rendu est 100 % client.
- Bypass complet du `CSS2DRenderer` (positionnement DOM manuel) — surdimensionné.
- Index spatial (octree) pour le calcul de declutter — pas le goulot ici (cf. Risques).

## Problème mesuré dans le code

`buildLabels` (`scene-v2.js:533`) crée **un `<div>` + un `CSS2DObject` par dossier**, tous
ajoutés à `sceneRoot` au build et jamais retirés (seulement masqués via
`el.style.visibility`). À chaque passage, `CSS2DRenderer.render()`
(`vendor/addons/renderers/CSS2DRenderer.js`) :

- `renderObject` projette **chaque** `CSS2DObject` et écrit son `style.display` ;
- `zOrder` → `filterAndFlatten` collecte **tous** les `CSS2DObject` du graphe **sans
  filtrer sur `.visible`** (ligne 174-176), les **trie tous** (O(n log n)) et réécrit
  `style.zIndex` sur **chacun** (ligne 203-205).

Conséquence : `obj.visible = false` ne réduit **pas** le coût du tri ni des écritures
`zIndex`. Avec plusieurs milliers de dossiers traités ~15×/s alors que l'écran n'en
affiche que quelques dizaines à quelques centaines, l'essentiel du travail DOM est jeté.

## Approche 1 — Virtualisation des étiquettes (montage / démontage du graphe)

`declutterLabels` (`scene-v2.js:857`) calcule déjà l'ensemble réellement visible
(projection écran + test de chevauchement). On s'appuie dessus pour ne garder dans le
graphe que ce sous-ensemble :

- **`buildLabels`** : créer les entrées `labels` (`{ obj, el, node }`) comme aujourd'hui,
  mais **ne pas** `sceneRoot.add(obj)`. Initialiser `el.style.display = "none"` et un
  drapeau `l.mounted = false`.
- **`declutterLabels`** : la phase de calcul (candidats, tri par score, résolution des
  collisions) reste **inchangée**. À la décision finale par label :
  - retenu (visible) et `!l.mounted` → `sceneRoot.add(l.obj)` ; `l.mounted = true` ;
  - non retenu et `l.mounted` → `sceneRoot.remove(l.obj)` ; `l.mounted = false` ;
    `l.el.style.display = "none"` (le renderer ne le visitera plus, il faut donc forcer
    le masquage nous-mêmes).
  - L'`opacity`/`visibility` des retenus reste géré comme aujourd'hui ; le
    `CSS2DRenderer` repositionnera (`transform`) et remettra `display = ""` au même
    `render()` (pas de frame de retard → pas de pop dû au timing).
- **`buildLabels` / rebuilds** : avant de vider `labels`, retirer du graphe ceux qui sont
  montés (le `labels.forEach((l) => sceneRoot.remove(l.obj))` existant ligne 531 reste
  correct ; il ne faut juste plus présumer que tous sont montés).

Effet : `CSS2DRenderer` ne traite que ~N_visibles → `zOrder` et écritures DOM passent de
plusieurs milliers à quelques centaines au pire. Le calcul JS de declutter reste O(total)
mais c'est du vecteur pur (`Vector3.project`), sans DOM, et déjà throttlé à 15 fps.

**Aucune modification** des positions, couleurs, seuils de révélation (`REVEAL`), de
l'anti-chevauchement ni de l'opacité par distance. Le rendu visuel est identique ; seul
change _ce qui est monté dans le DOM à un instant donné_.

## Approche 2 — Transparence par point (RGBA)

- **Branches** (`refresh`, `scene-v2.js:666-674`) : les traits non isolés passent de
  `0.08` → `0.15` (`line.material.opacity`) et les veines de `0.05` → `0.15`
  (`uOpacity`).
- **Fichiers** : aujourd'hui les points hors isolation sont **recolorés vers `dim`**
  (lerp, `refresh:659-663`), donc opaques et sombres. On remplace par une **vraie
  transparence par point** :
  - `buildPoints` (`scene-v2.js:397`) : `baseCol` passe de `Float32Array(n*3)` à
    `Float32Array(n*4)` ; l'attribut `color` passe en **itemSize 4 (RGBA)**. Le
    `PointsMaterial` (`vertexColors:true, transparent:true`) active automatiquement
    `USE_COLOR_ALPHA` en THREE 0.160 et applique l'alpha par vertex.
  - `applyColors` (`scene-v2.js:571`) : écrire `r,g,b` puis `a = 1`.
  - `refresh` : pour chaque fichier, copier la **vraie couleur** (`baseCol` RGB) et fixer
    l'alpha → `1` si visible, `0.15` sinon (isolation **ou** non-correspondance de
    recherche). La logique de lerp vers `dim` pour les points est supprimée ; retirer la
    variable `dim` locale si elle n'est plus utilisée ailleurs.

`depthWrite:false` est déjà actif (ligne 418) → pas de z-fighting. En blending additif,
l'alpha module l'intensité ajoutée (0.15 = estompé) ; en normal, 0.15 = quasi transparent
sur fond sombre. Les deux donnent l'effet « 85 % transparent » attendu.

## Invariants préservés

- Un seul `THREE.Points` (44k fichiers, 1 draw call) — inchangé.
- Génération déterministe, ordre d'appel, IDs stables — inchangés.
- Callbacks `createScene` (`onHover`/`onContext`/`onPick`/`onLabel`/`onIsland`/`onCounts`)
  — inchangés.
- Comportement de recherche, d'isolation (sélection de branche), de thème, de fly-to —
  inchangés (seul l'aspect visuel « estompé » devient « transparent »).

## Risques et points de vigilance

- **Pop / scintillement des étiquettes** à l'entrée/sortie d'écran (montage tardif). À
  confirmer visuellement ; mitigé par l'opacité par distance déjà calculée.
- **`alphaTest:0.02`** (ligne 416) : à alpha 0.15, le bord doux du sprite de point peut
  être rogné → points estompés un peu plus petits/nets. Bénin (moins de bruit visuel).
- **Changement de rendu de la recherche** : les non-correspondances deviennent
  transparentes (alpha) au lieu de sombres. Visuellement proche, mais c'est un léger
  écart au comportement actuel — signalé.
- **Tri de transparence des points** : non trié, mais `depthWrite:false` + alpha faible
  sur fond sombre → artefacts négligeables.
- Le calcul JS de declutter reste O(total labels) : prochain plafond théorique, non
  atteint ici (vecteur pur à 15 fps). Octree seulement si un jour nécessaire.

## Vérification

1. `node --check inspector/scene-v2.js` ; `npm run build && node --test` (aucun test
   frontend, vérifie juste que le backend reste vert).
2. Vérif visuelle **Playwright / Chromium** (déjà installé) :
   - orbite/zoom fluides, pas de pop ni de scintillement des étiquettes ;
   - étiquettes révélées/masquées au zoom comme avant, positions identiques ;
   - isolation d'une branche → autres branches **et** fichiers à ~15 % d'opacité, vraie
     couleur conservée ;
   - recherche, thème, sliders, reset → mise à jour correcte.
