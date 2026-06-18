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
