import { createScene } from "./scene-v2.js";
import {
  formatSize,
  formatDate,
  relDate,
  isBinary,
  langOf,
  snippet,
} from "./content.js";
import { fetchArchitecture, refreshArchitecture } from "./data.js";

const $ = (s) => document.querySelector(s);
const stage = $("#stage");

let scene;
const tooltip = $("#tooltip");

// ---- usage helpers --------------------------------------------------------
function usageLevel(uses) {
  if (uses <= 0) return { txt: "inactif", cls: "u0" };
  if (uses < 15) return { txt: "peu actif", cls: "u1" };
  if (uses < 120) return { txt: "actif", cls: "u2" };
  return { txt: "très actif", cls: "u3" };
}
function sparkSVG(usage, w = 132, h = 30) {
  const max = Math.max(1, ...usage);
  const px = (i) => (i / 29) * (w - 4) + 2;
  const py = (v) => h - 3 - (v / max) * (h - 8);
  const line = usage
    .map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`)
    .join(" ");
  const area = `2,${h - 3} ${line} ${w - 2},${h - 3}`;
  const lastI = 29,
    lastV = usage[29];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <polyline class="sp-area" points="${area}"></polyline>
    <polyline class="sp-line" points="${line}"></polyline>
    <circle class="sp-dot" cx="${px(lastI).toFixed(1)}" cy="${py(lastV).toFixed(1)}" r="2.4"></circle>
  </svg>`;
}
function nodeMetaLine(n) {
  return n.type === "dir"
    ? `${n.count} fichiers · ${formatSize(n.size)}`
    : `${langOf(n.ext)} · ${formatSize(n.size)}`;
}

// ---- callbacks scène ------------------------------------------------------
const callbacks = {
  onContext(node, x, y) {
    if (!node) {
      tooltip.classList.remove("show");
      return;
    }
    const lvl = usageLevel(node.uses);
    tooltip.innerHTML = `
      <span class="tt-name">${node.name}</span>
      <span class="tt-meta">${nodeMetaLine(node)}</span>
      <div class="tt-usage"><span class="u-tag ${lvl.cls}">${lvl.txt}</span><span class="tt-uses">${node.uses} utilisations · 30 j</span></div>
      ${sparkSVG(node.usage30)}
      <span class="tt-dates">créé ${formatDate(node.createdAt)} · modifié ${relDate(node.mtime)}</span>`;
    const px = Math.min(x + 16, innerWidth - 190);
    const py = Math.min(y + 16, innerHeight - 130);
    tooltip.style.transform = `translate(${px}px, ${py}px)`;
    tooltip.classList.add("show");
  },
  onPick(file, x, y) {
    openFileBubble(file, x, y);
  },
  onEmpty() {
    tooltip.classList.remove("show");
  },
  onLabel(node, x, y) {
    openNodeBubble(node, x, y);
  },
  onIsland(isl) {
    openIsland(isl);
  },
  onCounts({ match, total, isolated }) {
    const st = scene ? scene.getStats() : null;
    $("#count").textContent = isolated
      ? `${isolated} · ${match} fichiers`
      : match < total
        ? `${match} / ${total} fichiers`
        : st
          ? `${st.containers} conteneurs · ${total} fichiers · ${st.dirs} dossiers`
          : `${total} fichiers`;
    const chip = $("#isolate-chip");
    if (isolated) {
      chip.classList.add("show");
      $("#isolate-name").textContent = isolated;
    } else chip.classList.remove("show");
  },
};

try {
  const snap = await fetchArchitecture();
  scene = createScene(stage, callbacks, snap.islands);
  const loadingEl = document.getElementById("loading");
  if (loadingEl) {
    loadingEl.style.opacity = "0";
    setTimeout(() => loadingEl.remove(), 300);
  }
} catch (err) {
  console.error(err);
  const loadingEl = document.getElementById("loading");
  if (loadingEl) {
    loadingEl.textContent =
      "Impossible de joindre l'agent OpenTree — vérifie qu'il tourne sur 127.0.0.1:7070";
    loadingEl.style.opacity = "1";
  }
}

// ---- legend ----------------------------------------------------------------
function topNodeOf(node) {
  if (node.bid == null || node.bid < 0) return null;
  return scene.getLegend().find((l) => l.node.bid === node.bid)?.node || null;
}
function isolateNode(node) {
  const top = node.bid == null || node.bid < 0 ? node : topNodeOf(node) || node;
  scene.setIsolated(top);
  if (top !== node) scene.flyTo(node);
}
function renderLegend() {
  const wrap = $("#legend-items");
  wrap.innerHTML = "";
  const legend = scene.getLegend();
  const islands = scene.getIslands();

  const secC = document.createElement("div");
  secC.className = "lg-sec";
  secC.textContent = "Conteneurs";
  wrap.appendChild(secC);
  islands
    .filter((i) => i.kind === "container")
    .forEach((isl) => {
      const l = legend.find((x) => x.islandId === isl.id);
      const b = document.createElement("button");
      b.className = "legend-chip";
      b.innerHTML = `<span class="dot" style="background:${l.color}"></span>
      <span class="lg-name"><span class="ip-dot st-${isl.status}"></span>${isl.name.replace("openclaw-", "")}</span>
      <span class="lg-count">${l.uses}</span>`;
      b.title = `${isl.statusTxt} · ${isl.stats}`;
      b.addEventListener("click", () => {
        const cur = scene.isIsolated();
        if (cur && cur.bid === l.node.bid) scene.resetView();
        else scene.setIsolated(l.node);
      });
      wrap.appendChild(b);
    });

  const secH = document.createElement("div");
  secH.className = "lg-sec";
  secH.textContent = "Hôte · branches";
  wrap.appendChild(secH);
  legend
    .filter((l) => l.islandId === "host")
    .forEach((l) => {
      const b = document.createElement("button");
      b.className = "legend-chip";
      b.innerHTML = `<span class="dot" style="background:${l.color}"></span><span class="lg-name">${l.name}</span><span class="lg-count">${l.uses}</span>`;
      b.title = `${l.count} fichiers · ${l.uses} utilisations / 30 j`;
      b.addEventListener("click", () => {
        const cur = scene.isIsolated();
        if (cur && cur.bid === l.node.bid) scene.resetView();
        else scene.setIsolated(l.node);
      });
      wrap.appendChild(b);
    });
}
renderLegend();
const st0 = scene.getStats();
$("#count").textContent =
  `${st0.containers} conteneurs · ${st0.files} fichiers · ${st0.dirs} dossiers`;

// ---- theme (parchemin uniquement) -------------------------------------------
document.body.dataset.theme = "parchment";
scene.setTheme("parchment");

// ---- search -----------------------------------------------------------------
const search = $("#search");
search.addEventListener("input", () => {
  scene.setQuery(search.value);
  $("#search-clear").classList.toggle("show", !!search.value);
});
$("#search-clear").addEventListener("click", () => {
  search.value = "";
  scene.setQuery("");
  $("#search-clear").classList.remove("show");
  search.focus();
});

// ---- isolate chip / reset -----------------------------------------------------
$("#isolate-clear").addEventListener("click", () => scene.resetView());
$("#reset-view").addEventListener("click", () => {
  scene.resetView();
});
$("#refresh-btn").addEventListener("click", async () => {
  const btn = $("#refresh-btn");
  if (btn.classList.contains("busy")) return;
  btn.classList.add("busy");
  btn.disabled = true;
  try {
    await refreshArchitecture();
    location.reload();
  } catch (err) {
    console.error("[opentree] refresh failed:", err);
    btn.classList.remove("busy");
    btn.disabled = false;
  }
});

// ---- settings popover ---------------------------------------------------------
$("#gear").addEventListener("click", () => {
  $("#arch-panel").classList.remove("open");
  $("#settings").classList.toggle("open");
});
$("#arch-btn").addEventListener("click", () => {
  $("#settings").classList.remove("open");
  $("#arch-panel").classList.toggle("open");
});
const PCT = (v) => Math.round(v * 100) + "%";
const optDefs = {
  glow: PCT,
  curve: PCT,
  fileSize: PCT,
};
Object.keys(optDefs).forEach((id) => {
  const el = document.getElementById("opt-" + id);
  if (!el) return;
  el.addEventListener("input", () => {
    const v = parseFloat(el.value);
    scene.setOption(id, v);
    const out = document.getElementById("val-" + id);
    if (out) out.textContent = optDefs[id](v);
  });
});
$("#opt-rotate").addEventListener("change", (e) =>
  scene.setOption("autoRotate", e.target.checked),
);
$("#opt-plates").addEventListener("change", (e) =>
  scene.setOption("plates", e.target.checked),
);

// ---- étiquettes : on/off + niveau d'affichage (dernier cran = Automatique) ----
$("#opt-labels").addEventListener("change", (e) =>
  scene.setOption("labelsOn", e.target.checked),
);
const labelSlider = $("#opt-labelDepth");
const labelVal = $("#val-labelDepth");
const autoPos = scene.getMaxDepth() + 1;
labelSlider.max = String(autoPos);
labelSlider.value = String(autoPos);
function applyLabelLevel() {
  const v = parseInt(labelSlider.value, 10);
  if (v >= autoPos) {
    scene.setOption("labelAuto", true);
    labelVal.textContent = "Automatique";
  } else {
    scene.setOption("labelAuto", false);
    scene.setOption("labelDepth", v);
    labelVal.textContent = "Niveau " + v;
  }
}
labelSlider.addEventListener("input", applyLabelLevel);
applyLabelLevel();

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- island info card -----------------------------------------------------
const islandCard = $("#island-card");
const METRIC_RE = /^(CPU|RAM|disque|disk|mémoire)\b\s*(.*)$/i;
function metricTile(chunk) {
  const m = chunk.match(METRIC_RE);
  if (m)
    return `<div class="ic-tile"><span class="t-k">${m[1]}</span><span class="t-v">${m[2] || "—"}</span></div>`;
  return `<div class="ic-tile"><span class="t-v">${chunk}</span></div>`;
}
function openIsland(isl) {
  const leg = scene
    .getLegend()
    .find((l) => l.islandId === isl.id && l.node === isl.root);
  const accent = leg ? leg.color : "var(--accent)";
  const parts = isl.statusTxt.split("·").map((s) => s.trim());
  const statusWord = parts[0];
  const uptime = parts.slice(1).join(" · ");
  const tiles = isl.stats
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(metricTile)
    .join("");
  const chips = isl.ports
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((c) => `<span class="ic-chip">${c}</span>`)
    .join("");
  islandCard.style.setProperty("--ic-accent", accent);
  islandCard.innerHTML = `
    <div class="ic-head">
      <span class="ic-dot st-${isl.status}"></span>
      <span class="ic-name">${isl.name}</span>
      <span class="ic-kind">${isl.kind === "host" ? "Hôte" : "Conteneur"}</span>
      <button id="ic-close">×</button>
    </div>
    <div class="ic-status">
      <span class="ic-badge st-${isl.status}">${statusWord}</span>
      ${uptime ? `<span class="ic-up">${uptime}</span>` : ""}
    </div>
    <div class="ic-sec">${isl.kind === "host" ? "Machine" : "Ressources"}</div>
    <div class="ic-grid">${tiles}</div>
    <div class="ic-sec">${isl.kind === "host" ? "Disque · chemin" : "Réseau · image"}</div>
    <div class="ic-chips">${chips}</div>
    <div class="ic-actions">
      <button class="ic-btn" id="ic-isolate">Isoler la branche</button>
      <button class="ic-btn ghost" id="ic-center">Centrer la vue</button>
    </div>`;
  islandCard.classList.add("show");
  markActivePlate(isl);
  islandCard.querySelector("#ic-close").addEventListener("click", closeIsland);
  islandCard.querySelector("#ic-isolate").addEventListener("click", () => {
    const b = scene
      .getLegend()
      .find((l) => l.islandId === isl.id && l.node === isl.root);
    if (b) scene.setIsolated(b.node);
    else scene.flyTo(isl.root);
    closeIsland();
  });
  islandCard
    .querySelector("#ic-center")
    .addEventListener("click", () => scene.flyTo(isl.root));
}
function closeIsland() {
  islandCard.classList.remove("show");
  markActivePlate(null);
}
function markActivePlate(isl) {
  document.querySelectorAll(".island-plate").forEach((el) => {
    el.classList.toggle(
      "active",
      !!isl && el.querySelector(".ip-title")?.textContent === isl.name,
    );
  });
}

// ---- node bubble (intersection counts + file text) ------------------------
const nodeBubble = $("#node-bubble");
function countUnder(node) {
  let dirs = 0,
    files = 0;
  (function w(n) {
    (n.children || []).forEach((c) => {
      if (c.type === "dir") {
        dirs++;
        w(c);
      } else files++;
    });
  })(node);
  return { dirs, files };
}
function branchColorOf(node) {
  const top = topNodeOf(node);
  return (
    (top && scene.getLegend().find((l) => l.node === top)?.color) || "#8a8275"
  );
}
function placeBubble(x, y) {
  nodeBubble.classList.add("show");
  const r = nodeBubble.getBoundingClientRect();
  const px = Math.min(x + 14, innerWidth - r.width - 14);
  const py = Math.min(y + 14, innerHeight - r.height - 14);
  nodeBubble.style.left = Math.max(14, px) + "px";
  nodeBubble.style.top = Math.max(14, py) + "px";
}
function openNodeBubble(node, x, y) {
  const { dirs, files } = countUnder(node);
  const color = branchColorOf(node);
  nodeBubble.innerHTML = `
    <div class="nb-head">
      <span class="nb-dot" style="background:${color}"></span>
      <span class="nb-name">${node.name}</span>
      <span class="nb-ext">Dossier</span>
      <button id="nb-close">×</button>
    </div>
    <div class="nb-counts">
      <div class="nb-stat"><span class="s-v">${dirs}</span><span class="s-k">${dirs > 1 ? "sous-dossiers" : "sous-dossier"}</span></div>
      <div class="nb-stat"><span class="s-v">${files}</span><span class="s-k">${files > 1 ? "fichiers au total" : "fichier au total"}</span></div>
    </div>
    <div class="nb-foot"><button class="nb-iso" id="nb-iso">Isoler cette branche</button></div>`;
  nodeBubble.querySelector("#nb-close").addEventListener("click", closeBubble);
  nodeBubble.querySelector("#nb-iso").addEventListener("click", () => {
    isolateNode(node);
    closeBubble();
  });
  placeBubble(x, y);
  enableBubbleDrag();
}
function openFileBubble(file, x, y) {
  const color = branchColorOf(file);
  let body;
  if (isBinary(file.ext)) {
    body = `<div class="nb-bin"><div class="b-ext">.${file.ext}</div><div class="b-note">${langOf(file.ext)} · ${formatSize(file.size)} — ressource binaire</div></div>`;
  } else {
    body = `<pre class="nb-code"><code>${escapeHtml(snippet(file) || "")}</code></pre>`;
  }
  nodeBubble.innerHTML = `
    <div class="nb-head">
      <span class="nb-dot" style="background:${color}"></span>
      <span class="nb-name">${file.name}</span>
      <span class="nb-ext">${file.ext || "fichier"}</span>
      <button id="nb-close">×</button>
    </div>
    ${body}`;
  nodeBubble.querySelector("#nb-close").addEventListener("click", closeBubble);
  placeBubble(x, y);
  enableBubbleDrag();
}
function closeBubble() {
  nodeBubble.classList.remove("show");
}

// le tooltip de stats (clic droit) se ferme à tout clic ailleurs
addEventListener("pointerdown", () => tooltip.classList.remove("show"), true);

// rendre la bulle déplaçable par son header
function enableBubbleDrag() {
  const head = nodeBubble.querySelector(".nb-head");
  if (!head) return;
  head.style.cursor = "grab";
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#nb-close")) return;
    e.preventDefault();
    const r = nodeBubble.getBoundingClientRect();
    const ox = e.clientX - r.left,
      oy = e.clientY - r.top;
    head.style.cursor = "grabbing";
    nodeBubble.style.transition = "none";
    const move = (ev) => {
      const nx = Math.max(
        6,
        Math.min(ev.clientX - ox, innerWidth - r.width - 6),
      );
      const ny = Math.max(
        6,
        Math.min(ev.clientY - oy, innerHeight - r.height - 6),
      );
      nodeBubble.style.left = nx + "px";
      nodeBubble.style.top = ny + "px";
    };
    const up = () => {
      head.style.cursor = "grab";
      nodeBubble.style.transition = "";
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });
}

// keyboard
addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    tooltip.classList.remove("show");
    closeBubble();
    closeIsland();
    scene.resetView();
  }
  if (e.key === "/" && document.activeElement !== search) {
    e.preventDefault();
    search.focus();
  }
});
