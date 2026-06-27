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
