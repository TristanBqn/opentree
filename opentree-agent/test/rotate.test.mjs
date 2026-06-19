import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRecentEvents } from "../lib/rotate.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 19, 12, 0, 0);

test("keeps events within retention window, drops older ones", () => {
  const recent = JSON.stringify({ ts: NOW - 5 * DAY, path: "a" });
  const old = JSON.stringify({ ts: NOW - 40 * DAY, path: "b" });
  const out = filterRecentEvents(`${old}\n${recent}\n`, NOW, 30);
  assert.equal(out, recent + "\n");
});

test("drops malformed lines and returns empty string when nothing remains", () => {
  const old = JSON.stringify({ ts: NOW - 40 * DAY, path: "b" });
  assert.equal(filterRecentEvents(`not json\n${old}\n`, NOW, 30), "");
});

test("keeps the boundary event exactly at the cutoff", () => {
  const boundary = JSON.stringify({ ts: NOW - 30 * DAY, path: "c" });
  assert.equal(filterRecentEvents(boundary + "\n", NOW, 30), boundary + "\n");
});
