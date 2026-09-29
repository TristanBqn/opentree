import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
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

// raw GET: fetch/undici auto-decompresses, so inspect headers + body directly
function rawGet(base, path, headers) {
  const u = new URL(base + path);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "GET",
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
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

test("gzip-encodes /api/snapshot when the client accepts gzip", async () => {
  const cache = createSnapshotCache({
    build: async () => ({ generatedAt: 9, islands: [] }),
  });
  const handler = createRequestHandler({
    staticDir: ".",
    cache,
    prefix: "/opentree",
  });
  await withServer(handler, async (base) => {
    const r = await rawGet(base, "/opentree/api/snapshot", {
      "accept-encoding": "gzip",
    });
    assert.equal(r.headers["content-encoding"], "gzip");
    assert.match(r.headers["vary"] || "", /Accept-Encoding/i);
    const json = JSON.parse(zlib.gunzipSync(r.body).toString());
    assert.equal(json.generatedAt, 9);
  });
});

test("sends plain JSON when the client does not accept gzip", async () => {
  const cache = createSnapshotCache({
    build: async () => ({ generatedAt: 11, islands: [] }),
  });
  const handler = createRequestHandler({
    staticDir: ".",
    cache,
    prefix: "/opentree",
  });
  await withServer(handler, async (base) => {
    const r = await rawGet(base, "/opentree/api/snapshot", {
      "accept-encoding": "identity",
    });
    assert.equal(r.headers["content-encoding"], undefined);
    assert.equal(JSON.parse(r.body.toString()).generatedAt, 11);
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

test("gzips compressible static files and sends cache headers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ot-"));
  const big = "<h1>ok</h1>" + "x".repeat(2048); // > 1 KiB → gzip eligible
  await writeFile(join(dir, "OpenTree.html"), big);
  const cache = createSnapshotCache({ build: async () => ({ generatedAt: 1 }) });
  const handler = createRequestHandler({ staticDir: dir, cache, prefix: "" });
  await withServer(handler, async (base) => {
    const r = await rawGet(base, "/OpenTree.html", {
      "accept-encoding": "gzip",
    });
    assert.equal(r.headers["content-encoding"], "gzip");
    assert.equal(r.headers["cache-control"], "no-cache");
    assert.ok(r.headers["etag"]);
    assert.equal(zlib.gunzipSync(r.body).toString(), big);
    // sans gzip → contenu brut
    const plain = await rawGet(base, "/OpenTree.html", {
      "accept-encoding": "identity",
    });
    assert.equal(plain.headers["content-encoding"], undefined);
    assert.equal(plain.body.toString(), big);
  });
});

test("answers 304 on matching If-None-Match", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ot-"));
  await writeFile(join(dir, "OpenTree.html"), "<h1>ok</h1>");
  const cache = createSnapshotCache({ build: async () => ({ generatedAt: 1 }) });
  const handler = createRequestHandler({ staticDir: dir, cache, prefix: "" });
  await withServer(handler, async (base) => {
    const r1 = await rawGet(base, "/OpenTree.html", {});
    const etag = r1.headers["etag"];
    assert.ok(etag);
    const r2 = await rawGet(base, "/OpenTree.html", { "if-none-match": etag });
    assert.equal(r2.status, 304);
    assert.equal(r2.body.length, 0);
  });
});

test("serves updated content after a static file changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ot-"));
  const f = join(dir, "OpenTree.html");
  await writeFile(f, "v1");
  const cache = createSnapshotCache({ build: async () => ({ generatedAt: 1 }) });
  const handler = createRequestHandler({ staticDir: dir, cache, prefix: "" });
  await withServer(handler, async (base) => {
    assert.equal((await rawGet(base, "/OpenTree.html", {})).body.toString(), "v1");
    await writeFile(f, "v2 — plus long"); // taille différente → cache invalidé
    assert.equal(
      (await rawGet(base, "/OpenTree.html", {})).body.toString(),
      "v2 — plus long",
    );
  });
});

test("marks vendor files immutable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ot-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, "vendor"));
  await writeFile(join(dir, "vendor", "lib.js"), "export const x = 1;");
  const cache = createSnapshotCache({ build: async () => ({ generatedAt: 1 }) });
  const handler = createRequestHandler({ staticDir: dir, cache, prefix: "" });
  await withServer(handler, async (base) => {
    const r = await rawGet(base, "/vendor/lib.js", {});
    assert.match(r.headers["cache-control"], /immutable/);
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
