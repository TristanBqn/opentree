import { test } from "node:test";
import assert from "node:assert/strict";
import { annotate, placeOrigins, parseHosts } from "../lib/snapshot.mjs";

const NOW = Date.UTC(2026, 5, 12, 12, 0, 0);

test("annotate aggregates size, count, uses and usage30 up the tree", () => {
  const tree = {
    type: "dir",
    name: "r",
    path: "r",
    children: [
      {
        type: "file",
        name: "a",
        path: "r/a",
        size: 100,
        mtime: NOW,
        createdAt: NOW,
        usage30: Array(30)
          .fill(0)
          .map((_, i) => (i === 29 ? 2 : 0)),
        uses: 2,
      },
      {
        type: "file",
        name: "b",
        path: "r/b",
        size: 50,
        mtime: NOW,
        createdAt: NOW,
        usage30: Array(30)
          .fill(0)
          .map((_, i) => (i === 29 ? 3 : 0)),
        uses: 3,
      },
    ],
  };
  annotate(tree, 0, NOW);
  assert.equal(tree.size, 150);
  assert.equal(tree.count, 2);
  assert.equal(tree.uses, 5);
  assert.equal(tree.usage30[29], 5);
  assert.equal(tree.depth, 0);
});

test("placeOrigins puts host at origin and spreads containers", () => {
  const o = placeOrigins(3);
  assert.deepEqual(o[0], [0, 0, 0]);
  assert.equal(o.length, 3);
  assert.notDeepEqual(o[1], o[2]);
});

test("parseHosts: single root", () => {
  const h = parseHosts("/app", "openclaw");
  assert.equal(h.length, 1);
  assert.deepEqual(h[0], { root: "/app", name: "openclaw", rootLen: 10 });
});

test("parseHosts: two comma-separated roots", () => {
  const h = parseHosts("/app,/home/node/.openclaw", "openclaw,.openclaw");
  assert.equal(h.length, 2);
  assert.equal(h[1].root, "/home/node/.openclaw");
  assert.equal(h[1].name, ".openclaw");
});

test("parseHosts: trims spaces and derives missing name from basename", () => {
  const h = parseHosts(" /app , /home/node/.openclaw ", "openclaw");
  assert.equal(h.length, 2);
  assert.equal(h[0].root, "/app");
  assert.equal(h[1].name, ".openclaw");
});
