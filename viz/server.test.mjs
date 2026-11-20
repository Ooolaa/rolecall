// Every fixture is built in a tmpdir laid out like ~/.claude: teams/, tasks/, projects/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer, gitHealth, readTeam } from './server.mjs';

const SID = '11111111-1111-4111-8111-111111111111';
const SID2 = '22222222-2222-4222-8222-222222222222';
const SID3 = '33333333-3333-4333-8333-333333333333';
const SID4 = '44444444-4444-4444-8444-444444444444';
const SID5 = '55555555-5555-4555-8555-555555555555';
const slugOf = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

const send = (ts, to, message, summary) => JSON.stringify({
  type: 'assistant', timestamp: ts,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'SendMessage', input: { to, message, summary } }] },
});
const jsonl = (...lines) => lines.join('\n') + '\n';
async function put(path, body) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, typeof body === 'string' ? body : JSON.stringify(body));
}

async function fixture({ leadSessionId = SID, leadCwd } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rolecall-viz-'));
  leadCwd ??= join(root, 'work', 'proj');
  await mkdir(join(root, 'work', 'proj'), { recursive: true });
  await put(join(root, 'teams', 't1', 'config.json'), {
    name: 't1', createdAt: Date.parse('2026-11-11T10:00:00Z'), leadSessionId,
    members: [
      { name: 'team-lead', agentType: 'team-lead', cwd: leadCwd, leadProcess: { pid: 1 } },
      { name: 'Skeptic-2', agentType: 'team-skeptic', color: 'pink', model: 'opus', prompt: 'PROMPT-SECRET', cwd: '/CWD-SECRET' },
      { name: 'Planner-2', agentType: 'team-planner', color: 'orange' },
      { name: '../x', agentType: 'weird', color: 'red' },
      { name: 'Builder-2', agentType: 'team-builder', color: 'cyan' },
    ],
  });
  await put(join(root, 'tasks', 't1', '1.json'), { id: '1', subject: 'Discuss: brief', description: 'd', status: 'completed', owner: 'Skeptic-2', blocks: ['2'], blockedBy: [] });
  await put(join(root, 'tasks', 't1', '2.json'), { id: '2', subject: 'Plan: write it', status: 'in_progress', owner: 'Planner-2', blockedBy: ['1'] });
  await put(join(root, 'tasks', 't1', '3.json'), { id: '3', subject: 'Build: code', status: 'pending', blockedBy: ['2'] });
  await put(join(root, 'tasks', 't1', '4.json'), '{not json');

  const dir = join(root, 'projects', slugOf(leadCwd));
  const skeptic = jsonl(
    send('2026-11-11T10:02:00Z', 'team-lead', 'brief text', 'brief'),
    send('2026-11-11T10:03:00Z', 'team-lead', { type: 'shutdown_response', request_id: 'r', approve: true }),
  );
  // The lead's own session: a SendMessage among secrets, a recipient copy and junk lines.
  await put(join(dir, `${SID}.jsonl`), [
    send('2026-11-11T10:01:00Z', 'Skeptic-2', 'hello skeptic', 'kickoff'),
    // The lead's session outlives teams: a send from before this team was created is not ours.
    send('2026-11-11T09:00:00Z', 'Skeptic', 'OLD-TEAM', 'earlier team'),
    send('2026-11-11T10:06:30Z', 'Gatekeeper', 'STALE-TO', 'to a former member'),
    JSON.stringify({ type: 'user', timestamp: '2026-11-11T10:01:30Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'sk-test-SECRET-123' }] } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-11-11T10:01:40Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'sk-test-SECRET-456' } }] } }),
    JSON.stringify({ type: 'user', timestamp: '2026-11-11T10:02:10Z', message: { role: 'user', content: '<teammate-message teammate_id="Skeptic-2">brief text</teammate-message>' } }),
    // Claude Code replays each request as an untimestamped blob; it is not a second send.
    send(undefined, 'Skeptic-2', 'hello skeptic', 'kickoff').replace('"type":"assistant"', '"type":"api-request-blob"'),
    'not json', 'null', '{}', '{"message":{"content":[null,{"type":"tool_use","name":"SendMessage"}]}}',
    '{"type":"assis',
  ].join('\n'));
  await put(join(dir, SID, 'subagents', 'agent-aSkeptic-2-c75f9ab1.jsonl'), skeptic);
  // A teammate from an earlier team in the same lead session: not a member, so not shown.
  await put(join(dir, SID, 'subagents', 'agent-aPlanner-0a1b2c.jsonl'), jsonl(send('2026-11-11T10:06:00Z', 'team-lead', 'STALE-FROM')));
  await put(join(dir, SID, 'subagents', 'agent-a..-x.jsonl'), jsonl(send('2026-11-11T10:09:00Z', 'x', 'EVIL-DOTDOT')));
  await put(join(dir, SID, 'subagents', 'notes.jsonl'), jsonl(send('2026-11-11T10:09:00Z', 'x', 'EVIL-NOTES')));

  // A resumed lead: a new session not in config, found by its teammates' meta files.
  // It also holds a copy of the Skeptic transcript, whose messages must appear once.
  await put(join(dir, `${SID2}.jsonl`), jsonl(send('2026-11-11T10:04:00Z', 'Planner-2', 'go plan')));
  await put(join(dir, SID2, 'subagents', 'agent-aPlanner-2-abc123.meta.json'), { name: 'Planner-2', teamName: 't1' });
  await put(join(dir, SID2, 'subagents', 'agent-aPlanner-2-abc123.jsonl'), jsonl(
    send('2026-11-11T10:05:00Z', 'Builder-2', 'plan ready', 'ready'),
    // "main" is the lead's own address.
    send('2026-11-11T10:05:30Z', 'main', 'to the lead', 'via main'),
  ));
  await put(join(dir, SID2, 'subagents', 'agent-aSkeptic-2-c75f9ab1.jsonl'), skeptic);

  // Sessions that must never be read: another team, a non-UUID dir, a corrupt meta, an oversized meta.
  const decoy = async (sid, meta, word) => {
    await put(join(dir, `${sid}.jsonl`), jsonl(send('2026-11-11T10:09:00Z', 'x', `${word}-LEAD`)));
    await put(join(dir, sid, 'subagents', 'agent-aOther-1234.meta.json'), meta);
    await put(join(dir, sid, 'subagents', 'agent-aOther-1234.jsonl'), jsonl(send('2026-11-11T10:09:00Z', 'x', word)));
  };
  await decoy(SID3, { teamName: 'other' }, 'DECOY');
  await decoy('memory', { teamName: 't1' }, 'MEMORYDIR');
  await decoy(SID4, '{bad', 'CORRUPTMETA');
  await decoy(SID5, JSON.stringify({ teamName: 't1', pad: 'x'.repeat(6 * 1024 * 1024) }), 'BIGMETA');
  await put(join(root, 'secret.jsonl'), jsonl(send('2026-11-11T10:09:00Z', 'x', 'OUTSIDE')));
  return { root, dir };
}

const shared = fixture();

test('readTeam returns whitelisted members, every SendMessage oldest first, and tasks', async () => {
  const { root } = await shared;
  const state = await readTeam(root, 't1');
  assert.equal(state.team, 't1');
  assert.equal(state.project, 'proj');
  assert.equal(state.createdAt, Date.parse('2026-11-11T10:00:00Z'));
  assert.deepEqual(state.members, [
    { name: 'team-lead', agentType: 'team-lead', color: null },
    { name: 'Skeptic-2', agentType: 'team-skeptic', color: 'pink' },
    { name: 'Planner-2', agentType: 'team-planner', color: 'orange' },
    { name: '../x', agentType: 'weird', color: 'red' },
    { name: 'Builder-2', agentType: 'team-builder', color: 'cyan' },
  ]);
  assert.deepEqual(state.messages, [
    { from: 'team-lead', to: 'Skeptic-2', summary: 'kickoff', text: 'hello skeptic', ts: '2026-11-11T10:01:00Z' },
    { from: 'Skeptic-2', to: 'team-lead', summary: 'brief', text: 'brief text', ts: '2026-11-11T10:02:00Z' },
    { from: 'Skeptic-2', to: 'team-lead', summary: 'shutdown_response', text: '', ts: '2026-11-11T10:03:00Z' },
    { from: 'team-lead', to: 'Planner-2', summary: '', text: 'go plan', ts: '2026-11-11T10:04:00Z' },
    { from: 'Planner-2', to: 'Builder-2', summary: 'ready', text: 'plan ready', ts: '2026-11-11T10:05:00Z' },
    { from: 'Planner-2', to: 'team-lead', summary: 'via main', text: 'to the lead', ts: '2026-11-11T10:05:30Z' },
  ]);
  assert.deepEqual(state.tasks, [
    { id: '1', subject: 'Discuss: brief', status: 'completed', owner: 'Skeptic-2', blockedBy: [] },
    { id: '2', subject: 'Plan: write it', status: 'in_progress', owner: 'Planner-2', blockedBy: ['1'] },
    { id: '3', subject: 'Build: code', status: 'pending', owner: null, blockedBy: ['2'] },
  ]);
});

test('A5: a team id that could leave teams/ is rejected before any read', async () => {
  const root = join(tmpdir(), 'rolecall-viz-does-not-exist');
  for (const id of ['..', '.', 'a.b', '%2e%2e', '../x', 'a%00b', '/etc', 'a/b', '', 'a\0b']) {
    await assert.rejects(readTeam(root, id), /invalid team/, JSON.stringify(id));
  }
});

test('A8: junk transcript lines and a corrupt task file are skipped, not fatal', async () => {
  const { root } = await shared;
  const state = await readTeam(root, 't1');
  assert.ok(state.messages.some((m) => m.text === 'hello skeptic'));
  assert.equal(state.tasks.length, 3);
});

test('A11: only SendMessage fields leave readTeam, never tool results, other tool input or prompts', async () => {
  const { root } = await shared;
  const json = JSON.stringify(await readTeam(root, 't1'));
  assert.ok(json.includes('hello skeptic'));
  for (const secret of ['sk-test-SECRET-123', 'sk-test-SECRET-456', 'PROMPT-SECRET', 'CWD-SECRET', 'opus', 'pid']) {
    assert.ok(!json.includes(secret), secret);
  }
});

test('A12: sessions and transcript files are found only by strict names inside projects/', async () => {
  const { root } = await shared;
  const json = JSON.stringify(await readTeam(root, 't1'));
  for (const word of ['OLD-TEAM', 'STALE-FROM', 'STALE-TO', 'EVIL-DOTDOT', 'EVIL-NOTES', 'DECOY', 'MEMORYDIR', 'CORRUPTMETA', 'BIGMETA', 'OUTSIDE']) {
    assert.ok(!json.includes(word), word);
  }
});

test('A12: a hostile leadSessionId or lead cwd reads nothing outside projects/', async () => {
  for (const opts of [{ leadSessionId: '../../secret' }, { leadSessionId: '../../../.ssh' }, { leadCwd: '/../../etc' }, { leadCwd: '..' }]) {
    const { root } = await fixture(opts);
    // A naive join(projects, '..', sid) would read this file.
    await put(join(root, `${SID}.jsonl`), jsonl(send('2026-11-11T10:09:00Z', 'x', 'OUTSIDE')));
    const json = JSON.stringify(await readTeam(root, 't1'));
    assert.ok(!json.includes('OUTSIDE'), JSON.stringify(opts));
  }
});

test('A10: a transcript over 50 MB still yields its message, in under 5 s', async () => {
  const { root, dir } = await fixture();
  const big = join(dir, `${SID}.jsonl`);
  const out = createWriteStream(big);
  const junk = JSON.stringify({ type: 'assistant', timestamp: '2026-11-11T10:00:30Z', message: { role: 'assistant', content: [{ type: 'text', text: 'y'.repeat(1000) }] } }) + '\n';
  const chunk = junk.repeat(1024);
  for (let i = 0; i < 50; i++) if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
  out.end(send('2026-11-11T10:08:00Z', 'Skeptic-2', 'after the junk') + '\n');
  await new Promise((r) => out.once('finish', r));
  const t0 = Date.now();
  const state = await readTeam(root, 't1');
  assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
  assert.ok(state.messages.some((m) => m.text === 'after the junk'));
  await rm(root, { recursive: true, force: true });
});

// A repo with one commit before `since` and one after, plus an uncommitted change.
const SINCE = Date.parse('2026-06-01T00:00:00Z');
async function repo({ before = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'rolecall-viz-git-'));
  const git = (date, ...args) => execFileSync('git', ['-C', dir, ...args], {
    stdio: 'pipe',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  git('', 'init', '-q', '-b', 'main');
  await writeFile(join(dir, 'f.txt'), 'a\nb\n');
  await writeFile(join(dir, '.gitattributes'), '* filter=x diff=x\n');
  git('', 'add', '.');
  git(before ? '2026-05-01T00:00:00Z' : '2026-07-01T00:00:00Z', 'commit', '-q', '-m', 'one');
  await writeFile(join(dir, 'f.txt'), 'a\nb\nc\n');
  git('2026-07-02T00:00:00Z', 'commit', '-q', '-am', 'two');
  await writeFile(join(dir, 'f.txt'), 'a\nc\nd\n');
  return { dir, git };
}

test('gitHealth reports branch, commits since the run began, and lines changed against the base', async () => {
  const { dir } = await repo();
  assert.deepEqual(await gitHealth(dir, SINCE), { branch: 'main', commits: 1, insertions: 2, deletions: 1 });
});

test('gitHealth with no commit before the run gives null line counts', async () => {
  const { dir } = await repo({ before: false });
  assert.deepEqual(await gitHealth(dir, SINCE), { branch: 'main', commits: 2, insertions: null, deletions: null });
});

test('readTeam includes git for the lead cwd', async () => {
  const { dir } = await repo();
  const { root } = await fixture({ leadCwd: dir });
  assert.equal((await readTeam(root, 't1')).git?.branch, 'main');
});

test('A9: repo config cannot make gitHealth run commands', async () => {
  const { dir, git } = await repo();
  const pwned = join(dir, '..', `${dir.split('/').pop()}-pwned`);
  for (const key of ['filter.x.clean', 'filter.x.smudge', 'filter.x.process', 'diff.x.textconv', 'diff.x.command', 'core.fsmonitor', 'core.pager', 'pager.diff', 'pager.log']) {
    git('', 'config', key, `touch ${pwned}`);
  }
  git('', 'config', 'filter.x.required', 'true');
  const result = await gitHealth(dir, SINCE);
  assert.equal(await readFile(pwned).then(() => true, () => false), false, 'a repo-configured command ran');
  assert.equal(result?.branch, 'main');
});

// A planted command that leaves a file behind if git ever runs it.
async function trap(dir) {
  const pwned = join(dir, '..', `${dir.split('/').pop()}-pwned`);
  const script = join(dir, '..', `${dir.split('/').pop()}-trap.sh`);
  await writeFile(script, `#!/bin/sh\ntouch '${pwned}'\ncat\n`);
  await chmod(script, 0o755);
  return { script, ran: () => readFile(pwned).then(() => true, () => false) };
}

test('A9: a global attributes file cannot apply a filter', async () => {
  const { dir, git } = await repo();
  const { script, ran } = await trap(dir);
  const attrs = join(dir, '..', `${dir.split('/').pop()}-attrs`);
  await writeFile(attrs, '* filter=y\n');
  git('', 'config', 'core.attributesFile', attrs);
  git('', 'config', 'filter.y.clean', script);
  assert.equal((await gitHealth(dir, SINCE))?.branch, 'main');
  assert.equal(await ran(), false, 'core.attributesFile filter ran');
});

test('A9: a signed commit cannot make git run gpg.program', async () => {
  const { dir, git } = await repo();
  const { script, ran } = await trap(dir);
  // Re-create HEAD as a commit carrying a (fake) signature header.
  const body = git('', 'cat-file', 'commit', 'HEAD').toString().replace(/\n\n/, '\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEz\n -----END PGP SIGNATURE-----\n\n');
  const sha = execFileSync('git', ['-C', dir, 'hash-object', '-t', 'commit', '-w', '--stdin'], { input: body }).toString().trim();
  git('', 'update-ref', 'refs/heads/main', sha);
  git('', 'config', 'log.showSignature', 'true');
  git('', 'config', 'gpg.program', script);
  assert.equal((await gitHealth(dir, SINCE))?.commits, 1);
  assert.equal(await ran(), false, 'gpg.program ran');
});

// ponytail: waived by the user. --attr-source and core.attributesFile do not cover
// .git/info/attributes, and no flag does, so a worktree diff can still run its clean filter.
test('A9: .git/info/attributes cannot apply a filter', { todo: 'waived by user: .git/info/attributes' }, async () => {
  const { dir, git } = await repo();
  const { script, ran } = await trap(dir);
  await writeFile(join(dir, '.git', 'info', 'attributes'), '* filter=y\n');
  git('', 'config', 'filter.y.clean', script);
  await gitHealth(dir, SINCE);
  assert.equal(await ran(), false, 'info/attributes filter ran');
});

test('A9: a cwd that is relative, missing, or flag-like gives null and runs nothing', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rolecall-viz-cwd-'));
  for (const cwd of [`/tmp/x; touch ${tmp}/pwned2`, `--upload-pack=touch ${tmp}/pwned3`, 'relative', '', join(tmp, 'missing'), undefined]) {
    assert.equal(await gitHealth(cwd, SINCE), null, String(cwd));
  }
  assert.deepEqual(await readdir(tmp), []);
});

test('A9: a hanging git is cut off at the timeout', async () => {
  const { dir } = await repo();
  const stub = join(dir, '..', `${dir.split('/').pop()}-slowgit`);
  await writeFile(stub, '#!/bin/sh\nsleep 10\n');
  await chmod(stub, 0o755);
  const t0 = Date.now();
  assert.equal(await gitHealth(dir, SINCE, { timeout: 200, bin: stub }), null);
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
});

// HTTP: every test talks to a real server on an ephemeral port with hand-set headers.
const here = fileURLToPath(new URL('.', import.meta.url));
const CSP = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
async function serve(t) {
  const { root } = await shared;
  const server = await createServer({ root, team: 't1' });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const get = (path, { method = 'GET', headers = { Host: `127.0.0.1:${port}` }, setHost = false } = {}) =>
    new Promise((done, fail) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers, setHost }, (res) => {
        let body = '';
        res.setEncoding('utf8').on('data', (c) => (body += c)).on('end', () => done({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', fail).end();
    });
  return { root, server, port, get };
}

test('A1: the server binds 127.0.0.1 only', async (t) => {
  const { server } = await serve(t);
  assert.equal(server.address().address, '127.0.0.1');
});

test('A2: only a 127.0.0.1 or localhost Host header with our port is served', async (t) => {
  const { server, port, get } = await serve(t);
  for (const Host of ['evil.example:' + port, `127.0.0.1:${port}.evil.example`, '127.0.0.1:1', 'localhost']) {
    assert.equal((await get('/api/state', { headers: { Host } })).status, 403, Host);
    assert.equal((await get('/api/state?x=1', { headers: { Host } })).status, 403, `${Host} ?x=1`);
  }
  // Node itself answers a Host-less HTTP/1.1 request with 400 before our handler runs.
  assert.ok([400, 403].includes((await get('/api/state', { headers: {} })).status), 'no Host');
  for (const Host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
    assert.equal((await get('/api/state', { headers: { Host } })).status, 200, Host);
  }
});

test('A3: a foreign Origin is refused and no CORS header is ever sent', async (t) => {
  const { server, port, get } = await serve(t);
  for (const Origin of ['https://evil.example', 'null', `http://127.0.0.1:${port}.evil.example`]) {
    const res = await get('/api/state', { headers: { Host: `127.0.0.1:${port}`, Origin } });
    assert.equal(res.status, 403, Origin);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
  const ok = await get('/api/state', { headers: { Host: `127.0.0.1:${port}`, Origin: `http://localhost:${port}` } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['access-control-allow-origin'], undefined);
});

test('A4: anything but GET or HEAD gets 405 and writes nothing', async (t) => {
  const { root, server, get } = await serve(t);
  const config = join(root, 'teams', 't1', 'config.json');
  const before = (await stat(config)).mtimeMs;
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const path of ['/', '/api/state', '/x']) assert.equal((await get(path, { method })).status, 405, `${method} ${path}`);
  }
  assert.equal((await get('/', { method: 'HEAD' })).status, 200);
  assert.equal((await stat(config)).mtimeMs, before);
});

test('A5: the CLI refuses a team id that could leave teams/', async () => {
  const { root } = await shared;
  let status;
  try {
    execFileSync('node', [join(here, 'server.mjs'), '../x'], { env: { ...process.env, CLAUDE_CONFIG_DIR: root, PORT: '0' }, stdio: 'pipe', timeout: 5000 });
    status = 0;
  } catch (e) {
    status = e.status;
  }
  assert.ok(status !== 0 && status !== null, `exit status ${status}`);
});

test('A6: URL paths never reach the filesystem', async (t) => {
  const { server, get } = await serve(t);
  for (const path of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2fpackage.json', '/%2e%2e/server.mjs', '/server.mjs', '/server.test.mjs', '/index.html/', '//etc/passwd']) {
    assert.equal((await get(path)).status, 404, path);
    assert.equal((await get(`${path}?q=1`)).status, 404, `${path}?q=1`);
  }
  assert.equal((await get('/server.mjs?x=1')).status, 404);
});

test('a shared link with a query string serves the page unchanged, and assets and state ignore the query', async (t) => {
  const { get } = await serve(t);
  const plain = await get('/');
  for (const path of ['/?q=x&role=skeptic', `/?q=${encodeURIComponent('<img src=x onerror=1>')}`]) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers['content-type'], /^text\/html/, path);
    assert.equal(res.body, plain.body, path);
    assert.equal(res.headers['content-security-policy'], CSP, path);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', path);
  }
  const js = await get('/app.js?v=1');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /^text\/javascript/);
  const state = await get('/api/state?q=1');
  assert.equal(state.status, 200);
  assert.equal(state.body, (await get('/api/state')).body);
});

test('A7: every response carries the CSP and nosniff', async (t) => {
  const { server, get } = await serve(t);
  for (const path of ['/', '/app.js', '/app.css', '/api/state', '/nope']) {
    const res = await get(path);
    assert.equal(res.headers['content-security-policy'], CSP, path);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', path);
  }
});

test('A7: app.js never writes HTML or inline styles, and sets only literal non-handler attributes', async () => {
  const src = await readFile(join(here, 'app.js'), 'utf8');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', ' style=', '.style.cssText', 'eval(', 'new Function', 'RegExp(']) {
    assert.ok(!src.includes(bad), bad);
  }
  for (const [, arg] of src.matchAll(/setAttribute(?:NS)?\(\s*([^,)]*)/g)) {
    assert.match(arg, /^(null,\s*)?'[^']*'$|^'[^']*'$/, `non-literal attribute name: ${arg}`);
    assert.doesNotMatch(arg, /^'on/i, `event handler attribute: ${arg}`);
  }
});

test('GET / is HTML, GET /api/state is the readTeam JSON with secrets left out (A11)', async (t) => {
  const { root, server, get } = await serve(t);
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /^text\/html/);
  const res = await get('/api/state');
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.deepEqual(JSON.parse(res.body), await readTeam(root, 't1'));
  for (const secret of ['sk-test-SECRET-123', 'sk-test-SECRET-456', 'PROMPT-SECRET', 'CWD-SECRET']) assert.ok(!res.body.includes(secret), secret);
});

test('A9: the server keeps answering while git hangs', async (t) => {
  const { server, get } = await serve(t);
  const bin = await mkdtemp(join(tmpdir(), 'rolecall-viz-bin-'));
  await writeFile(join(bin, 'git'), '#!/bin/sh\nsleep 10\n');
  await chmod(join(bin, 'git'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const slow = get('/api/state');
    const t0 = Date.now();
    assert.equal((await get('/app.css')).status, 200);
    assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
    const state = await slow;
    assert.equal(state.status, 200);
    assert.equal(JSON.parse(state.body).git, null);
  } finally {
    process.env.PATH = path;
    }
});

test('the CLI with no team serves the newest one and prints its URL', async () => {
  const { root } = await shared;
  const child = spawn('node', [join(here, 'server.mjs')], { env: { ...process.env, CLAUDE_CONFIG_DIR: root, PORT: '0' } });
  try {
    const url = await new Promise((done, fail) => {
      child.stdout.setEncoding('utf8').on('data', (d) => { const m = /http:\/\/127\.0\.0\.1:\d+/.exec(d); if (m) done(m[0]); });
      child.on('exit', (code) => fail(new Error(`exited ${code}`)));
    });
    const state = await (await fetch(`${url}/api/state`)).json();
    assert.equal(state.team, 't1');
  } finally {
    child.kill();
  }
});

// The page's pure logic: app.js only touches the DOM when there is a document.
test('page: phase is the furthest in-progress phase task, or -1', async () => {
  const { phaseOf } = await import('./app.js');
  const t = (subject, status) => ({ id: subject, subject, status, owner: null, blockedBy: [] });
  assert.equal(phaseOf([]), -1);
  assert.equal(phaseOf([t('Discuss: x', 'completed'), t('Fix things', 'in_progress')]), -1);
  assert.equal(phaseOf([t('Plan: x', 'in_progress'), t('Build: y', 'in_progress'), t('Review: z', 'pending')]), 3);
  assert.equal(phaseOf([t('Wrap up: done', 'in_progress')]), 5);
});

test('page: desk state is blocked over active over idle', async () => {
  const { deskState } = await import('./app.js');
  const now = Date.parse('2026-11-11T10:10:00Z');
  const tasks = [
    { id: '1', subject: 'Plan: p', status: 'in_progress', owner: 'P', blockedBy: [] },
    { id: '2', subject: 'Build: b', status: 'pending', owner: 'B', blockedBy: ['1'] },
    { id: '3', subject: 'Review: r', status: 'pending', owner: 'R', blockedBy: ['9'] },
  ];
  const msgs = [
    { from: 'P', to: 'B', ts: '2026-11-11T10:09:00Z' },
    { from: 'B', to: 'P', ts: '2026-11-11T10:09:30Z' },
    { from: 'R', to: 'P', ts: '2026-11-11T10:00:00Z' },
  ];
  assert.deepEqual(deskState('B', tasks, msgs, now), { state: 'blocked', caption: 'Blocked' });
  assert.deepEqual(deskState('P', tasks, msgs, now), { state: 'active', caption: 'Plan: p' });
  assert.deepEqual(deskState('R', tasks, msgs, now), { state: 'idle', caption: 'Idle' });
  assert.deepEqual(deskState('Q', tasks, [{ from: 'Q', to: 'P', ts: '2026-11-11T10:09:59Z' }], now), { state: 'active', caption: 'Working' });
});

test('page: rooms come from agentType, anything else is a visitor', async () => {
  const { department } = await import('./app.js');
  assert.equal(department('team-lead'), 'Lead');
  assert.equal(department('team-skeptic'), 'Strategy');
  assert.equal(department('team-security-reviewer'), 'Security');
  assert.equal(department('team-design-critic'), 'Design');
  assert.equal(department('team-gatekeeper'), 'Engineering');
  for (const odd of ['weird', '__proto__', 'constructor', '']) assert.equal(department(odd), 'Visitors', odd);
});

test('page: the ledger appends new rows, and starts over when a late message lands mid-list', async () => {
  const { ledgerUpdate } = await import('./app.js');
  const m = (ts) => ({ from: 'a', to: 'b', ts, text: ts, summary: '' });
  const [one, two, three, late] = [m('1'), m('2'), m('3'), m('1.5')];
  assert.deepEqual(ledgerUpdate([], [one, two]), { reset: false, fresh: [one, two] });
  assert.deepEqual(ledgerUpdate([one, two], [one, two, three]), { reset: false, fresh: [three] });
  assert.deepEqual(ledgerUpdate([one, two], [one, two]), { reset: false, fresh: [] });
  assert.deepEqual(ledgerUpdate([one, two], [one, late, two]), { reset: true, fresh: [one, late, two] });
  assert.deepEqual(ledgerUpdate([one, two], [one]), { reset: true, fresh: [one] });
});

// Post room search. Role = agentType without its team- prefix; a memo matches a Role by sender or recipient.
const SEARCH_MEMBERS = [
  { name: 'team-lead', agentType: 'team-lead' },
  { name: 'Skeptic-2', agentType: 'team-skeptic' },
  { name: 'Skeptic-3', agentType: 'team-skeptic' },
  { name: 'Builder-2', agentType: 'team-builder' },
];
const SEARCH_MEMOS = [
  { from: 'team-lead', to: 'Skeptic-2', ts: '1', text: 'Hello Skeptic', summary: 'kickoff' },
  { from: 'Skeptic-2', to: 'team-lead', ts: '2', text: 'brief .* ready', summary: 'brief' },
  { from: 'Builder-2', to: 'Skeptic-3', ts: '3', text: 'a[b(c\\d (a+)+$', summary: '' },
  { from: 'Proto', to: 'team-lead', ts: '4', text: 'proto talk', summary: '' },
  { from: 'ghost', to: 'nobody', ts: '5', text: '', summary: undefined },
  { from: 'Builder-2', to: 'team-lead', ts: '6', text: `${'a'.repeat(50000)}!`, summary: '' },
];
const T_ = true;
const F_ = false;

test('filterRows: text is a case-insensitive substring of text, summary, from or to; Role matches sender or recipient; both AND', async () => {
  const { filterRows } = await import('./app.js');
  const f = (q, role) => filterRows(SEARCH_MEMOS, SEARCH_MEMBERS, { q, role });
  assert.deepEqual(f('', ''), [T_, T_, T_, T_, T_, T_]);
  assert.deepEqual(f('HELLO', ''), [T_, F_, F_, F_, F_, F_]);
  assert.deepEqual(f('KICKOFF', ''), [T_, F_, F_, F_, F_, F_]);
  assert.deepEqual(f('skeptic-2', ''), [T_, T_, F_, F_, F_, F_]);
  assert.deepEqual(f('', 'skeptic'), [T_, T_, T_, F_, F_, F_]);
  assert.deepEqual(f('', 'lead'), [T_, T_, F_, T_, F_, T_]);
  assert.deepEqual(f('brief', 'lead'), [F_, T_, F_, F_, F_, F_]);
  assert.deepEqual(f('brief', 'builder'), [F_, F_, F_, F_, F_, F_]);
});

test('AC2: filterRows matches q literally, never as a pattern', async () => {
  const { filterRows } = await import('./app.js');
  const f = (q) => filterRows(SEARCH_MEMOS, SEARCH_MEMBERS, { q, role: '' });
  assert.deepEqual(f('.*'), [F_, T_, F_, F_, F_, F_]);
  for (const q of ['[', '(', '\\', '(a+)+$']) assert.deepEqual(f(q), [F_, F_, T_, F_, F_, F_], q);
});

test('AC3: a 100,000-char q does not throw and matches nothing ordinary', async () => {
  const { filterRows } = await import('./app.js');
  assert.deepEqual(filterRows(SEARCH_MEMOS, SEARCH_MEMBERS, { q: 'x'.repeat(100000), role: '' }), [F_, F_, F_, F_, F_, F_]);
});

test('AC4/AC5: an unknown or prototype-named Role means all memos, and Object.prototype is untouched', async () => {
  const { filterRows } = await import('./app.js');
  const protoKeys = Object.getOwnPropertyNames(Object.prototype).sort();
  const all = filterRows(SEARCH_MEMOS, SEARCH_MEMBERS, { q: '', role: '' });
  for (const role of ['nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.deepEqual(filterRows(SEARCH_MEMOS, SEARCH_MEMBERS, { q: '', role }), all, role);
  }
  assert.deepEqual(filterRows(SEARCH_MEMOS, SEARCH_MEMBERS, { q: '__proto__', role: '' }), [F_, F_, F_, F_, F_, F_]);
  assert.deepEqual(filterRows(SEARCH_MEMOS, SEARCH_MEMBERS, { q: 'constructor', role: '' }), [F_, F_, F_, F_, F_, F_]);
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), protoKeys);
});

test('AC6: a member whose agentType is __proto__ has that Role and matches its own memos', async () => {
  const { filterRows } = await import('./app.js');
  const members = [...SEARCH_MEMBERS, { name: 'Proto', agentType: '__proto__' }];
  assert.deepEqual(filterRows(SEARCH_MEMOS, members, { q: '', role: '__proto__' }), [F_, F_, F_, T_, F_, F_]);
});

test('AC8/AC9: empty filters match everything; missing fields and unknown names neither throw nor match a Role', async () => {
  const { filterRows } = await import('./app.js');
  const f = (q, role) => filterRows(SEARCH_MEMOS, SEARCH_MEMBERS, { q, role })[4];
  assert.equal(f('', ''), true);
  assert.equal(f('ghost', ''), true);
  assert.equal(f('NOBODY', ''), true);
  assert.equal(f('undefined', ''), false);
  assert.equal(f('', 'lead'), false);
  assert.deepEqual(filterRows([{ from: 'x', to: 'y' }], [], { q: '', role: '' }), [true]);
});

test('AC1/AC3/AC8: parseFilter reads the first q and role, literally, with q clamped to 200', async () => {
  const { parseFilter } = await import('./app.js');
  const IMG = '<img src=x onerror="window.__pwned=1">';
  assert.deepEqual(parseFilter(''), { q: '', role: '' });
  assert.deepEqual(parseFilter('?q=brief&role=skeptic'), { q: 'brief', role: 'skeptic' });
  assert.equal(parseFilter('?role=a&role=b').role, 'a');
  assert.equal(parseFilter(`?q=${encodeURIComponent(IMG)}`).q, IMG);
  assert.equal(parseFilter(`?q=${'x'.repeat(100000)}`).q.length, 200);
});

test('AC7: filterQuery sets or drops q and role through URLSearchParams and keeps other params', async () => {
  const { filterQuery, parseFilter } = await import('./app.js');
  const s = new URLSearchParams(filterQuery('', { q: 'a&role=x#y', role: '' }));
  assert.equal(s.get('q'), 'a&role=x#y');
  assert.equal(s.get('role'), null);
  const kept = new URLSearchParams(filterQuery('?x=1&q=old', { q: '', role: 'skeptic' }));
  assert.deepEqual([...kept], [['x', '1'], ['role', 'skeptic']]);
  assert.equal(filterQuery('', { q: '', role: '' }), '');
  assert.ok(filterQuery('', parseFilter(`?q=${'x'.repeat(100000)}`)).length < 300);
});

// The 3D office (docs/superpowers/specs/2026-11-13-team-office-3d-viewer-design.md).
test('layout: rooms at 35 px per tile, desks and figure points per slot, visitors for odd types', async () => {
  const { layout, T } = await import('./app.js');
  const lay = layout([{ name: 'A', agentType: 'team-skeptic', color: 'pink' }, { name: 'B', agentType: 'team-planner', color: 'orange' }, { name: 'Z', agentType: 'odd', color: null }]);
  assert.equal(T, 35);
  assert.deepEqual(lay.rooms.find((r) => r.name === 'Strategy'), { name: 'Strategy', left: 0, top: 20, width: 245, height: 210, count: 2 });
  assert.deepEqual(lay.agents.get('A').desk, { left: 32, top: 88 }); // di 1, dj 2
  assert.deepEqual(lay.agents.get('A').home, { x: 70, y: 82 });
  assert.deepEqual(lay.agents.get('A').beside, { x: 127, y: 112 });
  assert.deepEqual(lay.agents.get('B').desk, { left: 172, top: 88 }); // di 5
  assert.equal(lay.agents.get('Z').room, 'Visitors');
  assert.equal(lay.agents.get('Z').color, null);
  assert.equal(lay.agents.get('A').color, '#C2417A');
});

test('clampCam: ranges hold and non-finite input leaves the camera as it was', async () => {
  const { clampCam, HOME_CAM } = await import('./app.js');
  assert.deepEqual(clampCam({ rz: -200, rx: 0, zoom: 9 }), { rz: -80, rx: 38, zoom: 1.3 });
  assert.deepEqual(clampCam({ rz: 5, rx: 90, zoom: 0.1 }), { rz: -8, rx: 68, zoom: 0.6 });
  assert.deepEqual(clampCam({ rz: NaN, rx: 50, zoom: 1 }), HOME_CAM);
  const prev = { rz: -30, rx: 50, zoom: 1 };
  assert.equal(clampCam({ rz: -30, rx: Infinity, zoom: 1 }, prev), prev);
  let cam = HOME_CAM;
  for (let i = 0; i < 1000; i++) cam = clampCam({ rz: cam.rz + (i % 2 ? 1e9 : -1e9), rx: cam.rx - 1e6, zoom: cam.zoom * 7 }, cam);
  assert.ok(cam.rz >= -80 && cam.rz <= -8 && cam.rx >= 38 && cam.rx <= 68 && cam.zoom >= 0.6 && cam.zoom <= 1.3);
});

test('stepState: sender beside the recipient, counts, desk states, bubble text', async () => {
  const { layout, stepState } = await import('./app.js');
  const lay = layout([{ name: 'A', agentType: 'team-skeptic', color: 'pink' }, { name: 'B', agentType: 'team-builder', color: 'cyan' }]);
  const tasks = [{ id: '1', subject: 'Build: b', status: 'in_progress', owner: 'B', blockedBy: [] }, { id: '2', subject: 'Review: r', status: 'pending', owner: 'A', blockedBy: ['1'] }];
  const msgs = [
    { from: 'A', to: 'B', ts: '2026-11-11T10:00:00Z', text: 'hi', summary: 's1' },
    { from: 'B', to: 'A', ts: '2026-11-11T10:01:00Z', text: '', summary: 'protocol' },
    { from: 'A', to: 'B', ts: '2026-11-11T10:02:00Z', text: '', summary: '' },
  ];
  const s0 = stepState(lay, tasks, msgs, 0, Date.parse(msgs[0].ts));
  const b = lay.agents.get('B');
  assert.deepEqual(s0.positions.get('A'), b.beside);
  assert.deepEqual(s0.positions.get('B'), b.home);
  assert.deepEqual(s0.link, { x1: b.beside.x, y1: b.beside.y, x2: b.home.x, y2: b.home.y });
  assert.deepEqual(s0.desks.get('A'), { state: 'away', caption: 'Delivering memo' });
  assert.deepEqual(s0.desks.get('B'), { state: 'idle', caption: 'Idle' }); // B has sent nothing yet
  assert.equal(s0.say, 'hi');
  const s1 = stepState(lay, tasks, msgs, 1, Date.parse(msgs[1].ts));
  assert.deepEqual(s1.desks.get('B'), { state: 'away', caption: 'Delivering memo' });
  assert.deepEqual(stepState(lay, tasks, msgs, 2, Date.parse(msgs[2].ts)).desks.get('B'), { state: 'active', caption: 'Build: b' }); // sent 1 min ago
  const s2 = stepState(lay, tasks, msgs, 2, Date.parse(msgs[2].ts));
  assert.equal(s2.worn.get('A|B'), 2);
  assert.equal(s2.worn.get('B|A'), 1);
  assert.equal(s2.sent.get('A'), 2);
  assert.equal(s2.got.get('A'), 1);
  assert.equal(s2.say, '(no text)');
  assert.equal(stepState(lay, tasks, msgs, 1, Date.parse(msgs[1].ts)).say, 'protocol');
  const idle = stepState(lay, tasks, msgs, 1, Date.parse('2026-11-11T11:00:00Z'));
  assert.deepEqual(idle.desks.get('A'), { state: 'blocked', caption: 'Blocked' });
  const none = stepState(lay, tasks, [], 0, Date.now());
  assert.equal(none.step, null);
  assert.deepEqual(none.positions.get('A'), lay.agents.get('A').home);
  assert.equal(none.say, '');
});

test('stepState: unknown names, bad timestamp', async () => {
  const { layout, stepState } = await import('./app.js');
  const lay = layout([{ name: 'A', agentType: 'team-skeptic', color: 'pink' }]);
  const s = stepState(lay, [], [{ from: 'Ghost', to: 'A', ts: 'nope', text: 'x', summary: '' }], 0, NaN);
  assert.equal(s.link, null);
  assert.equal(s.worn.size, 0);
  assert.deepEqual(s.positions.get('A'), lay.agents.get('A').home);
  assert.deepEqual(s.desks.get('A'), { state: 'idle', caption: 'Idle' });
  assert.equal(s.when, '');
  assert.equal(s.sent.get('Ghost'), 1);
});

test('stepState: a bad timestamp after a good one leaves every earlier sender Idle', async () => {
  const { layout, stepState } = await import('./app.js');
  const lay = layout([{ name: 'L', agentType: 'team-lead', color: null }, { name: 'B', agentType: 'team-builder', color: 'cyan' }, { name: 'C', agentType: 'team-reviewer', color: 'red' }]);
  const msgs = [{ from: 'B', to: 'L', ts: '2026-11-11T10:00:00Z', text: 'x', summary: '' }, { from: 'C', to: 'B', ts: 'garbage', text: 'y', summary: '' }];
  const s = stepState(lay, [], msgs, 1, Date.parse(msgs[1].ts));
  assert.deepEqual(s.desks.get('B'), { state: 'idle', caption: 'Idle' });
});

test('wheelZoom: zoom follows the wheel distance, so a trackpad flick is not end to end', async () => {
  const { wheelZoom, HOME_CAM } = await import('./app.js');
  assert.equal(wheelZoom(HOME_CAM, 4).zoom, 0.89);                    // one small trackpad event
  assert.equal(wheelZoom(HOME_CAM, -100).zoom, 1.1);                  // one mouse notch
  assert.equal(wheelZoom(HOME_CAM, 1e9).zoom, 0.7);                   // capped per event
  assert.equal(wheelZoom(HOME_CAM, NaN), HOME_CAM);
  assert.equal(wheelZoom(HOME_CAM, Infinity).zoom, 0.7);
});

test('office page: the Post room scrolls itself, never the window', async () => {
  const js = await readFile(join(here, 'app.js'), 'utf8');
  assert.ok(!js.includes('scrollIntoView'), 'scrollIntoView also scrolls the page');
});

test('recursor: the cursor follows its memo through a ledger reset, else clamps', async () => {
  const { recursor } = await import('./app.js');
  const m = (ts) => ({ from: 'a', to: 'b', ts, text: ts });
  const [one, two, three, late] = [m('1'), m('2'), m('3'), m('1.5')];
  assert.equal(recursor([one, two, three], [one, late, two, three], 1), 2);
  assert.equal(recursor([one, two, three], [one], 2), 0);
  assert.equal(recursor([one, two, three], [], 2), -1);
});

test('office page: Fit button, a range scrubber, nothing from the network', async () => {
  const html = await readFile(join(here, 'index.html'), 'utf8');
  assert.match(html, /id="zoom-fit"[^>]*>Fit</, 'a Fit button');
  assert.match(html, /<input[^>]*type="range"/, 'a range scrubber');
  assert.doesNotMatch(html, /(href|src)="https?:/, 'no network assets');
  const css = await readFile(join(here, 'app.css'), 'utf8');
  for (const bad of ['url(', '@import']) assert.ok(!css.includes(bad), bad);
  const js = await readFile(join(here, 'app.js'), 'utf8');
  for (const gone of ['animateMotion', 'zoomAt', 'depthKey', 'routeFor']) assert.ok(!js.includes(gone), gone);
});

// The agent figure is the Claude Design image pack (docs/superpowers/specs/agent-images), drawn inline.
test('figure: every pack SVG is the figure the page draws for that colour', async () => {
  const { figureShapes } = await import('./app.js');
  const pack = join(here, '..', 'docs', 'superpowers', 'specs', 'agent-images');
  const { agents } = JSON.parse(await readFile(join(pack, 'agents.json'), 'utf8'));
  assert.equal(agents.length, 11);
  for (const a of agents) {
    const src = await readFile(join(pack, a.svg), 'utf8');
    assert.match(src, /viewBox="0 0 56 72"/, a.id);
    const shapes = [...src.matchAll(/<(rect|circle|path)\s([^>]*?)\/>/g)].map(([, tag, attrs]) => ({
      tag, ...Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
    }));
    const drawn = figureShapes(a.color).map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])));
    assert.deepEqual(drawn, shapes, a.id);
  }
});

test('A13d: wheel, pointer and key handlers read only event numbers and the view, never server data', async () => {
  const src = await readFile(join(here, 'app.js'), 'utf8');
  const bodies = [];
  for (const m of src.matchAll(/addEventListener\(\s*'(wheel|pointer\w+|keydown)'/g)) {
    // The handler runs to the paren that closes this addEventListener call.
    let depth = 0;
    let i = m.index + 'addEventListener'.length;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    bodies.push([m[1], src.slice(m.index, i)]);
  }
  const kinds = new Set(bodies.map(([k]) => k));
  for (const k of ['wheel', 'pointerdown', 'pointermove', 'keydown']) assert.ok(kinds.has(k), `no ${k} handler`);
  for (const [kind, body] of bodies) {
    assert.doesNotMatch(body, /\b(lastState|state|messages|rendered|queue|walkers)\b/, `${kind} handler touches server data`);
  }
});
