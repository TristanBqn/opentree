// Live data source — fetches the real architecture snapshot from the agent.
// NOW is a mutable live binding: content.js/scene-v2.js import it; fetchArchitecture
// updates it before the scene renders, so relative dates use the server clock.
export let NOW = Date.now();

export async function fetchArchitecture() {
  const res = await fetch("/api/snapshot");
  if (!res.ok) throw new Error("snapshot HTTP " + res.status);
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
