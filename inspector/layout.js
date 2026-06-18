// Pure-math 3D tree layout (multi-îlots). No THREE dependency.

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

function hash(n) {
  let h = 2166136261 ^ n.id;
  h = Math.imul(h ^ (h >>> 13), 16777619);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function basis(dir) {
  let up = Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(dir, up));
  const v = norm(cross(dir, u));
  return [u, v];
}

export function layout(root, opts = {}) {
  const o = Object.assign({
    rootLen: 10, decay: 0.66, rootSpread: 1.5, childSpread: 0.9,
    fileSpread: 0.5, lengthByMass: 0.5,
  }, opts);

  root.pos = [0, 0, 0];
  root.dir = [0, 1, 0];

  function place(node) {
    if (node.type !== 'dir') return;
    const childDirs = node.children.filter((c) => c.type === 'dir');
    const childFiles = node.children.filter((c) => c.type === 'file');
    const [U, V] = basis(node.dir);
    const phase = hash(node) * Math.PI * 2;
    const spread = node.depth === 0 ? o.rootSpread : o.childSpread * Math.pow(0.92, node.depth);

    const n = childDirs.length;
    childDirs.forEach((c, i) => {
      const theta = n <= 1 ? spread * 0.35 : spread * Math.sqrt((i + 0.5) / n);
      const phi = i * GOLDEN + phase;
      const dir = norm(add(scale(node.dir, Math.cos(theta)),
        add(scale(U, Math.sin(theta) * Math.cos(phi)), scale(V, Math.sin(theta) * Math.sin(phi)))));
      const mass = Math.log2(c.count + 2);
      const baseLen = o.rootLen * Math.pow(o.decay, node.depth);
      const len = baseLen * (1 + o.lengthByMass * (mass / 6)) * (0.82 + hash(c) * 0.4);
      c.dir = dir;
      c.pos = add(node.pos, scale(dir, len));
      c.branchLen = len;
      place(c);
    });

    const fc = childFiles.length;
    const tip = node.pos;
    childFiles.forEach((f, i) => {
      const t = (i + 0.5) / Math.max(fc, 1);
      const theta = Math.acos(1 - 2 * t);
      const phi = i * GOLDEN + phase * 1.7;
      const sph = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      const r = o.fileSpread * (1.1 + Math.log2(fc + 2) * 0.5) * (0.6 + hash(f) * 0.9);
      const local = add(scale(node.dir, sph[1] * 0.6), add(scale(U, sph[0]), scale(V, sph[2])));
      f.pos = add(tip, scale(norm(local), r));
      f.dir = node.dir;
    });
  }
  place(root);
  return root;
}

export function translate(root, off) {
  (function w(n) {
    if (n.pos) n.pos = [n.pos[0] + off[0], n.pos[1] + off[1], n.pos[2] + off[2]];
    n.children?.forEach(w);
  })(root);
}

// L'hôte est éclaté en branches (les gros dossiers de premier niveau lisibles
// comme modules colorés) ; chaque container = UNE branche (une couleur).
function selectBranchRoots(root) {
  const roots = [];
  const tops = root.children.filter((c) => c.type === 'dir');
  const total = root.count;
  for (const d of tops) {
    const childDirs = d.children.filter((c) => c.type === 'dir');
    if (d.count > total * 0.16 && childDirs.length >= 3) {
      for (const cd of childDirs) roots.push(cd);
      if (d.children.some((c) => c.type === 'file')) roots.push(d);
    } else {
      roots.push(d);
    }
  }
  return roots;
}

export function assignBranchesMulti(islands, paletteLen) {
  const entries = []; // {node, islandId, label}
  for (const isl of islands) {
    if (isl.kind === 'host') {
      selectBranchRoots(isl.root).forEach((r) => {
        const parts = r.path.split('/');
        entries.push({ node: r, islandId: isl.id, label: parts.length > 2 ? parts.slice(-2).join('/') : r.name });
      });
    } else {
      entries.push({ node: isl.root, islandId: isl.id, label: isl.name });
    }
  }
  const stride = 3;
  const cidxByBid = entries.map((_, i) => (i * stride) % paletteLen);
  const map = new Map(); entries.forEach((e, i) => map.set(e.node, i));
  for (const isl of islands) {
    (function tag(n, bid) {
      if (map.has(n)) bid = map.get(n);
      n.bid = bid; n.cidx = bid < 0 ? -1 : cidxByBid[bid];
      if (n.children) n.children.forEach((c) => tag(c, bid));
    })(isl.root, -1);
  }
  return entries.map((e, i) => ({
    node: e.node, bid: i, cidx: cidxByBid[i],
    name: e.label, count: e.node.count, islandId: e.islandId,
  }));
}
