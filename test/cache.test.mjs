import { test } from "node:test";
import assert from "node:assert/strict";
import { createSnapshotCache } from "../lib/cache.mjs";

test("get() builds lazily once, then serves the cached value", async () => {
  let builds = 0;
  const cache = createSnapshotCache({
    build: async () => ({ generatedAt: ++builds }),
  });
  assert.equal(cache.peek(), null);
  const a = await cache.get();
  const b = await cache.get();
  assert.equal(a.generatedAt, 1);
  assert.equal(b.generatedAt, 1);
  assert.equal(builds, 1);
});

test("refresh() forces a rebuild and updates the cache", async () => {
  let builds = 0;
  const cache = createSnapshotCache({
    build: async () => ({ generatedAt: ++builds }),
  });
  await cache.get();
  const r = await cache.refresh();
  assert.equal(r.generatedAt, 2);
  assert.equal((await cache.get()).generatedAt, 2);
});

test("concurrent get() calls share a single in-flight build", async () => {
  let builds = 0;
  const cache = createSnapshotCache({
    build: async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { generatedAt: ++builds };
    },
  });
  const [a, b] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(a.generatedAt, 1);
  assert.equal(b.generatedAt, 1);
  assert.equal(builds, 1);
});

test("a failed build does not poison the cache", async () => {
  let attempt = 0;
  const cache = createSnapshotCache({
    build: async () => {
      attempt++;
      if (attempt === 1) throw new Error("boom");
      return { generatedAt: attempt };
    },
  });
  await assert.rejects(() => cache.get(), /boom/);
  const ok = await cache.get();
  assert.equal(ok.generatedAt, 2);
});
