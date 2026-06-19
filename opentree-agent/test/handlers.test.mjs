import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestHandler } from "../lib/handlers.mjs";
import { createSnapshotCache } from "../lib/cache.mjs";

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test("serves /api/snapshot from the cache under a prefix", async () => {
  let n = 0;
  const cache = createSnapshotCache({
    build: async () => ({ generatedAt: ++n, islands: [] }),
  });
  const handler = createRequestHandler({
    staticDir: ".",
    cache,
    prefix: "/opentree",
  });
  await withServer(handler, async (base) => {
    const r1 = await fetch(`${base}/opentree/api/snapshot`);
    const r2 = await fetch(`${base}/opentree/api/snapshot`);
    assert.equal((await r1.json()).generatedAt, 1);
    assert.equal((await r2.json()).generatedAt, 1);
  });
});

test("/api/refresh forces a rebuild", async () => {
  let n = 0;
  const cache = createSnapshotCache({
    build: async () => ({ generatedAt: ++n, islands: [] }),
  });
  const handler = createRequestHandler({
    staticDir: ".",
    cache,
    prefix: "/opentree",
  });
  await withServer(handler, async (base) => {
    await fetch(`${base}/opentree/api/snapshot`);
    const r = await fetch(`${base}/opentree/api/refresh`, { method: "POST" });
    assert.equal((await r.json()).generatedAt, 2);
  });
});

test("serves a static file and 404s a traversal attempt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ot-"));
  await writeFile(join(dir, "OpenTree.html"), "<h1>ok</h1>");
  const cache = createSnapshotCache({
    build: async () => ({ generatedAt: 1 }),
  });
  const handler = createRequestHandler({ staticDir: dir, cache, prefix: "" });
  await withServer(handler, async (base) => {
    const root = await fetch(`${base}/`);
    assert.equal(await root.text(), "<h1>ok</h1>");
    const bad = await fetch(`${base}/../../etc/passwd`);
    assert.equal(bad.status, 404);
  });
});

test("redirects the bare prefix to the trailing-slash root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ot-"));
  await writeFile(join(dir, "OpenTree.html"), "<h1>ok</h1>");
  const cache = createSnapshotCache({
    build: async () => ({ generatedAt: 1 }),
  });
  const handler = createRequestHandler({
    staticDir: dir,
    cache,
    prefix: "/opentree",
  });
  await withServer(handler, async (base) => {
    const r = await fetch(`${base}/opentree`, { redirect: "manual" });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get("location"), "/opentree/");
  });
});
