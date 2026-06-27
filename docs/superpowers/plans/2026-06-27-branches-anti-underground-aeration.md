# Anti-underground des branches + aération du layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir géométriquement qu'aucun nœud ne descend sous le socle d'un îlot, et rendre le layout plus grand/aéré.

**Architecture:** Deux gardes ajoutées dans le module math pur `inspector/layout.js` (plancher de direction sur les branches → `y` monotone croissant ; plancher de hauteur sur les fleurs de fichiers). Réglages cosmétiques via les défauts de `layout()` et les valeurs `rootLen`/rayon d'anneau côté backend `lib/snapshot.mjs`. Invariante anti-underground couverte par un nouveau test unitaire.

**Tech Stack:** JavaScript ESM, `node:test` + `node:assert/strict`, THREE.js (non touché ici).

## Global Constraints

- `inspector/layout.js` reste **pur** : pas de dépendance DOM ni THREE.
- Tests lancés via `node --test <fichier>` (la suite complète : `npm test`).
- `rootLen` a une **unique source de vérité** dans `lib/snapshot.mjs` — pas de scaling dupliqué côté front.
- Socle d'un îlot = plan `y = origin[1] - 1.6` ; tous les îlots ont `origin[1] = 0`, donc socle à `y = -1.6` en local comme en monde.
- Commits en anglais, format conventionnel. Branche : `feat/branch-layout-aeration` (déjà active).

---

### Task 1: Gardes anti-underground dans `layout.js` + test d'invariante

**Files:**

- Modify: `inspector/layout.js` (consts en tête ; boucle `childDirs` ~l. 64-84 ; boucle `childFiles` ~l. 88-105)
- Test: `test/layout.test.mjs` (nouveau)

**Interfaces:**

- Consumes: `layout(root, opts?)` exporté par `inspector/layout.js` — mute `root` en place, assigne `node.pos = [x,y,z]` et `node.dir` à chaque nœud.
- Produces: invariante `node.pos[1] >= -1.6` pour tout nœud avec `pos`, garantie par deux constantes module `MIN_DIR_Y = 0.06` et `FLOOR_Y = -1.3`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `test/layout.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { layout } from "../inspector/layout.js";

// Construit un arbre de dossiers/fichiers avec id, depth et count renseignés
// (les seuls champs que layout() lit : type, children, depth, count, id).
let idc = 0;
function mkFile() {
  return { type: "file", id: ++idc, count: 1, children: [] };
}
function mkDir(depth, nDirs, nFiles, depthBudget) {
  const node = { type: "dir", id: ++idc, depth, count: 0, children: [] };
  for (let i = 0; i < nFiles; i++) node.children.push(mkFile());
  if (depthBudget > 0) {
    for (let i = 0; i < nDirs; i++) {
      node.children.push(mkDir(depth + 1, nDirs, nFiles, depthBudget - 1));
    }
  }
  node.count = node.children.reduce((s, c) => s + (c.count || 1), 0);
  return node;
}

const SOCLE_Y = -1.6;

test("layout maintient tout nœud au-dessus du socle (y >= -1.6)", () => {
  idc = 0;
  const root = mkDir(0, 6, 4, 3); // profondeurs 0..3, large éventail à la racine
  layout(root);
  const bad = [];
  (function walk(n) {
    if (n.pos && n.pos[1] < SOCLE_Y)
      bad.push({ id: n.id, y: +n.pos[1].toFixed(2) });
    n.children?.forEach(walk);
  })(root);
  assert.deepEqual(bad, [], `nœuds sous le socle: ${JSON.stringify(bad)}`);
});

test("layout garde les fleurs de fichiers de la racine au-dessus du socle", () => {
  idc = 0;
  const root = mkDir(0, 0, 60, 0); // racine = 60 fichiers, aucun sous-dossier
  layout(root);
  const below = root.children.filter((f) => f.pos[1] < SOCLE_Y);
  assert.equal(below.length, 0, `fichiers sous le socle: ${below.length}`);
});

test("layout respecte l'invariante sur une chaîne de dossiers à enfant unique", () => {
  idc = 0;
  const root = mkDir(0, 1, 2, 6); // chaîne profonde : exerce la branche theta `n <= 1`
  layout(root);
  const bad = [];
  (function walk(n) {
    if (n.pos && n.pos[1] < SOCLE_Y) bad.push(n.id);
    n.children?.forEach(walk);
  })(root);
  assert.deepEqual(bad, [], `nœuds sous le socle: ${JSON.stringify(bad)}`);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/layout.test.mjs`
Expected: FAIL — le 1er test (`y >= -1.6`) liste des nœuds profonds à `y` très négatif (branches quasi-horizontales dont les descendantes pointent vers le bas avec `rootSpread = 1.5`), donc le run échoue globalement. Les 2e/3e tests sont des gardes ciblées (fleurs racine, chaîne mono-enfant) et peuvent déjà être verts avant la garde — c'est attendu.
_Si le 1er test passe (aucun underground déclenché), augmenter `depthBudget`/`nDirs` dans `mkDir(0, …)` jusqu'à reproduire le bug avant de coder la garde._

- [ ] **Step 3: Ajouter les deux constantes module**

Dans `inspector/layout.js`, sous `const GOLDEN = Math.PI * (3 - Math.sqrt(5));` (l. 3) :

```js
const MIN_DIR_Y = 0.06; // ~3,4° au-dessus de l'horizontale : aucune branche ne plonge
const FLOOR_Y = -1.3; // plancher des fleurs de fichiers, juste au-dessus de l'anneau (-1.6)
```

- [ ] **Step 4: Garde de direction sur les branches**

Dans la boucle `childDirs.forEach((c, i) => { … })`, passer la déclaration de `dir` de `const` à `let`, puis insérer le clamp juste après le bloc `norm(...)` et **avant** `const mass`. Remplacer :

```js
const dir = norm(
  add(
    scale(node.dir, Math.cos(theta)),
    add(
      scale(U, Math.sin(theta) * Math.cos(phi)),
      scale(V, Math.sin(theta) * Math.sin(phi)),
    ),
  ),
);
const mass = Math.log2(c.count + 2);
```

par :

```js
let dir = norm(
  add(
    scale(node.dir, Math.cos(theta)),
    add(
      scale(U, Math.sin(theta) * Math.cos(phi)),
      scale(V, Math.sin(theta) * Math.sin(phi)),
    ),
  ),
);
if (dir[1] < MIN_DIR_Y) dir = norm([dir[0], MIN_DIR_Y, dir[2]]);
const mass = Math.log2(c.count + 2);
```

(Les lignes suivantes — `c.dir = dir;`, `c.pos = add(node.pos, scale(dir, len));` — restent inchangées : `dir` est réutilisé.)

- [ ] **Step 5: Plancher de hauteur sur les fichiers**

Dans la boucle `childFiles.forEach((f, i) => { … })`, juste après `f.pos = add(tip, scale(norm(local), r));`, insérer :

```js
if (f.pos[1] < FLOOR_Y) f.pos[1] = FLOOR_Y;
```

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

Run: `node --test test/layout.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add inspector/layout.js test/layout.test.mjs
git commit -m "fix(layout): guard branches and file blooms above the island socle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Réglages d'aération (`layout.js` défauts + `snapshot.mjs` valeurs)

**Files:**

- Modify: `inspector/layout.js` (objet `opts` par défaut, ~l. 37-47)
- Modify: `lib/snapshot.mjs` (`placeOrigins` l. 51 ; `parseHosts` l. 59 ; container `rootLen` l. 169)
- Modify: `test/snapshot.test.mjs` (assertion `parseHosts` l. 57)
- Test: `test/layout.test.mjs` (régression : invariante toujours verte), `test/snapshot.test.mjs`

**Interfaces:**

- Consumes: gardes de la Task 1 (l'invariante doit rester vraie après changement des constantes cosmétiques).
- Produces: arbres plus grands/aérés ; `parseHosts(...).rootLen === 13` par défaut ; conteneurs `rootLen 7.5` ; anneau d'îlots `R = 32`.

- [ ] **Step 1: Mettre à jour l'assertion `rootLen` dans le test snapshot**

Dans `test/snapshot.test.mjs`, remplacer la ligne :

```js
assert.deepEqual(h[0], { root: "/app", name: "openclaw", rootLen: 10 });
```

par :

```js
assert.deepEqual(h[0], { root: "/app", name: "openclaw", rootLen: 13 });
```

- [ ] **Step 2: Lancer le test snapshot pour le voir échouer**

Run: `node --test test/snapshot.test.mjs`
Expected: FAIL sur `parseHosts: single root` (attend `rootLen: 13`, reçoit `10`).

- [ ] **Step 3: Bumper les valeurs `rootLen` et le rayon d'anneau dans `snapshot.mjs`**

Dans `lib/snapshot.mjs` :

- l. 51, dans `placeOrigins` : `const R = 26;` → `const R = 32;`
- l. 59, signature `parseHosts` : `export function parseHosts(rootStr, nameStr, rootLen = 10) {` → `rootLen = 13`
- l. 169, bloc container : `rootLen: 5.6,` → `rootLen: 7.5,`

- [ ] **Step 4: Ajuster les défauts cosmétiques de `layout()`**

Dans `inspector/layout.js`, objet par défaut de `layout` (l. 37-47), remplacer :

```js
      rootLen: 10,
      decay: 0.66,
      rootSpread: 1.5,
      childSpread: 0.9,
      fileSpread: 0.5,
      lengthByMass: 0.5,
```

par :

```js
      rootLen: 10,
      decay: 0.72,
      rootSpread: 1.3,
      childSpread: 0.95,
      fileSpread: 0.7,
      lengthByMass: 0.5,
```

(`rootLen: 10` est le fallback du module si l'appelant n'en passe pas ; la vraie valeur vient de `snapshot.mjs` via `layout(isl.root, { rootLen: isl.rootLen })`. Inchangé.)

- [ ] **Step 5: Lancer les tests touchés**

Run: `node --test test/snapshot.test.mjs test/layout.test.mjs`
Expected: PASS — snapshot vert (rootLen 13), invariante anti-underground toujours verte malgré les nouvelles constantes.

- [ ] **Step 6: Lancer la suite complète**

Run: `npm test`
Expected: build `tsc` OK puis tous les tests verts.

- [ ] **Step 7: Commit**

```bash
git add inspector/layout.js lib/snapshot.mjs test/snapshot.test.mjs
git commit -m "feat(layout): larger, airier tree spacing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Vérification visuelle (post-implémentation, hors TDD)

Les valeurs cosmétiques (`decay`, spreads, `rootLen`, `R`) sont des points de départ. Après les deux tasks, l'utilisateur recharge son instance OpenClaw et fournit une capture. Itérer si : rendu trop dense/épars, îlots qui se chevauchent encore (lever `R`), ou blooms au bas trop nets (relever `FLOOR_Y`).
