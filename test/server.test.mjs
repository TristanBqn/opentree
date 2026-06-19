import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { createServer } from "../lib/server.mjs";
import { createSnapshotCache } from "../lib/cache.mjs";

function listen(server) {
  return new Promise((res) =>
    server.listen(0, "127.0.0.1", () => res(server.address().port)),
  );
}

function rawGet(port, target) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(
        `GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
      );
    });
    let buf = "";
    sock.on("data", (d) => (buf += d));
    sock.on("end", () => resolve(buf));
  });
}

test("GET /api/snapshot returns the snapshot JSON", async () => {
  const cache = createSnapshotCache({
    build: async () => ({ generatedAt: 42, islands: [] }),
  });
  const server = createServer({ staticDir: tmpdir(), cache });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/api/snapshot`);
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.generatedAt, 42);
  server.close();
});

test("GET /api/snapshot degrades to empty islands when builder throws", async () => {
  const cache = createSnapshotCache({
    build: async () => {
      throw new Error("docker down");
    },
  });
  const server = createServer({ staticDir: tmpdir(), cache });
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
  const cache = createSnapshotCache({ build: async () => ({}) });
  const server = createServer({ staticDir: dir, cache });
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
  const cache = createSnapshotCache({ build: async () => ({}) });
  const server = createServer({ staticDir: dir, cache });
  const port = await listen(server);
  const r = await fetch(`http://127.0.0.1:${port}/../../etc/passwd`);
  assert.equal(r.status, 404);
  server.close();
});

test("blocks raw path traversal that fetch would normalise away", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ot-rawtrav-"));
  const cache = createSnapshotCache({ build: async () => ({}) });
  const server = createServer({ staticDir: dir, cache });
  const port = await listen(server);
  const resp = await rawGet(port, "/../../../../../../etc/passwd");
  assert.match(resp.split("\r\n")[0], /404/);
  assert.ok(!resp.includes("root:"));
  server.close();
});

test("malformed percent-encoding does not crash the server", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ot-malformed-"));
  const cache = createSnapshotCache({ build: async () => ({}) });
  const server = createServer({ staticDir: dir, cache });
  const port = await listen(server);
  const resp1 = await rawGet(port, "/%E0%A4%A");
  assert.match(resp1.split("\r\n")[0], /HTTP\/1\.1 \d\d\d/);
  const resp2 = await rawGet(port, "/%");
  assert.match(resp2.split("\r\n")[0], /HTTP\/1\.1 \d\d\d/);
  const ok = await fetch(`http://127.0.0.1:${port}/api/snapshot`);
  assert.equal(ok.status, 200);
  server.close();
});
