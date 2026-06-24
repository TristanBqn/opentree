# Refonte du système de recherche — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recherche par nom (fichiers + dossiers) qui met les correspondances en évidence et estompe tout le reste à 0.075, avec une liste déroulante de résultats à multi-sélection qui isole l'union des sous-arbres choisis et recadre la caméra.

**Architecture:** Trois couches. (1) Un module pur `inspector/search.js` (matching nom, collecte de sous-arbres, sphère englobante) — testable via `node --test`. (2) `inspector/scene-v2.js` consomme ce module : l'état `isolated` (nœud unique) devient `isolatedNodes` (collection), la visibilité passe par une appartenance au sous-arbre (`isoFiles`/`isoDirs`), et `refresh` estompe « le reste » en recherche. (3) `inspector/main-v2.js` + `OpenTree.html` câblent la liste de résultats (panneau `#results`) et la multi-sélection.

**Tech Stack:** JavaScript ESM (`"type": "module"`), THREE.js 0.160 (CDN importmap), `node:test` (intégré, aucune dépendance à installer), Playwright MCP (Chromium déjà installé) pour la vérif visuelle.

## Global Constraints

- **Aucune dépendance npm nouvelle** (préférence utilisateur : demander avant d'installer). `node:test` intégré suffit.
- **Aucun commentaire** sauf logique non-évidente ; suivre les idiomes du fichier édité.
- **Commits en anglais**, format conventionnel (`feat:`/`fix:`/`refactor:`). Branche `feat/search-overhaul` (déjà créée, ne pas committer sur `main`). Jamais de `push --force`.
- **Transparence du « reste » = `0.075`** (aligné sur le code courant).
- **Génération déterministe / IDs stables** : ne pas toucher `mulberry32`, l'ordre d'appel, ni l'assignation des `bid`.
- **Pool matchable** = fichiers + dossiers de profondeur > 0 (= étiquettes). Racines d'îlot (profondeur 0) exclues.
- **Plafond liste** = 300 entrées rendues ; le compteur affiche le total réel.
- Spec de référence : `docs/superpowers/specs/2026-06-24-refonte-recherche-design.md`.

## Prérequis pour la vérification visuelle (Tasks 2-4)

Le rendu a besoin de `/api/snapshot`, servi par l'agent (qui sert aussi `inspector/` en statique sur le port 7070). Avant les étapes Playwright :

```bash
node opentree-agent.mjs   # lance l'agent en arrière-plan ; sert http://127.0.0.1:7070/OpenTree.html
```

URL de test : `http://127.0.0.1:7070/OpenTree.html`. Attendre la disparition de l'écran `#loading` avant d'agir.

## File Structure

| Fichier                   | Rôle                                                                                                                                                                             | Action   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `inspector/search.js`     | Helpers purs : `nameMatches`, `collectSubtrees`, `centroidRadius`. Aucun DOM, aucun THREE.                                                                                       | Créer    |
| `test/search.test.mjs`    | Tests unitaires des helpers purs (`node --test`).                                                                                                                                | Créer    |
| `inspector/scene-v2.js`   | État d'isolation par collection + sous-arbres, `refresh` (matching/fade/counts/`matches`), `declutterLabels`, `setIsolated`/`toggleIsolated`/`frameToIso`, `isIsolated`→tableau. | Modifier |
| `inspector/OpenTree.html` | Markup `#results` + chevron CSS + styles de liste.                                                                                                                               | Modifier |
| `inspector/main-v2.js`    | Câblage liste (toggle, rendu, multi-sélection), texte compteur « éléments », légende `isIsolated` tableau, effacement sélection à la frappe.                                     | Modifier |

---

## Task 1: Module pur de recherche + tests unitaires

**Files:**

- Create: `inspector/search.js`
- Test: `test/search.test.mjs`

**Interfaces:**

- Produces:
  - `nameMatches(node, q) -> boolean` — `q` déjà en minuscules/trim ; `true` ssi `q` non vide et `node.name.toLowerCase()` contient `q`.
  - `collectSubtrees(nodes) -> { files: Set<node>, dirs: Set<node> }` — union dédupliquée ; un dir contribue lui-même + descendants, un fichier lui-même.
  - `centroidRadius(points) -> { cx, cy, cz, r } | null` — `points` = tableau de `[x,y,z]` ; `null` si vide ; `r=0` pour un point.

- [ ] **Step 1: Écrire les tests (qui échouent)**

Create `test/search.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nameMatches,
  collectSubtrees,
  centroidRadius,
} from "../inspector/search.js";

test("nameMatches: sous-chaîne insensible à la casse sur le nom", () => {
  assert.equal(nameMatches({ name: "GogServer.ts" }, "gog"), true);
  assert.equal(nameMatches({ name: "readme.md" }, "gog"), false);
  assert.equal(nameMatches({ name: "abc" }, ""), false);
});

test("collectSubtrees: tout le sous-arbre d'un dossier, lui inclus", () => {
  const f1 = { type: "file", name: "a" };
  const f2 = { type: "file", name: "b" };
  const sub = { type: "dir", name: "sub", children: [f2] };
  const root = { type: "dir", name: "root", children: [f1, sub] };
  const { files, dirs } = collectSubtrees([root]);
  assert.deepEqual([...dirs], [root, sub]);
  assert.deepEqual(new Set(files), new Set([f1, f2]));
});

test("collectSubtrees: un fichier seul → ce fichier, aucun dossier", () => {
  const f = { type: "file", name: "a" };
  const { files, dirs } = collectSubtrees([f]);
  assert.equal(dirs.size, 0);
  assert.deepEqual([...files], [f]);
});

test("collectSubtrees: déduplique des racines qui se chevauchent", () => {
  const leaf = { type: "file", name: "leaf" };
  const child = { type: "dir", name: "child", children: [leaf] };
  const parent = { type: "dir", name: "parent", children: [child] };
  const { files, dirs } = collectSubtrees([parent, child]);
  assert.equal(dirs.size, 2);
  assert.equal(files.size, 1);
});

test("centroidRadius: vide→null, un point→r=0, rayon englobant", () => {
  assert.equal(centroidRadius([]), null);
  assert.deepEqual(centroidRadius([[1, 2, 3]]), { cx: 1, cy: 2, cz: 3, r: 0 });
  const two = centroidRadius([
    [-1, 0, 0],
    [1, 0, 0],
  ]);
  assert.equal(two.cx, 0);
  assert.equal(two.r, 1);
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `node --test test/search.test.mjs`
Expected: FAIL — `Cannot find module '../inspector/search.js'`.

- [ ] **Step 3: Implémenter le module**

Create `inspector/search.js` :

```js
// Pure search & isolation helpers — no DOM, no THREE.
// Imported by scene-v2.js (browser) and unit-tested via node --test.

export function nameMatches(node, q) {
  return !!q && node.name.toLowerCase().includes(q);
}

export function collectSubtrees(nodes) {
  const files = new Set();
  const dirs = new Set();
  const walk = (n) => {
    if (n.type === "dir") {
      dirs.add(n);
      if (n.children) for (const c of n.children) walk(c);
    } else {
      files.add(n);
    }
  };
  for (const n of nodes) walk(n);
  return { files, dirs };
}

export function centroidRadius(points) {
  if (!points.length) return null;
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= points.length;
  cy /= points.length;
  cz /= points.length;
  let r = 0;
  for (const p of points) {
    r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
  }
  return { cx, cy, cz, r };
}
```

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `node --test test/search.test.mjs`
Expected: PASS — 5 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add inspector/search.js test/search.test.mjs
git commit -m "feat(search): pure name-match / subtree / centroid helpers + tests"
```

---

## Task 2: Isolation par sous-arbres + mise en évidence de recherche (scene-v2.js)

**Files:**

- Modify: `inspector/scene-v2.js`

**Interfaces:**

- Consumes (Task 1) : `nameMatches`, `collectSubtrees`, `centroidRadius` depuis `./search.js`.
- Produces (pour main-v2 en Task 4) :
  - `setIsolated(node|null)` — isole `[node]` (ou rien) ; recadre.
  - `toggleIsolated(node)` — ajoute/retire `node` de la sélection ; recadre sur l'union.
  - `isIsolated() -> node[]` — tableau des nœuds isolés (vide si aucun).
  - `onCounts({ match, total, isolated, matches })` — `match`/`total` en éléments ; `isolated` = `null` | nom | `` `${n} éléments` `` ; `matches` = `node[]` (≤300) si recherche, sinon `null`.

- [ ] **Step 1: Importer le module pur**

Sous l'import existant (`scene-v2.js:7`, `import { flatten } from "./data.js";`), ajouter :

```js
import { nameMatches, collectSubtrees, centroidRadius } from "./search.js";
```

- [ ] **Step 2: Remplacer l'état d'isolation**

Remplacer (`scene-v2.js:648-649`) :

```js
let isolated = null;
let query = "";
```

par :

```js
let isolatedNodes = [];
let isoFiles = null;
let isoDirs = null;
let isoBids = null;
let query = "";
```

- [ ] **Step 3: Réécrire `fileVisible`**

Remplacer (`scene-v2.js:650-654`) :

```js
function fileVisible(f) {
  if (isolated && topBranchOf(f) !== isolated) return false;
  if (query && !f.path.toLowerCase().includes(query)) return false;
  return true;
}
```

par :

```js
function fileVisible(f) {
  if (isolatedNodes.length) return isoFiles.has(f);
  if (query) return f.name.toLowerCase().includes(query);
  return true;
}
```

- [ ] **Step 4: Réécrire `refresh`**

Remplacer tout le corps de `refresh` (`scene-v2.js:655-714`) par :

```js
function refresh() {
  const iso = isolatedNodes.length > 0;
  const CAP = 300;
  const matches = query ? [] : null;
  let nFileMatch = 0;
  let nDirMatch = 0;

  const col = points.geometry.attributes.color.array;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const vis = fileVisible(f);
    col[i * 4] = baseCol[i * 4];
    col[i * 4 + 1] = baseCol[i * 4 + 1];
    col[i * 4 + 2] = baseCol[i * 4 + 2];
    col[i * 4 + 3] = vis ? 1 : 0.075;
    if (query && nameMatches(f, query)) {
      nFileMatch++;
      if (matches.length < CAP) matches.push(f);
    }
  }
  points.geometry.attributes.color.needsUpdate = true;

  branchSegGroups.forEach(({ bid, line, arc, vein }) => {
    const on = iso ? isoBids.has(bid) : !query;
    if (vein) {
      line.material.uniforms.uOpacity.value = on ? 1 : 0.075;
      return;
    }
    line.material.opacity =
      (arc ? theme.arc.opacity : theme.branch.opacity) * (on ? 1 : 0.075);
  });

  glowSprites.forEach((sp) => {
    const on = iso ? isoBids.has(sp.userData.bid) : !query;
    sp.material.opacity = theme.glow.opacity * opts.glow * (on ? 1 : 0.075);
  });

  labels.forEach((l) => {
    const d = l.node;
    l.queryMatch = nameMatches(d, query);
    if (l.queryMatch) {
      nDirMatch++;
      if (matches.length < CAP) matches.push(d);
    }
    let allowed;
    let isoShow = false;
    if (iso) {
      allowed = isoDirs.has(d);
      isoShow = allowed;
    } else if (query) {
      allowed = l.queryMatch;
    } else {
      allowed = !containerIids.has(d.iid);
    }
    l.allowed = allowed;
    l.isoShow = isoShow;
    l.el.classList.toggle("hidden", !allowed);
    l.el.classList.toggle("dim", false);
  });

  const ownIslands = iso
    ? new Set(isolatedNodes.map((n) => branches[n.bid]?.islandId))
    : null;
  islandChrome.forEach(({ isl, ring, disc, el }) => {
    const vis = opts.plates;
    ring.visible = vis;
    disc.visible = vis;
    el.style.display = vis ? "" : "none";
    if (iso) {
      const own = ownIslands.has(isl.id);
      el.style.opacity = own ? "1" : ".25";
      ring.material.opacity = theme.ring.opacity * (own ? 1 : 0.075);
    } else {
      el.style.opacity = "1";
    }
  });

  const total = files.length + labels.length;
  callbacks.onCounts?.({
    match: query ? nFileMatch + nDirMatch : total,
    total,
    isolated:
      isolatedNodes.length === 0
        ? null
        : isolatedNodes.length === 1
          ? isolatedNodes[0].name
          : `${isolatedNodes.length} éléments`,
    matches,
  });
  needsRender = true;
  labelsDirty = true;
}
```

Après cette réécriture, `topBranchOf` (`scene-v2.js:470-472`) n'est plus référencé nulle part (vérifié : seuls `fileVisible` et `refresh` l'utilisaient). Supprimer sa définition (les 3 lignes 470-472) pour éviter du code mort.

- [ ] **Step 5: Bypass declutter pour les labels matchés**

Dans `declutterLabels`, remplacer (`scene-v2.js:892`) :

```js
      if (!l.isoShow && (effLevel <= 0 || l.node.depth !== effLevel)) {
```

par :

```js
      if (
        !l.isoShow &&
        !l.queryMatch &&
        (effLevel <= 0 || l.node.depth !== effLevel)
      ) {
```

- [ ] **Step 6: Remplacer `setIsolated` + `setQuery` par le bloc d'isolation généralisé**

Remplacer (`scene-v2.js:729-737`) :

```js
function setIsolated(node) {
  isolated = node;
  refresh();
  if (node) flyTo(node);
}
function setQuery(q) {
  query = (q || "").trim().toLowerCase();
  refresh();
}
```

par :

```js
function applyIsolation(nodes) {
  isolatedNodes = nodes;
  if (nodes.length) {
    const { files: fs, dirs: ds } = collectSubtrees(nodes);
    isoFiles = fs;
    isoDirs = ds;
    isoBids = new Set(nodes.map((n) => n.bid));
  } else {
    isoFiles = isoDirs = isoBids = null;
  }
  refresh();
  if (nodes.length) frameToIso();
}
function setIsolated(node) {
  applyIsolation(node ? [node] : []);
}
function toggleIsolated(node) {
  const has = isolatedNodes.includes(node);
  applyIsolation(
    has ? isolatedNodes.filter((n) => n !== node) : [...isolatedNodes, node],
  );
}
function setQuery(q) {
  query = (q || "").trim().toLowerCase();
  refresh();
}
```

- [ ] **Step 7: Ajouter `frameToIso` après `flyTo`**

Juste après la fin de `flyTo` (`scene-v2.js:765`, accolade fermante), ajouter :

```js
function frameToIso() {
  if (!isoFiles || isoFiles.size === 0) return;
  const pts = [];
  isoFiles.forEach((f) => pts.push(f.pos));
  const cr = centroidRadius(pts);
  if (!cr) return;
  const target = new THREE.Vector3(cr.cx, cr.cy, cr.cz);
  const r = Math.max(cr.r, 6);
  const dist = (r / Math.sin((camera.fov * Math.PI) / 180 / 2)) * 1.15;
  const dirToCam = camera.position.clone().sub(controls.target).normalize();
  const camTo = target.clone().add(dirToCam.multiplyScalar(dist));
  tween = {
    t: 0,
    fromT: controls.target.clone(),
    toT: target,
    fromC: camera.position.clone(),
    toC: camTo,
  };
}
```

- [ ] **Step 8: Adapter `resetView`**

Remplacer (`scene-v2.js:766-769`, le début de `resetView`) :

```js
  function resetView() {
    isolated = null;
    refresh();
    tween = {
```

par :

```js
  function resetView() {
    applyIsolation([]);
    tween = {
```

- [ ] **Step 9: Exposer `toggleIsolated` et corriger `isIsolated`**

Dans l'objet retourné, après la ligne `setIsolated,` (`scene-v2.js:1002`), ajouter :

```js
    toggleIsolated,
```

Puis remplacer (`scene-v2.js:1022`) `isIsolated: () => isolated,` par :

```js
    isIsolated: () => isolatedNodes,
```

- [ ] **Step 10: Vérifier la syntaxe**

Run: `node --check inspector/scene-v2.js`
Expected: aucune sortie (OK).

- [ ] **Step 11: Vérification visuelle — mise en évidence de recherche**

Lancer l'agent (`node opentree-agent.mjs` en arrière-plan), puis avec Playwright MCP :

- `browser_navigate` → `http://127.0.0.1:7070/OpenTree.html` ; attendre la fin de `#loading`.
- `browser_type` dans `#search` la valeur `gog`.
- `browser_take_screenshot`.
  Vérifier (capture) : seuls quelques points/étiquettes restent pleins, **tout le reste estompé** (branches, veines, halos, points non-matchés) ; des étiquettes « gog » apparaissent hors de leur niveau de zoom habituel.
- `browser_evaluate` : `() => document.querySelector('#count').textContent` → doit contenir « / » et un petit nombre (le libellé « éléments » arrive en Task 4 ; ici le nombre doit déjà refléter fichiers + dossiers matchés).
- Vider `#search` → la carte redevient pleine et opaque.

- [ ] **Step 12: Commit**

```bash
git add inspector/scene-v2.js
git commit -m "feat(search): name-match highlight + subtree/union isolation in scene"
```

---

## Task 3: Markup + styles du panneau de résultats (OpenTree.html)

**Files:**

- Modify: `inspector/OpenTree.html`

**Interfaces:**

- Produces : un `<div id="results" class="results">` (vide, rempli par main-v2) placé au-dessus de `#count` ; classes CSS `.results.open`, `.r-row`, `.r-row.selected`, `.r-ico`, `.r-name`, `.r-path`, `.r-more` ; chevron via `#count.has-results::after`, rotation via `#count.open::after`.

- [ ] **Step 1: Ajouter le markup `#results`**

Remplacer (`OpenTree.html:1486-1487`) :

```html
<div class="hud">
  <div id="count"></div>
</div>
```

par :

```html
<div class="hud">
  <div id="results" class="results"></div>
  <div id="count"></div>
</div>
```

- [ ] **Step 2: Ajouter les styles**

Juste après le bloc `#count { … }` (`OpenTree.html:868-877`), ajouter :

```css
#count.has-results {
  cursor: pointer;
}
#count.has-results::after {
  content: "▾";
  margin-left: 7px;
  display: inline-block;
  color: var(--ink-soft);
  transition: transform 0.2s ease;
}
#count.open::after {
  transform: rotate(180deg);
}
.results {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink);
  background: var(--panel);
  border: 1px solid var(--hair);
  border-radius: 9px;
  backdrop-filter: blur(10px);
  width: 320px;
  max-width: 80vw;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition:
    max-height 0.25s ease,
    opacity 0.2s ease;
}
.results.open {
  max-height: 40vh;
  opacity: 1;
  overflow-y: auto;
}
.r-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--hair);
}
.r-row:last-child {
  border-bottom: 0;
}
.r-row:hover {
  background: rgba(120, 103, 74, 0.1);
}
.r-row.selected {
  background: color-mix(in oklab, var(--accent) 16%, transparent);
}
.r-ico {
  flex: 0 0 auto;
  width: 14px;
  text-align: center;
  opacity: 0.7;
}
.r-name {
  font-weight: 600;
  white-space: nowrap;
}
.r-path {
  color: var(--ink-soft);
  margin-left: auto;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: right;
}
.r-more {
  padding: 6px 10px;
  color: var(--ink-soft);
  font-style: italic;
}
```

- [ ] **Step 3: Vérification visuelle — présence + style**

Avec l'agent lancé et Playwright MCP :

- `browser_navigate` → `http://127.0.0.1:7070/OpenTree.html`.
- `browser_evaluate` : `() => { const r = document.querySelector('#results'); return { exists: !!r, open: r?.classList.contains('open'), h: getComputedStyle(r).maxHeight }; }`
  Expected : `{ exists: true, open: false, h: "0px" }` (panneau présent, fermé, hauteur nulle).

- [ ] **Step 4: Commit**

```bash
git add inspector/OpenTree.html
git commit -m "feat(search): results panel markup + styles"
```

---

## Task 4: Câblage liste, multi-sélection et compteur « éléments » (main-v2.js)

**Files:**

- Modify: `inspector/main-v2.js`

**Interfaces:**

- Consumes : `scene.toggleIsolated`, `scene.setIsolated`, `scene.isIsolated() -> node[]`, et le champ `matches` de `onCounts` (Task 2) ; le markup `#results` + classes CSS (Task 3).

- [ ] **Step 1: État liste + helpers (déclarés AVANT l'objet `callbacks`)**

`createScene` lance un premier `refresh()` **synchrone** qui appelle `onCounts` → l'état liste doit déjà exister (sinon `ReferenceError` TDZ sur `lastMatches`/`resultsOpen`). Même raison que la barre d'étiquettes (cf. `main-v2.js:18-19`). Insérer ce bloc **avant** `// ---- callbacks scène ----` (`main-v2.js:58`, après la fonction `nodeMetaLine`) :

```js
// ---- results list state (déclaré avant createScene : 1er rendu synchrone → onCounts) ---
let lastMatches = [];
let lastMatchTotal = 0;
let resultsOpen = false;

function renderResults() {
  const results = $("#results");
  results.innerHTML = "";
  const sel = new Set(scene.isIsolated());
  for (const node of lastMatches) {
    const row = document.createElement("div");
    row.className = "r-row" + (sel.has(node) ? " selected" : "");
    const ico = document.createElement("span");
    ico.className = "r-ico";
    ico.textContent = node.type === "dir" ? "📁" : "📄";
    const nm = document.createElement("span");
    nm.className = "r-name";
    nm.textContent = node.name;
    const pth = document.createElement("span");
    pth.className = "r-path";
    pth.textContent = node.path;
    row.append(ico, nm, pth);
    row.addEventListener("click", () => scene.toggleIsolated(node));
    results.appendChild(row);
  }
  if (lastMatchTotal > lastMatches.length) {
    const more = document.createElement("div");
    more.className = "r-more";
    more.textContent = `… +${lastMatchTotal - lastMatches.length} autres`;
    results.appendChild(more);
  }
}

function openResults() {
  resultsOpen = true;
  $("#results").classList.add("open");
  $("#count").classList.add("open");
  renderResults();
}

function closeResults() {
  resultsOpen = false;
  $("#results").classList.remove("open");
  $("#count").classList.remove("open");
}
```

- [ ] **Step 2: Réécrire `onCounts`**

Remplacer (`main-v2.js:89-103`) :

```js
  onCounts({ match, total, isolated }) {
    const st = scene ? scene.getStats() : null;
    $("#count").textContent = isolated
      ? `${isolated} · ${match} fichiers`
      : match < total
        ? `${match} / ${total} fichiers`
        : st
          ? `${st.containers} conteneurs · ${total} fichiers · ${st.dirs} dossiers`
          : `${total} fichiers`;
    const chip = $("#isolate-chip");
    if (isolated) {
      chip.classList.add("show");
      $("#isolate-name").textContent = isolated;
    } else chip.classList.remove("show");
  },
```

par :

```js
  onCounts({ match, total, isolated, matches }) {
    const st = scene ? scene.getStats() : null;
    const searching = match < total;
    $("#count").textContent = isolated
      ? isolated
      : searching
        ? `${match} / ${total} éléments`
        : st
          ? `${st.containers} conteneurs · ${st.files} fichiers · ${st.dirs} dossiers`
          : `${total} éléments`;
    $("#count").classList.toggle("has-results", searching);
    lastMatches = matches || [];
    lastMatchTotal = match;
    if (!searching) closeResults();
    else if (resultsOpen) renderResults();
    const chip = $("#isolate-chip");
    if (isolated) {
      chip.classList.add("show");
      $("#isolate-name").textContent = isolated;
    } else chip.classList.remove("show");
  },
```

- [ ] **Step 3: Toggle d'ouverture au clic sur `#count`**

Dans la section recherche, juste avant `const search = $("#search");` (`main-v2.js:198`), ajouter :

```js
$("#count").addEventListener("click", () => {
  if ($("#count").classList.contains("has-results")) {
    resultsOpen ? closeResults() : openResults();
  }
});
```

- [ ] **Step 4: Effacer la sélection à la frappe + fermer la liste au clear**

Remplacer (`main-v2.js:199-208`) :

```js
search.addEventListener("input", () => {
  scene.setQuery(search.value);
  $("#search-clear").classList.toggle("show", !!search.value);
});
$("#search-clear").addEventListener("click", () => {
  search.value = "";
  scene.setQuery("");
  $("#search-clear").classList.remove("show");
  search.focus();
});
```

par :

```js
search.addEventListener("input", () => {
  if (scene.isIsolated().length) scene.setIsolated(null);
  scene.setQuery(search.value);
  $("#search-clear").classList.toggle("show", !!search.value);
});
$("#search-clear").addEventListener("click", () => {
  search.value = "";
  scene.setQuery("");
  $("#search-clear").classList.remove("show");
  closeResults();
  search.focus();
});
```

- [ ] **Step 5: Adapter les deux appels `isIsolated()` de la légende**

`isIsolated()` renvoie désormais un tableau. Remplacer les **deux** occurrences identiques (`main-v2.js:158-160` puis `main-v2.js:180-182`) :

```js
const cur = scene.isIsolated();
if (cur && cur.bid === l.node.bid) scene.resetView();
else scene.setIsolated(l.node);
```

par :

```js
const cur = scene.isIsolated();
if (cur.length === 1 && cur[0].bid === l.node.bid) scene.resetView();
else scene.setIsolated(l.node);
```

(Les deux blocs sont à l'intérieur des `addEventListener("click", …)` des puces de légende ; conserver l'indentation locale de chaque bloc.)

- [ ] **Step 6: Vérifier la syntaxe**

Run: `node --check inspector/main-v2.js`
Expected: aucune sortie (OK).

- [ ] **Step 7: Vérification visuelle — bout en bout**

Agent lancé, Playwright MCP, `http://127.0.0.1:7070/OpenTree.html` :

1. `browser_type` `gog` dans `#search`.
   - `browser_evaluate` `() => document.querySelector('#count').textContent` → matche `^\d+ / \d+ éléments$`.
   - `() => document.querySelector('#count').classList.contains('has-results')` → `true`.
2. `browser_click` sur `#count`.
   - `() => document.querySelector('#results').classList.contains('open')` → `true` ; `browser_take_screenshot` → liste ouverte vers le haut, lignes nom + chemin.
3. `browser_click` sur la 1re `.r-row`.
   - `() => document.querySelectorAll('#results .r-row.selected').length` → `1` ; `#count` affiche le libellé d'isolation ; capture : élément isolé, reste à 0.075, caméra recentrée.
4. `browser_click` sur une 2e `.r-row`.
   - `.r-row.selected` length → `2` ; `#count` → `2 éléments` ; capture : union visible, caméra recadrée plus large ; `#results` toujours `open`.
5. Re-`browser_click` sur la 1re `.r-row` (déjà sélectionnée) → length `1` (retrait de l'union).
6. `browser_click` sur `#search-clear`.
   - `#results` plus `open`, carte pleine, `#search` vide.
7. Régression légende : `browser_click` sur une puce de conteneur dans `#legend-items` → branche isolée (reste à 0.075) ; re-clic → reset. Confirme que `isIsolated()`-tableau n'a rien cassé.

- [ ] **Step 8: Lancer la suite de tests pure (non-régression)**

Run: `node --test test/search.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add inspector/main-v2.js
git commit -m "feat(search): results list, multi-select isolation, éléments counter"
```

---

## Self-review (auteur du plan)

**Couverture spec :**

- Recherche par nom fichiers+dossiers → Task 2 (Step 3-4, `fileVisible` + `nameMatches`).
- Reste à 0.075 (points/branches/veines/halos) + labels matchés forcés → Task 2 (Step 4-5).
- Compteur « N / total éléments » → Task 4 (Step 2).
- `#count` cliquable → liste vers le haut → Task 3 (markup/CSS) + Task 4 (Step 1, 3).
- Multi-sélection live (clic = bascule) → Task 4 (Step 1 `renderResults`, Step 7).
- Union des sous-arbres + caméra englobante → Task 2 (`applyIsolation`/`toggleIsolated`/`frameToIso`).
- `isIsolated()` → tableau + appelants légende → Task 2 (Step 9) + Task 4 (Step 5).
- Effacement sélection à la frappe / fermeture liste → Task 4 (Step 4).

**Placeholders :** aucun TODO/TBD ; tout le code est complet.

**Cohérence des types :** `isIsolated()` renvoie `node[]` partout (Task 2 produit, Task 4 consomme via `new Set(...)` et `.length`/`[0]`). `onCounts` : `matches` (`node[]|null`) produit en Task 2, consommé en Task 4 (`matches || []`). `toggleIsolated`/`setIsolated` signatures stables entre Task 2 et Task 4. `centroidRadius` retourne `{cx,cy,cz,r}` (Task 1) consommé par `frameToIso` (Task 2).

**Cas limites couverts :** sélection vide → pas de recadrage (Task 2 `applyIsolation`) ; fichier feuille isolé → `r=0`→ min 6 (Task 2 `frameToIso`) ; >300 résultats → ligne « +N autres » (Task 4) ; racines d'îlot non matchables (pool = profondeur > 0).
