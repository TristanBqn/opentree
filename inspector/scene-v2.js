import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/addons/renderers/CSS2DRenderer.js";
import { flatten } from "./data.js";
import { nameMatches, collectSubtrees, centroidRadius } from "./search.js";
import { layout, translate, assignBranchesMulti } from "./layout.js";
import { THEMES } from "./themes.js";

// ---- soft round sprite textures ------------------------------------------
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

export function createScene(container, callbacks = {}, islands = []) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.inset = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  labelRenderer.domElement.className = "label-layer";
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 0.9;
  controls.minDistance = 4;
  controls.maxDistance = 180;
  controls.enablePan = true;
  controls.panSpeed = 0.6;
  controls.enableZoom = false;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.5;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  // ===== rendu à la demande : ne redessine que sur changement =====
  let needsRender = true;
  let labelsDirty = true;
  let lastLabelMs = 0;
  let pendingPick = null;
  controls.addEventListener("change", () => {
    needsRender = true;
  });

  // zoom manuel : pas fixe par cran
  renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const step = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      const offset = camera.position.clone().sub(controls.target);
      let dist = offset.length() * step;
      dist = Math.max(
        controls.minDistance,
        Math.min(controls.maxDistance, dist),
      );
      offset.setLength(dist);
      camera.position.copy(controls.target).add(offset);
      needsRender = true;
    },
    { passive: false },
  );

  // ---- Spacebar pan mode ----
  let spaceHeld = false;
  function enterSpaceMode() {
    if (spaceHeld) return;
    spaceHeld = true;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    renderer.domElement.style.cursor = "grab";
    container.setAttribute("data-space", "");
  }
  function exitSpaceMode() {
    if (!spaceHeld) return;
    spaceHeld = false;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    renderer.domElement.style.cursor = "";
    container.removeAttribute("data-space");
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
  window.addEventListener("blur", exitSpaceMode);
  renderer.domElement.addEventListener("pointerdown", () => {
    if (spaceHeld) renderer.domElement.style.cursor = "grabbing";
  });
  renderer.domElement.addEventListener("pointerup", () => {
    if (spaceHeld) renderer.domElement.style.cursor = "grab";
  });

  // ---- data + layout (multi-îlots) ----
  let theme = THEMES.parchment;
  let opts = {
    glow: 1,
    curve: 1,
    fileSize: 1,
    labelLevel: 0,
    labelAuto: true,
    labelsOn: true,
    autoRotate: false,
    pulseSpeed: 1,
    pulseIntensity: 1,
    plates: true,
  };
  // islands provided by caller (fetched snapshot)
  islands.forEach((isl) => {
    layout(isl.root, { rootLen: isl.rootLen });
    translate(isl.root, isl.origin);
  });
  const branches = assignBranchesMulti(
    islands,
    THEMES.parchment.palette.length,
  );
  const dirs = [],
    files = [];
  islands.forEach((isl) => {
    const f = flatten(isl.root);
    dirs.push(...f.dirs);
    files.push(...f.files);
  });
  const hostIsland = islands.find((i) => i.kind === "host");
  // un nœud est "interne à un conteneur" selon le kind de son île, pas selon son
  // iid : avec plusieurs hôtes, seul le 1er a l'id "host" (cf. snapshot.mjs)
  const containerIids = new Set(
    islands.filter((i) => i.kind === "container").map((i) => i.id),
  );

  // île → rayon horizontal (pour les anneaux)
  islands.forEach((isl) => {
    let r = 0;
    (function w(n) {
      if (n.type === "file") {
        const dx = n.pos[0] - isl.origin[0],
          dz = n.pos[2] - isl.origin[2];
        r = Math.max(r, Math.hypot(dx, dz));
      }
      n.children?.forEach(w);
    })(isl.root);
    isl.radius = Math.max(5, r * 1.06);
  });

  // ---- auto-fit camera ----
  const centroid = new THREE.Vector3();
  files.forEach((f) => centroid.add(new THREE.Vector3(...f.pos)));
  centroid.multiplyScalar(1 / files.length);
  const dists = files
    .map((f) => centroid.distanceTo(new THREE.Vector3(...f.pos)))
    .sort((a, b) => a - b);
  const sphereR = Math.max(10, dists[Math.floor(dists.length * 0.94)] || 14);
  const fitDist = (sphereR / Math.sin((camera.fov * Math.PI) / 180 / 2)) * 1.04;
  const VIEW_DIR = new THREE.Vector3(0.4, 0.42, 1).normalize();
  const HOME = centroid.clone().add(VIEW_DIR.clone().multiplyScalar(fitDist));
  camera.position.copy(HOME);
  controls.maxDistance = fitDist * 2.4;
  controls.target.copy(centroid);
  const fogScale = Math.max(1, fitDist / 34);
  const sizeScale = Math.max(1, fitDist / 44);
  // ligne de base : le 100 % du slider rend ce que l'ancien 40 % rendait
  const FILE_SIZE_BASE = 0.4;

  const discTex = discTexture(),
    glowTex = glowTexture();
  const sceneRoot = new THREE.Group();
  scene.add(sceneRoot);

  // usage → score 0..1 (log) — normalisé sur les arêtes de dossiers
  let maxEdgeUses = 1;
  dirs.forEach((d) => {
    if (d.depth > 0) maxEdgeUses = Math.max(maxEdgeUses, d.uses);
  });
  function usageScore(uses) {
    if (uses <= 0) return 0;
    return 0.18 + (0.82 * Math.log(1 + uses)) / Math.log(1 + maxEdgeUses);
  }

  // ===== BRANCHES + collecte des arêtes pour les pulsations ================
  const branchSegGroups = [];
  const edgeDefs = []; // {pts:[Vector3], bid, cidx, u}
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
  function edgeLen(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]);
    return L;
  }

  const veinMats = []; // {bid, mat}  — fils de structure

  // ===== FILS DE STRUCTURE : trait fin coloré par branche (statique) =========
  // L'usage est encodé statiquement : un fil plus utilisé est légèrement plus
  // lumineux. Pas d'animation.
  function makeVeinMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(0xffffff) },
        uBase: { value: 0.2 },
        uFlowAmp: { value: 0.9 },
        uBright: { value: 1.0 },
        uAdditive: { value: 0 },
        uOpacity: { value: 1 },
      },
      vertexShader: `
        attribute float aFlow; varying float vFlow;
        void main() { vFlow = aFlow;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        precision mediump float;
        uniform float uBase, uFlowAmp, uBright, uAdditive, uOpacity;
        uniform vec3 uColor; varying float vFlow;
        void main() {
          float lift = 0.4 + 0.6 * vFlow;
          if (uAdditive > 0.5) {
            gl_FragColor = vec4(uColor * (uBase * 0.7 + vFlow * uBright * 0.5),
                                clamp(uBase * lift, 0.0, 1.0) * uOpacity);
          } else {
            gl_FragColor = vec4(uColor,
                                clamp(uBase * lift + vFlow * uFlowAmp * 0.2, 0.0, 1.0) * uOpacity);
          }
        }`,
    });
  }

  function buildBranches() {
    branchSegGroups.forEach(({ line }) => sceneRoot.remove(line));
    branchSegGroups.length = 0;
    edgeDefs.length = 0;
    veinMats.length = 0;

    const byBranch = new Map(); // bid -> {verts, dist, flow}
    const bucket = (bi) => {
      if (!byBranch.has(bi))
        byBranch.set(bi, { verts: [], dist: [], flow: [] });
      return byBranch.get(bi);
    };

    function walk(node, accDist) {
      if (!node.children) return;
      for (const c of node.children) {
        if (c.type !== "dir") continue;
        const pts = curveSamples(node.pos, c.pos, c.id);
        const bi = c.bid < 0 ? -1 : c.bid;
        const u = usageScore(c.uses);
        const b = bucket(bi);
        let d = accDist;
        for (let i = 0; i < pts.length - 1; i++) {
          const dA = d;
          d += pts[i + 1].distanceTo(pts[i]);
          b.verts.push(pts[i], pts[i + 1]);
          b.dist.push(dA, d);
          b.flow.push(u, u);
        }
        edgeDefs.push({ pts, bid: bi, cidx: c.cidx, u });
        walk(c, accDist + edgeLen(pts));
      }
    }

    islands.filter((i) => i.kind === "host").forEach((h) => walk(h.root, 0));

    // arcs hôte → containers : lien réseau pointillé (statique) + parcours interne préfixé
    islands.forEach((isl) => {
      if (isl.kind !== "container") return;
      const A = new THREE.Vector3(...hostIsland.root.pos);
      const B = new THREE.Vector3(...isl.root.pos);
      const mid = A.clone().add(B).multiplyScalar(0.5);
      mid.y += 11;
      const arc = new THREE.QuadraticBezierCurve3(A, mid, B).getPoints(26);
      const b = branches.find((x) => x.islandId === isl.id);
      edgeDefs.push({
        pts: arc,
        bid: b.bid,
        cidx: b.cidx,
        u: usageScore(isl.root.uses) * 0.9,
        arc: true,
      });
      const geo = new THREE.BufferGeometry().setFromPoints(arc);
      const mat = new THREE.LineDashedMaterial({
        transparent: true,
        depthWrite: false,
        dashSize: 0.7,
        gapSize: 0.9,
      });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      line.userData = { bid: b.bid, arc: true };
      sceneRoot.add(line);
      branchSegGroups.push({ bid: b.bid, line, arc: true });
      walk(isl.root, edgeLen(arc));
    });

    // veines : une LineSegments + ShaderMaterial de flux par branche
    byBranch.forEach((data, bi) => {
      const n = data.verts.length;
      const pos = new Float32Array(n * 3),
        dst = new Float32Array(n),
        flw = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = data.verts[i].x;
        pos[i * 3 + 1] = data.verts[i].y;
        pos[i * 3 + 2] = data.verts[i].z;
        dst[i] = data.dist[i];
        flw[i] = data.flow[i];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aDist", new THREE.BufferAttribute(dst, 1));
      geo.setAttribute("aFlow", new THREE.BufferAttribute(flw, 1));
      const mat = makeVeinMaterial();
      const line = new THREE.LineSegments(geo, mat);
      line.userData.bid = bi;
      line.frustumCulled = false;
      sceneRoot.add(line);
      branchSegGroups.push({ bid: bi, line, vein: true });
      veinMats.push({ bid: bi, mat });
    });
  }

  function paintVeins() {
    const additive = theme.pulse.blend === "additive";
    const inten = Math.min(2, opts.pulseIntensity);
    veinMats.forEach(({ bid, mat }) => {
      const cidx = bid < 0 ? -1 : branches[bid].cidx;
      const hex = cidx < 0 ? theme.branch.color : theme.palette[cidx];
      mat.uniforms.uColor.value.setHex(hex);
      mat.uniforms.uAdditive.value = additive ? 1 : 0;
      mat.uniforms.uBase.value = theme.branch.opacity * (additive ? 1.0 : 1.3);
      mat.uniforms.uFlowAmp.value = (additive ? 0.95 : 0.8) * inten;
      mat.uniforms.uBright.value =
        (additive ? 1.7 : 1.15) * (0.5 + 0.5 * inten);
      mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      mat.needsUpdate = true;
    });
  }

  // ===== FILE POINTS ======================================================
  let points,
    basePos,
    baseCol,
    fileBranch = [];
  function buildPoints() {
    const n = files.length;
    basePos = new Float32Array(n * 3);
    baseCol = new Float32Array(n * 4);
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
    geo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(n * 4), 4),
    );
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

  // ===== GLOW SPRITES per branch ==========================================
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
  // ===== SOCLES (anneaux + plaques) des îlots =============================
  const islandChrome = [];
  function buildIslandChrome() {
    islands.forEach((isl) => {
      const y = isl.origin[1] - 1.6;
      const seg = 96;
      const ringPts = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ringPts.push(
          new THREE.Vector3(
            isl.origin[0] + Math.cos(a) * isl.radius,
            y,
            isl.origin[2] + Math.sin(a) * isl.radius,
          ),
        );
      }
      const ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(ringPts),
        new THREE.LineDashedMaterial({
          transparent: true,
          depthWrite: false,
          dashSize: 0.9,
          gapSize: 0.55,
        }),
      );
      ring.computeLineDistances();
      sceneRoot.add(ring);

      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(isl.radius, seg),
        new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(isl.origin[0], y - 0.02, isl.origin[2]);
      sceneRoot.add(disc);

      const el = document.createElement("div");
      el.className = "island-plate" + (isl.kind === "host" ? " is-host" : "");
      el.innerHTML = `<span class="ip-dot st-${isl.status}"></span><span class="ip-title">${isl.name}</span>`;
      el.addEventListener("pointerdown", (e) => {
        if (e.button === 2) return;
        e.stopPropagation();
        callbacks.onIsland?.(isl);
      });
      const plate = new CSS2DObject(el);
      plate.position.set(
        isl.origin[0],
        y - 3,
        isl.origin[2] + isl.radius * 0.95,
      );
      sceneRoot.add(plate);

      islandChrome.push({ isl, ring, disc, plate, el });
    });
  }

  // ===== LABELS (CSS2D) ===================================================
  let labels = [];
  function buildLabels() {
    labels.forEach((l) => sceneRoot.remove(l.obj));
    labels = [];
    dirs.forEach((d) => {
      if (d.depth === 0) return;
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
      // clic gauche = stats ; clic droit = bulle de comptage
      el.addEventListener("pointerdown", (e) => {
        if (e.button === 2) return;
        e.stopPropagation();
        callbacks.onContext?.(d, e.clientX, e.clientY);
      });
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        callbacks.onLabel?.(d, e.clientX, e.clientY);
      });
      // en mode branche isolée : stats au survol
      el.addEventListener("pointerenter", (e) => {
        if (isolatedNodes.length)
          callbacks.onContext?.(d, e.clientX, e.clientY);
      });
      el.addEventListener("pointerleave", () => {
        if (isolatedNodes.length) callbacks.onContext?.(null);
      });
      const obj = new CSS2DObject(el);
      obj.position.set(...d.pos);
      el.style.display = "none";
      labels.push({ obj, node: d, el, mounted: false });
    });
  }

  // ===== COLORS / THEME ===================================================
  function applyColors() {
    for (let i = 0; i < files.length; i++) {
      const bi = fileBranch[i];
      const hex = bi < 0 ? theme.misc : theme.palette[branches[bi].cidx];
      const col = new THREE.Color(hex);
      baseCol[i * 4] = col.r;
      baseCol[i * 4 + 1] = col.g;
      baseCol[i * 4 + 2] = col.b;
      baseCol[i * 4 + 3] = 1;
    }
    points.geometry.attributes.color.array.set(baseCol);
    points.geometry.attributes.color.needsUpdate = true;
    points.material.size =
      theme.file.size * opts.fileSize * sizeScale * FILE_SIZE_BASE;
    points.material.blending =
      theme.file.blend === "additive"
        ? THREE.AdditiveBlending
        : THREE.NormalBlending;
    points.material.needsUpdate = true;
    branchSegGroups.forEach(({ line, arc, vein }) => {
      if (vein) return; // veines peintes par paintVeins()
      line.material.color = new THREE.Color(theme.branch.color);
      line.material.opacity = arc ? theme.arc.opacity : theme.branch.opacity;
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
    islandChrome.forEach(({ isl, ring, disc }) => {
      const b = branches.find(
        (x) => x.islandId === isl.id && x.node === isl.root,
      );
      const hex =
        isl.kind === "container" && b
          ? theme.palette[b.cidx]
          : theme.branch.color;
      ring.material.color = new THREE.Color(hex);
      ring.material.opacity =
        theme.ring.opacity * (isl.kind === "host" ? 0.55 : 1);
      disc.material.color = new THREE.Color(hex);
      disc.material.opacity = theme.ring.disc * (isl.kind === "host" ? 0.5 : 1);
      disc.material.blending =
        theme.pulse.blend === "additive"
          ? THREE.AdditiveBlending
          : THREE.NormalBlending;
    });
    scene.fog = new THREE.Fog(
      theme.fog.color,
      theme.fog.near * fogScale,
      theme.fog.far * fogScale,
    );
    labels.forEach((l) =>
      l.el.style.setProperty(
        "--c",
        "#" +
          theme.palette[l.node.cidx < 0 ? 0 : l.node.cidx]
            .toString(16)
            .padStart(6, "0"),
      ),
    );
    paintVeins();
  }

  // ===== STATE: isolate + search ==========================================
  let isolatedNodes = [];
  let isoFiles = null;
  let isoDirs = null;
  let isoBids = null;
  let query = "";
  function fileVisible(f) {
    if (isolatedNodes.length) return isoFiles.has(f);
    if (query) return f.name.toLowerCase().includes(query);
    return true;
  }
  function refresh() {
    const iso = isolatedNodes.length > 0;
    const CAP = 300;
    const matches = query ? [] : null;
    let nFileMatch = 0;
    let nDirMatch = 0;

    const col = points.geometry.attributes.color.array;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const vis = fileVisible(f);
      col[i * 4] = baseCol[i * 4];
      col[i * 4 + 1] = baseCol[i * 4 + 1];
      col[i * 4 + 2] = baseCol[i * 4 + 2];
      col[i * 4 + 3] = vis ? 1 : 0.075;
      if (query && nameMatches(f, query)) {
        nFileMatch++;
        if (matches.length < CAP) matches.push(f);
      }
    }
    points.geometry.attributes.color.needsUpdate = true;

    branchSegGroups.forEach(({ bid, line, arc, vein }) => {
      const on = iso ? isoBids.has(bid) : !query;
      if (vein) {
        line.material.uniforms.uOpacity.value = on ? 1 : 0.075;
        return;
      }
      line.material.opacity =
        (arc ? theme.arc.opacity : theme.branch.opacity) * (on ? 1 : 0.075);
    });

    glowSprites.forEach((sp) => {
      const on = iso ? isoBids.has(sp.userData.bid) : !query;
      sp.material.opacity = theme.glow.opacity * opts.glow * (on ? 1 : 0.075);
    });

    labels.forEach((l) => {
      const d = l.node;
      l.queryMatch = nameMatches(d, query);
      if (l.queryMatch) {
        nDirMatch++;
        if (matches.length < CAP) matches.push(d);
      }
      let allowed;
      let isoShow = false;
      if (iso) {
        allowed = isoDirs.has(d);
        isoShow = allowed;
      } else if (query) {
        allowed = l.queryMatch;
      } else {
        allowed = !containerIids.has(d.iid);
      }
      l.allowed = allowed;
      l.isoShow = isoShow;
      l.el.classList.toggle("hidden", !allowed);
      l.el.classList.toggle("dim", false);
    });

    const ownIslands = iso
      ? new Set(isolatedNodes.map((n) => branches[n.bid]?.islandId))
      : null;
    islandChrome.forEach(({ isl, ring, disc, el }) => {
      const vis = opts.plates;
      ring.visible = vis;
      disc.visible = vis;
      el.style.display = vis ? "" : "none";
      if (iso) {
        const own = ownIslands.has(isl.id);
        el.style.opacity = own ? "1" : ".25";
        ring.material.opacity = theme.ring.opacity * (own ? 1 : 0.075);
      } else {
        el.style.opacity = "1";
      }
    });

    const total = files.length + labels.length;
    callbacks.onCounts?.({
      match: query ? nFileMatch + nDirMatch : total,
      total,
      isolated:
        isolatedNodes.length === 0
          ? null
          : isolatedNodes.length === 1
            ? isolatedNodes[0].name
            : `${isolatedNodes.length} éléments`,
      matches,
    });
    needsRender = true;
    labelsDirty = true;
  }

  function setTheme(key) {
    theme = THEMES[key];
    applyColors();
    refresh();
  }
  function setOption(k, v) {
    opts[k] = v;
    if (k === "autoRotate") controls.autoRotate = v;
    if (k === "curve") buildBranches();
    if (k === "glow" || k === "fileSize") applyColors();
    if (k === "curve") applyColors();
    refresh();
  }
  function applyIsolation(nodes) {
    isolatedNodes = nodes;
    if (nodes.length) {
      const { files: fs, dirs: ds } = collectSubtrees(nodes);
      isoFiles = fs;
      isoDirs = ds;
      isoBids = new Set(nodes.map((n) => n.bid));
    } else {
      isoFiles = isoDirs = isoBids = null;
    }
    refresh();
    if (nodes.length) frameToIso();
  }
  function setIsolated(node) {
    applyIsolation(node ? [node] : []);
  }
  function toggleIsolated(node) {
    const has = isolatedNodes.includes(node);
    applyIsolation(
      has ? isolatedNodes.filter((n) => n !== node) : [...isolatedNodes, node],
    );
  }
  function setQuery(q) {
    query = (q || "").trim().toLowerCase();
    refresh();
  }

  // ===== camera fly =======================================================
  let tween = null;
  function flyTo(node) {
    const target = new THREE.Vector3(...node.pos);
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
  function frameToIso() {
    if (!isoFiles || isoFiles.size === 0) return;
    const pts = [];
    isoFiles.forEach((f) => pts.push(f.pos));
    const cr = centroidRadius(pts);
    if (!cr) return;
    const target = new THREE.Vector3(cr.cx, cr.cy, cr.cz);
    const r = Math.max(cr.r, 6);
    const dist = (r / Math.sin((camera.fov * Math.PI) / 180 / 2)) * 1.15;
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
    applyIsolation([]);
    tween = {
      t: 0,
      fromT: controls.target.clone(),
      toT: centroid.clone(),
      fromC: camera.position.clone(),
      toC: HOME.clone(),
    };
  }

  // ===== picking ==========================================================
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    ray.params.Points.threshold =
      theme.file.size * opts.fileSize * sizeScale * FILE_SIZE_BASE * 0.9;
    const hits = ray.intersectObject(points, false);
    for (const h of hits) {
      if (fileVisible(files[h.index])) return h.index;
    }
    return -1;
  }
  const raycanvas = renderer.domElement;
  function doPick(x, y) {
    const i = pick(x, y);
    raycanvas.style.cursor = i >= 0 ? "pointer" : "grab";
    // en mode branche isolée : stats au survol d'un fichier
    if (isolatedNodes.length)
      callbacks.onContext?.(i >= 0 ? files[i] : null, x, y);
  }
  raycanvas.addEventListener("pointermove", (e) => {
    pendingPick = { x: e.clientX, y: e.clientY };
  });
  raycanvas.addEventListener("contextmenu", (e) => {
    const i = pick(e.clientX, e.clientY);
    if (i >= 0) {
      e.preventDefault();
      callbacks.onPick?.(files[i], e.clientX, e.clientY);
    }
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
    if (i >= 0) callbacks.onContext?.(files[i], e.clientX, e.clientY);
    else callbacks.onEmpty?.();
  });

  // ===== build + start ====================================================
  buildPoints();
  buildBranches();
  buildGlows();
  buildLabels();
  buildIslandChrome();
  applyColors();
  refresh();

  // les largeurs d'étiquettes dépendent des web fonts (chargement asynchrone) :
  // invalider les dimensions mesurées une fois la police prête → re-mesure unique
  document.fonts?.ready?.then(() => {
    labels.forEach((l) => {
      l.w = l.h = null;
    });
    needsRender = true;
    labelsDirty = true;
  });

  function resize() {
    const w = container.clientWidth,
      h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    needsRender = true;
    labelsDirty = true;
  }
  addEventListener("resize", resize);
  resize();

  // ===== LABEL DECLUTTER : projection écran + masquage des chevauchements ===
  const _v = new THREE.Vector3();
  const maxLabelDepth = dirs.reduce((m, d) => Math.max(m, d.depth), 1);
  let lastAutoLevel = -1;
  // distance caméra → niveau d'étiquettes (0 = vue d'ensemble, aucune étiquette)
  function levelFromZoom(dist) {
    const r = dist / fitDist;
    if (r >= 0.9) return 0;
    let lvl = 0;
    for (let L = 1; L <= maxLabelDepth; L++) {
      if (r <= 0.9 * Math.pow(0.66, L - 1)) lvl = L;
    }
    return lvl;
  }
  function declutterLabels() {
    const camPos = camera.position;
    const W = container.clientWidth,
      H = container.clientHeight;
    // niveau affiché : auto = déduit du zoom, manuel = valeur du slider
    const effLevel = opts.labelAuto
      ? levelFromZoom(camPos.distanceTo(controls.target))
      : opts.labelLevel;
    if (opts.labelAuto && effLevel !== lastAutoLevel) {
      lastAutoLevel = effLevel;
      callbacks.onLabelLevel?.(effLevel);
    }
    const cand = [];
    for (const l of labels) {
      if (!opts.labelsOn || l.el.classList.contains("hidden")) {
        l.el.style.visibility = "hidden";
        continue;
      }
      l.obj.getWorldPosition(_v);
      const dist = camPos.distanceTo(_v);
      // niveau exact (non cumulatif) ; une branche isolée montre tout son arbre
      if (
        !l.isoShow &&
        !l.queryMatch &&
        (effLevel <= 0 || l.node.depth !== effLevel)
      ) {
        l.el.style.visibility = "hidden";
        continue;
      }
      _v.project(camera);
      // derrière la caméra ou hors-champ → masquer
      if (_v.z > 1 || _v.x < -1.1 || _v.x > 1.1 || _v.y < -1.1 || _v.y > 1.1) {
        l.el.style.visibility = "hidden";
        continue;
      }
      const sx = (_v.x * 0.5 + 0.5) * W;
      const sy = (-_v.y * 0.5 + 0.5) * H;
      if (l.w == null) {
        const w0 = l.el.offsetWidth,
          h0 = l.el.offsetHeight;
        if (w0) {
          l.w = w0;
          l.h = h0;
        }
      }
      const w = l.w || 70,
        h = l.h || 24;
      // priorité : profondeur faible, puis proche, puis usage élevé
      const score = l.node.depth * 1000 + dist - (l.node.uses || 0) * 0.01;
      cand.push({ l, sx, sy, w, h, dist, score });
    }
    cand.sort((a, b) => a.score - b.score);
    const placed = [];
    const PAD = 3;
    for (const c of cand) {
      const x0 = c.sx - c.w / 2 - PAD,
        x1 = c.sx + c.w / 2 + PAD;
      const y0 = c.sy - c.h / 2 - PAD,
        y1 = c.sy + c.h / 2 + PAD;
      let hit = false;
      for (const p of placed) {
        if (x0 < p.x1 && x1 > p.x0 && y0 < p.y1 && y1 > p.y0) {
          hit = true;
          break;
        }
      }
      if (hit) {
        c.l.el.style.visibility = "hidden";
        continue;
      }
      placed.push({ x0, x1, y0, y1 });
      c.l.el.style.visibility = "visible";
      const o = THREE.MathUtils.clamp(
        1 - (c.dist - 18 * sizeScale) / (90 * sizeScale),
        0.45,
        1,
      );
      c.l.el.style.opacity = (
        c.l.el.classList.contains("dim") ? o * 0.25 : o
      ).toFixed(2);
    }
    // virtualisation : seul l'ensemble réellement visible reste dans le graphe.
    // CSS2DRenderer trie (zOrder) et écrit le zIndex de TOUS les CSS2DObject montés,
    // sans filtrer sur .visible — démonter les invisibles élimine ce coût O(n).
    for (const l of labels) {
      const want = l.el.style.visibility === "visible";
      if (want && !l.mounted) {
        sceneRoot.add(l.obj);
        l.mounted = true;
      } else if (!want && l.mounted) {
        sceneRoot.remove(l.obj);
        l.mounted = false;
        l.el.style.display = "none";
      }
    }
  }

  function renderLabels() {
    const t = performance.now();
    if (labelsDirty || t - lastLabelMs >= 66) {
      lastLabelMs = t;
      labelsDirty = false;
      declutterLabels();
      labelRenderer.render(scene, camera);
    } else {
      needsRender = true; // re-arme pour flusher les étiquettes après l'arrêt du mouvement
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    if (pendingPick) {
      const { x, y } = pendingPick;
      pendingPick = null;
      doPick(x, y);
    }
    if (tween) {
      tween.t = Math.min(1, tween.t + 0.045);
      const e = 1 - Math.pow(1 - tween.t, 3);
      controls.target.lerpVectors(tween.fromT, tween.toT, e);
      camera.position.lerpVectors(tween.fromC, tween.toC, e);
      if (tween.t >= 1) tween = null;
      needsRender = true;
    }
    controls.update();
    if (!needsRender) return;
    needsRender = false;
    renderer.render(scene, camera);
    renderLabels();
  }
  animate();

  return {
    setTheme,
    setOption,
    setIsolated,
    toggleIsolated,
    setQuery,
    resetView,
    flyTo,
    getLegend: () =>
      branches.map((b) => ({
        name: b.name,
        color: "#" + theme.palette[b.cidx].toString(16).padStart(6, "0"),
        node: b.node,
        count: b.count,
        islandId: b.islandId,
        uses: b.node.uses,
      })),
    getIslands: () => islands,
    getStats: () => ({
      files: files.length,
      dirs: dirs.length,
      containers: islands.filter((i) => i.kind === "container").length,
    }),
    getMaxDepth: () => dirs.reduce((m, d) => Math.max(m, d.depth), 1),
    isIsolated: () => isolatedNodes,
  };
}
