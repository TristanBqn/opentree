# Spec — Refonte du système de recherche

Date : 2026-06-24
Fichiers touchés : `inspector/scene-v2.js`, `inspector/main-v2.js`, `inspector/OpenTree.html`

## Contexte

La recherche actuelle « fonctionne mal » pour trois raisons concrètes :

1. **Elle matche le chemin complet** (`fileVisible`, `scene-v2.js:652` —
   `query && !f.path.toLowerCase().includes(query)`). Taper « gog » allume tous les
   descendants de n'importe quel dossier dont le chemin contient « gog » → bruit massif au
   lieu d'un petit set ciblé.
2. **Seuls les fichiers (points) réagissent.** En recherche, les points non-matchés passent
   à `0.075` (`refresh`, `scene-v2.js:664`) mais **les branches, veines, halos et étiquettes
   restent pleins** — « le reste de l'architecture » ne s'estompe donc pas vraiment. Les
   dossiers ne sont jamais matchés ni comptés.
3. **Le compteur `#count` est un texte mort** (`OpenTree.html:1487`) : aucune liste, aucun
   moyen d'atteindre les résultats.

## Objectifs

1. **Recherche par nom (titre)**, fichiers **et** dossiers : sous-chaîne insensible à la
   casse sur `node.name`. Taper « gog » → exactement les éléments dont le titre contient
   « gog ».
2. **Mise en évidence forte** : éléments matchés à pleine opacité, **tout le reste à
   `0.075`** (points, branches, veines, halos) ; seules les **étiquettes des dossiers
   matchés** s'affichent (forcées visibles quel que soit le zoom), les autres masquées.
3. **`#count` cliquable → liste déroulante** des résultats, qui s'ouvre **vers le haut** de
   façon fluide. Compteur formulé « **N / total éléments** » (`total = fichiers + dossiers`).
4. **Multi-sélection dans la liste** : **clic = bascule** (live). L'isolation reflète à tout
   instant l'**union des sous-arbres** sélectionnés ; le reste à `0.075`.
5. **La caméra recadre toute la sélection** (sphère englobante) en travelling fluide à
   chaque changement. Une sélection à un seul élément = cas particulier (centrage).

## Non-objectifs

- Recherche floue / classement par pertinence (fuzzy, Levenshtein) — hors périmètre.
- Recherche sur le contenu des fichiers — la carte n'a pas le contenu.
- Surlignage de la sous-chaîne dans le nom — possible plus tard, non requis.
- Tri des résultats — ordre d'insertion suffisant.
- Modifier l'isolation par branche existante (clics légende, « Isoler la branche ») — elle
  doit continuer à fonctionner à l'identique (= sélection à un seul nœud).

## Décision d'architecture — isolation par union de sous-arbres

Aujourd'hui `isolated` est un **nœud unique**, limité à une **branche de 1er niveau** :
`fileVisible` teste `topBranchOf(f) !== isolated` (`scene-v2.js:651`) et les étiquettes
testent `topBranchOf(d) === isolated` (`scene-v2.js:684-685`).

On généralise en deux temps :

- `isolated` (nœud) → **`isolatedNodes` (tableau de nœuds)**. Vide = aucune isolation.
- Le test « même branche » → **appartenance à l'union des sous-arbres** des `isolatedNodes`,
  matérialisée par deux `Set` recalculés à chaque changement de sélection :
  - `isoFiles : Set<fileNode>` — union des fichiers des sous-arbres sélectionnés.
  - `isoDirs : Set<dirNode>` — union des dossiers des sous-arbres sélectionnés.

**Pourquoi** : un seul mécanisme couvre les trois cas — isoler une branche racine (légende),
isoler un élément précis (1 résultat), isoler plusieurs résultats (union). Strictement
rétrocompatible : isoler `[topNode]` ≡ comportement actuel.

_Alternative écartée_ : un état `focused`/`selection` distinct en parallèle d'`isolated` →
logique dupliquée dans `fileVisible` / `refresh` / `declutterLabels`, surface de bugs doublée.

## Détail — `inspector/scene-v2.js`

### État et prédicats

- Remplacer `let isolated = null;` (`648`) par `let isolatedNodes = [];` et ajouter
  `let isoFiles = null, isoDirs = null;` ainsi qu'un `Set` de bids isolés
  `let isoBids = null;` (pour l'allumage branches/halos).
- `fileVisible(f)` (`650`) :
  - si `isolatedNodes.length` : visible ssi `isoFiles.has(f)` ;
  - sinon si `query` : visible ssi `f.name.toLowerCase().includes(query)` ;
  - sinon : `true`.
- Helper `nameMatches(node)` = `!!query && node.name.toLowerCase().includes(query)`.

### `refresh()` (`655`)

Initialiser : `nFileMatch = 0`, `nDirMatch = 0`, `matches = []`. Le tableau `matches` est
rempli au fil des boucles, plafonné à **300** entrées (les compteurs comptent tout).

- **Fichiers** (boucle existante) : alpha `1` si `fileVisible(f)`, sinon `0.075`. Si
  `query && f.name…includes(query)` : `nFileMatch++` et push `f` dans `matches` (si < 300).
- Le comptage et la collecte des **dossiers** matchés se font dans la boucle **Étiquettes**
  ci-dessous (dossiers de profondeur > 0 = « étiquettes »). Les racines d'îlot (profondeur 0,
  affichées en plaques) ne sont pas matchables — on les isole via la légende.
- **Branches / veines** (`668-676`) : `on = isolatedNodes.length ? isoBids.has(bid) : !query`.
  → en recherche sans isolation, **toutes** tombent à `0.075` ; en isolation, les branches
  des nœuds sélectionnés restent allumées (contexte). Veine via `uOpacity` ; trait via
  `* (on ? 1 : 0.075)`.
- **Halos** (`677-681`) : `on = isolatedNodes.length ? isoBids.has(sp.bid) : !query`, sinon
  `0.075` (remplace le `* 0.4` actuel sur `query`).
- **Étiquettes** (`682-693`, boucle sur `labels` = dossiers profondeur > 0) : sur `d = l.node`,
  - `l.queryMatch = nameMatches(d)` ; si `l.queryMatch` : `nDirMatch++` et push `d` dans
    `matches` (si < 300) ;
  - en recherche (`query && !isolatedNodes.length`) : `l.allowed = l.queryMatch` ;
    `l.isoShow = false` ;
  - en isolation : `l.allowed = isoDirs.has(d)` ; `l.isoShow = isoDirs.has(d)` ;
  - sinon : logique actuelle (branche / conteneur / zoom) ;
  - `l.el.classList.toggle("hidden", !l.allowed)` comme aujourd'hui.
- **Compteur / callback** (`707-711`) : `onCounts({ match, total, isolated, matches })` où
  - `total = files.length + labels.length` (fichiers + dossiers de profondeur > 0) ;
  - `match = query ? (nFileMatch + nDirMatch) : total` (donc `match < total` ⇔ recherche
    active → déclenche l'affichage « N / total éléments ») ;
  - `isolated` = libellé d'isolation : `null` si vide, sinon `isolatedNodes[0].name` si un
    seul, sinon `` `${isolatedNodes.length} éléments` `` ;
  - `matches` = tableau assemblé ci-dessus si `query`, sinon `null` (peut être tronqué à
    300, alors que `match` reste le total réel).

### `declutterLabels()` (`871`)

- Le filtre de niveau (`892`) doit **bypasser** les labels matchés, comme `isoShow` :
  `if (!l.isoShow && !l.queryMatch && (effLevel <= 0 || l.node.depth !== effLevel)) { hide }`.
- Reste inchangé (projection, anti-chevauchement, opacité par distance, virtualisation).

### Isolation et caméra

- `applyIsolation(nodes)` (nouveau, privé) : `isolatedNodes = nodes` ; si vide →
  `isoFiles = isoDirs = isoBids = null` ; sinon parcourir **une fois** l'union des
  sous-arbres pour remplir `isoFiles` / `isoDirs`, et `isoBids = new Set(nodes.map(n => n.bid))`.
  Puis `refresh()` ; puis `frameToIso()` si `nodes.length`.
- `setIsolated(node)` (`729`, conservé, signature inchangée) :
  `applyIsolation(node ? [node] : [])`. Couvre légende et « Isoler la branche ».
- `toggleIsolated(node)` (nouveau, exporté) : si `node` ∈ `isolatedNodes` → le retirer,
  sinon l'ajouter ; `applyIsolation(nouvelleListe)`. Une bascule vers liste vide laisse la
  caméra en place (rien à recadrer) et `refresh` réaffiche la mise en évidence de recherche.
- `frameToIso()` (nouveau) : calcule le **centroïde + rayon** de `isoFiles` (positions) →
  cible = centroïde, distance = `rayon / sin(fov/2) * marge` (min ~16 pour un point seul),
  le long de la direction de vue courante ; alimente le même `tween` que `flyTo` (`758`).
- `flyTo(node)` (`741`) : **conservé tel quel** (centrage d'un nœud), encore utilisé par
  `main-v2.js:isolateNode` pour cibler un sous-nœud dans une branche isolée.
- `resetView()` (`766`) : `applyIsolation([])` + tween retour `HOME` (comme aujourd'hui).
- `isIsolated()` (`1022`) : retourne désormais **`isolatedNodes`** (tableau, vide si aucune)
  — adapter les appelants dans `main-v2.js` (voir ci-dessous).

`topBranchOf` (`470`) reste utilisé par `main-v2.js:isolateNode` ; seuls les clics de
résultats passent un nœud exact (via `toggleIsolated`).

## Détail — `inspector/main-v2.js`

### `onCounts` (`89-103`)

- Mémoriser `matches` dans `let lastMatches = []`.
- Texte `#count` : ajouter le cas « **N / total éléments** » quand `match < total` (au lieu
  de « fichiers »). Ajouter/retirer la classe `has-results` sur `#count` selon `match < total`
  (curseur cliquable + chevron). Le cas isolé et le cas vue d'ensemble restent inchangés.
- Chip d'isolation (`98-102`) : inchangé — affiche `isolated` (libellé « X » ou « N éléments »).
- Si la liste est ouverte, la re-rendre depuis `lastMatches` ; si hors recherche, la fermer.

### Liste de résultats (multi-sélection)

- Clic sur `#count.has-results` : bascule l'ouverture du panneau `#results`.
- `renderResults(matches)` : vider `#results`, une ligne `.r-row` par nœud — icône
  dossier/fichier (classe CSS), nom (`.r-name`), chemin grisé (`.r-path`). Marquer
  `.selected` les lignes dont le nœud ∈ `scene.isIsolated()`. Au-delà de 300 entrées :
  300 premières + ligne « … +N autres ».
- Clic sur une ligne : `scene.toggleIsolated(node)` (ajout/retrait → union recalculée,
  `refresh` + `frameToIso`), puis basculer la classe `.selected` de la ligne. **La liste
  reste ouverte** (on construit la sélection en continu).
- Changement de requête (`search input`) : la sélection/isolation courante est effacée
  (`scene.setIsolated(null)` si une isolation issue de la recherche est active) avant de
  ré-appliquer la nouvelle mise en évidence — évite des lignes sélectionnées hors résultats.

### Légende / fermeture

- Légende (`158-160`, `180-182`) : `isIsolated()` renvoie un tableau →
  `const cur = scene.isIsolated(); if (cur.length === 1 && cur[0].bid === l.node.bid)
scene.resetView(); else scene.setIsolated(l.node);`.
- Fermeture du panneau : re-clic chevron, vidage de la recherche (`#search-clear`,
  `197-208`), ou Reset. (Le clic sur une ligne **ne ferme plus**.)

## Détail — `inspector/OpenTree.html`

- **Markup** (`.hud`, `1486`) : insérer `<div id="results" class="results"></div>` **avant**
  `<div id="count">`. HUD en `flex-direction: column; align-items: flex-end` ancré
  bas-droite → `#results` au-dessus de `#count`, ouverture vers le haut. Ajouter un chevron
  dans/à côté de `#count`.
- **CSS** :
  - `#count.has-results` : `cursor: pointer` + chevron (rotation à l'ouverture).
  - `.results` : fermé = `max-height: 0; opacity: 0; overflow: hidden`, transition douce sur
    `max-height` (~.25s) et `opacity` ; même fond / bordure / blur que `#count` (`868-877`).
    Ouvert (`.results.open`) = `max-height: 40vh; opacity: 1; overflow-y: auto`.
  - `.r-row` : flex, icône + nom + chemin grisé (`var(--ink-soft)`), `:hover` surbrillance,
    `cursor: pointer`, troncature chemin (`text-overflow: ellipsis`).
  - `.r-row.selected` : état coché visible (fond teinté + coche/point coloré).

## Invariants préservés

- Un seul `THREE.Points`, génération déterministe, IDs stables — inchangés.
- Isolation par branche (légende, « Isoler la branche »), thème, sliders, fly-to, reset —
  comportement inchangé (devient le cas « 1 nœud sélectionné »).
- Signature `createScene(container, callbacks, islands)` inchangée ; `onCounts` gagne un
  champ `matches` (additif). **Changement de contrat interne** : `isIsolated()` renvoie un
  tableau (n'affecte que `main-v2.js` ; `scene.js`/`main.js` legacy non touchés).
- Transparence d'isolation déjà à `0.075` dans le code courant — on s'aligne dessus.

## Risques et points de vigilance

- **Recadrages répétés** : chaque bascule relance un travelling (`frameToIso`). Choix
  assumé par l'utilisateur ; le tween est interruptible (réécrit à chaque appel) donc pas
  d'empilement.
- **`isIsolated()` change de type** (nœud → tableau) : casserait `main-v2.js` si un appelant
  est oublié — les deux usages légende sont listés ci-dessus ; vérifier qu'il n'y en a pas
  d'autre (`grep isIsolated inspector/main-v2.js`).
- **Compteur** : `match` additionne fichiers + dossiers, dénominateur = fichiers + dossiers
  → cohérent (« éléments »).
- **Anti-chevauchement des étiquettes matchées** : deux matchs superposés à l'écran → un
  peut être masqué par `declutterLabels`. Rare avec le name-matching ; acceptable.
- **Recadrage sur un dossier volumineux** : `frameToIso` cadre tout le sous-arbre → la
  caméra recule pour englober ; voulu (« englober toute la sélection »).

## Vérification

1. `node --check inspector/scene-v2.js` et `node --check inspector/main-v2.js`.
2. Vérif visuelle **Playwright / Chromium** (déjà installé), serveur statique local :
   - taper « gog » → seuls les fichiers/dossiers nommés « gog » sont pleins, **tout le reste
     à 0.075** (points, branches, veines, halos), étiquettes des dossiers matchés visibles
     hors de leur niveau de zoom habituel ;
   - `#count` affiche « N / total éléments », est cliquable, ouvre la liste vers le haut de
     façon fluide ; lignes listant les N matchs ;
   - clic sur une ligne → ligne `.selected`, l'élément (et son sous-arbre si dossier) reste
     visible, reste à 0.075, caméra recentrée ; chip « X » ;
   - clic sur une 2ᵉ/3ᵉ ligne → union isolée, chip « N éléments », caméra recadrée pour tout
     englober, liste toujours ouverte ;
   - re-clic d'une ligne sélectionnée → retrait de l'union, recadrage ;
   - clic légende / « Isoler la branche » → isolation de branche **identique** à avant ;
   - vidage de la recherche → retour à la vue complète, liste fermée, sélection effacée.
