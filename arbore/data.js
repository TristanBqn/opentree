// Generates a deterministic, realistic example project tree (~500 files).
// Each node: { name, path, type:'dir'|'file', ext, size, mtime, git, children[] }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0xC0FFEE);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const NOW = Date.UTC(2026, 5, 9);
const DAY = 86400000;
function mtime() {
  // skew toward recent
  const d = Math.floor(Math.pow(rnd(), 2.2) * 400);
  return NOW - d * DAY - Math.floor(rnd() * DAY);
}
function gitStatus() {
  const r = rnd();
  if (r < 0.06) return 'modified';
  if (r < 0.09) return 'added';
  if (r < 0.105) return 'untracked';
  return 'clean';
}

// component / module name banks for plausible filenames
const NOUNS = ['User', 'Account', 'Session', 'Project', 'Workspace', 'Canvas', 'Node', 'Edge', 'Graph', 'Tree', 'Branch', 'Token', 'Auth', 'Profile', 'Settings', 'Theme', 'Layout', 'Sidebar', 'Toolbar', 'Modal', 'Dialog', 'Tooltip', 'Dropdown', 'Menu', 'Card', 'Badge', 'Avatar', 'Button', 'Input', 'Select', 'Slider', 'Toggle', 'Tabs', 'Table', 'List', 'Grid', 'Chart', 'Editor', 'Viewer', 'Player', 'Upload', 'Search', 'Filter', 'Notification', 'Toast', 'Banner', 'Skeleton', 'Spinner', 'Pagination', 'Breadcrumb', 'Command', 'Palette', 'Drawer', 'Sheet', 'Popover', 'Calendar', 'DatePicker', 'Form', 'Field', 'Label', 'Checkbox', 'Radio', 'Stepper', 'Wizard', 'Gallery', 'Carousel', 'Map', 'Marker', 'Cluster', 'Timeline', 'Feed', 'Comment', 'Reaction', 'Mention', 'Thread', 'Message', 'Channel', 'Room', 'Presence', 'Cursor', 'Selection', 'Clipboard', 'History', 'Undo', 'Diff', 'Merge', 'Commit', 'Repo', 'Pipeline', 'Job', 'Queue', 'Worker', 'Cache', 'Store', 'Slice', 'Reducer', 'Action', 'Effect', 'Saga', 'Hook', 'Provider', 'Context', 'Guard', 'Interceptor', 'Adapter', 'Gateway', 'Client', 'Service', 'Repository', 'Model', 'Schema', 'Entity', 'Dto', 'Mapper', 'Validator', 'Serializer', 'Logger', 'Tracer', 'Metric', 'Config', 'Env', 'Flag', 'Plugin', 'Extension', 'Skill', 'Agent', 'Prompt', 'Memory', 'Vector', 'Embedding', 'Index'];
const VERBS = ['use', 'get', 'set', 'fetch', 'load', 'save', 'create', 'update', 'delete', 'parse', 'format', 'render', 'compute', 'resolve', 'normalize', 'validate', 'serialize', 'transform', 'build', 'make', 'with', 'on'];

function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
function kebab(s) { return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(); }

let idc = 0;
function file(dir, name, ext) {
  const path = dir + '/' + name + (ext ? '.' + ext : '');
  return {
    id: ++idc, name: name + (ext ? '.' + ext : ''), path, type: 'file',
    ext: ext || '', size: rint(120, 38000), mtime: mtime(), git: gitStatus(),
  };
}
function dir(parentPath, name) {
  return { id: ++idc, name, path: parentPath ? parentPath + '/' + name : name, type: 'dir', children: [] };
}

// generic generators per folder kind --------------------------------------
function reactComponents(d, n) {
  for (let i = 0; i < n; i++) {
    const base = pick(NOUNS) + (rnd() < 0.4 ? pick(['Panel', 'View', 'Item', 'Row', 'Group', 'Provider', 'Container']) : '');
    const sub = dir(d.path, base);
    sub.children.push(file(sub.path, base, 'tsx'));
    if (rnd() < 0.7) sub.children.push(file(sub.path, base + '.module', 'css'));
    if (rnd() < 0.5) sub.children.push(file(sub.path, base + '.test', 'tsx'));
    if (rnd() < 0.25) sub.children.push(file(sub.path, base + '.stories', 'tsx'));
    if (rnd() < 0.3) sub.children.push(file(sub.path, 'index', 'ts'));
    d.children.push(sub);
  }
}
function hooks(d, n) { for (let i = 0; i < n; i++) d.children.push(file(d.path, 'use' + pick(NOUNS), 'ts')); }
function utils(d, n) { for (let i = 0; i < n; i++) d.children.push(file(d.path, lower(pick(VERBS) === 'use' ? pick(NOUNS) : pick(VERBS) + pick(NOUNS)), pick(['ts', 'ts', 'ts', 'js']))); }
function apiRoutes(d, n) {
  for (let i = 0; i < n; i++) {
    const r = dir(d.path, kebab(pick(NOUNS)));
    r.children.push(file(r.path, 'route', 'ts'));
    if (rnd() < 0.4) r.children.push(file(r.path, 'handler', 'ts'));
    if (rnd() < 0.3) r.children.push(file(r.path, 'schema', 'ts'));
    d.children.push(r);
  }
}

export function buildProject() {
  idc = 0;
  const root = dir('', 'arbore-app');
  root.children.push(file(root.path, 'README', 'md'));
  root.children.push(file(root.path, 'package', 'json'));
  root.children.push(file(root.path, 'tsconfig', 'json'));
  root.children.push(file(root.path, 'vite.config', 'ts'));
  root.children.push(file(root.path, '.gitignore', ''));

  // src ---------------------------------------------------------------
  const src = dir(root.path, 'src');
  const components = dir(src.path, 'components'); reactComponents(components, 26);
  const features = dir(src.path, 'features');
  ['canvas', 'auth', 'workspace', 'editor', 'billing', 'settings'].forEach((fn) => {
    const f = dir(features.path, fn);
    reactComponents(f, rint(3, 6));
    const fh = dir(f.path, 'hooks'); hooks(fh, rint(2, 5)); f.children.push(fh);
    const fa = dir(f.path, 'api'); utils(fa, rint(2, 4)); f.children.push(fa);
    f.children.push(file(f.path, 'index', 'ts'));
    f.children.push(file(f.path, fn + '.store', 'ts'));
    features.children.push(f);
  });
  const hooksD = dir(src.path, 'hooks'); hooks(hooksD, 18);
  const utilsD = dir(src.path, 'utils'); utils(utilsD, 22);
  const libD = dir(src.path, 'lib');
  ['three', 'graph', 'layout', 'color', 'math'].forEach((ln) => { const l = dir(libD.path, ln); utils(l, rint(2, 5)); libD.children.push(l); });
  const storeD = dir(src.path, 'store'); utils(storeD, 9); storeD.children.push(file(storeD.path, 'index', 'ts'));
  const pagesD = dir(src.path, 'pages');
  ['Home', 'Dashboard', 'Project', 'Settings', 'Login', 'NotFound'].forEach((p) => pagesD.children.push(file(pagesD.path, p, 'tsx')));
  const stylesD = dir(src.path, 'styles');
  ['globals', 'tokens', 'reset', 'themes'].forEach((s) => stylesD.children.push(file(stylesD.path, s, 'css')));
  const typesD = dir(src.path, 'types'); for (let i = 0; i < 7; i++) typesD.children.push(file(typesD.path, lower(pick(NOUNS)), 'ts'));
  src.children.push(components, features, hooksD, utilsD, libD, storeD, pagesD, stylesD, typesD);
  src.children.push(file(src.path, 'main', 'tsx'));
  src.children.push(file(src.path, 'App', 'tsx'));
  root.children.push(src);

  // server ------------------------------------------------------------
  const server = dir(root.path, 'server');
  const api = dir(server.path, 'api'); apiRoutes(api, 14);
  const dbD = dir(server.path, 'db');
  const models = dir(dbD.path, 'models'); for (let i = 0; i < 11; i++) models.children.push(file(models.path, pick(NOUNS), 'ts'));
  const migrations = dir(dbD.path, 'migrations'); for (let i = 0; i < 9; i++) migrations.children.push(file(migrations.path, '20260' + rint(1, 6) + rint(10, 28) + '_' + kebab(pick(VERBS) + pick(NOUNS)), 'sql'));
  dbD.children.push(models, migrations, file(dbD.path, 'client', 'ts'), file(dbD.path, 'seed', 'ts'));
  const mw = dir(server.path, 'middleware'); utils(mw, 7);
  const svc = dir(server.path, 'services'); for (let i = 0; i < 10; i++) svc.children.push(file(svc.path, pick(NOUNS) + 'Service', 'ts'));
  server.children.push(api, dbD, mw, svc, file(server.path, 'index', 'ts'), file(server.path, 'app', 'ts'));
  root.children.push(server);

  // tests -------------------------------------------------------------
  const tests = dir(root.path, 'tests');
  const unit = dir(tests.path, 'unit'); for (let i = 0; i < 18; i++) unit.children.push(file(unit.path, lower(pick(NOUNS)) + '.spec', 'ts'));
  const e2e = dir(tests.path, 'e2e'); for (let i = 0; i < 10; i++) e2e.children.push(file(e2e.path, kebab(pick(NOUNS)) + '.e2e', 'ts'));
  const fixtures = dir(tests.path, 'fixtures'); for (let i = 0; i < 8; i++) fixtures.children.push(file(fixtures.path, lower(pick(NOUNS)), 'json'));
  tests.children.push(unit, e2e, fixtures);
  root.children.push(tests);

  // docs --------------------------------------------------------------
  const docs = dir(root.path, 'docs');
  ['getting-started', 'architecture', 'api-reference', 'contributing', 'deployment', 'faq', 'changelog'].forEach((m) => docs.children.push(file(docs.path, m, 'md')));
  const guides = dir(docs.path, 'guides'); for (let i = 0; i < 9; i++) guides.children.push(file(guides.path, kebab(pick(VERBS) + pick(NOUNS)), 'md'));
  const adr = dir(docs.path, 'adr'); for (let i = 0; i < 6; i++) adr.children.push(file(adr.path, '000' + (i + 1) + '-' + kebab(pick(NOUNS)), 'md'));
  docs.children.push(guides, adr);
  root.children.push(docs);

  // public / assets ---------------------------------------------------
  const pub = dir(root.path, 'public');
  const img = dir(pub.path, 'images'); for (let i = 0; i < 16; i++) img.children.push(file(img.path, kebab(pick(NOUNS)), pick(['png', 'png', 'jpg', 'webp'])));
  const icons = dir(pub.path, 'icons'); for (let i = 0; i < 20; i++) icons.children.push(file(icons.path, kebab(pick(NOUNS)), 'svg'));
  const fonts = dir(pub.path, 'fonts'); ['Inter-Regular', 'Inter-Medium', 'Inter-Bold', 'Mono-Regular'].forEach((f) => fonts.children.push(file(fonts.path, f, 'woff2')));
  pub.children.push(img, icons, fonts, file(pub.path, 'favicon', 'ico'), file(pub.path, 'manifest', 'json'));
  root.children.push(pub);

  // scripts / config / ci ---------------------------------------------
  const scripts = dir(root.path, 'scripts'); for (let i = 0; i < 9; i++) scripts.children.push(file(scripts.path, kebab(pick(VERBS) + pick(NOUNS)), pick(['ts', 'sh', 'mjs'])));
  root.children.push(scripts);
  const config = dir(root.path, 'config');
  ['eslint', 'prettier', 'jest', 'tailwind', 'postcss', 'docker'].forEach((c) => config.children.push(file(config.path, c + '.config', pick(['js', 'ts', 'json']))));
  root.children.push(config);
  const ci = dir(root.path, '.github');
  const wf = dir(ci.path, 'workflows'); ['ci', 'release', 'deploy', 'lint', 'codeql'].forEach((w) => wf.children.push(file(wf.path, w, 'yml')));
  ci.children.push(wf, file(ci.path, 'CODEOWNERS', ''), file(ci.path, 'PULL_REQUEST_TEMPLATE', 'md'));
  root.children.push(ci);

  // finalize: compute sizes, counts
  annotate(root, 0);
  return root;
}

function annotate(node, depth) {
  node.depth = depth;
  if (node.type === 'file') { node.count = 1; return node.size; }
  let total = 0, count = 0;
  for (const c of node.children) { total += annotate(c, depth + 1); count += c.count; }
  node.size = total; node.count = count;
  return total;
}

export function flatten(root) {
  const dirs = [], files = [];
  (function walk(n) {
    if (n.type === 'dir') { dirs.push(n); n.children.forEach(walk); }
    else files.push(n);
  })(root);
  return { dirs, files };
}
