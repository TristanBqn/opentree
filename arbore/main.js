import { createScene } from './scene.js';
import { formatSize, formatDate, relDate, GIT_LABEL, isBinary, langOf, snippet } from './content.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');

let scene;
const tooltip = $('#tooltip');
const detail = $('#detail');

const callbacks = {
  onHover(file, x, y) {
    if (!file) { tooltip.classList.remove('show'); return; }
    tooltip.innerHTML = `<span class="tt-name">${file.name}</span><span class="tt-meta">${formatSize(file.size)} · ${relDate(file.mtime)}</span>`;
    tooltip.style.transform = `translate(${x + 16}px, ${y + 16}px)`;
    tooltip.classList.add('show');
  },
  onPick(file) { openDetail(file); },
  onEmpty() { /* keep panel; click X to close */ },
  onLabel(node) { isolateNode(node); },
  onCounts({ match, total, isolated }) {
    $('#count').textContent = isolated
      ? `${isolated} · ${match} fichiers`
      : (match < total ? `${match} / ${total} fichiers` : `${total} fichiers · ${scene ? scene.getStats().dirs : ''} dossiers`);
    const chip = $('#isolate-chip');
    if (isolated) { chip.classList.add('show'); $('#isolate-name').textContent = isolated; }
    else chip.classList.remove('show');
  },
};

scene = createScene(stage, callbacks);

// ---- legend ----
function topNodeOf(node) {
  if (node.bid == null || node.bid < 0) return null;
  return scene.getLegend().find((l) => l.node.bid === node.bid)?.node || null;
}
function isolateNode(node) {
  const top = (node.bid == null || node.bid < 0) ? node : (topNodeOf(node) || node);
  scene.setIsolated(top);
  if (top !== node) scene.flyTo(node);
}
function renderLegend() {
  const wrap = $('#legend-items'); wrap.innerHTML = '';
  scene.getLegend().forEach((l) => {
    const b = document.createElement('button');
    b.className = 'legend-chip';
    b.innerHTML = `<span class="dot" style="background:${l.color}"></span><span class="lg-name">${l.name}</span><span class="lg-count">${l.count}</span>`;
    b.addEventListener('click', () => {
      const cur = scene.isIsolated();
      if (cur && cur.bid === l.node.bid) scene.resetView();
      else scene.setIsolated(l.node);
    });
    wrap.appendChild(b);
  });
}
renderLegend();
$('#count').textContent = `${scene.getStats().files} fichiers · ${scene.getStats().dirs} dossiers`;

// ---- theme switcher ----
function applyTheme(key, save = true) {
  if (!['parchment', 'openclaw'].includes(key)) key = 'parchment';
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.theme === key));
  document.body.dataset.theme = key;
  scene.setTheme(key);
  renderLegend();
  if (save) try { localStorage.setItem('arbore.theme', key); } catch (e) {}
}
document.querySelectorAll('.seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});
applyTheme((() => { try { return localStorage.getItem('arbore.theme'); } catch (e) { return null; } })() || 'parchment', false);

// ---- search ----
const search = $('#search');
search.addEventListener('input', () => {
  scene.setQuery(search.value);
  $('#search-clear').classList.toggle('show', !!search.value);
});
$('#search-clear').addEventListener('click', () => { search.value = ''; scene.setQuery(''); $('#search-clear').classList.remove('show'); search.focus(); });

// ---- isolate chip / reset ----
$('#isolate-clear').addEventListener('click', () => scene.resetView());
$('#reset-view').addEventListener('click', () => { scene.resetView(); });

// ---- settings popover ----
$('#gear').addEventListener('click', () => $('#settings').classList.toggle('open'));
const optMap = { glow: 'glow', curve: 'curve', fileSize: 'fileSize', labelDepth: 'labelDepth' };
Object.keys(optMap).forEach((id) => {
  const el = document.getElementById('opt-' + id);
  if (!el) return;
  el.addEventListener('input', () => {
    const v = id === 'labelDepth' ? parseInt(el.value, 10) : parseFloat(el.value);
    scene.setOption(optMap[id], v);
    const out = document.getElementById('val-' + id);
    if (out) out.textContent = id === 'labelDepth' ? ['Dossiers racine', 'Niveau 1', 'Niveau 2', 'Tout'][v] || v : Math.round(v * 100) + '%';
  });
});
$('#opt-rotate').addEventListener('change', (e) => scene.setOption('autoRotate', e.target.checked));

// ---- detail panel ----
function openDetail(file) {
  detail.classList.add('show');
  const branch = file.path.split('/');
  const top = topNodeOf(file);
  const color = top ? (scene.getLegend().find((l) => l.node === top)?.color || '#888') : '#888';
  const g = GIT_LABEL[file.git];
  const lang = langOf(file.ext);
  const crumb = branch.slice(0, -1).map((p) => `<span>${p}</span>`).join('<i>/</i>');
  let body;
  if (isBinary(file.ext)) {
    body = `<div class="bin-card"><div class="bin-ext">.${file.ext}</div><div class="bin-meta">${lang} · ${formatSize(file.size)}</div><div class="bin-note">Ressource binaire — aucun aperçu texte</div></div>`;
  } else {
    const code = snippet(file) || '';
    body = `<pre class="code"><code>${escapeHtml(code)}</code></pre>`;
  }
  detail.querySelector('.d-body').innerHTML = `
    <div class="d-file"><span class="d-dot" style="background:${color}"></span><span class="d-name">${file.name}</span></div>
    <div class="d-crumb">${crumb}</div>
    <div class="d-meta">
      <div class="m"><span class="k">Type</span><span class="v">${lang}</span></div>
      <div class="m"><span class="k">Taille</span><span class="v">${formatSize(file.size)}</span></div>
      <div class="m"><span class="k">Modifié</span><span class="v">${formatDate(file.mtime)}</span></div>
      <div class="m"><span class="k">Git</span><span class="v"><span class="git ${g.cls}">${g.txt}</span></span></div>
    </div>
    ${body}
    <div class="d-actions">
      <button class="d-btn" id="d-isolate">Isoler la branche</button>
      <button class="d-btn ghost" id="d-center">Centrer</button>
    </div>`;
  detail.querySelector('#d-isolate').addEventListener('click', () => isolateNode(file));
  detail.querySelector('#d-center').addEventListener('click', () => scene.flyTo({ pos: file.pos, depth: 3, type: 'file', children: null }));
}
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
$('#d-close').addEventListener('click', () => detail.classList.remove('show'));

// keyboard
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { scene.resetView(); detail.classList.remove('show'); }
  if (e.key === '/' && document.activeElement !== search) { e.preventDefault(); search.focus(); }
});
