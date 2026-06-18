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
    .map((l) => l.replace(/\r$/, ""))
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
      (err, stdout) => resolve(stdout || ""),
    );
  });
}
