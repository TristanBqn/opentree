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
