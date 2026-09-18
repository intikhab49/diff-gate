#!/usr/bin/env node
// diff-gate: verify what an agent actually changed. Zero dependencies.
// Usage: node check.mjs [base-ref] [--offline]   (default: HEAD, i.e. uncommitted + untracked work)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

const args = process.argv.slice(2);
const base = args.find(a => !a.startsWith('--')) || 'HEAD';
const offline = args.includes('--offline') || /^(1|true)$/i.test(process.env.DG_OFFLINE || '');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
let root;
try { root = git('rev-parse', '--show-toplevel').trim(); } catch { console.log('diff-gate: not a git repo'); process.exit(2); }
process.chdir(root);
try { git('rev-parse', '--verify', '--quiet', base + '^{commit}'); } catch { console.log(`diff-gate: unknown ref '${base}'`); process.exit(2); }

// ---- collect added lines per file ----
const added = new Map(); // file -> string[]
const newFiles = new Set();
let removedCount = 0;
let cur = null, fromNull = false;
for (const line of git('diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-renames', base).split('\n')) {
  if (line.startsWith('diff --git')) cur = null;
  else if (line.startsWith('--- ')) fromNull = line === '--- /dev/null';
  else if (line.startsWith('+++ ')) {
    cur = line === '+++ /dev/null' ? null : line.slice(6);
    if (cur) { if (!added.has(cur)) added.set(cur, []); if (fromNull) newFiles.add(cur); }
  }
  else if (line.startsWith('@@')) continue;
  else if (line.startsWith('+') && cur) added.get(cur).push(line.slice(1).replace(/\r$/, ''));
  else if (line.startsWith('-')) removedCount++;
}
// Vendored, generated and lock files are never the agent's work, even when they aren't gitignored.
const VENDOR = /(^|\/)(node_modules|vendor|\.venv|venv|__pycache__|dist|build|out|\.next|coverage)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Cargo\.lock|composer\.lock)$|\.min\.(js|css)$/;
for (const f of [...added.keys()]) if (VENDOR.test(f)) { added.delete(f); newFiles.delete(f); }
for (const f of git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) {
  if (VENDOR.test(f)) continue;
  try { if (statSync(f).size < 1 << 20) { added.set(f, readFileSync(f, 'utf8').split(/\r?\n/)); newFiles.add(f); } } catch {}
}

const isJs = f => /\.(m|c)?[jt]sx?$/.test(f);
const isPy = f => f.endsWith('.py');
const isTest = f => /(^|\/)(tests?|__tests__|spec|e2e)\/|[._-](test|spec)\.|(^|\/)test_[^/]*\.py$/.test(f);
const findings = { block: [], warn: [], info: [] };

// ---- 1. imports that do not resolve (hallucinated modules/packages) ----
const pkgCache = new Map();
function nearestPkg(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    const p = path.join(d, 'package.json');
    if (existsSync(p)) {
      if (!pkgCache.has(p)) { try { const j = JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')); pkgCache.set(p, { deps: { ...j.dependencies, ...j.devDependencies, ...j.peerDependencies, ...j.optionalDependencies }, name: j.name }); } catch { pkgCache.set(p, null); } }
      if (pkgCache.get(p)) return pkgCache.get(p);
    }
    if (d === path.dirname(d) || d.length <= root.length) return null;
  }
}
// tsconfig/jsconfig "paths" (e.g. "@/*": ["./src/*"]). Returns true/false when an alias pattern matches, null when none does.
const tsCache = new Map();
function tsPaths(dir) {
  for (let d = dir; d.length >= root.length; d = path.dirname(d)) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const p = path.join(d, name);
      if (!existsSync(p)) continue;
      if (!tsCache.has(p)) {
        let cfg = null;
        try {
          const raw = readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, m => m[0] === '"' ? m : '').replace(/,(\s*[}\]])/g, '$1');
          const o = JSON.parse(raw).compilerOptions || {};
          if (o.paths) cfg = { base: path.resolve(d, o.baseUrl || '.'), paths: o.paths };
        } catch {}
        tsCache.set(p, cfg);
      }
      if (tsCache.get(p)) return tsCache.get(p);
    }
    if (d === path.dirname(d)) break;
  }
  return null;
}
function resolveAlias(spec, file) {
  const cfg = tsPaths(path.dirname(path.resolve(file)));
  if (!cfg) return null;
  for (const [pat, targets] of Object.entries(cfg.paths)) {
    const star = pat.indexOf('*');
    const hit = star < 0 ? spec === pat : spec.startsWith(pat.slice(0, star)) && spec.endsWith(pat.slice(star + 1));
    if (!hit) continue;
    const mid = star < 0 ? '' : spec.slice(star, spec.length - (pat.length - star - 1));
    return targets.some(t => { const abs = path.resolve(cfg.base, t.replace('*', mid)); return JS_EXT.some(e => existsSync(abs + e)); });
  }
  return null;
}
const JS_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.d.ts', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs'];
function jsResolves(spec, file) {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const abs = path.resolve(path.dirname(file), spec);
    const stripped = abs.replace(/\.(m|c)?js$/, ''); // TS ESM imports './x.js' for x.ts
    return JS_EXT.some(e => existsSync(abs + e) || existsSync(stripped + e));
  }
  if (spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0])) return true;
  const aliased = resolveAlias(spec, file);
  if (aliased !== null) return aliased;
  if (/^(@\/|~\/|#|\$)/.test(spec)) return 'alias';
  if (/^(https?:|data:|virtual:|bun:)/.test(spec) || /[?!]/.test(spec)) return true;
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  const pkg = nearestPkg(path.dirname(path.resolve(file)));
  if (pkg && (pkg.deps[name] || pkg.name === name)) return true;
  for (let d = path.dirname(path.resolve(file)); d.length >= root.length; d = path.dirname(d)) {
    if (existsSync(path.join(d, 'node_modules', name))) return 'undeclared';
    if (d === path.dirname(d)) break;
  }
  return false;
}
// Statement-position imports only, so prose like `import "whatever"` inside a comment or string doesn't count.
const JS_IMPORT = /(?:^\s*import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?|^\s*\}?\s*from\s+|^\s*export\s+(?:type\s+)?(?:[\w*{}\s,]+\s+)from\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"\s]+)['"]/g;
const BUILD_DIR = /(^|\/)(dist|build|out|\.next|\.nuxt|\.svelte-kit|coverage|generated)(\/|$)/;
const COMMENT = /^\s*(\/\/|\*|\/\*|#)/;
const undeclared = new Map();
let unverifiedAlias = 0;
const pyChecks = []; // [module, file]
const PY_IMPORT = /^(?:from\s+([\w.]+)\s+import\b|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))/;
for (const [file, lines] of added) {
  if (isJs(file)) {
    for (const l of lines) {
      if (COMMENT.test(l)) continue;
      for (const m of l.matchAll(JS_IMPORT)) {
        const r = jsResolves(m[1], file);
        if (r === false && BUILD_DIR.test(m[1])) findings.info.push(`${file}: '${m[1]}' points into build output, only exists after a build`);
        else if (r === false) findings.block.push(`${file}: import '${m[1]}' does not resolve (no such file, not a declared dependency, not installed)`);
        else if (r === 'undeclared') undeclared.set(m[1], (undeclared.get(m[1]) || 0) + 1);
        else if (r === 'alias') unverifiedAlias++;
      }
    }
  } else if (isPy(file)) {
    for (const l of lines) {
      const m = l.trim().match(PY_IMPORT); if (!m) continue;
      const mods = m[1] ? [m[1]] : m[2].split(',').map(s => s.trim());
      for (const mod of mods) if (!mod.startsWith('.')) pyChecks.push([mod.split('.')[0], file]);
    }
  }
}
if (unverifiedAlias) findings.info.push(`${unverifiedAlias} path-alias import(s) not verified (no tsconfig/jsconfig "paths" found)`);
for (const [spec, n] of undeclared) findings.info.push(`'${spec}' is imported in ${n} file(s) but only installed transitively, not declared in package.json`);
if (pyChecks.length) {
  const local = mod => pyChecks.some(([m, f]) => m === mod && [path.dirname(f), '.', 'src'].some(d => existsSync(path.join(d, mod + '.py')) || existsSync(path.join(d, mod))));
  const top = [...new Set(pyChecks.map(c => c[0]))].filter(mod => !local(mod));
  if (top.length) {
    let missing = [];
    try {
      const py = process.platform === 'win32' ? 'python' : 'python3';
      const out = execFileSync(py, ['-c', 'import sys,importlib.util as u\nfor m in sys.argv[1:]:\n  try:\n    s=u.find_spec(m)\n  except Exception:\n    s=None\n  s is None and print(m)', ...top], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      missing = out.split(/\r?\n/).filter(Boolean);
    } catch { findings.info.push('python not found: Python imports not verified'); }
    for (const mod of missing) for (const [m, f] of pyChecks) if (m === mod) findings.block.push(`${f}: import '${mod}' is not importable in this environment (hallucinated, or not installed)`);
  }
}

// ---- 2. new dependencies (compare manifests, so line-ending churn doesn't count) ----
const newNpm = new Map(), newPy = new Map(); // name -> manifest file
const privateNpm = new Set(), privatePy = new Set(); // manifests that may resolve from a private registry
const workspaceNames = new Set();
for (const f of new Set([...git('ls-files', '--', '*package.json').split('\n'), ...added.keys()].filter(f => f && path.basename(f) === 'package.json' && !VENDOR.test(f)))) {
  try { const n = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')).name; if (n) workspaceNames.add(n); } catch {}
}
// The registry name behind a manifest entry, or null when it doesn't come from the registry (workspace, file, git, url).
function npmName(n, v) {
  v = String(v);
  if (v.startsWith('npm:')) { const s = v.slice(4); const at = s.lastIndexOf('@'); return at > 0 ? s.slice(0, at) : s; }
  if (/^(workspace:|file:|link:|portal:|git|github:|https?:)/.test(v) || /^[\w.-]+\/[\w.-]+(#.*)?$/.test(v)) return null;
  return workspaceNames.has(n) ? null : n;
}
const hasCustomRegistry = file => [path.dirname(file), '.'].some(d => { try { return /^\s*registry\s*=/m.test(readFileSync(path.join(d, '.npmrc'), 'utf8')); } catch { return false; } });
for (const [file, lines] of added) {
  const b = path.basename(file);
  if (b === 'package.json') {
    const deps = txt => { try { const j = JSON.parse(txt.replace(/^﻿/, '')); return { ...j.dependencies, ...j.devDependencies, ...j.peerDependencies, ...j.optionalDependencies }; } catch { return {}; } };
    let before = {}; if (!newFiles.has(file)) try { before = deps(git('show', `${base}:${file}`)); } catch {}
    let after = {}; try { after = deps(readFileSync(file, 'utf8')); } catch {}
    const fresh = Object.entries(after).filter(([n]) => !(n in before));
    if (fresh.length) findings.warn.push(`${file}: new dependencies ${fresh.map(([n, v]) => `${n}@${v}`).join(', ')}: for each, name what it replaces or why the stdlib or existing deps can't do it`);
    for (const [n, v] of fresh) { const real = npmName(n, v); if (real) newNpm.set(real, file); }
    if (hasCustomRegistry(file)) privateNpm.add(file);
  } else if (/^requirements.*\.txt$/.test(b)) {
    const fresh = lines.map(l => l.trim()).filter(t => /^[A-Za-z][\w.-]*/.test(t));
    if (fresh.length) findings.warn.push(`${file}: new/changed requirements ${fresh.join(', ')}: say why each is needed`);
    for (const t of fresh.filter(t => !/:\/\/|\s@\s/.test(t))) newPy.set(t.match(/^[A-Za-z][\w.-]*/)[0], file);
    try { if (/^\s*(-i|--index-url|--extra-index-url)\b/m.test(readFileSync(file, 'utf8'))) privatePy.add(file); } catch {}
  }
}

// ---- 2b. registry lookup for new dependencies: does the package exist, and does it look like a fresh squat? ----
// Only runs when the diff adds a dependency. A network failure is reported as INFO, never as a finding against the code.
const POPULAR_NPM = 'react react-dom lodash express axios chalk commander debug moment dayjs uuid request typescript webpack vite next vue jquery underscore async bluebird yargs dotenv cors body-parser mongoose mongodb redis pg mysql mysql2 sequelize prisma zod jest mocha chai eslint prettier rxjs ws socket.io jsonwebtoken bcrypt bcryptjs nodemailer cheerio puppeteer sharp esbuild rollup tailwindcss postcss classnames prop-types styled-components graphql glob minimist semver fs-extra colors node-fetch cross-env nodemon winston validator crypto-js date-fns ramda immer redux zustand formik yup'.split(' ');
const POPULAR_PY = 'requests numpy pandas django flask fastapi scipy matplotlib pillow boto3 urllib3 setuptools pydantic sqlalchemy pytest beautifulsoup4 selenium tensorflow torch scikit-learn openai httpx aiohttp cryptography pyyaml jinja2 click colorama python-dateutil six psycopg2 redis celery uvicorn gunicorn lxml tqdm rich anthropic transformers'.split(' ');
// Edit distance where swapping two adjacent letters counts as one typo (lodahs -> lodash).
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let pp = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], pp[j - 2] + 1);
    }
    pp = prev; prev = cur;
  }
  return prev[b.length];
}
const lookalike = (name, popular) => {
  const k = name.toLowerCase().replace(/[-_.]/g, '');
  if (popular.some(p => p.replace(/[-_.]/g, '') === k)) return null;
  return popular.find(p => { const d = editDistance(k, p.replace(/[-_.]/g, '')); return d > 0 && d <= (k.length >= 8 ? 2 : 1); }) || null;
};
const DAY = 864e5, YOUNG_DAYS = 30, LOW_DOWNLOADS = 1000, MAX_LOOKUPS = 50;
async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function checkNpm(name, file) {
  // /latest is one version manifest (a few KB); the full document of a big package is megabytes.
  const [doc, dl] = await Promise.all([
    getJson(`https://registry.npmjs.org/${name.replace('/', '%2f')}/latest`),
    getJson(`https://api.npmjs.org/downloads/point/last-week/${name}`).then(j => j?.downloads ?? 0, () => null), // a downloads-API hiccup only loses this one signal
  ]);
  if (!doc) {
    if (name.startsWith('@') || privateNpm.has(file)) findings.warn.push(`${file}: '${name}' is not on the public npm registry: fine only if it comes from your private registry`);
    else findings.block.push(`${file}: '${name}' does not exist on the npm registry: invented package name. Remove it; never register or install a name to make this pass`);
    return;
  }
  const script = Object.keys(doc.scripts || {}).some(k => /^(pre|post)?install$/.test(k)) || !!doc.gypfile;
  const low = dl !== null && dl < LOW_DOWNLOADS;
  let ageDays = null;
  if (low) { const full = await getJson(`https://registry.npmjs.org/${name.replace('/', '%2f')}`); const c = full?.time?.created; if (c) ageDays = Math.floor((Date.now() - Date.parse(c)) / DAY); }
  // A lookalike name only counts when the package is also obscure: preact is one letter from react and fine.
  const young = ageDays !== null && ageDays < YOUNG_DAYS;
  report(name, file, { low, dl, ageDays, script, typo: (low || young) && lookalike(name, POPULAR_NPM), eco: 'npm' });
}
async function checkPy(name, file) {
  const doc = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (!doc) {
    if (privatePy.has(file)) findings.warn.push(`${file}: '${name}' is not on PyPI: fine only if it comes from your private index`);
    else findings.block.push(`${file}: '${name}' does not exist on PyPI: invented package name. Remove it; never register or install a name to make this pass`);
    return;
  }
  const first = Object.values(doc.releases || {}).flat().map(x => Date.parse(x.upload_time_iso_8601 || x.upload_time + 'Z')).filter(Number.isFinite).sort((a, b) => a - b)[0];
  report(name, file, { low: false, dl: null, ageDays: first ? Math.floor((Date.now() - first) / DAY) : null, script: false, typo: lookalike(name, POPULAR_PY), eco: 'PyPI' });
}
function report(name, file, { low, dl, ageDays, script, typo, eco }) {
  const young = ageDays !== null && ageDays < YOUNG_DAYS;
  const signals = [young && `first published ${ageDays} day(s) ago`, low && `${dl} downloads last week`, script && 'runs an install script', typo && `one typo away from '${typo}'`].filter(Boolean);
  if (young && (script || typo) && (low || eco === 'PyPI')) findings.block.push(`${file}: '${name}' looks like a squatted package on ${eco} (${signals.join(', ')}): do not install it; use the real package or none`);
  else if (young || low || typo) findings.warn.push(`${file}: '${name}' on ${eco}: ${signals.join(', ')}: confirm this is the package you meant before installing`);
  else if (script) findings.info.push(`'${name}' runs an install script on install (normal for native/binary packages)`);
}
const lookups = [...[...newNpm].map(([n, f]) => [checkNpm, n, f]), ...[...newPy].map(([n, f]) => [checkPy, n, f])];
if (lookups.length && offline) findings.info.push(`registry lookup skipped (--offline): ${lookups.length} new package(s) not checked against npm/PyPI`);
else if (lookups.length && typeof fetch !== 'function') findings.info.push('registry lookup skipped: needs Node 18+');
else if (lookups.length) {
  const failed = [];
  const queue = lookups.slice(0, MAX_LOOKUPS);
  const worker = async () => { for (let job; (job = queue.shift());) { const [fn, n, f] = job; await fn(n, f).catch(e => failed.push(`${n} (${e.name === 'TimeoutError' ? 'timeout' : e.message})`)); } };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (failed.length) findings.info.push(`registry lookup failed, not checked: ${failed.join(', ')}`);
  if (lookups.length > MAX_LOOKUPS) findings.info.push(`registry lookup capped at ${MAX_LOOKUPS}: ${lookups.length - MAX_LOOKUPS} new package(s) not checked`);
}

// ---- 3. re-implemented helpers: a new top-level definition whose normalized name already exists ----
const DEF = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|def\s+([A-Za-z_]\w*)\s*\()/;
const norm = n => n.toLowerCase().replace(/[_$]/g, '');
const GENERIC = new Set(['main', 'init', 'setup', 'handler', 'default', 'run', 'test', 'render', 'get', 'set', 'update', 'create', 'load', 'app', 'index', 'teardown', 'post', 'put', 'delete', 'cleanup', 'submit', 'required', 'page', 'layout', 'generatemetadata', 'middleware', 'loader', 'action', 'config', 'helper', 'wrapper']);
const newDefs = [];
for (const [file, lines] of added) if (isJs(file) || isPy(file)) for (const l of lines) {
  const m = l.match(DEF); const n = m && (m[1] || m[2] || m[3]);
  if (n && n.length > 3 && !GENERIC.has(norm(n)) && !/^test/i.test(n)) newDefs.push([n, file]);
}
if (newDefs.length) {
  let existing = '';
  try { existing = git('grep', '-n', '-I', '-E', '^(export )?(default )?(async )?(function|const|let|def) ', base, '--', '*.js', '*.jsx', '*.ts', '*.tsx', '*.mjs', '*.cjs', '*.py'); } catch {}
  const index = new Map();
  for (const row of existing.split('\n')) {
    const m = row.match(/^[^:]+:(.+?):\d+:(.*)$/); if (!m) continue;
    const d = m[2].match(DEF); const n = d && (d[1] || d[2] || d[3]); if (!n) continue;
    const k = norm(n); if (!index.has(k)) index.set(k, new Set()); index.get(k).add(m[1]);
  }
  const byName = new Map();
  for (const [n, file] of newDefs) {
    const others = [...(index.get(norm(n)) || [])].filter(f => f !== file && existsSync(f)); // gone now = moved or deleted, not a duplicate
    if (!others.length) continue;
    if (!byName.has(n)) byName.set(n, { files: new Set(), others: new Set() });
    byName.get(n).files.add(file); others.forEach(o => byName.get(n).others.add(o));
  }
  const list = s => [...s].slice(0, 3).join(', ') + (s.size > 3 ? ` (+${s.size - 3} more)` : '');
  for (const [n, { files, others }] of byName) findings.warn.push(`'${n}' newly defined in ${list(files)} but already exists in ${list(others)}: reuse it or say why not`);
}

// ---- 4. size, untested logic, speculative structure, branding ----
const codeFiles = [...added.keys()].filter(f => isJs(f) || isPy(f));
const src = codeFiles.filter(f => !isTest(f));
const addedTotal = [...added.values()].reduce((s, l) => s + l.filter(x => x.trim()).length, 0);
const logicAdded = src.reduce((s, f) => s + added.get(f).filter(l => !COMMENT.test(l) && /\b(if|for|while|switch|case|catch|except|elif)\b/.test(l)).length, 0);
if (logicAdded >= 3 && !codeFiles.some(isTest)) findings.info.push(`${logicAdded} branches/loops added across ${src.length} source file(s) and no test file touched`);
const structure = src.flatMap(f => added.get(f)).filter(l => /\b(abstract class|interface \w+(Factory|Strategy|Provider|Manager|Service)|class \w+(Factory|Strategy|Manager|Builder))\b/.test(l));
if (structure.length) findings.info.push(`${structure.length} new factory/strategy/manager-style declaration(s): confirm each has more than one real use`);
const stamp = codeFiles.flatMap(f => added.get(f)).filter(l => /\b(ponytail|diff-gate):/i.test(l)).length;
if (stamp) findings.warn.push(`${stamp} tool-branded comment(s) in code: remove them`);

// ---- report ----
const out = [`## diff-gate vs ${base}`, `${added.size} file(s) changed, ${newFiles.size} new, +${addedTotal} / -${removedCount} lines`];
for (const [k, label] of [['block', 'BLOCK (must fix)'], ['warn', 'WARN (fix, or justify in one line)'], ['info', 'INFO']]) {
  const u = [...new Set(findings[k])];
  if (!u.length) continue;
  out.push(`\n### ${label}`);
  for (const x of u.slice(0, 20)) out.push('- ' + x);
  if (u.length > 20) out.push(`- ...and ${u.length - 20} more`);
}
if (!added.size) out.push('\nNOTHING TO CHECK: this diff is empty. If a task was meant to change code, it is not done.');
else if (!findings.block.length && !findings.warn.length) out.push('\nPASS: no unresolved imports, unknown packages, new deps, or duplicate helpers found.');
console.log(out.join('\n'));
process.exit(findings.block.length ? 1 : 0);
