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
  const R = 32;
  for (let i = 0; i < ring; i++) {
    const a = (i / Math.max(1, ring)) * Math.PI * 2 + 0.4; // 0.4 rad: avoid placing the first ring island on the +X axis
    out.push([Math.round(Math.cos(a) * R), 0, Math.round(Math.sin(a) * R)]);
  }
  return out.slice(0, count);
}

export function parseHosts(rootStr, nameStr, rootLen = 13) {
  const roots = String(rootStr)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const names = String(nameStr || "")
    .split(",")
    .map((s) => s.trim());
  return roots.map((root, i) => ({
    root,
    name: names[i] || root.split("/").filter(Boolean).pop() || root,
    rootLen,
  }));
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
  return { stats, ports: disk || "disque indisponible" };
}

async function tagAndAnnotate(island, nowMs) {
  annotate(island.root, 0, nowMs);
  (function tag(n) {
    n.iid = island.id;
    n.children?.forEach(tag);
  })(island.root);
  return island;
}

export async function buildSnapshot({ hosts, dataDir, socketPath, now }) {
  let nextIdN = 0;
  const nextId = () => ++nextIdN;
  const islands = [];

  // --- hosts --------------------------------------------------------------
  let eventsText = "";
  try {
    eventsText = await readFile(join(dataDir, "events.ndjson"), "utf8");
  } catch {
    /* no log yet */
  }
  const eventsMap = parseEventsNdjson(eventsText, now);
  const hs = await hostStats();
  for (let i = 0; i < hosts.length; i++) {
    const h = hosts[i];
    const tree = await walkDir(h.root, {
      rootName: h.name,
      exclude: EXCLUDE,
      nextId,
    });
    applyUsage(tree, eventsMap, now);
    islands.push({
      id: i === 0 ? "host" : h.name,
      kind: "host",
      name: h.name.replace(/^~\//, ""),
      status: "ok",
      statusTxt: "en ligne",
      stats: hs.stats,
      ports: hs.ports,
      rootLen: h.rootLen ?? 10,
      origin: [0, 0, 0],
      root: tree,
    });
  }

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
      rootLen: 7.5,
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
