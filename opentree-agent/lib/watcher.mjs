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
