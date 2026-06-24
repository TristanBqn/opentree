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
