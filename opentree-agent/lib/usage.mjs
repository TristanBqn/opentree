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
  if (node.children) {
    for (const c of node.children) applyUsage(c, eventsMap, nowMs);
  }
}
