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
