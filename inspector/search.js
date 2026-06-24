// Pure search & isolation helpers — no DOM, no THREE.
// Imported by scene-v2.js (browser) and unit-tested via node --test.

export function nameMatches(node, q) {
  return !!q && node.name.toLowerCase().includes(q);
}

export function collectSubtrees(nodes) {
  const files = new Set();
  const dirs = new Set();
  const walk = (n) => {
    if (n.type === "dir") {
      dirs.add(n);
      if (n.children) for (const c of n.children) walk(c);
    } else {
      files.add(n);
    }
  };
  for (const n of nodes) walk(n);
  return { files, dirs };
}

export function centroidRadius(points) {
  if (!points.length) return null;
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= points.length;
  cy /= points.length;
  cz /= points.length;
  let r = 0;
  for (const p of points) {
    r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
  }
  return { cx, cy, cz, r };
}
