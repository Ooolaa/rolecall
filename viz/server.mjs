// Read-only, local-only viewer for a live Team run. Stdlib only.
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEAM = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT = /^agent-a([A-Za-z0-9_-]+)-[0-9a-f]+\.jsonl$/;
const META = /^agent-a[A-Za-z0-9_-]+-[0-9a-f]+\.meta\.json$/;
const TASK = /^[A-Za-z0-9_-]+\.json$/;
const CAP = 5 * 1024 * 1024;

const list = (dir) => readdir(dir).catch(() => []);
const str = (v) => (typeof v === 'string' ? v : '');

async function readJson(path) {
  try {
    if ((await stat(path)).size > CAP) return null;
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

// ponytail: per-file reparse on any change; tail from last offset if transcripts get huge.
const cache = new Map();

// Only SendMessage tool_use blocks leave this function, and only their to/summary/message.
async function sends(path, from) {
  let s;
  try { s = await stat(path); } catch { return []; }
  if (!s.isFile()) return [];
  const key = `${s.mtimeMs}:${s.size}`;
  if (cache.get(path)?.key === key) return cache.get(path).msgs;
  const msgs = [];
  try {
    for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
      if (!line.includes('"SendMessage"')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o?.type !== 'assistant') continue; // api-request-blob lines replay the same sends
      const content = o?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b?.type !== 'tool_use' || b.name !== 'SendMessage' || !b.input || typeof b.input !== 'object') continue;
        const { to, message, summary } = b.input;
        const plain = typeof message === 'string';
        msgs.push({
          from, to: to === 'main' ? 'team-lead' : str(to), // "main" is the lead's own address
          summary: plain ? str(summary) : str(message?.type) || 'protocol',
          text: plain ? message : '',
          ts: str(o.timestamp),
        });
      }
    }
  } catch {
    // A file that vanishes mid-read keeps what was parsed.
  }
  cache.set(path, { key, msgs });
  return msgs;
}

// A meta file's teamName, cached by mtime and size so a 2 s poll doesn't reparse every session.
// ponytail: still one readdir per session dir per poll; cache the dir listing if projects/ gets huge.
const metas = new Map();
async function metaTeam(path) {
  const s = await stat(path).catch(() => null);
  if (!s) return null;
  const key = `${s.mtimeMs}:${s.size}`;
  if (metas.get(path)?.key !== key) metas.set(path, { key, team: (await readJson(path))?.teamName ?? null });
  return metas.get(path).team;
}

// A resumed lead gets a new session id while config.leadSessionId keeps the old one,
// so a session also belongs to the team when one of its teammates' meta files says so.
async function sessions(dir, team, leadSessionId) {
  const ids = new Set(typeof leadSessionId === 'string' && UUID.test(leadSessionId) ? [leadSessionId] : []);
  for (const id of await list(dir)) {
    if (!UUID.test(id) || ids.has(id)) continue;
    const sub = join(dir, id, 'subagents');
    for (const f of (await list(sub)).filter((f) => META.test(f))) {
      if ((await metaTeam(join(sub, f))) === team) { ids.add(id); break; }
    }
  }
  return [...ids];
}

async function messages(root, team, leadSessionId, leadCwd, createdAt) {
  const projects = resolve(root, 'projects');
  const dir = resolve(projects, leadCwd.replace(/[^A-Za-z0-9]/g, '-'));
  if (!leadCwd || !dir.startsWith(projects + sep)) return [];
  // Resumed sessions copy earlier transcripts, so the union is deduped.
  const seen = new Map();
  for (const sid of await sessions(dir, team, leadSessionId)) {
    const sub = join(dir, sid, 'subagents');
    const files = [[join(dir, `${sid}.jsonl`), 'team-lead']];
    for (const f of await list(sub)) {
      const m = AGENT.exec(f);
      if (m) files.push([join(sub, f), m[1]]);
    }
    for (const [path, from] of files) {
      for (const msg of await sends(path, from)) {
        // The lead's session outlives teams, so earlier teams' sends are dropped.
        if (createdAt !== null && !(Date.parse(msg.ts) >= createdAt)) continue;
        seen.set(JSON.stringify([msg.from, msg.to, msg.ts, msg.text]), msg);
      }
    }
  }
  return [...seen.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

async function tasks(root, team) {
  const dir = join(root, 'tasks', team);
  const out = [];
  for (const f of (await list(dir)).filter((f) => TASK.test(f))) {
    const t = await readJson(join(dir, f));
    if (!t || typeof t !== 'object') continue;
    out.push({
      id: String(t.id ?? ''), subject: str(t.subject), status: str(t.status),
      owner: typeof t.owner === 'string' ? t.owner : null,
      blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy.map(String) : [],
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

// The empty tree as --attr-source means no .gitattributes applies, and core.attributesFile=/dev/null
// drops the global one, so no filter, textconv or diff driver from them can run. Needs git >= 2.40;
// an older git errors, which gives null.
// ponytail: waived by the user. .git/info/attributes still applies and no flag stops it, so a repo
// that plants a clean filter there runs it on the worktree diff. Diff <base> HEAD if that matters.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function git(bin, cwd, args, timeout) {
  return new Promise((done) => {
    const child = execFile(
      bin,
      [
        '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat',
        '-c', 'log.showSignature=false', '-c', 'core.attributesFile=/dev/null', `--attr-source=${EMPTY_TREE}`,
        '-C', cwd, ...args,
      ],
      // GIT_OPTIONAL_LOCKS=0: diff never refreshes or locks .git/index, so the viewer stays read-only.
      { timeout, killSignal: 'SIGKILL', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, out) => done(err ? null : out),
    );
    // A grandchild can keep the pipes open after the kill, so give up on them too.
    setTimeout(() => { child.stdout?.destroy(); child.stderr?.destroy(); done(null); }, timeout + 50).unref();
  });
}

// bin is for tests only: nothing from config, env or HTTP ever sets it.
export async function gitHealth(cwd, sinceMs, { timeout = 3000, bin = 'git' } = {}) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.startsWith('-') || !Number.isFinite(sinceMs)) return null;
  if (!(await stat(cwd).then((s) => s.isDirectory(), () => false))) return null;
  const run = (...args) => git(bin, cwd, args, timeout);
  const sec = Math.floor(sinceMs / 1000);
  const [branch, log, base] = await Promise.all([
    run('rev-parse', '--abbrev-ref', 'HEAD'),
    run('log', `--since=@${sec}`, '--format=%h'),
    run('log', '-1', `--before=@${sec}`, '--format=%H'),
  ]);
  if (branch === null || log === null || base === null) return null;
  let insertions = null;
  let deletions = null;
  if (/^[0-9a-f]{40,64}$/.test(base.trim())) {
    const short = await run('diff', '--shortstat', '--no-ext-diff', '--no-textconv', base.trim());
    if (short === null) return null;
    insertions = Number(/(\d+) insertion/.exec(short)?.[1] ?? 0);
    deletions = Number(/(\d+) deletion/.exec(short)?.[1] ?? 0);
  }
  return { branch: branch.trim(), commits: log.split('\n').filter(Boolean).length, insertions, deletions };
}

export async function readTeam(root, team) {
  if (typeof team !== 'string' || !TEAM.test(team)) throw new Error('invalid team');
  const config = await readJson(join(root, 'teams', team, 'config.json'));
  if (!config || !Array.isArray(config.members)) throw new Error(`no team ${team}`);
  const members = config.members.filter((m) => m && typeof m === 'object');
  const leadCwd = str(members.find((m) => m.agentType === 'team-lead')?.cwd);
  const createdAt = Number.isFinite(config.createdAt) ? config.createdAt : null;
  const names = new Set(['team-lead', ...members.map((m) => str(m.name))]);
  return {
    team,
    project: leadCwd ? basename(leadCwd) : null,
    createdAt,
    members: members.map((m) => ({ name: str(m.name), agentType: str(m.agentType), color: typeof m.color === 'string' ? m.color : null })),
    // Earlier teams in the same lead session have other names, so both ends must be members now.
    messages: (await messages(root, team, config.leadSessionId, leadCwd, createdAt)).filter((m) => names.has(m.from) && names.has(m.to)),
    tasks: await tasks(root, team),
    git: await gitHealth(leadCwd, createdAt),
  };
}

// A fixed route map: no URL path ever reaches the filesystem.
const here = fileURLToPath(new URL('.', import.meta.url));
const STATIC = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/app.css', ['app.css', 'text/css']]]);
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

// Binds 127.0.0.1 only, and checks Host and Origin so another site can't read it via DNS rebinding.
export function createServer({ root, team, port = 0 }) {
  const server = httpServer(async (req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { ...HEADERS, 'Content-Type': `${type}; charset=utf-8`, ...(status === 405 && { Allow: 'GET, HEAD' }) });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const hosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
    if (!hosts.includes(req.headers.host)) return send(403, 'text/plain', 'Forbidden');
    if (req.headers.origin !== undefined && !hosts.some((h) => req.headers.origin === `http://${h}`)) return send(403, 'text/plain', 'Forbidden');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'Method not allowed');
    try {
      if (req.url === '/api/state') return send(200, 'application/json', JSON.stringify(await readTeam(root, team)));
      const file = STATIC.get(req.url);
      if (!file) return send(404, 'text/plain', 'Not found');
      send(200, file[1], await readFile(join(here, file[0])));
    } catch {
      send(500, 'text/plain', 'Error');
    }
  });
  return new Promise((done, fail) => server.once('error', fail).listen(port, '127.0.0.1', () => done(server)));
}

async function newestTeam(root) {
  let best = null;
  for (const name of (await list(join(root, 'teams'))).filter((n) => TEAM.test(n))) {
    const s = await stat(join(root, 'teams', name, 'config.json')).catch(() => null);
    if (s && (!best || s.mtimeMs > best.mtimeMs)) best = { name, mtimeMs: s.mtimeMs };
  }
  return best?.name;
}

if (import.meta.main) {
  const root = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const team = process.argv[2] ?? (await newestTeam(root));
  try {
    await readTeam(root, team);
  } catch (e) {
    console.error(`Can't read team ${JSON.stringify(team ?? '')} in ${root}: ${e.message}`);
    process.exit(1);
  }
  const server = await createServer({ root, team, port: Number(process.env.PORT || 4747) });
  console.log(`http://127.0.0.1:${server.address().port}  (team ${team})`);
}
