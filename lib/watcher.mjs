import { watch } from "node:fs";
import { appendFile } from "node:fs/promises";
import { rotateEventsFile } from "./rotate.mjs";

export function formatEventLine(nowMs, displayPath) {
  return JSON.stringify({ ts: nowMs, path: displayPath }) + "\n";
}

function watchRoot(absRoot, rootName, eventsPath) {
  try {
    const watcher = watch(absRoot, { recursive: true }, (_evt, filename) => {
      if (!filename) return;
      const rel = filename.toString().replace(/\\/g, "/");
      if (rel.includes("node_modules") || rel.includes(".git")) return;
      const displayPath = rootName + "/" + rel;
      appendFile(eventsPath, formatEventLine(Date.now(), displayPath)).catch(
        () => {},
      );
    });
    watcher.on("error", () => {});
    return watcher;
  } catch (err) {
    console.warn(
      `[opentree] fs.watch unavailable for ${rootName}, mtime only:`,
      err.message,
    );
    return null;
  }
}

export function startWatcher({
  roots,
  absRoot,
  rootName,
  eventsPath,
  retentionDays = 30,
}) {
  // un seul propriétaire de la rotation (le .tmp est partagé entre racines)
  rotateEventsFile(eventsPath, Date.now(), retentionDays).catch(() => {});
  const rotateTimer = setInterval(
    () =>
      rotateEventsFile(eventsPath, Date.now(), retentionDays).catch(() => {}),
    86400000,
  );
  rotateTimer.unref?.();

  const list = roots ?? [{ absRoot, rootName }];
  const watchers = list
    .map((r) => watchRoot(r.absRoot, r.rootName, eventsPath))
    .filter(Boolean);

  return {
    close() {
      clearInterval(rotateTimer);
      watchers.forEach((w) => w.close?.());
    },
  };
}
