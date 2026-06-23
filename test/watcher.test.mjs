import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  formatEventLine,
  isIgnoredPath,
  startWatcher,
} from "../lib/watcher.mjs";
import { parseEventsNdjson } from "../lib/usage.mjs";

const NOW = Date.UTC(2026, 5, 12, 12, 0, 0);

test("formatEventLine emits a line parseEventsNdjson can read", () => {
  const line = formatEventLine(NOW, "~/openclaw/src/server.ts");
  assert.ok(line.endsWith("\n"));
  const map = parseEventsNdjson(line, NOW);
  assert.equal(map.get("~/openclaw/src/server.ts")[29], 1);
});

test("isIgnoredPath ignores its own events file even when under a watched root", () => {
  const root = "/home/node/.openclaw";
  const events = "/home/node/.openclaw/state/opentree/events.ndjson";
  // real files are tracked
  assert.equal(isIgnoredPath("src/server.ts", root, events), false);
  // noise is ignored
  assert.equal(isIgnoredPath("node_modules/x/index.js", root, events), true);
  assert.equal(isIgnoredPath(".git/HEAD", root, events), true);
  // the events file and its rotation tmp must NOT feed back into themselves
  assert.equal(
    isIgnoredPath("state/opentree/events.ndjson", root, events),
    true,
  );
  assert.equal(
    isIgnoredPath("state/opentree/events.ndjson.tmp", root, events),
    true,
  );
});

async function waitFor(predicate, timeoutMs = 4000, stepMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return predicate();
}

test("watches every root and records events under each rootName", async () => {
  const base = mkdtempSync(join(tmpdir(), "opentree-watch-"));
  const dirA = mkdtempSync(join(tmpdir(), "ot-a-"));
  const dirB = mkdtempSync(join(tmpdir(), "ot-b-"));
  const eventsPath = join(base, "events.ndjson");

  const w = startWatcher({
    roots: [
      { absRoot: dirA, rootName: "hostA" },
      { absRoot: dirB, rootName: "hostB" },
    ],
    eventsPath,
  });
  try {
    await sleep(200); // let fs.watch initialise (setup, not the assertion)
    writeFileSync(join(dirA, "touched-a.txt"), "x");
    writeFileSync(join(dirB, "touched-b.txt"), "y");

    const readText = () => {
      try {
        return readFileSync(eventsPath, "utf8");
      } catch {
        return "";
      }
    };
    const ok = await waitFor(() => {
      const t = readText();
      return t.includes("hostA/") && t.includes("hostB/");
    });
    const text = readText();
    assert.ok(ok, `expected events from both roots, got:\n${text}`);
  } finally {
    w.close();
    rmSync(base, { recursive: true, force: true });
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});
