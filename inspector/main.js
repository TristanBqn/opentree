import { createScene } from "./scene.js?v=6";
import {
  formatSize,
  formatDate,
  relDate,
  GIT_LABEL,
  isBinary,
  langOf,
  snippet,
} from "./content.js";
import { fetchArchitecture } from "./data.js";

const $ = (s) => document.querySelector(s);
const stage = $("#stage");

let scene;
const tooltip = $("#tooltip");
const detail = $("#detail");

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
  onHover(node, x, y) {
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
  onPick(file) {
    openDetail(file);
  },
  onEmpty() {
    /* click X pour fermer */
  },
  onLabel(node) {
    isolateNode(node);
  },
  onIsland(isl) {
    const b = scene
      .getLegend()
      .find((l) => l.islandId === isl.id && l.node === isl.root);
    if (b) scene.setIsolated(b.node);
    else scene.flyTo(isl.root);
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

const snap = await fetchArchitecture();
scene = createScene(stage, callbacks, snap.islands);

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

// ---- settings popover ---------------------------------------------------------
$("#gear").addEventListener("click", () =>
  $("#settings").classList.toggle("open"),
);
const PCT = (v) => Math.round(v * 100) + "%";
const optDefs = {
  glow: PCT,
  curve: PCT,
  fileSize: PCT,
  labelDepth: (v) =>
    ["Dossiers racine", "Niveau 1", "Niveau 2", "Tout"][v] || v,
};
Object.keys(optDefs).forEach((id) => {
  const el = document.getElementById("opt-" + id);
  if (!el) return;
  el.addEventListener("input", () => {
    const v =
      id === "labelDepth" ? parseInt(el.value, 10) : parseFloat(el.value);
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

// ---- detail panel ---------------------------------------------------------------
function openDetail(file) {
  detail.classList.add("show");
  const branch = file.path.split("/");
  const top = topNodeOf(file);
  const color = top
    ? scene.getLegend().find((l) => l.node === top)?.color || "#888"
    : "#888";
  const isl = scene.getIslands().find((i) => i.id === file.iid);
  const lvl = usageLevel(file.uses);
  const g = GIT_LABEL[file.git];
  const lang = langOf(file.ext);
  const crumb = branch
    .slice(0, -1)
    .map((p) => `<span>${p}</span>`)
    .join("<i>/</i>");
  const locRow =
    isl && isl.kind === "container"
      ? `<div class="m"><span class="k">Conteneur</span><span class="v"><span class="ip-dot st-${isl.status}"></span> ${isl.name.replace("openclaw-", "")}</span></div>`
      : `<div class="m"><span class="k">Git</span><span class="v"><span class="git ${g.cls}">${g.txt}</span></span></div>`;
  let body;
  if (isBinary(file.ext)) {
    body = `<div class="bin-card"><div class="bin-ext">.${file.ext}</div><div class="bin-meta">${lang} · ${formatSize(file.size)}</div><div class="bin-note">Ressource binaire — aucun aperçu texte</div></div>`;
  } else {
    const code = snippet(file) || "";
    body = `<pre class="code"><code>${escapeHtml(code)}</code></pre>`;
  }
  const perDay = file.uses
    ? (file.uses / 30).toFixed(1).replace(".", ",")
    : "0";
  detail.querySelector(".d-body").innerHTML = `
    <div class="d-file"><span class="d-dot" style="background:${color}"></span><span class="d-name">${file.name}</span></div>
    <div class="d-crumb">${crumb}</div>
    <div class="d-usage">
      <div class="du-head"><span class="k">Activité · 30 derniers jours</span><span class="u-tag ${lvl.cls}">${lvl.txt}</span></div>
      ${sparkSVG(file.usage30, 320, 56)}
      <div class="du-stats"><b>${file.uses}</b> utilisations · ${perDay} / jour · dernière ${relDate(file.mtime)}</div>
    </div>
    <div class="d-meta">
      <div class="m"><span class="k">Type</span><span class="v">${lang}</span></div>
      <div class="m"><span class="k">Taille</span><span class="v">${formatSize(file.size)}</span></div>
      <div class="m"><span class="k">Créé</span><span class="v">${formatDate(file.createdAt)}</span></div>
      <div class="m"><span class="k">Modifié</span><span class="v">${formatDate(file.mtime)}</span></div>
      ${locRow}
      <div class="m"><span class="k">Usage 30 j</span><span class="v">${file.uses}</span></div>
    </div>
    ${body}
    <div class="d-actions">
      <button class="d-btn" id="d-isolate">Isoler la branche</button>
      <button class="d-btn ghost" id="d-center">Centrer</button>
    </div>`;
  detail
    .querySelector("#d-isolate")
    .addEventListener("click", () => isolateNode(file));
  detail
    .querySelector("#d-center")
    .addEventListener("click", () =>
      scene.flyTo({ pos: file.pos, depth: 3, type: "file", children: null }),
    );
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
$("#d-close").addEventListener("click", () => detail.classList.remove("show"));

// keyboard
addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    scene.resetView();
    detail.classList.remove("show");
  }
  if (e.key === "/" && document.activeElement !== search) {
    e.preventDefault();
    search.focus();
  }
});
