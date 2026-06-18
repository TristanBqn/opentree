# OpenTree Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-free Node.js agent that serves the OpenTree frontend and exposes the real OpenClaw architecture (host filesystem + Docker containers + 30-day usage) at `GET /api/snapshot`, then wire the frontend to consume it.

**Architecture:** A standalone agent (`opentree-agent/`) runs on the VPS, bound to `127.0.0.1:7070`, reachable via SSH tunnel. It walks `~/openclaw`, reads Docker over the Unix socket (read-only), computes per-file 30-day usage (mtime bucketing now, `fs.watch` event log over time), and assembles a JSON snapshot with the exact same island/node shape the frontend already consumes. The frontend's `data.js` swaps simulated generation for a `fetch`.

**Tech Stack:** Node.js ≥ 20, built-in modules only (`node:http`, `node:fs/promises`, `node:child_process`, `node:os`, `node:path`, `node:net`). Tests via the built-in `node:test` runner + `node:assert/strict`. No npm dependencies, no build step.

## Global Constraints

- **Zero runtime dependencies** — only `node:*` built-ins. No `package.json` deps.
- **Node.js ≥ 20** — required for the native test runner and recursive `fs.watch` on Linux. Verify on the VPS with `node --version` before deploying.
- **Bind `127.0.0.1` only** — never `0.0.0.0`. Access is via SSH tunnel.
- **Docker access is read-only** — `GET` on the socket and `docker exec … find` only. Never start/stop/create/remove.
- **Exclude `node_modules`** from every filesystem walk (host and container).
- **Output shape is the contract** — `/api/snapshot` returns `{ generatedAt: number, islands: Island[] }`. Each `Island` is `{ id, kind, name, status, statusTxt, stats, ports, rootLen, origin: [x,y,z], root: DirNode }`, identical to the current `buildArchitecture()` output. `status ∈ {'ok','healthy','unhealthy','unknown'}`.
- **Node shapes:**
  - `FileNode`: `{ id, name, path, type:'file', ext, size, mtime, createdAt, usage30:number[30], uses, git, depth, count }`
  - `DirNode`: `{ id, name, path, type:'dir', children, depth, count, size, uses, usage30:number[30], createdAt, mtime }`
- **Never throw a 500 from `/api/snapshot`** — every collection step degrades gracefully (see Task 4 / Task 5).

---

## File Structure

```
opentree-agent/
├── opentree-agent.mjs        # entry: env config, wire server + watcher, listen
├── lib/
│   ├── walk.mjs              # walkDir() → host DirNode tree
│   ├── usage.mjs             # mtime→usage30, events ndjson→usage, git proxy
│   ├── docker.mjs            # unix-socket GET client + stats/inspect/find parsers
│   ├── snapshot.mjs          # annotate(), placeOrigins(), hostStats(), buildSnapshot()
│   ├── watcher.mjs           # formatEventLine(), startWatcher()
│   └── server.mjs            # createServer() → static files + /api/snapshot
├── test/
│   ├── walk.test.mjs
│   ├── usage.test.mjs
│   ├── docker.test.mjs
│   ├── snapshot.test.mjs
│   └── server.test.mjs
└── deploy/
    └── opentree-agent.service
```

Frontend touches (Task 8): `inspector/data.js`, `inspector/scene-v2.js`, `inspector/main-v2.js`, `inspector/OpenTree.html`.

---

### Task 1: Project scaffold + filesystem walk

**Files:**

- Create: `opentree-agent/lib/walk.mjs`
- Create: `opentree-agent/test/walk.test.mjs`
- Create: `opentree-agent/package.json` (type module, test script — no deps)

**Interfaces:**

- Produces: `walkDir(absPath, { rootName, exclude, nextId }) → Promise<DirNode>` where `nextId` is a `() => number` counter and `exclude` is a `Set<string>` of directory basenames to skip. The returned tree's display `path` starts at `rootName` (e.g. `~/openclaw`), not the absolute path. File nodes carry `{ id, name, path, type:'file', ext, size, mtime, createdAt }`; dir nodes `{ id, name, path, type:'dir', children }`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "opentree-agent",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: Write the failing test**

`opentree-agent/test/walk.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
});

test("walkDir excludes node_modules and records ext/size on files", async () => {
  const dir = await fixture();
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
});

test("walkDir nests subdirectories with correct paths", async () => {
  const dir = await fixture();
  let id = 0;
  const tree = await walkDir(dir, {
    rootName: "~/app",
    exclude: new Set(["node_modules"]),
    nextId: () => ++id,
  });
  const src = tree.children.find((c) => c.name === "src");
  assert.equal(src.type, "dir");
  assert.equal(src.children[0].path, "~/app/src/server.ts");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd opentree-agent && node --test test/walk.test.mjs`
Expected: FAIL — `Cannot find module '../lib/walk.mjs'`

- [ ] **Step 4: Implement `lib/walk.mjs`**

```js
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export async function walkDir(absPath, opts, displayPath = opts.rootName) {
  const node = {
    id: opts.nextId(),
    name: displayPath.split("/").pop(),
    path: displayPath,
    type: "dir",
    children: [],
  };
  let entries = [];
  try {
    entries = await readdir(absPath, { withFileTypes: true });
  } catch {
    return node; // unreadable dir → empty, never throw
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    if (ent.isDirectory() && opts.exclude.has(ent.name)) continue;
    if (ent.name.startsWith(".git")) continue;
    const childAbs = join(absPath, ent.name);
    const childDisplay = displayPath + "/" + ent.name;
    if (ent.isDirectory()) {
      node.children.push(await walkDir(childAbs, opts, childDisplay));
    } else if (ent.isFile()) {
      let s;
      try {
        s = await stat(childAbs);
      } catch {
        continue;
      }
      node.children.push({
        id: opts.nextId(),
        name: ent.name,
        path: childDisplay,
        type: "file",
        ext: extOf(ent.name),
        size: s.size,
        mtime: Math.round(s.mtimeMs),
        createdAt: Math.round(s.birthtimeMs || s.ctimeMs),
      });
    }
  }
  return node;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd opentree-agent && node --test test/walk.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add opentree-agent/package.json opentree-agent/lib/walk.mjs opentree-agent/test/walk.test.mjs
git commit -m "feat(agent): filesystem walk producing host DirNode tree"
```

---

### Task 2: 30-day usage (mtime bucketing + event log + git proxy)

**Files:**

- Create: `opentree-agent/lib/usage.mjs`
- Create: `opentree-agent/test/usage.test.mjs`

**Interfaces:**

- Consumes: `FileNode` from Task 1 (`mtime` in ms).
- Produces:
  - `mtimeToUsage30(mtimeMs, nowMs) → number[30]` — pure; 1 in the bucket matching the file's age, else 0; all-zero if older than 30 days.
  - `parseEventsNdjson(text, nowMs) → Map<string, number[30]>` — pure; keyed by file `path`, counts events per day bucket.
  - `gitProxy(mtimeMs, nowMs) → 'modified' | 'clean'` — pure; `'modified'` if mtime within last 24 h (recency proxy — there is no git on the VPS), else `'clean'`.
  - `applyUsage(node, eventsMap, nowMs) → void` — mutates: every file node gets `usage30`, `uses` (sum), and `git`. Recurses dirs (dirs aggregated later in Task 4).

- [ ] **Step 1: Write the failing test**

`opentree-agent/test/usage.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd opentree-agent && node --test test/usage.test.mjs`
Expected: FAIL — `Cannot find module '../lib/usage.mjs'`

- [ ] **Step 3: Implement `lib/usage.mjs`**

```js
const DAY = 86400000;

function dayIndex(tsMs, nowMs) {
  const idx = 29 - Math.floor((nowMs - tsMs) / DAY);
  return idx >= 0 && idx <= 29 ? idx : -1;
}

export function mtimeToUsage30(mtimeMs, nowMs) {
  const a = new Array(30).fill(0);
  const i = dayIndex(mtimeMs, nowMs);
  if (i >= 0) a[i] = 1;
  return a;
}

export function parseEventsNdjson(text, nowMs) {
  const map = new Map();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!evt || typeof evt.path !== "string" || typeof evt.ts !== "number")
      continue;
    const i = dayIndex(evt.ts, nowMs);
    if (i < 0) continue;
    let arr = map.get(evt.path);
    if (!arr) {
      arr = new Array(30).fill(0);
      map.set(evt.path, arr);
    }
    arr[i] += 1;
  }
  return map;
}

export function gitProxy(mtimeMs, nowMs) {
  return nowMs - mtimeMs < DAY ? "modified" : "clean";
}

export function applyUsage(node, eventsMap, nowMs) {
  if (node.type === "file") {
    const fromEvents = eventsMap.get(node.path);
    node.usage30 = fromEvents || mtimeToUsage30(node.mtime, nowMs);
    node.uses = node.usage30.reduce((s, v) => s + v, 0);
    node.git = gitProxy(node.mtime, nowMs);
    return;
  }
  for (const c of node.children) applyUsage(c, eventsMap, nowMs);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd opentree-agent && node --test test/usage.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add opentree-agent/lib/usage.mjs opentree-agent/test/usage.test.mjs
git commit -m "feat(agent): 30-day usage from mtime buckets and event log"
```

---

### Task 3: Docker client + parsers

**Files:**

- Create: `opentree-agent/lib/docker.mjs`
- Create: `opentree-agent/test/docker.test.mjs`

**Interfaces:**

- Produces:
  - `parseStats(raw) → { cpuPct:number, memMiB:number }` — pure; Docker `stats?stream=false` JSON.
  - `parseInspect(raw, nowMs) → { status, statusTxt, ports }` — pure; Docker `containers/{id}/json`. `status ∈ {'healthy','unhealthy','ok','unknown'}`.
  - `parseFindOutput(text, rootName, nextId) → DirNode` — pure; parses `find -printf '%y\t%s\t%T@\t%p\n'` output into a tree rooted at `rootName`.
  - `dockerGet(socketPath, urlPath) → Promise<any|null>` — unix-socket HTTP GET, returns parsed JSON or `null` on any error.
  - `listContainers(socketPath) → Promise<Array>` — `[]` on error.
  - `execFind(containerId, dir) → Promise<string>` — runs `docker exec … find`; `''` on error.

- [ ] **Step 1: Write the failing test**

`opentree-agent/test/docker.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStats, parseInspect, parseFindOutput } from "../lib/docker.mjs";

const NOW = Date.UTC(2026, 5, 12, 12, 0, 0);

test("parseStats computes cpu percent and memory MiB", () => {
  const raw = {
    cpu_stats: {
      cpu_usage: { total_usage: 2000 },
      system_cpu_usage: 10000,
      online_cpus: 4,
    },
    precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 6000 },
    memory_stats: { usage: 355 * 1048576 },
  };
  const s = parseStats(raw);
  // cpuDelta=1000, systemDelta=4000 → 1000/4000*4*100 = 100
  assert.equal(Math.round(s.cpuPct), 100);
  assert.equal(Math.round(s.memMiB), 355);
});

test("parseStats returns zeros on missing fields", () => {
  const s = parseStats({});
  assert.equal(s.cpuPct, 0);
  assert.equal(s.memMiB, 0);
});

test("parseInspect maps health status", () => {
  const raw = {
    State: {
      Status: "running",
      StartedAt: new Date(NOW - 18 * 60000).toISOString(),
      Health: { Status: "healthy" },
    },
    NetworkSettings: { Ports: {} },
  };
  const r = parseInspect(raw, NOW);
  assert.equal(r.status, "healthy");
  assert.match(r.statusTxt, /healthy/);
  assert.match(r.statusTxt, /up 18 min/);
});

test("parseInspect treats running-without-health as ok", () => {
  const raw = {
    State: {
      Status: "running",
      StartedAt: new Date(NOW - 3600000).toISOString(),
    },
    NetworkSettings: { Ports: {} },
  };
  assert.equal(parseInspect(raw, NOW).status, "ok");
});

test("parseFindOutput builds a nested tree", () => {
  const text = [
    "d\t4096\t1718000000\t/app",
    "f\t512\t1718000001\t/app/index.js",
    "d\t4096\t1718000002\t/app/dist",
    "f\t99\t1718000003\t/app/dist/server.js",
  ].join("\n");
  let id = 0;
  const tree = parseFindOutput(text, "c1:/app", () => ++id);
  assert.equal(tree.name, "c1:/app");
  assert.equal(tree.type, "dir");
  const dist = tree.children.find((c) => c.name === "dist");
  assert.equal(dist.type, "dir");
  assert.equal(dist.children[0].name, "server.js");
  assert.equal(dist.children[0].ext, "js");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd opentree-agent && node --test test/docker.test.mjs`
Expected: FAIL — `Cannot find module '../lib/docker.mjs'`

- [ ] **Step 3: Implement `lib/docker.mjs`**

```js
import http from "node:http";
import { execFile } from "node:child_process";

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function parseStats(raw) {
  try {
    const cpuDelta =
      raw.cpu_stats.cpu_usage.total_usage -
      raw.precpu_stats.cpu_usage.total_usage;
    const sysDelta =
      raw.cpu_stats.system_cpu_usage - raw.precpu_stats.system_cpu_usage;
    const cpus =
      raw.cpu_stats.online_cpus ||
      (raw.cpu_stats.cpu_usage.percpu_usage || []).length ||
      1;
    const cpuPct =
      sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;
    const memMiB = (raw.memory_stats.usage || 0) / 1048576;
    return { cpuPct, memMiB };
  } catch {
    return { cpuPct: 0, memMiB: 0 };
  }
}

function uptimeStr(startedAt, nowMs) {
  const ms = nowMs - new Date(startedAt).getTime();
  if (!isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60000);
  if (min < 60) return `up ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `up ${h} h`;
  return `up ${Math.round(h / 24)} j`;
}

export function parseInspect(raw, nowMs) {
  const st = raw.State || {};
  const health = st.Health && st.Health.Status;
  let status = "unknown";
  if (health === "healthy") status = "healthy";
  else if (health === "unhealthy") status = "unhealthy";
  else if (st.Status === "running") status = "ok";
  const up = st.StartedAt ? uptimeStr(st.StartedAt, nowMs) : "";
  const word = status === "ok" ? "running" : status;
  const statusTxt = [word, up].filter(Boolean).join(" · ");
  const ports =
    Object.keys((raw.NetworkSettings && raw.NetworkSettings.Ports) || {}).join(
      " · ",
    ) || "openclaw:local";
  return { status, statusTxt, ports };
}

export function parseFindOutput(text, rootName, nextId) {
  const byPath = new Map();
  const root = {
    id: nextId(),
    name: rootName,
    path: rootName,
    type: "dir",
    children: [],
  };
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return root;
  const absRoot = lines[0].split("\t")[3]; // first find row is the search dir itself
  byPath.set(absRoot, root);
  for (const line of lines.slice(1)) {
    const [type, size, mtimeSec, abs] = line.split("\t");
    if (!abs) continue;
    const parentAbs = abs.slice(0, abs.lastIndexOf("/")) || absRoot;
    const parent = byPath.get(parentAbs);
    if (!parent) continue;
    const name = abs.slice(abs.lastIndexOf("/") + 1);
    const display = parent.path + "/" + name;
    if (type === "d") {
      const node = {
        id: nextId(),
        name,
        path: display,
        type: "dir",
        children: [],
      };
      byPath.set(abs, node);
      parent.children.push(node);
    } else if (type === "f") {
      const mt = Math.round(parseFloat(mtimeSec) * 1000);
      parent.children.push({
        id: nextId(),
        name,
        path: display,
        type: "file",
        ext: extOf(name),
        size: parseInt(size, 10) || 0,
        mtime: mt,
        createdAt: mt,
      });
    }
  }
  return root;
}

export function dockerGet(socketPath, urlPath) {
  return new Promise((resolve) => {
    const req = http.request(
      { socketPath, path: urlPath, method: "GET", timeout: 4000 },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

export async function listContainers(socketPath) {
  const list = await dockerGet(socketPath, "/containers/json");
  return Array.isArray(list) ? list : [];
}

export function execFind(containerId, dir) {
  return new Promise((resolve) => {
    execFile(
      "docker",
      [
        "exec",
        containerId,
        "find",
        dir,
        "-maxdepth",
        "5",
        "-not",
        "-path",
        "*/node_modules*",
        "-printf",
        "%y\\t%s\\t%T@\\t%p\\n",
      ],
      { timeout: 6000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(err ? "" : stdout),
    );
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd opentree-agent && node --test test/docker.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add opentree-agent/lib/docker.mjs opentree-agent/test/docker.test.mjs
git commit -m "feat(agent): read-only docker socket client and parsers"
```

---

### Task 4: Snapshot assembly

**Files:**

- Create: `opentree-agent/lib/snapshot.mjs`
- Create: `opentree-agent/test/snapshot.test.mjs`

**Interfaces:**

- Consumes: `walkDir` (Task 1), `applyUsage` (Task 2), `parseStats`/`parseInspect`/`parseFindOutput`/`dockerGet`/`listContainers`/`execFind` (Task 3).
- Produces:
  - `annotate(node, depth, nowMs) → DirNode` — aggregates `size`/`count`/`uses`/`usage30`/`createdAt`/`mtime`/`depth` up the tree (ported from `inspector/data.js`).
  - `placeOrigins(count) → [x,y,z][]` — host at `[0,0,0]`, containers on a ring radius 26 in the XZ plane.
  - `hostStats() → { stats:string, ports:string }` — from `node:os` + `df`; best-effort.
  - `buildSnapshot({ hostRoot, hostName, dataDir, socketPath, now }) → Promise<{ generatedAt, islands }>`.

- [ ] **Step 1: Write the failing test**

`opentree-agent/test/snapshot.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { annotate, placeOrigins } from "../lib/snapshot.mjs";

const NOW = Date.UTC(2026, 5, 12, 12, 0, 0);

test("annotate aggregates size, count, uses and usage30 up the tree", () => {
  const tree = {
    type: "dir",
    name: "r",
    path: "r",
    children: [
      {
        type: "file",
        name: "a",
        path: "r/a",
        size: 100,
        mtime: NOW,
        createdAt: NOW,
        usage30: Array(30)
          .fill(0)
          .map((_, i) => (i === 29 ? 2 : 0)),
        uses: 2,
      },
      {
        type: "file",
        name: "b",
        path: "r/b",
        size: 50,
        mtime: NOW,
        createdAt: NOW,
        usage30: Array(30)
          .fill(0)
          .map((_, i) => (i === 29 ? 3 : 0)),
        uses: 3,
      },
    ],
  };
  annotate(tree, 0, NOW);
  assert.equal(tree.size, 150);
  assert.equal(tree.count, 2);
  assert.equal(tree.uses, 5);
  assert.equal(tree.usage30[29], 5);
  assert.equal(tree.depth, 0);
});

test("placeOrigins puts host at origin and spreads containers", () => {
  const o = placeOrigins(3);
  assert.deepEqual(o[0], [0, 0, 0]);
  assert.equal(o.length, 3);
  assert.notDeepEqual(o[1], o[2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd opentree-agent && node --test test/snapshot.test.mjs`
Expected: FAIL — `Cannot find module '../lib/snapshot.mjs'`

- [ ] **Step 3: Implement `lib/snapshot.mjs`**

```js
import os from "node:os";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { walkDir } from "./walk.mjs";
import { applyUsage, parseEventsNdjson } from "./usage.mjs";
import {
  dockerGet,
  listContainers,
  execFind,
  parseStats,
  parseInspect,
  parseFindOutput,
} from "./docker.mjs";

const EXCLUDE = new Set(["node_modules", ".git", ".cache"]);

export function annotate(node, depth, nowMs) {
  node.depth = depth;
  if (node.type === "file") {
    node.count = 1;
    return node;
  }
  let size = 0,
    count = 0,
    uses = 0,
    created = Infinity,
    mt = 0;
  const u30 = new Array(30).fill(0);
  for (const c of node.children) {
    annotate(c, depth + 1, nowMs);
    size += c.size;
    count += c.count;
    uses += c.uses;
    created = Math.min(created, c.createdAt);
    mt = Math.max(mt, c.mtime);
    for (let i = 0; i < 30; i++) u30[i] += c.usage30[i];
  }
  node.size = size;
  node.count = count;
  node.uses = uses;
  node.usage30 = u30;
  node.createdAt = created === Infinity ? nowMs : created;
  node.mtime = mt || nowMs;
  return node;
}

export function placeOrigins(count) {
  const out = [[0, 0, 0]];
  const ring = count - 1;
  const R = 26;
  for (let i = 0; i < ring; i++) {
    const a = (i / Math.max(1, ring)) * Math.PI * 2 + 0.4;
    out.push([Math.round(Math.cos(a) * R), 0, Math.round(Math.sin(a) * R)]);
  }
  return out.slice(0, count);
}

function dfRoot() {
  return new Promise((resolve) => {
    execFile(
      "df",
      ["-BG", "--output=used,size", "/"],
      { timeout: 3000 },
      (err, out) => {
        if (err) return resolve("");
        const line = out.trim().split("\n").pop().trim().split(/\s+/);
        resolve(line.length >= 2 ? `disque ${line[0]} / ${line[1]}` : "");
      },
    );
  });
}

export async function hostStats() {
  const mem = (os.totalmem() / 1073741824).toFixed(1).replace(".", ",");
  const stats = `${os.cpus().length} vCPU · ${mem} Gi · ${os.type()} ${os.release()}`;
  const disk = await dfRoot();
  return { stats, ports: disk || "host" };
}

async function tagAndAnnotate(island, nowMs) {
  annotate(island.root, 0, nowMs);
  (function tag(n) {
    n.iid = island.id;
    n.children?.forEach(tag);
  })(island.root);
  return island;
}

export async function buildSnapshot({
  hostRoot,
  hostName,
  dataDir,
  socketPath,
  now,
}) {
  let nextIdN = 0;
  const nextId = () => ++nextIdN;
  const islands = [];

  // --- host ---------------------------------------------------------------
  let eventsText = "";
  try {
    eventsText = await readFile(join(dataDir, "events.ndjson"), "utf8");
  } catch {
    /* no log yet */
  }
  const eventsMap = parseEventsNdjson(eventsText, now);
  const hostTree = await walkDir(hostRoot, {
    rootName: hostName,
    exclude: EXCLUDE,
    nextId,
  });
  applyUsage(hostTree, eventsMap, now);
  const hs = await hostStats();
  islands.push({
    id: "host",
    kind: "host",
    name: hostName.replace(/^~\//, ""),
    status: "ok",
    statusTxt: "en ligne",
    stats: hs.stats,
    ports: hs.ports,
    rootLen: 10,
    origin: [0, 0, 0],
    root: hostTree,
  });

  // --- containers ---------------------------------------------------------
  const containers = await listContainers(socketPath);
  for (const c of containers) {
    const id = c.Id;
    const name = ((c.Names && c.Names[0]) || id.slice(0, 12)).replace(
      /^\//,
      "",
    );
    const inspectRaw = await dockerGet(socketPath, `/containers/${id}/json`);
    const statsRaw = await dockerGet(
      socketPath,
      `/containers/${id}/stats?stream=false`,
    );
    const insp = inspectRaw
      ? parseInspect(inspectRaw, now)
      : { status: "unknown", statusTxt: "unknown", ports: "openclaw:local" };
    const st = statsRaw ? parseStats(statsRaw) : { cpuPct: 0, memMiB: 0 };
    const findText = await execFind(id, "/app");
    const root = parseFindOutput(findText, `${name}:/app`, nextId);
    applyUsage(root, eventsMap, now);
    islands.push({
      id: name,
      kind: "container",
      name,
      status: insp.status,
      statusTxt: insp.statusTxt,
      stats: `CPU ${st.cpuPct.toFixed(1).replace(".", ",")} % · RAM ${Math.round(st.memMiB)} MiB`,
      ports: insp.ports,
      rootLen: 5.6,
      origin: [0, 0, 0],
      root,
    });
  }

  // --- positions + aggregation -------------------------------------------
  const origins = placeOrigins(islands.length);
  islands.forEach((isl, i) => {
    isl.origin = origins[i];
  });
  for (const isl of islands) await tagAndAnnotate(isl, now);

  return { generatedAt: now, islands };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd opentree-agent && node --test test/snapshot.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full suite so far**

Run: `cd opentree-agent && node --test test/`
Expected: PASS (all tests from Tasks 1–4)

- [ ] **Step 6: Commit**

```bash
git add opentree-agent/lib/snapshot.mjs opentree-agent/test/snapshot.test.mjs
git commit -m "feat(agent): assemble host + container islands into snapshot"
```

---

### Task 5: HTTP server (static + /api/snapshot)

**Files:**

- Create: `opentree-agent/lib/server.mjs`
- Create: `opentree-agent/test/server.test.mjs`

**Interfaces:**

- Consumes: a `buildSnapshot` thunk `() => Promise<object>` injected by the caller (lets tests stub it).
- Produces: `createServer({ staticDir, getSnapshot }) → http.Server`. Routes: `GET /api/snapshot` → JSON (`200`, or `200` with a minimal `{generatedAt, islands:[]}` fallback if the thunk throws — never `500`); any other `GET` → static file from `staticDir` with a path-traversal guard; unknown path → `404`.

- [ ] **Step 1: Write the failing test**

`opentree-agent/test/server.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd opentree-agent && node --test test/server.test.mjs`
Expected: FAIL — `Cannot find module '../lib/server.mjs'`

- [ ] **Step 3: Implement `lib/server.mjs`**

```js
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

const MIME = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  mp3: "audio/mpeg",
  woff2: "font/woff2",
  ico: "image/x-icon",
};

function mimeFor(path) {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

export function createServer({ staticDir, getSnapshot }) {
  return http.createServer(async (req, res) => {
    const url = (req.url || "/").split("?")[0];

    if (url === "/api/snapshot") {
      let payload;
      try {
        payload = await getSnapshot();
      } catch {
        payload = { generatedAt: Date.now(), islands: [] };
      }
      res.writeHead(200, { "content-type": MIME.json });
      res.end(JSON.stringify(payload));
      return;
    }

    const rel = normalize(url === "/" ? "/OpenTree.html" : url).replace(
      /^(\.\.[/\\])+/,
      "",
    );
    if (rel.includes("..")) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    try {
      const buf = await readFile(join(staticDir, rel));
      res.writeHead(200, { "content-type": mimeFor(rel) });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd opentree-agent && node --test test/server.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add opentree-agent/lib/server.mjs opentree-agent/test/server.test.mjs
git commit -m "feat(agent): http server serving static files and /api/snapshot"
```

---

### Task 6: Filesystem watcher

**Files:**

- Create: `opentree-agent/lib/watcher.mjs`
- Modify: `opentree-agent/test/usage.test.mjs` → add a small import test, OR create `opentree-agent/test/watcher.test.mjs`
- Create: `opentree-agent/test/watcher.test.mjs`

**Interfaces:**

- Produces:
  - `formatEventLine(nowMs, displayPath) → string` — pure; a single NDJSON line ending in `\n`, matching `parseEventsNdjson`'s expected `{ts, path}` shape.
  - `startWatcher({ absRoot, rootName, eventsPath }) → void` — best-effort recursive `fs.watch`; appends event lines; logs a warning and no-ops if recursive watch is unsupported. Not unit-tested (side-effectful).

- [ ] **Step 1: Write the failing test**

`opentree-agent/test/watcher.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd opentree-agent && node --test test/watcher.test.mjs`
Expected: FAIL — `Cannot find module '../lib/watcher.mjs'`

- [ ] **Step 3: Implement `lib/watcher.mjs`**

```js
import { watch } from "node:fs";
import { appendFile } from "node:fs/promises";

export function formatEventLine(nowMs, displayPath) {
  return JSON.stringify({ ts: nowMs, path: displayPath }) + "\n";
}

export function startWatcher({ absRoot, rootName, eventsPath }) {
  let watcher;
  try {
    watcher = watch(absRoot, { recursive: true }, (_evt, filename) => {
      if (!filename) return;
      const rel = filename.toString().replace(/\\/g, "/");
      if (rel.includes("node_modules") || rel.includes(".git")) return;
      const displayPath = rootName + "/" + rel;
      appendFile(eventsPath, formatEventLine(Date.now(), displayPath)).catch(
        () => {},
      );
    });
    watcher.on("error", () => {});
  } catch (err) {
    console.warn(
      "[opentree] fs.watch unavailable, falling back to mtime only:",
      err.message,
    );
  }
  return watcher;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd opentree-agent && node --test test/watcher.test.mjs`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add opentree-agent/lib/watcher.mjs opentree-agent/test/watcher.test.mjs
git commit -m "feat(agent): best-effort fs.watch event logger"
```

---

### Task 7: Entry point + systemd unit

**Files:**

- Create: `opentree-agent/opentree-agent.mjs`
- Create: `opentree-agent/deploy/opentree-agent.service`

**Interfaces:**

- Consumes: `createServer` (Task 5), `buildSnapshot` (Task 4), `startWatcher` (Task 6).
- Produces: a runnable agent. Config via env: `OPENTREE_PORT` (default `7070`), `OPENTREE_HOST_ROOT` (default `$HOME/openclaw`), `OPENTREE_HOST_NAME` (default `~/openclaw`), `OPENTREE_STATIC` (default sibling `../inspector`), `OPENTREE_DATA` (default `./.data`), `DOCKER_SOCKET` (default `/var/run/docker.sock`).

- [ ] **Step 1: Implement `opentree-agent.mjs`**

```js
import { mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createServer } from "./lib/server.mjs";
import { buildSnapshot } from "./lib/snapshot.mjs";
import { startWatcher } from "./lib/watcher.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.OPENTREE_PORT || "7070", 10);
const HOST_ROOT = process.env.OPENTREE_HOST_ROOT || join(homedir(), "openclaw");
const HOST_NAME = process.env.OPENTREE_HOST_NAME || "~/openclaw";
const STATIC_DIR = resolve(
  process.env.OPENTREE_STATIC || join(here, "..", "inspector"),
);
const DATA_DIR = resolve(process.env.OPENTREE_DATA || join(here, ".data"));
const SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

await mkdir(DATA_DIR, { recursive: true });

const getSnapshot = () =>
  buildSnapshot({
    hostRoot: HOST_ROOT,
    hostName: HOST_NAME,
    dataDir: DATA_DIR,
    socketPath: SOCKET,
    now: Date.now(),
  });

startWatcher({
  absRoot: HOST_ROOT,
  rootName: HOST_NAME,
  eventsPath: join(DATA_DIR, "events.ndjson"),
});

const server = createServer({ staticDir: STATIC_DIR, getSnapshot });
server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[opentree] http://127.0.0.1:${PORT}  (host=${HOST_ROOT}, static=${STATIC_DIR})`,
  );
});
```

- [ ] **Step 2: Smoke-test locally (no Docker required)**

Run:

```bash
cd opentree-agent
OPENTREE_HOST_ROOT="$PWD/lib" OPENTREE_HOST_NAME="~/agent-lib" OPENTREE_STATIC="$PWD" node opentree-agent.mjs &
sleep 1
curl -s http://127.0.0.1:7070/api/snapshot | head -c 400
kill %1
```

Expected: JSON beginning `{"generatedAt":...,"islands":[{"id":"host",...`. Container collection may be empty/absent locally — that is correct (graceful degradation).

- [ ] **Step 3: Write `deploy/opentree-agent.service`**

```ini
[Unit]
Description=OpenTree architecture agent
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=%h/opentree-agent
ExecStart=/usr/bin/env node %h/opentree-agent/opentree-agent.mjs
Restart=always
RestartSec=3
Environment=OPENTREE_PORT=7070

[Install]
WantedBy=default.target
```

- [ ] **Step 4: Commit**

```bash
git add opentree-agent/opentree-agent.mjs opentree-agent/deploy/opentree-agent.service
git commit -m "feat(agent): entry point and systemd unit"
```

---

### Task 8: Wire the frontend to live data

**Files:**

- Modify: `inspector/data.js` (replace generation with fetch; keep `NOW` as a mutable live binding)
- Modify: `inspector/scene-v2.js:4` and `inspector/scene-v2.js:104` (accept islands as a param instead of calling `buildArchitecture()`)
- Modify: `inspector/main-v2.js` (fetch first, set `NOW`, pass islands into `createScene`, add loading state)
- Modify: `inspector/OpenTree.html` (loading overlay element)

**Interfaces:**

- Consumes: `GET /api/snapshot → { generatedAt, islands }` (Task 5).
- Produces: `fetchArchitecture() → Promise<{ generatedAt, islands }>` in `data.js`; `createScene(container, callbacks, islands)` now takes islands.

**Note:** This task is verified in the browser, not via `node:test` (it's THREE.js + DOM). Manual verification steps included.

- [ ] **Step 1: Rewrite `inspector/data.js`**

Replace the entire file with:

```js
// Live data source — fetches the real architecture snapshot from the agent.
// NOW is a mutable live binding: content.js/scene-v2.js import it; fetchArchitecture
// updates it before the scene renders, so relative dates use the server clock.
export let NOW = Date.now();

export async function fetchArchitecture() {
  const res = await fetch("/api/snapshot");
  const snap = await res.json();
  NOW = snap.generatedAt || Date.now();
  return snap;
}

export function flatten(root) {
  const dirs = [],
    files = [];
  (function walk(n) {
    if (n.type === "dir") {
      dirs.push(n);
      n.children.forEach(walk);
    } else files.push(n);
  })(root);
  return { dirs, files };
}
```

- [ ] **Step 2: Update `inspector/scene-v2.js` import (line 4)**

Change:

```js
import { buildArchitecture, flatten, NOW } from "./data.js";
```

to:

```js
import { flatten } from "./data.js";
```

- [ ] **Step 3: Update `inspector/scene-v2.js` signature and data source**

Change the factory signature (line 35):

```js
export function createScene(container, callbacks = {}) {
```

to:

```js
export function createScene(container, callbacks = {}, islands = []) {
```

And change line 104:

```js
const islands = buildArchitecture();
```

to:

```js
// islands provided by caller (fetched snapshot)
```

(Delete the `const islands = buildArchitecture();` line — the parameter now provides `islands`.)

- [ ] **Step 4: Update `inspector/main-v2.js`**

At the top, add to the data import (line ~3) — `main-v2.js` does not currently import from `data.js`; add:

```js
import { fetchArchitecture } from "./data.js";
```

Wrap the bootstrap. Change line 68:

```js
scene = createScene(stage, callbacks);
```

to:

```js
const snap = await fetchArchitecture();
scene = createScene(stage, callbacks, snap.islands);
```

Because top-level `await` is used, confirm `<script type="module">` (it is, per `OpenTree.html:400`). If any code between the `callbacks` definition and line 68 must run after the scene exists, it already does (it's after line 68). No other reordering needed.

- [ ] **Step 5: Add a loading overlay to `inspector/OpenTree.html`**

After `<div id="stage" …></div>` (line 330), add:

```html
<div
  id="loading"
  style="position:fixed;inset:0;z-index:40;display:flex;align-items:center;
    justify-content:center;font-family:var(--mono);font-size:13px;color:var(--ink-soft);
    background:var(--bg1);transition:opacity .3s"
>
  Lecture de l'architecture…
</div>
```

In `main-v2.js`, immediately after `scene = createScene(...)` (Step 4), add:

```js
const loadingEl = document.getElementById("loading");
if (loadingEl) {
  loadingEl.style.opacity = "0";
  setTimeout(() => loadingEl.remove(), 300);
}
```

- [ ] **Step 6: Verify in the browser against the running agent**

Run (agent must be running from Task 7, serving `inspector/` as static):

```bash
cd opentree-agent
OPENTREE_HOST_ROOT="$(cd .. && pwd)" OPENTREE_HOST_NAME="~/opentree-repo" \
  OPENTREE_STATIC="$(cd ../inspector && pwd)" node opentree-agent.mjs
```

Open `http://127.0.0.1:7070`. Expected: the loading text appears briefly, then the globe renders the **real** repo tree (host island = this repository). Hover a file → tooltip with size + 30-day sparkline. Click a file → detail panel. No console errors.

- [ ] **Step 7: Commit**

```bash
git add inspector/data.js inspector/scene-v2.js inspector/main-v2.js inspector/OpenTree.html
git commit -m "feat(viewer): consume live /api/snapshot instead of simulated data"
```

---

## Verification (whole feature)

- [ ] `cd opentree-agent && node --test test/` → all tests pass (Tasks 1–6).
- [ ] Agent boots, `GET /api/snapshot` returns host island + any running containers, never a 500.
- [ ] Browser renders live data with working tooltips, detail panel, search, isolate.
- [ ] Deploy doc check: `node --version` on the VPS is ≥ 20; `systemctl --user enable --now opentree-agent` starts it; SSH tunnel `ssh -L 7070:localhost:7070 user@vps` exposes the UI locally.

## Known limitation flagged for follow-up

`content.js::snippet()` still fabricates file-content previews from the extension. Reading **real** file contents on click was not in the approved spec (scope was structure + usage + Docker). The detail/bubble code previews therefore remain synthetic. Decide separately whether to add a `GET /api/file?path=…` endpoint (with a strict path allowlist under the host root) to show real contents.
