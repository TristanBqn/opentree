// openclaw-inspector — architecture réelle du VPS openclaw-tristanb (Hetzner CX33).
// Hôte + 3 containers Docker, avec usage mocké sur 30 jours par fichier/dossier.

export const NOW = Date.UTC(2026, 5, 12, 15, 0, 0);
const DAY = 86400000;
const MIN = 60000;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0xC0FFEE);
const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

let idc = 0;

// ---- usage 30 jours -------------------------------------------------------
// heat 0..1 = intensité ; recent 0..1 = biais vers les derniers jours ;
// burst = container créé il y a 18 min : toute l'activité sur le dernier jour.
function genUsage(heat, recent = 0.5, burst = false) {
  const a = new Array(30).fill(0);
  if (burst) { a[29] = Math.max(1, Math.round(heat * (70 + rnd() * 90))); return a; }
  if (heat <= 0.002) { if (rnd() < 0.3) a[rint(2, 18)] = 1; return a; }
  for (let d = 0; d < 30; d++) {
    const wk = ((d + 4) % 7 >= 5) ? 0.45 : 1;           // creux le week-end
    const x = d / 29;
    const bias = Math.max(0.04, 1 + (recent - 0.5) * 2 * (x - 0.5) * 2);
    const p = heat * wk * bias;
    if (rnd() < Math.min(0.97, p * 1.2)) a[d] = Math.max(1, Math.round(p * (2 + rnd() * 16)));
  }
  return a;
}

// ---- noeuds ---------------------------------------------------------------
function file(parent, name, ext, heat = 0.2, o = {}) {
  heat = Math.min(1, heat);
  const full = ext ? name + '.' + ext : name;
  const usage30 = genUsage(heat, o.recent ?? 0.5, o.burst);
  const uses = usage30.reduce((s, v) => s + v, 0);
  let last = -1; usage30.forEach((v, i) => { if (v > 0) last = i; });
  const mtime = o.mtime ?? (last >= 0
    ? NOW - (29 - last) * DAY - Math.floor(rnd() * DAY * 0.6)
    : NOW - rint(60, 400) * DAY);
  const createdAt = o.createdAt ?? Math.min(mtime, NOW - rint(40, 420) * DAY);
  const f = {
    id: ++idc, name: full, path: parent.path + '/' + full, type: 'file',
    ext: ext || '', size: o.size ?? rint(140, 42000), heat, usage30, uses,
    mtime, createdAt,
    git: heat > 0.72 && rnd() < 0.45 ? 'modified' : (rnd() < 0.04 ? 'added' : 'clean'),
  };
  parent.children.push(f);
  return f;
}
function dir(parent, name) {
  const d = { id: ++idc, name, path: parent ? parent.path + '/' + name : name, type: 'dir', children: [] };
  if (parent) parent.children.push(d);
  return d;
}
// fill(d, [[name, ext, heat], …], opts)
function fill(d, list, o) { list.forEach(([n, e, h]) => file(d, n, e, h, o)); }
// série de fichiers ts homogènes
function tsFiles(d, names, heat, o) { names.forEach((n) => file(d, n, 'ts', Math.min(1, heat * (0.65 + rnd() * 0.7)), o)); }

// ---- HÔTE : ~/openclaw (repo docker-compose) ------------------------------
function buildHost() {
  const r = dir(null, '~/openclaw');
  fill(r, [
    ['docker-compose', 'yml', 0.92], ['docker-compose.override', 'yml', 0.85],
    ['docker-compose.yml', 'bak', 0], ['.env', '', 0.6], ['Dockerfile', '', 0.4],
    ['Dockerfile.wacli', '', 0.04], ['openclaw', 'mjs', 0.66], ['package', 'json', 0.7],
    ['pnpm-lock', 'yaml', 0.5], ['pnpm-workspace', 'yaml', 0.2], ['npm-shrinkwrap', 'json', 0.06],
    ['README', 'md', 0.14], ['AGENTS', 'md', 0.5], ['CHANGELOG', 'md', 0.2],
    ['VISION', 'md', 0.04], ['SECURITY', 'md', 0.02], ['CONTRIBUTING', 'md', 0.02],
    ['LICENSE', '', 0], ['fly', 'toml', 0], ['render', 'yaml', 0], ['appcast', 'xml', 0.02],
    ['tsconfig', 'json', 0.3], ['tsconfig.core', 'json', 0.1], ['tsdown.config', 'ts', 0.15],
    ['vitest.config', 'ts', 0.1],
  ], { recent: 0.7 });

  const src = dir(r, 'src');
  tsFiles(src, ['index', 'types'], 0.6);
  const gw = dir(src, 'gateway');
  tsFiles(gw, ['server', 'router', 'ws', 'sessions', 'health'], 0.88, { recent: 0.8 });
  tsFiles(gw, ['auth', 'metrics', 'proxy'], 0.45);
  const cli = dir(src, 'cli');
  tsFiles(cli, ['index', 'repl', 'render', 'args'], 0.62);
  const cmds = dir(cli, 'commands');
  tsFiles(cmds, ['run', 'chat', 'status', 'logs', 'config', 'session', 'doctor', 'update'], 0.5);
  const ag = dir(src, 'agents');
  tsFiles(ag, ['orchestrator', 'planner', 'executor', 'context'], 0.85, { recent: 0.8 });
  const pr = dir(ag, 'prompts');
  fill(pr, [['system', 'md', 0.6], ['planner', 'md', 0.5], ['executor', 'md', 0.55],
    ['critique', 'md', 0.25], ['summarize', 'md', 0.45], ['recovery', 'md', 0.12]]);
  const ch = dir(src, 'channels');
  fill(ch, [['whatsapp', 'ts', 0.82], ['webchat', 'ts', 0.6], ['telegram', 'ts', 0.48],
    ['discord', 'ts', 0.28], ['slack', 'ts', 0.08], ['email', 'ts', 0.04]]);
  const me = dir(src, 'memory');
  tsFiles(me, ['store', 'embeddings', 'recall', 'compact'], 0.52);
  const to = dir(src, 'tools');
  tsFiles(to, ['shell', 'files', 'browser', 'search', 'cron', 'registry'], 0.6);
  const inf = dir(src, 'infra');
  tsFiles(inf, ['logger', 'config', 'env', 'docker', 'telemetry'], 0.55);

  const pk = dir(r, 'packages');
  const core = dir(pk, 'core');
  file(core, 'package', 'json', 0.2);
  tsFiles(core, ['events', 'queue', 'retry', 'schema', 'ids', 'time'], 0.62);
  const sdk = dir(pk, 'plugin-sdk');
  file(sdk, 'package', 'json', 0.15);
  tsFiles(sdk, ['plugin', 'manifest', 'hooks', 'permissions', 'testkit'], 0.42);
  const sh = dir(pk, 'shared');
  tsFiles(sh, ['format', 'errors', 'http', 'crypto', 'paths', 'locks'], 0.5);
  const wa = dir(pk, 'wacli');
  file(wa, 'package', 'json', 0.05);
  tsFiles(wa, ['client', 'qr', 'media', 'sync'], 0.14);

  const apps = dir(r, 'apps');
  const web = dir(apps, 'web');
  fill(web, [['App', 'tsx', 0.4], ['Chat', 'tsx', 0.45], ['Sessions', 'tsx', 0.32],
    ['Settings', 'tsx', 0.2], ['api', 'ts', 0.38], ['theme', 'css', 0.18],
    ['index', 'html', 0.1], ['vite.config', 'ts', 0.06]]);
  const desk = dir(apps, 'desktop');
  fill(desk, [['main', 'ts', 0.06], ['tray', 'ts', 0.04], ['updater', 'ts', 0.03],
    ['preload', 'ts', 0.03], ['package', 'json', 0.02]]);

  const ui = dir(r, 'ui');
  const comp = dir(ui, 'components');
  fill(comp, [['MessageList', 'tsx', 0.5], ['Composer', 'tsx', 0.55], ['SessionCard', 'tsx', 0.4],
    ['AgentBadge', 'tsx', 0.35], ['ToolCall', 'tsx', 0.45], ['Markdown', 'tsx', 0.38],
    ['Modal', 'tsx', 0.2], ['Toast', 'tsx', 0.18], ['Spinner', 'tsx', 0.15],
    ['Tabs', 'tsx', 0.12], ['Avatar', 'tsx', 0.1], ['tokens', 'css', 0.3]]);
  const views = dir(ui, 'views');
  fill(views, [['Inbox', 'tsx', 0.42], ['Thread', 'tsx', 0.48], ['Memory', 'tsx', 0.25],
    ['Tools', 'tsx', 0.3], ['Logs', 'tsx', 0.5], ['Health', 'tsx', 0.55]]);
  const assets = dir(ui, 'assets');
  fill(assets, [['logo', 'svg', 0.08], ['claw', 'svg', 0.1], ['empty', 'svg', 0.03],
    ['notification', 'mp3', 0.2], ['fonts', 'css', 0.05]]);

  const ext = dir(r, 'extensions');
  const voice = dir(ext, 'voice');
  fill(voice, [['index', 'ts', 0.5], ['stt', 'ts', 0.45], ['tts', 'ts', 0.4], ['manifest', 'json', 0.1]]);
  const brw = dir(ext, 'browser');
  fill(brw, [['index', 'ts', 0.55], ['driver', 'ts', 0.5], ['scrape', 'ts', 0.42], ['manifest', 'json', 0.1]]);
  const cal = dir(ext, 'calendar');
  fill(cal, [['index', 'ts', 0.22], ['ics', 'ts', 0.18], ['manifest', 'json', 0.05]]);
  const pay = dir(ext, 'payments');
  fill(pay, [['index', 'ts', 0.03], ['stripe', 'ts', 0.02], ['manifest', 'json', 0.01]]);

  const skills = dir(r, 'skills');
  [['weather', 0.55], ['summarize', 0.7], ['deploy', 0.5], ['translate', 0.3],
   ['backup', 0.45], ['scrape', 0.35], ['monitor', 0.65], ['digest', 0.18]].forEach(([n, h]) => {
    const s = dir(skills, n);
    file(s, 'SKILL', 'md', h * 0.8);
    file(s, 'run', 'ts', h);
  });

  const cfg = dir(r, 'config');
  fill(cfg, [['openclaw', 'json', 0.92], ['models', 'json', 0.7], ['channels', 'json', 0.65],
    ['providers', 'json', 0.5], ['logging', 'json', 0.28], ['secrets.example', 'json', 0.04]], { recent: 0.8 });

  const dep = dir(r, 'deploy');
  fill(dep, [['compose.prod', 'yml', 0.32], ['nginx', 'conf', 0.2], ['hetzner', 'md', 0.12],
    ['openclaw.service', '', 0.15], ['rollback', 'sh', 0.08]]);

  const scr = dir(r, 'scripts');
  fill(scr, [['healthcheck', 'sh', 0.85], ['restart', 'sh', 0.68], ['backup', 'sh', 0.5],
    ['update', 'sh', 0.55], ['clean-logs', 'sh', 0.4], ['migrate', 'ts', 0.18]]);

  const docs = dir(r, 'docs');
  fill(docs, [['getting-started', 'md', 0.1], ['architecture', 'md', 0.12], ['channels', 'md', 0.08],
    ['skills', 'md', 0.1], ['deployment', 'md', 0.09], ['api', 'md', 0.05],
    ['faq', 'md', 0.04], ['troubleshooting', 'md', 0.16]]);

  const test = dir(r, 'test');
  fill(test, [['gateway.spec', 'ts', 0.14], ['agents.spec', 'ts', 0.16], ['channels.spec', 'ts', 0.1],
    ['memory.spec', 'ts', 0.08], ['tools.spec', 'ts', 0.1], ['cli.spec', 'ts', 0.07],
    ['e2e.spec', 'ts', 0.12], ['fixtures', 'json', 0.05]]);

  const qa = dir(r, 'qa');
  fill(qa, [['checklist', 'md', 0.02], ['scenarios', 'md', 0.02], ['report-mai', 'md', 0.01], ['report-juin', 'md', 0.03]]);

  const sec = dir(r, 'security');
  fill(sec, [['audit', 'md', 0.2], ['policies', 'json', 0.3], ['allowlist', 'json', 0.25], ['rotate-keys', 'sh', 0.1]]);

  const pat = dir(r, 'patches');
  fill(pat, [['ws-reconnect', 'patch', 0.01], ['pino-redact', 'patch', 0.01], ['undici-timeout', 'patch', 0.02]]);

  const gh = dir(r, 'git-hooks');
  fill(gh, [['pre-commit', '', 0.05], ['pre-push', '', 0.03], ['commit-msg', '', 0.04]]);

  return r;
}

// ---- CONTAINERS : /app ----------------------------------------------------
function appTree(rootName, heat, o = {}) {
  const r = dir(null, rootName);
  const k = (h) => Math.min(1, h * heat);
  file(r, 'package', 'json', k(0.2), o);
  file(r, 'entrypoint', 'sh', k(0.3), o);

  const dist = dir(r, 'dist');
  file(dist, 'index', 'js', k(0.95), o);
  const dgw = dir(dist, 'gateway');
  fill(dgw, [['server', 'js', k(0.9)], ['router', 'js', k(0.8)], ['ws', 'js', k(0.8)],
    ['health', 'js', k(1)], ['auth', 'js', k(0.5)]], o);
  const dch = dir(dist, 'channels');
  fill(dch, [['whatsapp', 'js', k(0.85)], ['webchat', 'js', k(0.6)], ['telegram', 'js', k(0.45)]], o);
  const dag = dir(dist, 'agents');
  fill(dag, [['orchestrator', 'js', k(0.85)], ['executor', 'js', k(0.8)], ['planner', 'js', k(0.7)]], o);

  const nm = dir(r, 'node_modules');
  [['ws', 0.5], ['pino', 0.6], ['zod', 0.45], ['undici', 0.5], ['bottleneck', 0.4],
   ['express', 0.3], ['better-sqlite3', 0.35]].forEach(([n, h]) => {
    const p = dir(nm, n);
    file(p, 'index', 'js', k(h * 0.4), o);
  });

  const cfg = dir(r, 'config');
  fill(cfg, [['runtime', 'json', k(0.7)], ['channels', 'json', k(0.6)]], o);

  const data = dir(r, 'data');
  const sess = dir(data, 'sessions');
  fill(sess, [['main', 'json', k(0.9)], ['wa-tristan', 'json', k(0.85)], ['webchat-01', 'json', k(0.6)],
    ['cron-digest', 'json', k(0.35)]], o);
  const cache = dir(data, 'cache');
  fill(cache, [['embeddings', 'bin', k(0.5)], ['media', 'bin', k(0.4)], ['http', 'bin', k(0.45)]], o);
  const logs = dir(data, 'logs');
  return { r, logs, o, k };
}

function buildGateway() {
  const { r, logs, k } = appTree('gateway-1:/app', 1, { recent: 0.65 });
  fill(logs, [['gateway', 'log', 0.95], ['access', 'log', 0.8], ['error', 'log', 0.25]], { recent: 0.65, size: rint(80000, 900000) });
  return r;
}
function buildCliDead() {
  // unhealthy depuis ~25 h : activité en début de mois, plus rien — sauf error.log
  const { r, logs } = appTree('cli-1:/app', 0.06, { recent: 0.12 });
  fill(logs, [['cli', 'log', 0.3]], { recent: 0.1, size: rint(40000, 200000) });
  file(logs, 'error', 'log', 0.55, { recent: 0.97, size: rint(120000, 600000) });
  return r;
}
function buildCliRun() {
  // créé il y a 18 min : burst — toute l'activité sur aujourd'hui
  const o = { burst: true, createdAt: NOW - 18 * MIN };
  const { r, logs } = appTree('cli-run:/app', 0.95, o);
  fill(logs, [['run', 'log', 0.95], ['tools', 'log', 0.7]], { ...o, size: rint(30000, 250000) });
  const ws = dir(r.children.find((c) => c.name === 'data'), 'workspace');
  fill(ws, [['task', 'md', 0.85], ['plan', 'json', 0.7], ['output', 'json', 0.9], ['scratch', 'ts', 0.6]], o);
  return r;
}

// ---- agrégation -----------------------------------------------------------
function annotate(node, depth) {
  node.depth = depth;
  if (node.type === 'file') { node.count = 1; return node; }
  let size = 0, count = 0, uses = 0;
  const u30 = new Array(30).fill(0);
  let created = Infinity, mt = 0;
  for (const c of node.children) {
    annotate(c, depth + 1);
    size += c.size; count += c.count; uses += c.uses;
    created = Math.min(created, c.createdAt); mt = Math.max(mt, c.mtime);
    for (let i = 0; i < 30; i++) u30[i] += c.usage30[i];
  }
  node.size = size; node.count = count; node.uses = uses;
  node.usage30 = u30; node.createdAt = created === Infinity ? NOW : created; node.mtime = mt || NOW;
  return node;
}

export function buildArchitecture() {
  idc = 0;
  const islands = [
    {
      id: 'host', kind: 'host', name: 'openclaw-tristanb',
      statusTxt: 'en ligne', status: 'ok',
      stats: 'Hetzner CX33 · Ubuntu 24.04 · 4 vCPU · 7,6 Gi',
      ports: 'disque 28 G / 150 G · ~/openclaw',
      rootLen: 10, origin: [0, 0, 0], root: buildHost(),
    },
    {
      id: 'gateway', kind: 'container', name: 'openclaw-gateway-1',
      statusTxt: 'healthy · up 18 min', status: 'healthy',
      stats: 'CPU 0,56 % · RAM 289 MiB',
      ports: '127.0.0.1 : 3978 · 8742 · 18789-90',
      rootLen: 6, origin: [-26, 0, -6], root: buildGateway(),
    },
    {
      id: 'cli', kind: 'container', name: 'openclaw-cli-1',
      statusTxt: 'unhealthy · up 25 h', status: 'unhealthy',
      stats: 'CPU 0 % · RAM 0 B',
      ports: 'openclaw:local',
      rootLen: 5.2, origin: [24, 0, -15], root: buildCliDead(),
    },
    {
      id: 'cli-run', kind: 'container', name: 'openclaw-cli-run-e0e3205',
      statusTxt: 'healthy · up 18 min', status: 'healthy',
      stats: 'CPU 13,1 % · RAM 355 MiB',
      ports: 'openclaw:local',
      rootLen: 5.6, origin: [15, 0, 22], root: buildCliRun(),
    },
  ];
  islands.forEach((isl) => {
    annotate(isl.root, 0);
    (function tag(n) { n.iid = isl.id; n.children?.forEach(tag); })(isl.root);
  });
  return islands;
}

export function flatten(root) {
  const dirs = [], files = [];
  (function walk(n) {
    if (n.type === 'dir') { dirs.push(n); n.children.forEach(walk); }
    else files.push(n);
  })(root);
  return { dirs, files };
}
