# OpenTree Plugin Exposition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empaqueter `opentree-agent` en plugin OpenClaw qui sert le viewer OpenTree via le gateway (URL protégée par mot de passe + bouton de mise à jour des données).

**Architecture:** Approche A — le plugin enregistre une route `registerHttpRoute(match:"prefix", auth:"gateway")` servie par un handler de requête combiné réutilisable (`lib/handlers.mjs`), et un `registerService({start, stop})` qui gère le cycle de vie du watcher. Un cache snapshot (`lib/cache.mjs`) rend `/api/snapshot` instantané ; `/api/refresh` force un rebuild. Le standalone existant (`server.mjs`) reste fonctionnel pour le dev local en réutilisant les mêmes modules.

**Tech Stack:** Node ESM (logique métier `.mjs`), un seul fichier TypeScript pour le wrapper plugin (`src/index.ts` + `src/register.ts`), SDK `openclaw/plugin-sdk/plugin-entry`, tests `node:test`, exposition via Tailscale Serve.

## Global Constraints

- Node ≥ 22.19 requis pour le dev plugin OpenClaw (source: `docs/plugins/building-plugins`).
- Aucune dépendance runtime nouvelle ; seule dépendance dev autorisée : le SDK OpenClaw (`openclaw`), **après approbation explicite de l'utilisateur** (CLAUDE.md : ne jamais installer sans demander).
- Génération aléatoire déterministe via `mulberry32(0xC0FFEE)` — ne pas modifier l'ordre d'appel (CLAUDE.md projet).
- Pas de commentaires sauf logique non-évidente ; suivre les idiomes du fichier édité.
- Commits en anglais, format conventionnel (`feat`/`fix`/`refactor`/`docs`/`test`). Branche courante `feat/opentree-backend` (jamais `main`).
- `auth: "gateway"` sur toutes les routes (hérite de `gateway.auth.*`). Préfixe de route : `/opentree`.
- Tests lancés en ciblé : `node --test opentree-agent/test/<file>` (CLAUDE.md : préférer un test ciblé).

---

## File Structure

| Fichier                               | Rôle                                                                     | Action   |
| ------------------------------------- | ------------------------------------------------------------------------ | -------- |
| `opentree-agent/lib/cache.mjs`        | Cache du dernier snapshot (build paresseux + force-refresh)              | Créer    |
| `opentree-agent/lib/rotate.mjs`       | Filtre pur des événements > 30 jours                                     | Créer    |
| `opentree-agent/lib/watcher.mjs`      | Watcher fs + appel rotation au démarrage et quotidien                    | Modifier |
| `opentree-agent/lib/handlers.mjs`     | Handler de requête combiné (statique / snapshot / refresh) avec `prefix` | Créer    |
| `opentree-agent/lib/server.mjs`       | Standalone : consomme `cache` + `handlers`                               | Modifier |
| `opentree-agent/opentree-agent.mjs`   | Standalone bootstrap : construit le cache                                | Modifier |
| `opentree-agent/src/register.ts`      | `registerOpenTree(api, deps)` pur (sans import SDK runtime)              | Créer    |
| `opentree-agent/src/index.ts`         | Point d'entrée plugin : `definePluginEntry` + wiring                     | Créer    |
| `opentree-agent/openclaw.plugin.json` | Manifeste plugin                                                         | Créer    |
| `opentree-agent/tsconfig.json`        | Config build du wrapper TS                                               | Créer    |
| `opentree-agent/package.json`         | Champ `openclaw` + scripts build                                         | Modifier |
| `inspector/data.js`                   | Résolution base path + `refreshArchitecture()`                           | Modifier |
| `inspector/main-v2.js`                | Wiring du bouton refresh (état chargement)                               | Modifier |
| `inspector/OpenTree.html`             | Bouton refresh dans la topbar                                            | Modifier |
| `opentree-agent/README.md`            | Déploiement : install, mot de passe gateway, Tailscale Serve             | Créer    |

---

## Task 1: Snapshot cache module

**Files:**

- Create: `opentree-agent/lib/cache.mjs`
- Test: `opentree-agent/test/cache.test.mjs`

**Interfaces:**

- Consumes: rien.
- Produces: `createSnapshotCache({ build }) → { get(): Promise<{snapshot, generatedAt}>, refresh(): Promise<{snapshot, generatedAt}>, peek(): {snapshot, generatedAt}|null }`. `build` est `() => Promise<snapshot>` où `snapshot` a un champ `generatedAt`.

- [ ] **Step 1: Write the failing test**

```js
// opentree-agent/test/cache.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test opentree-agent/test/cache.test.mjs`
Expected: FAIL — `Cannot find module '../lib/cache.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// opentree-agent/lib/cache.mjs
export function createSnapshotCache({ build }) {
  let current = null;
  let inflight = null;

  function rebuild() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const snapshot = await build();
        current = { snapshot, generatedAt: snapshot.generatedAt };
        return current;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return {
    get: () => (current ? Promise.resolve(current) : rebuild()),
    refresh: () => rebuild(),
    peek: () => current,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test opentree-agent/test/cache.test.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add opentree-agent/lib/cache.mjs opentree-agent/test/cache.test.mjs
git commit -m "feat(agent): add lazy snapshot cache with force-refresh"
```

---

## Task 2: events.ndjson rotation

**Files:**

- Create: `opentree-agent/lib/rotate.mjs`
- Modify: `opentree-agent/lib/watcher.mjs`
- Test: `opentree-agent/test/rotate.test.mjs`

**Interfaces:**

- Consumes: rien.
- Produces:
  - `filterRecentEvents(text: string, nowMs: number, retentionDays = 30): string` — renvoie le NDJSON ne gardant que les lignes `ts >= nowMs - retentionDays*DAY` (chaîne vide si aucune).
  - `rotateEventsFile(eventsPath: string, nowMs: number, retentionDays = 30): Promise<void>` — réécrit le fichier sur place (no-op si fichier absent).
  - `startWatcher` gagne un paramètre optionnel `retentionDays` et purge au démarrage + toutes les 24 h.

- [ ] **Step 1: Write the failing test**

```js
// opentree-agent/test/rotate.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test opentree-agent/test/rotate.test.mjs`
Expected: FAIL — `Cannot find module '../lib/rotate.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// opentree-agent/lib/rotate.mjs
import { readFile, writeFile, rename } from "node:fs/promises";

const DAY = 86400000;

export function filterRecentEvents(text, nowMs, retentionDays = 30) {
  const cutoff = nowMs - retentionDays * DAY;
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (evt && typeof evt.ts === "number" && evt.ts >= cutoff)
      out.push(trimmed);
  }
  return out.length ? out.join("\n") + "\n" : "";
}

export async function rotateEventsFile(eventsPath, nowMs, retentionDays = 30) {
  let text;
  try {
    text = await readFile(eventsPath, "utf8");
  } catch {
    return;
  }
  const filtered = filterRecentEvents(text, nowMs, retentionDays);
  const tmp = eventsPath + ".tmp";
  await writeFile(tmp, filtered);
  await rename(tmp, eventsPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test opentree-agent/test/rotate.test.mjs`
Expected: PASS — 3 tests.

- [ ] **Step 5: Wire rotation into the watcher**

Modify `opentree-agent/lib/watcher.mjs` — add the import at the top, and rotate on startup + every 24 h. Update the signature and clean up the interval on close:

```js
import { watch } from "node:fs";
import { appendFile } from "node:fs/promises";
import { rotateEventsFile } from "./rotate.mjs";

export function formatEventLine(nowMs, displayPath) {
  return JSON.stringify({ ts: nowMs, path: displayPath }) + "\n";
}

export function startWatcher({
  absRoot,
  rootName,
  eventsPath,
  retentionDays = 30,
}) {
  rotateEventsFile(eventsPath, Date.now(), retentionDays).catch(() => {});
  const rotateTimer = setInterval(
    () =>
      rotateEventsFile(eventsPath, Date.now(), retentionDays).catch(() => {}),
    86400000,
  );
  rotateTimer.unref?.();

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

  return {
    close() {
      clearInterval(rotateTimer);
      watcher?.close?.();
    },
  };
}
```

Note: the return shape changes from a raw watcher to `{ close() }`. `opentree-agent.mjs:52` already calls `watcher?.close?.()`, so it stays compatible.

- [ ] **Step 6: Run the watcher test to confirm no regression**

Run: `node --test opentree-agent/test/watcher.test.mjs`
Expected: PASS (existing `formatEventLine` test unchanged).

- [ ] **Step 7: Commit**

```bash
git add opentree-agent/lib/rotate.mjs opentree-agent/lib/watcher.mjs opentree-agent/test/rotate.test.mjs
git commit -m "feat(agent): rotate events.ndjson to the 30-day window"
```

---

## Task 3: Combined request handler + standalone refactor

**Files:**

- Create: `opentree-agent/lib/handlers.mjs`
- Modify: `opentree-agent/lib/server.mjs`
- Modify: `opentree-agent/opentree-agent.mjs`
- Test: `opentree-agent/test/handlers.test.mjs`
- Modify: `opentree-agent/test/server.test.mjs` (only if it constructs `createServer` with the old `getSnapshot` contract)

**Interfaces:**

- Consumes: `createSnapshotCache` (Task 1).
- Produces: `createRequestHandler({ staticDir, cache, prefix = "" }) → async (req, res) => void`. Internal routing on the path **after** stripping `prefix`:
  - `=== prefix` (no trailing slash) → 301 redirect to `prefix + "/"`.
  - ends with `/api/snapshot` → JSON of `(await cache.get()).snapshot`.
  - ends with `/api/refresh` → JSON of `(await cache.refresh()).snapshot`.
  - otherwise → static file from `staticDir` (index `OpenTree.html` for the directory root), with path-traversal guard returning 404.

- [ ] **Step 1: Write the failing test**

```js
// opentree-agent/test/handlers.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test opentree-agent/test/handlers.test.mjs`
Expected: FAIL — `Cannot find module '../lib/handlers.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// opentree-agent/lib/handlers.mjs
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

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

function sendJson(res, payload) {
  res.writeHead(200, { "content-type": MIME.json });
  res.end(JSON.stringify(payload));
}

export function createRequestHandler({ staticDir, cache, prefix = "" }) {
  const safeRoot = resolve(staticDir);
  return async (req, res) => {
    const full = (req.url || "/").split("?")[0];
    if (prefix && full === prefix) {
      res.writeHead(301, { location: prefix + "/" });
      res.end();
      return;
    }
    let url =
      prefix && full.startsWith(prefix) ? full.slice(prefix.length) : full;
    if (url === "") url = "/";

    if (url.endsWith("/api/snapshot")) {
      try {
        sendJson(res, (await cache.get()).snapshot);
      } catch {
        sendJson(res, { generatedAt: Date.now(), islands: [] });
      }
      return;
    }
    if (url.endsWith("/api/refresh")) {
      try {
        sendJson(res, (await cache.refresh()).snapshot);
      } catch {
        sendJson(res, { generatedAt: Date.now(), islands: [] });
      }
      return;
    }

    let abs;
    try {
      const reqPath = url === "/" ? "/OpenTree.html" : decodeURIComponent(url);
      abs = resolve(
        safeRoot,
        "." + (reqPath.startsWith("/") ? reqPath : "/" + reqPath),
      );
    } catch {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    if (abs !== safeRoot && !abs.startsWith(safeRoot + sep)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    try {
      const buf = await readFile(abs);
      res.writeHead(200, { "content-type": mimeFor(abs) });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test opentree-agent/test/handlers.test.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 5: Refactor the standalone server to use the handler + cache**

Replace `opentree-agent/lib/server.mjs` entirely:

```js
// opentree-agent/lib/server.mjs
import http from "node:http";
import { createRequestHandler } from "./handlers.mjs";

export function createServer({ staticDir, cache, prefix = "" }) {
  return http.createServer(createRequestHandler({ staticDir, cache, prefix }));
}
```

- [ ] **Step 6: Update the standalone bootstrap to build a cache**

Modify `opentree-agent/opentree-agent.mjs` — replace the `getSnapshot`/`createServer` wiring (lines 28–47) so it constructs a cache from `buildSnapshot` and passes it to `createServer`:

```js
import { createSnapshotCache } from "./lib/cache.mjs";

const cache = createSnapshotCache({
  build: () =>
    buildSnapshot({
      hostRoot: HOST_ROOT,
      hostName: HOST_NAME,
      dataDir: DATA_DIR,
      socketPath: SOCKET,
      now: Date.now(),
    }),
});

const watcher = startWatcher({
  absRoot: HOST_ROOT,
  rootName: HOST_NAME,
  eventsPath: join(DATA_DIR, "events.ndjson"),
});

const server = createServer({ staticDir: STATIC_DIR, cache });
server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[opentree] http://127.0.0.1:${PORT}  (host=${HOST_ROOT}, static=${STATIC_DIR})`,
  );
});
```

(Keep the existing imports of `createServer`, `buildSnapshot`, `startWatcher`; remove the now-unused `getSnapshot` arrow.)

- [ ] **Step 7: Reconcile the existing server test**

Run: `node --test opentree-agent/test/server.test.mjs`
If it FAILS because it calls `createServer({ staticDir, getSnapshot })`, update that test to construct a cache instead:

```js
import { createSnapshotCache } from "../lib/cache.mjs";
// ...
const cache = createSnapshotCache({
  build: async () => ({ generatedAt: 1, islands: [] }),
});
const server = createServer({ staticDir, cache });
```

Re-run until PASS. If the test already passes (it exercises only static/routing behaviour), leave it untouched.

- [ ] **Step 8: Run the full agent suite**

Run: `node --test opentree-agent/`
Expected: PASS — all suites (existing 24 + cache + rotate + handlers).

- [ ] **Step 9: Commit**

```bash
git add opentree-agent/lib/handlers.mjs opentree-agent/lib/server.mjs opentree-agent/opentree-agent.mjs opentree-agent/test/handlers.test.mjs opentree-agent/test/server.test.mjs
git commit -m "refactor(agent): combined request handler reused by standalone + cache wiring"
```

---

## Task 4: Plugin packaging + TypeScript entry

**Files:**

- Create: `opentree-agent/openclaw.plugin.json`
- Create: `opentree-agent/tsconfig.json`
- Create: `opentree-agent/src/register.ts`
- Create: `opentree-agent/src/index.ts`
- Modify: `opentree-agent/package.json`
- Test: `opentree-agent/test/register.test.mjs`

**Interfaces:**

- Consumes: `createRequestHandler` (Task 3), `createSnapshotCache` (Task 1), `buildSnapshot` (`lib/snapshot.mjs`), `startWatcher` (Task 2).
- Produces: `registerOpenTree(api, { staticDir, hostRoot, hostName, stateDir, socketPath })` — registers exactly one HTTP route (`path:"/opentree"`, `auth:"gateway"`, `match:"prefix"`) and one service (`id:"opentree-watcher"`, `start`, `stop`). `start` opens the watcher; `stop` closes it.

- [ ] **Step 1: Approval gate — install the SDK dev dependency**

The SDK is needed at the `src/index.ts` import (`openclaw/plugin-sdk/plugin-entry`) and for `tsc` typechecking. Per CLAUDE.md, do NOT install without approval. Ask the user:

> "Pour compiler le wrapper plugin il faut le SDK OpenClaw en devDependency. Je propose `npm i -D openclaw` (paquet public, gratuit). OK ?"

After approval, verify the package and subpath exist, then install:

Run: `npm view openclaw version && npm i -D openclaw --prefix opentree-agent`
Expected: prints a version (e.g. `2026.x.x`) and installs without error. If the subpath import later fails to resolve, cross-check the exact specifier against `gh api -H "Accept: application/vnd.github.raw" /repos/openclaw/openclaw/contents/docs/snippets/plugin-publish/` and adjust the import in Step 4.

- [ ] **Step 2: Write the failing test (pure register logic, no SDK at runtime)**

```js
// opentree-agent/test/register.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerOpenTree } from "../dist/register.js";

function mockApi() {
  const routes = [];
  const services = [];
  return {
    routes,
    services,
    registerHttpRoute: (p) => routes.push(p),
    registerService: (s) => services.push(s),
    logger: { info() {}, error() {} },
  };
}

test("registers one gateway-auth prefix route at /opentree", () => {
  const api = mockApi();
  registerOpenTree(api, {
    staticDir: ".",
    hostRoot: "/tmp",
    hostName: "~/openclaw",
    stateDir: "/tmp/state",
    socketPath: "/var/run/docker.sock",
  });
  assert.equal(api.routes.length, 1);
  assert.equal(api.routes[0].path, "/opentree");
  assert.equal(api.routes[0].auth, "gateway");
  assert.equal(api.routes[0].match, "prefix");
  assert.equal(typeof api.routes[0].handler, "function");
});

test("registers a watcher service with start and stop", () => {
  const api = mockApi();
  registerOpenTree(api, {
    staticDir: ".",
    hostRoot: "/tmp",
    hostName: "~/openclaw",
    stateDir: "/tmp/state",
    socketPath: "/var/run/docker.sock",
  });
  assert.equal(api.services.length, 1);
  assert.equal(api.services[0].id, "opentree-watcher");
  assert.equal(typeof api.services[0].start, "function");
  assert.equal(typeof api.services[0].stop, "function");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test opentree-agent/test/register.test.mjs`
Expected: FAIL — `Cannot find module '../dist/register.js'` (not built yet).

- [ ] **Step 4: Write `src/register.ts` (no runtime SDK import — types only)**

```ts
// opentree-agent/src/register.ts
import { join } from "node:path";
import { createSnapshotCache } from "../lib/cache.mjs";
import { createRequestHandler } from "../lib/handlers.mjs";
import { buildSnapshot } from "../lib/snapshot.mjs";
import { startWatcher } from "../lib/watcher.mjs";

type RouteParams = {
  path: string;
  auth: "gateway" | "plugin";
  match: "exact" | "prefix";
  handler: (req: unknown, res: unknown) => unknown;
};
type Service = { id: string; start: () => void; stop: () => void };
type Api = {
  registerHttpRoute: (p: RouteParams) => void;
  registerService: (s: Service) => void;
};
type Deps = {
  staticDir: string;
  hostRoot: string;
  hostName: string;
  stateDir: string;
  socketPath: string;
};

export function registerOpenTree(api: Api, deps: Deps): void {
  const eventsPath = join(deps.stateDir, "events.ndjson");
  const cache = createSnapshotCache({
    build: () =>
      buildSnapshot({
        hostRoot: deps.hostRoot,
        hostName: deps.hostName,
        dataDir: deps.stateDir,
        socketPath: deps.socketPath,
        now: Date.now(),
      }),
  });

  api.registerHttpRoute({
    path: "/opentree",
    auth: "gateway",
    match: "prefix",
    handler: createRequestHandler({
      staticDir: deps.staticDir,
      cache,
      prefix: "/opentree",
    }) as (req: unknown, res: unknown) => unknown,
  });

  let watcher: { close: () => void } | null = null;
  api.registerService({
    id: "opentree-watcher",
    start: () => {
      watcher = startWatcher({
        absRoot: deps.hostRoot,
        rootName: deps.hostName,
        eventsPath,
      });
    },
    stop: () => {
      watcher?.close();
      watcher = null;
    },
  });
}
```

- [ ] **Step 5: Write `src/index.ts` (the SDK entry)**

```ts
// opentree-agent/src/index.ts
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerOpenTree } from "./register.js";

const here = dirname(fileURLToPath(import.meta.url));

export default definePluginEntry({
  id: "opentree",
  name: "OpenTree",
  description: "Architecture visualiser served through the gateway.",
  register(api) {
    registerOpenTree(api, {
      staticDir: resolve(here, "..", "..", "inspector"),
      hostRoot: process.env.OPENTREE_HOST_ROOT || join(homedir(), "openclaw"),
      hostName: process.env.OPENTREE_HOST_NAME || "~/openclaw",
      stateDir: process.env.OPENTREE_DATA || resolve(here, "..", ".data"),
      socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock",
    });
  },
});
```

Note: `staticDir` resolves to the repo's `inspector/`. If ClawHub install requires the viewer assets inside the package, copy them in via an `assetScripts.copy` step (deferred — see Task 7 / README). For the local-on-VPS install the relative path holds.

- [ ] **Step 6: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "allowJs": false,
    "declaration": false,
    "noEmitOnError": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 7: Write `openclaw.plugin.json`**

```json
{
  "id": "opentree",
  "name": "OpenTree",
  "description": "Architecture visualiser served through the gateway.",
  "activation": { "onStartup": true },
  "enabledByDefault": true
}
```

- [ ] **Step 8: Update `package.json` with the `openclaw` field + build scripts**

Replace `opentree-agent/package.json`:

```json
{
  "name": "opentree-agent",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "npm run build && node --test"
  },
  "openclaw": {
    "extensions": ["./dist/index.js"]
  }
}
```

(The `openclaw.compat`/`build` fields are required only for external ClawHub publishing — out of scope; the VPS install is local. Note this in the README.)

- [ ] **Step 9: Build and run the register test**

Run: `npm run build --prefix opentree-agent && node --test opentree-agent/test/register.test.mjs`
Expected: `tsc` emits `dist/index.js` + `dist/register.js` with no errors; both register tests PASS.

- [ ] **Step 10: Full suite + typecheck**

Run: `npm test --prefix opentree-agent`
Expected: build succeeds, all suites PASS.

- [ ] **Step 11: Commit**

```bash
git add opentree-agent/openclaw.plugin.json opentree-agent/tsconfig.json opentree-agent/src opentree-agent/package.json opentree-agent/package-lock.json opentree-agent/test/register.test.mjs
git commit -m "feat(plugin): OpenClaw plugin entry serving OpenTree via gateway"
```

---

## Task 5: Front data layer — base path + refresh

**Files:**

- Modify: `inspector/data.js`
- Test: `opentree-agent/test/data-path.test.mjs`

**Interfaces:**

- Consumes: rien.
- Produces:
  - `apiUrl(path: string, pathname: string): string` — resolves `path` (e.g. `"api/snapshot"`) against the directory of `pathname` (strips the trailing filename segment). `/opentree/OpenTree.html` → `/opentree/api/snapshot`; `/OpenTree.html` → `/api/snapshot`; `/opentree/` → `/opentree/api/snapshot`.
  - `fetchArchitecture()` — now uses `apiUrl("api/snapshot", location.pathname)`.
  - `refreshArchitecture()` — `POST` to `apiUrl("api/refresh", location.pathname)`, updates `NOW`, returns the snapshot.

- [ ] **Step 1: Write the failing test**

```js
// opentree-agent/test/data-path.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { apiUrl } from "../../inspector/data.js";

test("resolves api path under a gateway prefix with a filename", () => {
  assert.equal(
    apiUrl("api/snapshot", "/opentree/OpenTree.html"),
    "/opentree/api/snapshot",
  );
});

test("resolves api path at the server root", () => {
  assert.equal(apiUrl("api/snapshot", "/OpenTree.html"), "/api/snapshot");
});

test("resolves api path for a directory root with trailing slash", () => {
  assert.equal(apiUrl("api/refresh", "/opentree/"), "/opentree/api/refresh");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test opentree-agent/test/data-path.test.mjs`
Expected: FAIL — `apiUrl` is not exported.

- [ ] **Step 3: Modify `inspector/data.js`**

Replace lines 1–12 (the header + `fetchArchitecture`) with:

```js
// Live data source — fetches the real architecture snapshot from the agent.
// NOW is a mutable live binding: content.js/scene-v2.js import it; fetchArchitecture
// updates it before the scene renders, so relative dates use the server clock.
export let NOW = Date.now();

export function apiUrl(path, pathname) {
  const dir = pathname.replace(/[^/]*$/, "");
  return dir + path;
}

export async function fetchArchitecture() {
  const res = await fetch(apiUrl("api/snapshot", location.pathname));
  if (!res.ok) throw new Error("snapshot HTTP " + res.status);
  const snap = await res.json();
  NOW = snap.generatedAt || Date.now();
  return snap;
}

export async function refreshArchitecture() {
  const res = await fetch(apiUrl("api/refresh", location.pathname), {
    method: "POST",
  });
  if (!res.ok) throw new Error("refresh HTTP " + res.status);
  const snap = await res.json();
  NOW = snap.generatedAt || Date.now();
  return snap;
}
```

(Leave `flatten` unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test opentree-agent/test/data-path.test.mjs`
Expected: PASS — 3 tests. (`apiUrl` is a pure function; the `location`/`fetch` references in the other exports are not evaluated at import time.)

- [ ] **Step 5: Commit**

```bash
git add inspector/data.js opentree-agent/test/data-path.test.mjs
git commit -m "feat(viewer): resolve API paths relative to the served prefix + refresh fetch"
```

---

## Task 6: Front refresh button

**Files:**

- Modify: `inspector/OpenTree.html` (add the button in the topbar near `#reset-view`, line ~1322)
- Modify: `inspector/main-v2.js` (wire the click; near the other `$("#...").addEventListener` calls, line ~196)

**Interfaces:**

- Consumes: `refreshArchitecture` (Task 5).
- Produces: a `#refresh-btn` topbar button that, on click, forces a server rebuild then reloads the viewer with fresh data, showing a busy state meanwhile.

- [ ] **Step 1: Add the button to the topbar**

In `inspector/OpenTree.html`, immediately before the `#reset-view` button (currently around line 1322), add:

```html
<button class="icon-btn" id="refresh-btn" title="Mettre à jour les données">
  ⟳
</button>
```

- [ ] **Step 2: Import `refreshArchitecture` and wire the click**

In `inspector/main-v2.js`, extend the existing import on line 11:

```js
import { fetchArchitecture, refreshArchitecture } from "./data.js";
```

Then, next to the other topbar handlers (around line 196), add:

```js
$("#refresh-btn").addEventListener("click", async () => {
  const btn = $("#refresh-btn");
  if (btn.classList.contains("busy")) return;
  btn.classList.add("busy");
  btn.disabled = true;
  try {
    await refreshArchitecture();
    location.reload();
  } catch (err) {
    console.error("[opentree] refresh failed:", err);
    btn.classList.remove("busy");
    btn.disabled = false;
  }
});
```

Rationale: `refreshArchitecture()` forces the server-side rebuild (updates the cache); `location.reload()` then re-fetches the now-fresh cached snapshot and rebuilds the scene cleanly without manual THREE teardown. Camera state is lost on reload — acceptable for the MVP (a hot-swap without reload is a future enhancement).

- [ ] **Step 3: Add a minimal busy style**

In `inspector/OpenTree.html`, in the topbar/icon-btn CSS area, add:

```css
.icon-btn.busy {
  opacity: 0.5;
  pointer-events: none;
}
```

- [ ] **Step 4: Manual verification**

Run the standalone server and confirm the button works end-to-end:

```bash
node opentree-agent/opentree-agent.mjs
# open http://127.0.0.1:7070/  → click ⟳ → button dims, page reloads with fresh data
```

Expected: clicking ⟳ issues `POST /api/refresh` (visible in the server logs / network tab), the button shows the busy state, then the page reloads. Confirm no console errors.

- [ ] **Step 5: Commit**

```bash
git add inspector/OpenTree.html inspector/main-v2.js
git commit -m "feat(viewer): add refresh button that forces a server rebuild"
```

---

## Task 7: Deployment README

**Files:**

- Create: `opentree-agent/README.md`

**Interfaces:**

- Consumes: the whole plugin.
- Produces: deployment documentation. No code, no test — a single reviewer-gateable doc deliverable.

- [ ] **Step 1: Write the README**

```markdown
# OpenTree — OpenClaw plugin

Serves the OpenTree architecture visualiser through the OpenClaw gateway,
behind the gateway password, reachable from your own devices over Tailscale.

## Build

    cd opentree-agent
    npm install        # installs the OpenClaw SDK dev dependency
    npm run build      # emits dist/index.js (the plugin entry)

## Install on the VPS

The plugin entry is `dist/index.js` (declared in `package.json` → `openclaw.extensions`).
Install it into the running OpenClaw on the Hetzner host:

    openclaw plugins install <path-or-clawhub-or-git-spec>

(Local path install is the simplest here. ClawHub publishing additionally
requires `openclaw.compat` and `openclaw.build` fields in `package.json` — out
of scope for a private single-host deploy.)

## Protect with a password

In the gateway config, enable password auth:

    gateway:
      auth:
        mode: password

Set the password via env:

    export OPENCLAW_GATEWAY_PASSWORD='<your-strong-password>'

All OpenTree routes register with `auth: "gateway"`, so they inherit this password.
Note: this password also guards the gateway Control UI — acceptable here because
you are the only operator.

## Reach it permanently over Tailscale (free)

The gateway listens on 127.0.0.1:18789. Expose it to your tailnet only:

    tailscale serve --bg 18789

Then open `https://<host>.<tailnet>.ts.net/opentree/` from any of your devices,
enter the password, and use the ⟳ button to refresh the data on demand.

## Configuration (env)

| Var                  | Default                | Meaning                                    |
| -------------------- | ---------------------- | ------------------------------------------ |
| `OPENTREE_HOST_ROOT` | `~/openclaw`           | Root directory walked for the host island. |
| `OPENTREE_HOST_NAME` | `~/openclaw`           | Display name of the host root.             |
| `OPENTREE_DATA`      | `<plugin>/.data`       | State dir (events.ndjson).                 |
| `DOCKER_SOCKET`      | `/var/run/docker.sock` | Docker socket for container islands.       |
```

- [ ] **Step 2: Commit**

```bash
git add opentree-agent/README.md
git commit -m "docs(plugin): deployment README (gateway password + Tailscale Serve)"
```

---

## Self-Review

**Spec coverage:**

- Plugin packaging (`registerHttpRoute`/`definePluginEntry`) → Task 4. ✅
- `auth: "gateway"` password → Task 4 (route) + Task 7 (config). ✅
- Cache + force-refresh → Task 1 (cache), Task 3 (routes), Task 6 (button). ✅
- Watcher lifecycle via `registerService` → Task 4. ✅
- `events.ndjson` rotation → Task 2. ✅
- Front base-path + refresh → Task 5, Task 6. ✅
- Tailscale + password deployment → Task 7. ✅
- Tests preserved + extended → every task ends in `node --test`. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The one genuine unknown (exact SDK import specifier) is handled by an explicit verification micro-step in Task 4 Step 1, not a placeholder.

**Type consistency:** `createSnapshotCache({build})→{get,refresh,peek}` used identically in Tasks 1/3/4. `createRequestHandler({staticDir,cache,prefix})` used in Tasks 3/4. `startWatcher(...)→{close()}` consistent across Tasks 2/4 and `opentree-agent.mjs`. `apiUrl(path,pathname)` / `refreshArchitecture()` consistent across Tasks 5/6.

**Known residual risks (flagged, not invented):**

1. Exact SDK import specifier (`openclaw/plugin-sdk/plugin-entry` vs `@openclaw/plugin-sdk/...`) — verified live in Task 4 Step 1.
2. Whether the gateway requires viewer assets bundled inside the package for non-local installs — noted in Task 4 Step 5 / Task 7; local install path is the supported target.
3. Nothing has run on the real Hetzner VPS yet — out of scope, post-implementation.
