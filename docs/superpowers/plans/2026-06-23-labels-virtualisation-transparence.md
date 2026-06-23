# Virtualisation des étiquettes + transparence d'isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fluidifier la navigation 3D à grande échelle (virtualisation des étiquettes CSS2D) et rendre les éléments hors branche isolée transparents à 15 %, sans changer le design ni les fonctionnalités.

**Architecture:** Tout dans `inspector/scene-v2.js`. (1) `declutterLabels` ne monte dans le graphe de scène que les étiquettes réellement visibles, pour que `CSS2DRenderer` ne trie/positionne plus que celles-là au lieu de plusieurs milliers. (2) L'attribut `color` du `THREE.Points` passe en RGBA (itemSize 4) : `refresh` pilote l'alpha par point (1 visible / 0.15 estompé) au lieu de délaver la couleur vers `dim`.

**Tech Stack:** THREE.js 0.160 (vendored, importmap), ES modules, pas de build frontend. Tests backend en `node:test`. Vérification frontend : `node --check` (syntaxe) + Playwright/Chromium (visuel, déjà installé).

## Global Constraints

- Fichier touché : `inspector/scene-v2.js` **uniquement**. (verbatim du spec)
- Aucune modification des positions, couleurs de base, seuils de révélation (`REVEAL`), de l'anti-chevauchement ni du comportement (recherche, isolation, thème, fly-to).
- Isolation : tout ce qui n'est pas la branche isolée → **opacité 0.15**, **vraie couleur conservée**.
- THREE 0.160 : un attribut `color` en itemSize 4 active nativement `USE_COLOR_ALPHA` sur `PointsMaterial`.
- Déterminisme préservé : ne pas changer l'ordre des appels de build ni les IDs.
- Pas de framework de test frontend dans ce repo → la « vérification » d'une tâche de code = `node --check` ; la validation visuelle est groupée en Task 3 (Playwright).

---

### Task 1: Transparence d'isolation (points RGBA + branches à 0.15)

**Files:**

- Modify: `inspector/scene-v2.js` — `buildPoints` (~397-422), `applyColors` (~571-580), `refresh` (~646-674)

**Interfaces:**

- Consumes: `baseCol` (devient `Float32Array(files.length * 4)`), `points.geometry.attributes.color` (devient itemSize 4), `fileVisible(f)` (inchangé), `theme.palette`, `theme.misc`.
- Produces: `refresh()` écrit la couleur vraie + alpha (1 ou 0.15) par point ; aucune nouvelle fonction exportée.

- [ ] **Step 1: `buildPoints` — attribut couleur en RGBA, tableaux séparés**

Dans `inspector/scene-v2.js`, remplacer dans `buildPoints` :

```js
basePos = new Float32Array(n * 3);
baseCol = new Float32Array(n * 3);
```

par :

```js
basePos = new Float32Array(n * 3);
baseCol = new Float32Array(n * 4);
```

puis remplacer :

```js
geo.setAttribute("color", new THREE.BufferAttribute(baseCol, 3));
```

par (tableau **distinct** de `baseCol` pour que `baseCol` reste la source de vérité — corrige aussi le bug de corruption cumulative) :

```js
geo.setAttribute(
  "color",
  new THREE.BufferAttribute(new Float32Array(n * 4), 4),
);
```

Le `PointsMaterial` (`vertexColors:true, transparent:true, alphaTest:0.02, depthWrite:false`) reste inchangé.

- [ ] **Step 2: `applyColors` — remplir RGBA avec alpha plein**

Remplacer la boucle de remplissage dans `applyColors` :

```js
baseCol[i * 3] = col.r;
baseCol[i * 3 + 1] = col.g;
baseCol[i * 3 + 2] = col.b;
```

par :

```js
baseCol[i * 4] = col.r;
baseCol[i * 4 + 1] = col.g;
baseCol[i * 4 + 2] = col.b;
baseCol[i * 4 + 3] = 1;
```

La ligne `points.geometry.attributes.color.array.set(baseCol);` qui suit copie maintenant réellement `baseCol` (RGBA) vers l'attribut (tableaux distincts).

- [ ] **Step 3: `refresh` — alpha par point + branches à 0.15**

Remplacer le début de `refresh` (déclaration `dim` + boucle fichiers) :

```js
const dim = new THREE.Color(theme.file.dim);
const col = points.geometry.attributes.color.array;
let nMatch = 0;
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const vis = fileVisible(f);
  if (vis) {
    col[i * 3] = baseCol[i * 3];
    col[i * 3 + 1] = baseCol[i * 3 + 1];
    col[i * 3 + 2] = baseCol[i * 3 + 2];
    if (query) nMatch++;
  } else {
    const t = isolated ? 0.06 : 0.14;
    col[i * 3] = THREE.MathUtils.lerp(dim.r, baseCol[i * 3], t);
    col[i * 3 + 1] = THREE.MathUtils.lerp(dim.g, baseCol[i * 3 + 1], t);
    col[i * 3 + 2] = THREE.MathUtils.lerp(dim.b, baseCol[i * 3 + 2], t);
  }
}
points.geometry.attributes.color.needsUpdate = true;
```

par :

```js
const col = points.geometry.attributes.color.array;
let nMatch = 0;
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const vis = fileVisible(f);
  col[i * 4] = baseCol[i * 4];
  col[i * 4 + 1] = baseCol[i * 4 + 1];
  col[i * 4 + 2] = baseCol[i * 4 + 2];
  col[i * 4 + 3] = vis ? 1 : 0.15;
  if (vis && query) nMatch++;
}
points.geometry.attributes.color.needsUpdate = true;
```

Puis, dans la boucle `branchSegGroups.forEach` de `refresh`, remplacer les deux facteurs d'estompage :

```js
line.material.uniforms.uOpacity.value = on ? 1 : 0.05;
```

par :

```js
line.material.uniforms.uOpacity.value = on ? 1 : 0.15;
```

et :

```js
line.material.opacity =
  (arc ? theme.arc.opacity : theme.branch.opacity) * (on ? 1 : 0.08);
```

par :

```js
line.material.opacity =
  (arc ? theme.arc.opacity : theme.branch.opacity) * (on ? 1 : 0.15);
```

- [ ] **Step 4: Vérifier qu'aucun usage résiduel de `dim` ne subsiste**

Run: `grep -n "theme.file.dim\|\bdim\b" inspector/scene-v2.js`
Expected: aucune occurrence (la seule, ligne ~647, a été supprimée au Step 3). Si une occurrence subsiste, c'est une erreur d'édition à corriger.

- [ ] **Step 5: Vérifier la syntaxe**

Run: `node --check inspector/scene-v2.js`
Expected: aucune sortie (exit 0).

- [ ] **Step 6: Commit**

```bash
git add inspector/scene-v2.js
git commit -m "feat: per-point alpha for isolation transparency (RGBA), others at 15%"
```

---

### Task 2: Virtualisation des étiquettes CSS2D

**Files:**

- Modify: `inspector/scene-v2.js` — `buildLabels` (~530-567), `declutterLabels` (~857-942)

**Interfaces:**

- Consumes: `labels` (entrées `{ obj, node, el }` → deviennent `{ obj, node, el, mounted }`), `sceneRoot.add/remove`, `l.el.style.visibility` posé par la logique de declutter existante.
- Produces: invariant « un label est dans `sceneRoot` ⟺ il est visible à l'écran ». Aucune nouvelle fonction exportée.

- [ ] **Step 1: `buildLabels` — ne pas monter les étiquettes au build**

Dans `buildLabels`, remplacer la fin de boucle :

```js
const obj = new CSS2DObject(el);
obj.position.set(...d.pos);
sceneRoot.add(obj);
labels.push({ obj, node: d, el });
```

par :

```js
const obj = new CSS2DObject(el);
obj.position.set(...d.pos);
el.style.display = "none";
labels.push({ obj, node: d, el, mounted: false });
```

(La ligne `labels.forEach((l) => sceneRoot.remove(l.obj));` en tête de `buildLabels` reste : `remove` est sans effet sur un objet non monté.)

- [ ] **Step 2: `declutterLabels` — passe de synchronisation montage/démontage**

Insérer, **juste avant l'accolade fermante de `declutterLabels`** (après la boucle `for (const c of cand) { … }`) :

```js
// virtualisation : seul l'ensemble réellement visible reste dans le graphe.
// CSS2DRenderer trie (zOrder) et écrit le zIndex de TOUS les CSS2DObject montés,
// sans filtrer sur .visible — démonter les invisibles élimine ce coût O(n).
for (const l of labels) {
  const want = l.el.style.visibility === "visible";
  if (want && !l.mounted) {
    sceneRoot.add(l.obj);
    l.mounted = true;
  } else if (!want && l.mounted) {
    sceneRoot.remove(l.obj);
    l.mounted = false;
    l.el.style.display = "none";
  }
}
```

Rien d'autre dans `declutterLabels` ne change : toutes les branches existantes posent déjà `l.el.style.visibility = "hidden"` (exclusion/collision) ou `"visible"` (retenu), ce qui pilote cette passe. Pour un label monté redevenu visible, `CSS2DRenderer.render()` (appelé juste après dans `renderLabels`) remettra `display = ""` et son `transform` dans le même cycle (pas de frame de retard).

- [ ] **Step 3: Vérifier la syntaxe**

Run: `node --check inspector/scene-v2.js`
Expected: aucune sortie (exit 0).

- [ ] **Step 4: Commit**

```bash
git add inspector/scene-v2.js
git commit -m "perf: virtualize CSS2D labels — mount only on-screen ones in the scene graph"
```

---

### Task 3: Vérification visuelle (Playwright) + intégration

**Files:**

- Create: `<scratchpad>/verify-iso.mjs` (script de vérification jetable, hors repo)
- Modify: aucun fichier du repo (sauf si une régression est trouvée → retour Task 1/2)

**Interfaces:**

- Consumes: serveur statique local sur `inspector/OpenTree.html` (données de démo via `inspector/data.js`), Chromium bundlé.

- [ ] **Step 1: Lancer un serveur statique local (en arrière-plan)**

Run: `npx serve . -l 3000` (lancer en arrière-plan)
Cible : `http://localhost:3000/inspector/OpenTree.html`

- [ ] **Step 2: Écrire le script de vérification**

Créer `<scratchpad>/verify-iso.mjs` :

```js
import { chromium } from "playwright";
const url = process.argv[2];
const dir = process.argv[3]; // scratchpad pour les PNG
const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const labelStats = () =>
  page.evaluate(() => {
    const all = document.querySelectorAll(".node-label");
    let shown = 0;
    all.forEach((e) => {
      if (getComputedStyle(e).display !== "none") shown++;
    });
    return { total: all.length, shown };
  });

const before = await labelStats();
await page.screenshot({ path: `${dir}/iso0-initial.png` });

// isolation : clic sur le premier chip de légende
await page.locator(".legend-chip").first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${dir}/iso1-isolated.png` });

// reset : doit restaurer les vraies couleurs (régression du bug baseCol)
await page.locator("#isolate-clear").click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${dir}/iso2-reset.png` });

// orbite : détecter un éventuel "pop" d'étiquettes
const box = await page.locator("canvas").boundingBox();
const cx = box.x + box.width / 2,
  cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 160, cy + 80, { steps: 14 });
await page.mouse.up();
await page.waitForTimeout(900);
await page.screenshot({ path: `${dir}/iso3-orbit.png` });
const after = await labelStats();

console.log(JSON.stringify({ before, after, errors }, null, 2));
await browser.close();
```

- [ ] **Step 3: Exécuter et constater**

Run: `node <scratchpad>/verify-iso.mjs http://localhost:3000/inspector/OpenTree.html <scratchpad>`
Expected:

- `errors` vide ;
- `shown` (étiquettes montées/affichées) nettement `< total` → virtualisation active ;
- lire les 4 PNG : `iso1-isolated` montre la branche isolée nette et le reste (points + branches) à ~15 % ; `iso2-reset` montre **les couleurs d'origine restaurées** (pas de fichiers restés sombres) ; `iso3-orbit` ne montre pas d'étiquette aberrante (pop) par rapport à `iso0`.

- [ ] **Step 4: Intégrer (merge ff dans `main`)**

```bash
git checkout main
git merge --ff-only feat/labels-virtualisation-transparence
git push origin main
```

- [ ] **Step 5: Déployer sur le VPS (procédure du HANDOFF, avec `lib/`)**

```bash
cd ~/opentree && git pull
rm -rf ~/.openclaw/extensions/opentree/inspector ~/.openclaw/extensions/opentree/dist ~/.openclaw/extensions/opentree/lib
cp -r ~/opentree/inspector ~/opentree/dist ~/opentree/lib ~/.openclaw/extensions/opentree/
docker restart openclaw-openclaw-gateway-1
```

Constater la fluidité réelle sur les ~44k fichiers via le tunnel SSH ; c'est le seul environnement où le gain de virtualisation est pleinement mesurable (le jeu de démo local est plus petit).

---

## Notes

- Les `island-plate` (CSS2DObject des îles, montées dans `buildIslandChrome`) ne sont pas concernées par la virtualisation : peu nombreuses, elles restent montées.
- Le calcul JS de `declutterLabels` reste O(total labels) (projection vectorielle pure, throttlée à 15 fps) ; c'est le prochain plafond théorique mais pas le goulot actuel. Un index spatial (octree) n'est à envisager que si ce calcul devient limitant.
