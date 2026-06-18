import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../lib/server.mjs";

function listen(server) {
  return new Promise((res) =>
    server.listen(0, "127.0.0.1", () => res(server.address().port)),
  );
}

test("GET /api/snapshot returns the snapshot JSON", async () => {
  const server = createServer({
    staticDir: tmpdir(),
    getSnapshot: async () => ({ generatedAt: 42, islands: [] }),
  });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/api/snapshot`);
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.generatedAt, 42);
  server.close();
});

test("GET /api/snapshot degrades to empty islands when builder throws", async () => {
  const server = createServer({
    staticDir: tmpdir(),
    getSnapshot: async () => {
      throw new Error("docker down");
    },
  });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/api/snapshot`);
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(body.islands, []);
  server.close();
});

test("serves static files and 404s unknown paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ot-static-"));
  await writeFile(join(dir, "OpenTree.html"), "<html>ok</html>");
  const server = createServer({
    staticDir: dir,
    getSnapshot: async () => ({}),
  });
  const port = await listen(server);
  const ok = await fetch(`http://127.0.0.1:${port}/OpenTree.html`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /ok/);
  const miss = await fetch(`http://127.0.0.1:${port}/nope.js`);
  assert.equal(miss.status, 404);
  server.close();
});

test("blocks path traversal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ot-trav-"));
  const server = createServer({
    staticDir: dir,
    getSnapshot: async () => ({}),
  });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/../../etc/passwd`);
  assert.equal(r.status, 404);
  server.close();
});
