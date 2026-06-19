// Pure-math 3D tree layout. No THREE dependency.
// Assigns world-space positions to every dir and file node.

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// deterministic per-node hash → 0..1
function hash(n) {
  let h = 2166136261 ^ n.id;
  h = Math.imul(h ^ (h >>> 13), 16777619);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function basis(dir) {
  // build U,V orthonormal to dir
  let up = Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(dir, up));
  const v = norm(cross(dir, u));
  return [u, v];
}

export function layout(root, opts = {}) {
  const o = Object.assign(
    {
      rootLen: 10,
      decay: 0.66,
      rootSpread: 1.5,
      childSpread: 0.9,
      fileSpread: 0.5,
      lengthByMass: 0.5,
    },
    opts,
  );

  root.pos = [0, 0, 0];
  root.dir = [0, 1, 0];

  function place(node) {
    if (node.type !== "dir") return;
    const childDirs = node.children.filter((c) => c.type === "dir");
    const childFiles = node.children.filter((c) => c.type === "file");
    const [U, V] = basis(node.dir);
    const phase = hash(node) * Math.PI * 2;
    const spread =
      node.depth === 0
        ? o.rootSpread
        : o.childSpread * Math.pow(0.92, node.depth);

    // place sub-directories
    const n = childDirs.length;
    childDirs.forEach((c, i) => {
      const theta = n <= 1 ? spread * 0.35 : spread * Math.sqrt((i + 0.5) / n);
      const phi = i * GOLDEN + phase;
      const dir = norm(
        add(
          scale(node.dir, Math.cos(theta)),
          add(
            scale(U, Math.sin(theta) * Math.cos(phi)),
            scale(V, Math.sin(theta) * Math.sin(phi)),
          ),
        ),
      );
      const mass = Math.log2(c.count + 2);
      const baseLen = o.rootLen * Math.pow(o.decay, node.depth);
      const len =
        baseLen * (1 + o.lengthByMass * (mass / 6)) * (0.82 + hash(c) * 0.4);
      c.dir = dir;
      c.pos = add(node.pos, scale(dir, len));
      c.branchLen = len;
      place(c);
    });

    // scatter direct files as a leaf-cluster around node.pos, biased along node.dir tip
    const fc = childFiles.length;
    const tip = add(node.pos, scale(node.dir, node.depth === 0 ? 0 : 0.0));
    childFiles.forEach((f, i) => {
      const t = (i + 0.5) / Math.max(fc, 1);
      const theta = Math.acos(1 - 2 * t); // fibonacci sphere
      const phi = i * GOLDEN + phase * 1.7;
      const sph = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      ];
      const r =
        o.fileSpread * (1.1 + Math.log2(fc + 2) * 0.5) * (0.6 + hash(f) * 0.9);
      // orient cluster in node's local frame, flatten slightly across the branch
      const local = add(
        scale(node.dir, sph[1] * 0.6),
        add(scale(U, sph[0]), scale(V, sph[2])),
      );
      f.pos = add(tip, scale(norm(local), r));
      f.dir = node.dir;
    });
  }
  place(root);
  return root;
}

// Choose "branch roots": top-level dirs, but expand the big ones into their
// sub-directories so a project dominated by src/ still reads as many colored
// modules (like the reference image) instead of one monochrome blob.
function selectBranchRoots(root) {
  const roots = [];
  const tops = root.children.filter((c) => c.type === "dir");
  const total = root.count;
  for (const d of tops) {
    const childDirs = d.children.filter((c) => c.type === "dir");
    if (d.count > total * 0.16 && childDirs.length >= 3) {
      for (const cd of childDirs) roots.push(cd);
      if (d.children.some((c) => c.type === "file")) roots.push(d); // d hosts its own loose files
    } else {
      roots.push(d);
    }
  }
  return roots;
}

// Tag every node with bid (branch id) + cidx (color index). Returns branch list.
export function assignBranches(root, paletteLen) {
  const roots = selectBranchRoots(root);
  const stride = 3; // spread hues so neighbours rarely share a color
  const cidxByBid = roots.map((_, i) => (i * stride) % paletteLen);
  const map = new Map();
  roots.forEach((r, i) => map.set(r, i));
  (function tag(n, bid) {
    if (map.has(n)) bid = map.get(n);
    n.bid = bid;
    n.cidx = bid < 0 ? -1 : cidxByBid[bid];
    if (n.children) n.children.forEach((c) => tag(c, bid));
  })(root, -1);
  return roots.map((r, i) => {
    const parts = r.path.split("/");
    return {
      node: r,
      bid: i,
      cidx: cidxByBid[i],
      name: parts.length > 2 ? parts.slice(-2).join("/") : r.name,
      count: r.count,
    };
  });
}
