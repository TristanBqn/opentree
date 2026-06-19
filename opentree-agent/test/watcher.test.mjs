import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEventLine } from "../lib/watcher.mjs";
import { parseEventsNdjson } from "../lib/usage.mjs";

const NOW = Date.UTC(2026, 5, 12, 12, 0, 0);

test("formatEventLine emits a line parseEventsNdjson can read", () => {
  const line = formatEventLine(NOW, "~/openclaw/src/server.ts");
  assert.ok(line.endsWith("\n"));
  const map = parseEventsNdjson(line, NOW);
  assert.equal(map.get("~/openclaw/src/server.ts")[29], 1);
});
