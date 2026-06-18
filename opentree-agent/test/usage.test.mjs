import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mtimeToUsage30,
  parseEventsNdjson,
  gitProxy,
  applyUsage,
} from "../lib/usage.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 12, 12, 0, 0);

test("mtimeToUsage30 marks today as the last bucket", () => {
  const u = mtimeToUsage30(NOW - 1000, NOW);
  assert.equal(u.length, 30);
  assert.equal(u[29], 1);
  assert.equal(
    u.reduce((s, v) => s + v, 0),
    1,
  );
});

test("mtimeToUsage30 marks 5 days ago at index 24", () => {
  const u = mtimeToUsage30(NOW - 5 * DAY, NOW);
  assert.equal(u[24], 1);
});

test("mtimeToUsage30 is all zeros beyond 30 days", () => {
  const u = mtimeToUsage30(NOW - 40 * DAY, NOW);
  assert.equal(
    u.reduce((s, v) => s + v, 0),
    0,
  );
});

test("parseEventsNdjson counts events per file per day", () => {
  const text = [
    JSON.stringify({ ts: NOW - 1000, path: "~/app/a.ts" }),
    JSON.stringify({ ts: NOW - 2000, path: "~/app/a.ts" }),
    JSON.stringify({ ts: NOW - 5 * DAY, path: "~/app/b.ts" }),
    "not json — ignored",
  ].join("\n");
  const m = parseEventsNdjson(text, NOW);
  assert.equal(m.get("~/app/a.ts")[29], 2);
  assert.equal(m.get("~/app/b.ts")[24], 1);
});

test("gitProxy returns modified only within 24h", () => {
  assert.equal(gitProxy(NOW - 1000, NOW), "modified");
  assert.equal(gitProxy(NOW - 2 * DAY, NOW), "clean");
});

test("applyUsage prefers events over mtime and sets uses + git", () => {
  const tree = {
    type: "dir",
    children: [
      { type: "file", path: "~/app/a.ts", mtime: NOW - 10 * DAY },
      { type: "file", path: "~/app/b.ts", mtime: NOW - 1000 },
    ],
  };
  const events = parseEventsNdjson(
    JSON.stringify({ ts: NOW - 1000, path: "~/app/a.ts" }),
    NOW,
  );
  applyUsage(tree, events, NOW);
  const a = tree.children[0],
    b = tree.children[1];
  assert.equal(a.uses, 1); // from event, not mtime
  assert.equal(a.usage30[29], 1);
  assert.equal(b.uses, 1); // fallback to mtime
  assert.equal(b.git, "modified");
});
