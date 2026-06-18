import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkDir } from "../lib/walk.mjs";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "ot-walk-"));
  await writeFile(join(dir, "index.ts"), "export {}");
  await mkdir(join(dir, "src"));
  await writeFile(join(dir, "src", "server.ts"), "a");
  await mkdir(join(dir, "node_modules"));
  await writeFile(join(dir, "node_modules", "junk.js"), "x");
  return dir;
}

test("walkDir builds a tree with display paths rooted at rootName", async () => {
  const dir = await fixture();
  try {
    let id = 0;
    const tree = await walkDir(dir, {
      rootName: "~/app",
      exclude: new Set(["node_modules"]),
      nextId: () => ++id,
    });
    assert.equal(tree.type, "dir");
    assert.equal(tree.name, "~/app");
    assert.equal(tree.path, "~/app");
    const names = tree.children.map((c) => c.name).sort();
    assert.deepEqual(names, ["index.ts", "src"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("walkDir excludes node_modules and records ext/size on files", async () => {
  const dir = await fixture();
  try {
    let id = 0;
    const tree = await walkDir(dir, {
      rootName: "~/app",
      exclude: new Set(["node_modules"]),
      nextId: () => ++id,
    });
    assert.ok(!tree.children.some((c) => c.name === "node_modules"));
    const file = tree.children.find((c) => c.name === "index.ts");
    assert.equal(file.type, "file");
    assert.equal(file.ext, "ts");
    assert.equal(file.path, "~/app/index.ts");
    assert.ok(file.size >= 0);
    assert.equal(typeof file.mtime, "number");
    assert.equal(typeof file.createdAt, "number");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("walkDir nests subdirectories with correct paths", async () => {
  const dir = await fixture();
  try {
    let id = 0;
    const tree = await walkDir(dir, {
      rootName: "~/app",
      exclude: new Set(["node_modules"]),
      nextId: () => ++id,
    });
    const src = tree.children.find((c) => c.name === "src");
    assert.equal(src.type, "dir");
    assert.equal(src.children[0].path, "~/app/src/server.ts");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
