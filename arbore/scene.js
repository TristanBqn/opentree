import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/addons/renderers/CSS2DRenderer.js";
import { buildProject, flatten } from "./data.js";
import { layout, assignBranches } from "./layout.js";
import { THEMES } from "./themes.js";

// ---- soft round sprite texture ------------------------------------------
function discTexture(soft = 0.5) {
  const s = 64,
    c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(soft, "rgba(255,255,255,0.85)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}
function glowTexture() {
  const s = 128,
    c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.45)");
  grd.addColorStop(0.6, "rgba(255,255,255,0.12)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

export function createScene(container, callbacks = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.inset = "0";
  labelRenderer.domElement.style.pointerEvents = "none"; // Crucial: laisse les events passer au canvas
  labelRenderer.domElement.className = "label-layer";
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 0.9;
  controls.minDistance = 4;
  controls.maxDistance = 120;
  controls.enablePan = true;
  controls.panSpeed = 0.6;
  controls.enableZoom = false; // zoom géré manuellement (delta molette/trackpad normalisé)
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.5; // Reduced from default 2 for slower rotation
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  // ---- Zoom manuel : pas fixe par cran, indépendant de l'amplitude du delta ----
  renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      // chaque cran = facteur constant ; la direction seule compte, pas l'amplitude
      const step = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      const offset = camera.position.clone().sub(controls.target);
      let dist = offset.length() * step;
      dist = Math.max(
        controls.minDistance,
        Math.min(controls.maxDistance, dist),
      );
      offset.setLength(dist);
      camera.position.copy(controls.target).add(offset);
    },
    { passive: false },
  );

  // ---- Spacebar pan mode (like Photoshop) ----
  let spaceHeld = false;
  function enterSpaceMode() {
    if (spaceHeld) return;
    spaceHeld = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    renderer.domElement.style.cursor = "grab";
    container.setAttribute("data-space", "");
  }
  function exitSpaceMode() {
    if (!spaceHeld) return;
    spaceHeld = false;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    renderer.domElement.style.cursor = "";
    container.removeAttribute("data-space");
  }
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      enterSpaceMode();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") exitSpaceMode();
  });
  // Also exit if window loses focus (e.g. alt-tab)
  window.addEventListener("blur", exitSpaceMode);
  renderer.domElement.addEventListener("pointerdown", () => {
    if (spaceHeld) renderer.domElement.style.cursor = "grabbing";
  });
  renderer.domElement.addEventListener("pointerup", () => {
    if (spaceHeld) renderer.domElement.style.cursor = "grab";
  });
  function enterSpaceMode() {
    if (spaceHeld) return;
    spaceHeld = true;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.dataset.spacePan = "1";
  }
  function exitSpaceMode() {
    if (!spaceHeld) return;
    spaceHeld = false;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    renderer.domElement.style.cursor = "";
    delete renderer.domElement.dataset.spacePan;
  }
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement?.tagName !== "INPUT") {
      e.preventDefault();
      enterSpaceMode();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") exitSpaceMode();
  });
  // If window loses focus while space held, release
  window.addEventListener("blur", exitSpaceMode);
  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (spaceHeld) renderer.domElement.style.cursor = "grabbing";
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (spaceHeld) renderer.domElement.style.cursor = "grab";
  });

  // ---- data + layout ----
  let theme = THEMES.parchment;
  let opts = {
    glow: 1,
    curve: 1,
    fileSize: 1,
    labelDepth: 1,
    autoRotate: false,
  };
  const root = buildProject();
  layout(root);
  const branches = assignBranches(root, theme.palette.length); // [{node,bid,cidx,name,count}]
  const { dirs, files } = flatten(root);

  // ---- auto-fit camera to the bulk of the tree (percentile radius) ----
  const centroid = new THREE.Vector3();
  files.forEach((f) => centroid.add(new THREE.Vector3(...f.pos)));
  centroid.multiplyScalar(1 / files.length);
  const dists = files
    .map((f) => centroid.distanceTo(new THREE.Vector3(...f.pos)))
    .sort((a, b) => a - b);
  const sphereR = Math.max(8, dists[Math.floor(dists.length * 0.88)] || 12);
  const fitDist = (sphereR / Math.sin((camera.fov * Math.PI) / 180 / 2)) * 1.05;
  const VIEW_DIR = new THREE.Vector3(0.45, 0.32, 1).normalize();
  const HOME = centroid.clone().add(VIEW_DIR.clone().multiplyScalar(fitDist));
  camera.position.copy(HOME);
  controls.maxDistance = fitDist * 2.6;
  controls.target.copy(centroid);

  const discTex = discTexture(),
    glowTex = glowTexture();
  const sceneRoot = new THREE.Group();
  scene.add(sceneRoot);

  // ===== BRANCHES (LineSegments grouped by top-level branch) =============
  const branchSegGroups = []; // [{idx, line}]
  function buildBranches() {
    branchSegGroups.length = 0;
    const byBranch = new Map();
    function curveSamples(a, b, seed) {
      const A = new THREE.Vector3(...a),
        B = new THREE.Vector3(...b);
      const mid = A.clone().add(B).multiplyScalar(0.5);
      const dir = B.clone().sub(A);
      const len = dir.length();
      const perp = new THREE.Vector3(dir.y, -dir.x, dir.z * 0.3).normalize();
      const bend = ((seed * 9301 + 49297) % 233280) / 233280 - 0.5;
      mid.addScaledVector(perp, bend * len * 0.22 * opts.curve);
      const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
      return curve.getPoints(14);
    }
    function walk(node) {
      if (!node.children) return;
      for (const c of node.children) {
        if (c.type === "dir") {
          const pts = curveSamples(node.pos, c.pos, c.id);
          const bi = c.bid < 0 ? -1 : c.bid;
          if (!byBranch.has(bi)) byBranch.set(bi, []);
          const arr = byBranch.get(bi);
          for (let i = 0; i < pts.length - 1; i++) {
            arr.push(pts[i], pts[i + 1]);
          }
          walk(c);
        }
      }
    }
    walk(root);
    byBranch.forEach((verts, bi) => {
      const geo = new THREE.BufferGeometry().setFromPoints(verts);
      const mat = new THREE.LineBasicMaterial({
        transparent: true,
        depthWrite: false,
      });
      const line = new THREE.LineSegments(geo, mat);
      line.userData.bid = bi;
      sceneRoot.add(line);
      branchSegGroups.push({ bid: bi, line });
    });
  }

  // ===== FILE POINTS (single Points, vertex colors) =====================
  let points,
    basePos,
    baseCol,
    fileBranch = [];
  function buildPoints() {
    const n = files.length;
    basePos = new Float32Array(n * 3);
    baseCol = new Float32Array(n * 3);
    fileBranch = new Array(n);
    files.forEach((f, i) => {
      basePos[i * 3] = f.pos[0];
      basePos[i * 3 + 1] = f.pos[1];
      basePos[i * 3 + 2] = f.pos[2];
      fileBranch[i] = f.bid;
      f._i = i;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(basePos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(baseCol, 3));
    const mat = new THREE.PointsMaterial({
      map: discTex,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.02,
      sizeAttenuation: true,
      depthWrite: false,
    });
    points = new THREE.Points(geo, mat);
    sceneRoot.add(points);
  }

  // ===== GLOW SPRITES per branch ========================================
  let glowSprites = [];
  function buildGlows() {
    glowSprites.forEach((s) => sceneRoot.remove(s));
    glowSprites = [];
    branches.forEach((b) => {
      let k = 0,
        maxd = 0;
      const ctr = new THREE.Vector3();
      files.forEach((f) => {
        if (f.bid === b.bid) {
          ctr.add(new THREE.Vector3(...f.pos));
          k++;
        }
      });
      if (k === 0) return;
      ctr.multiplyScalar(1 / k);
      files.forEach((f) => {
        if (f.bid === b.bid)
          maxd = Math.max(maxd, ctr.distanceTo(new THREE.Vector3(...f.pos)));
      });
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          transparent: true,
          depthWrite: false,
          depthTest: false,
        }),
      );
      sp.position.copy(ctr);
      sp.userData = {
        bid: b.bid,
        cidx: b.cidx,
        baseScale: Math.max(5, maxd * 2.2),
      };
      sceneRoot.add(sp);
      glowSprites.push(sp);
    });
  }
  // map a node → its branch-root node
  function topBranchOf(node) {
    return node.bid == null || node.bid < 0 ? null : branches[node.bid].node;
  }

  // ===== LABELS (CSS2D) =================================================
  let labels = []; // {obj, node, el}
  function buildLabels() {
    labels.forEach((l) => sceneRoot.remove(l.obj));
    labels = [];
    dirs.forEach((d) => {
      if (d.depth === 0) return; // skip project root label
      const el = document.createElement("div");
      el.className = "node-label";
      el.dataset.bid = d.bid;
      el.dataset.depth = d.depth;
      el.style.setProperty(
        "--c",
        "#" +
          theme.palette[d.cidx < 0 ? 0 : d.cidx].toString(16).padStart(6, "0"),
      );
      el.innerHTML = `<span class="lbl-name">${d.name}</span><span class="lbl-bar"></span>`;
      el.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        callbacks.onLabel?.(d);
      });
      const obj = new CSS2DObject(el);
      obj.position.set(...d.pos);
      sceneRoot.add(obj);
      labels.push({ obj, node: d, el });
    });
  }

  // ===== COLORS / THEME =================================================
  function applyColors() {
    const dim = new THREE.Color(theme.file.dim);
    for (let i = 0; i < files.length; i++) {
      const bi = fileBranch[i];
      const hex = bi < 0 ? theme.misc : theme.palette[branches[bi].cidx];
      const col = new THREE.Color(hex);
      baseCol[i * 3] = col.r;
      baseCol[i * 3 + 1] = col.g;
      baseCol[i * 3 + 2] = col.b;
    }
    points.geometry.attributes.color.array.set(baseCol);
    points.geometry.attributes.color.needsUpdate = true;
    points.material.size = theme.file.size * opts.fileSize;
    points.material.blending =
      theme.file.blend === "additive"
        ? THREE.AdditiveBlending
        : THREE.NormalBlending;
    points.material.needsUpdate = true;
    branchSegGroups.forEach(({ line }) => {
      line.material.color = new THREE.Color(theme.branch.color);
      line.material.opacity = theme.branch.opacity;
    });
    glowSprites.forEach((sp) => {
      sp.material.color = new THREE.Color(theme.palette[sp.userData.cidx]);
      sp.material.opacity = theme.glow.opacity * opts.glow;
      sp.material.blending =
        theme.glow.blend === "additive"
          ? THREE.AdditiveBlending
          : THREE.NormalBlending;
      const s = sp.userData.baseScale * theme.glow.size;
      sp.scale.set(s, s, 1);
    });
    scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
    labels.forEach((l) =>
      l.el.style.setProperty(
        "--c",
        "#" +
          theme.palette[l.node.cidx < 0 ? 0 : l.node.cidx]
            .toString(16)
            .padStart(6, "0"),
      ),
    );
  }

  // ===== STATE: isolate + search =======================================
  let isolated = null; // branch node or null
  let query = "";
  function fileVisible(f) {
    if (isolated && topBranchOf(f) !== isolated) return false;
    if (query && !f.path.toLowerCase().includes(query)) return false;
    return true;
  }
  function refresh() {
    const dim = new THREE.Color(theme.file.dim);
    const col = points.geometry.attributes.color.array;
    let nMatch = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const vis = fileVisible(f);
      if (vis) {
        col[i * 3] = baseCol[i * 3];
        col[i * 3 + 1] = baseCol[i * 3 + 1];
        col[i * 3 + 2] = baseCol[i * 3 + 2];
        if (query) nMatch++;
      } else {
        const t = isolated ? 0.06 : 0.14;
        col[i * 3] = THREE.MathUtils.lerp(dim.r, baseCol[i * 3], t);
        col[i * 3 + 1] = THREE.MathUtils.lerp(dim.g, baseCol[i * 3 + 1], t);
        col[i * 3 + 2] = THREE.MathUtils.lerp(dim.b, baseCol[i * 3 + 2], t);
      }
    }
    points.geometry.attributes.color.needsUpdate = true;
    // branch lines
    branchSegGroups.forEach(({ bid, line }) => {
      const on = !isolated || isolated.bid === bid;
      line.material.opacity = theme.branch.opacity * (on ? 1 : 0.1);
    });
    glowSprites.forEach((sp) => {
      const on = !isolated || isolated.bid === sp.userData.bid;
      sp.material.opacity =
        theme.glow.opacity * opts.glow * (on ? 1 : 0.06) * (query ? 0.4 : 1);
    });
    // labels
    labels.forEach((l) => {
      const d = l.node;
      const topNode = topBranchOf(d);
      const branchOn = !isolated || topNode === isolated;
      const depthOn =
        d.depth <= opts.labelDepth ||
        (isolated && topNode === isolated && d.depth <= opts.labelDepth + 2);
      l.el.classList.toggle("hidden", !(branchOn && depthOn));
      l.el.classList.toggle("dim", isolated && !branchOn);
    });
    callbacks.onCounts?.({
      match: query ? nMatch : files.length,
      total: files.length,
      isolated: isolated ? isolated.name : null,
    });
  }

  function setTheme(key) {
    theme = THEMES[key];
    applyColors();
    refresh();
  }
  function setOption(k, v) {
    opts[k] = v;
    if (k === "autoRotate") controls.autoRotate = v;
    if (k === "curve") {
      branchSegGroups.forEach(({ line }) => sceneRoot.remove(line));
      buildBranches();
    }
    if (k === "glow" || k === "fileSize") applyColors();
    refresh();
  }
  function setIsolated(node) {
    isolated = node;
    refresh();
    if (node) flyTo(node);
  }
  function setQuery(q) {
    query = (q || "").trim().toLowerCase();
    refresh();
  }

  // ===== camera fly ====================================================
  let tween = null;
  function flyTo(node) {
    const target = new THREE.Vector3(...node.pos);
    // include subtree centroid for nicer framing
    const c = new THREE.Vector3();
    let k = 0;
    (function w(n) {
      if (n.type === "file") {
        c.add(new THREE.Vector3(...n.pos));
        k++;
      } else n.children?.forEach(w);
    })(node);
    if (k) {
      c.multiplyScalar(1 / k);
      target.lerp(c, 0.6);
    }
    const dist = node.depth <= 1 ? 26 : 16;
    const dirToCam = camera.position.clone().sub(controls.target).normalize();
    const camTo = target.clone().add(dirToCam.multiplyScalar(dist));
    tween = {
      t: 0,
      fromT: controls.target.clone(),
      toT: target,
      fromC: camera.position.clone(),
      toC: camTo,
    };
  }
  function resetView() {
    isolated = null;
    refresh();
    tween = {
      t: 0,
      fromT: controls.target.clone(),
      toT: centroid.clone(),
      fromC: camera.position.clone(),
      toC: HOME.clone(),
    };
  }

  // ===== picking =======================================================
  // ===== picking =======================================================
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = -1;
  function pick(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    ray.params.Points.threshold = theme.file.size * opts.fileSize * 0.9;
    const hits = ray.intersectObject(points, false);
    for (const h of hits) {
      if (fileVisible(files[h.index])) return h.index;
    }
    return -1;
  }
  // Route all interactions through the renderer canvas
  // (label layer has pointerEvents: none so it doesn't block)
  const raycanvas = renderer.domElement;
  raycanvas.addEventListener("pointermove", (e) => {
    const i = pick(e.clientX, e.clientY);
    hovered = i;
    raycanvas.style.cursor = i >= 0 ? "pointer" : "grab";
    callbacks.onHover?.(i >= 0 ? files[i] : null, e.clientX, e.clientY);
  });
  let downXY = null;
  raycanvas.addEventListener("pointerdown", (e) => {
    downXY = [e.clientX, e.clientY];
  });
  raycanvas.addEventListener("pointerup", (e) => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
    downXY = null;
    if (moved > 5) return;
    const i = pick(e.clientX, e.clientY);
    if (i >= 0) callbacks.onPick?.(files[i]);
    else callbacks.onEmpty?.();
  });

  // ===== build + start =================================================
  buildBranches();
  buildPoints();
  buildGlows();
  buildLabels();
  applyColors();
  refresh();

  function resize() {
    const w = container.clientWidth,
      h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  addEventListener("resize", resize);
  resize();

  const camDir = new THREE.Vector3();
  function animate() {
    requestAnimationFrame(animate);
    if (tween) {
      tween.t = Math.min(1, tween.t + 0.045);
      const e = 1 - Math.pow(1 - tween.t, 3);
      controls.target.lerpVectors(tween.fromT, tween.toT, e);
      camera.position.lerpVectors(tween.fromC, tween.toC, e);
      if (tween.t >= 1) tween = null;
    }
    controls.update();
    // label depth fade
    camera.getWorldDirection(camDir);
    const camPos = camera.position;
    labels.forEach((l) => {
      if (l.el.classList.contains("hidden")) return;
      const d = camPos.distanceTo(l.obj.position);
      const o = THREE.MathUtils.clamp(1 - (d - 18) / 70, 0.15, 1);
      l.el.style.opacity = (
        l.el.classList.contains("dim") ? o * 0.25 : o
      ).toFixed(2);
    });
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();

  return {
    setTheme,
    setOption,
    setIsolated,
    setQuery,
    resetView,
    flyTo,
    getLegend: () =>
      branches.map((b) => ({
        name: b.name,
        color: "#" + theme.palette[b.cidx].toString(16).padStart(6, "0"),
        node: b.node,
        count: b.count,
      })),
    getStats: () => ({ files: files.length, dirs: dirs.length }),
    findNode: (path) => dirs.find((d) => d.path === path),
    isIsolated: () => isolated,
  };
}
