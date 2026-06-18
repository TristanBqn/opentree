# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

No build step. Open the HTML files directly via a local static server (required — ES modules don't work on `file://` in Chrome):

```bash
npx serve .          # then open http://localhost:3000/inspector/OpenTree.html
# or
python3 -m http.server 8080
```

Entry points:
- `inspector/OpenTree.html` — OpenTree inspector (main product)
- `arbore/Arbore - Cartographie 3D.html` — Arbore demo tree

## Architecture

Two independent visualisers that share the same module split pattern:

| Module | Role |
|--------|------|
| `data.js` | Pure data generation — no DOM, no THREE. Builds the node tree (`{ id, name, path, type, children, pos?, … }`). |
| `layout.js` | Pure math — assigns world-space `pos` and `dir` to every node using a fibonacci-sphere branch layout. |
| `themes.js` | Plain config objects — fog, palette, glow, branch, file material params. |
| `content.js` | Formatting helpers (`formatSize`, `relDate`, `snippet`) — no side effects. |
| `scene.js` / `scene-v2.js` | THREE.js scene. Exports a single `createScene(container, callbacks)` factory. |
| `main.js` / `main-v2.js` | DOM wiring only. Calls `createScene`, then wires all UI events. |

**`createScene` callback contract** — the scene never touches the DOM directly; it calls back:
- `onHover(node, x, y)` / `onContext(node, x, y)` — tooltip
- `onPick(file, x, y)` — file bubble / detail panel
- `onLabel(node, x, y)` — folder bubble
- `onIsland(isl)` — island info card (inspector only)
- `onCounts({ match, total, isolated })` — HUD counter

**`scene-v2.js` vs `scene.js`** — v2 adds: multi-island layout (host + 3 Docker containers each at their own `origin`), ShaderMaterial veins that encode usage as luminosity (`aFlow` attribute), CSS2D island plates with health indicators, and a label declutter pass (`declutterLabels`) that projects labels to screen space and suppresses overlaps.

## Inspector data model (`inspector/data.js`)

`buildArchitecture()` returns an array of **islands**:
```js
{ id, kind: 'host'|'container', name, status, stats, ports, rootLen, origin: [x,y,z], root: DirNode }
```
Each island's tree is laid out independently then translated to `origin`. Usage is modelled as `usage30: number[30]` (daily counts) per node; `uses` is the 30-day sum. The host VPS (`~/openclaw`) and three containers (`gateway-1`, `cli-1`, `cli-run`) are hardcoded with realistic heat values.

## Key invariants

- THREE.js is loaded from CDN via importmap (`three@0.160.0` on jsdelivr) — no local install.
- All random generation uses `mulberry32(0xC0FFEE)` — deterministic, call order matters.
- Node IDs (`idc` counter) must be stable across a session; `buildProject()` / `buildArchitecture()` reset `idc = 0` at the top.
- Branch color assignment: `cidx = (bid * stride) % paletteLen` with `stride = 3` to spread hues.
- `isolated` state lives in `scene-v2.js` closure; `refresh()` re-renders visibility without rebuilding geometry.
