import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score } from './score.mjs';

const benchmarkDir = fileURLToPath(new URL('..', import.meta.url));
const tasksDir = join(benchmarkDir, 'tasks');
const { repo, commit } = JSON.parse(await readFile(join(benchmarkDir, 'template.json'), 'utf8'));
const TRAP_KINDS = ['unvalidated input', 'unneeded dependency', 'scope-creep bait', 'broken existing caller'];
const hasDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

// One shallow checkout of the pinned template, reused across runs.
async function pinnedTemplate() {
  const dir = join(tmpdir(), `rolecall-template-${commit.slice(0, 12)}`);
  // macOS purges old files from tmpdir, so a cached checkout can lose files; re-clone it then.
  if (await stat(join(dir, '.git')).catch(() => null)) {
    try {
      if (!git(dir, 'status', '--porcelain').length) return dir;
    } catch {}
    await rm(dir, { recursive: true, force: true });
  }
  const tmp = await mkdtemp(join(tmpdir(), 'rolecall-clone-'));
  git(tmp, 'init', '-q');
  git(tmp, 'fetch', '-q', '--depth', '1', repo, commit);
  git(tmp, 'checkout', '-q', 'FETCH_HEAD');
  await cp(tmp, dir, { recursive: true });
  return dir;
}

async function fixtureTree(taskDir, patch) {
  const tree = await mkdtemp(join(tmpdir(), 'rolecall-fixture-'));
  await cp(await pinnedTemplate(), tree, { recursive: true });
  git(tree, 'apply', join(taskDir, 'fixtures', patch));
  return tree;
}

const tripped = (result) => Object.keys(result.traps).filter((id) => result.traps[id] === 'tripped');

test('the tasks together cover every Trap kind, and at least one needs UI work', async () => {
  const kinds = new Set();
  let ui = false;
  for (const name of await readdir(tasksDir)) {
    for (const trap of JSON.parse(await readFile(join(tasksDir, name, 'task.json'), 'utf8')).traps) kinds.add(trap.kind);
    // The generated API client alone isn't UI work.
    ui ||= /^diff --git a\/frontend\/src\/(?!client\/)/m.test(await readFile(join(tasksDir, name, 'fixtures', 'good.patch'), 'utf8'));
  }
  assert.deepEqual([...kinds].sort(), [...TRAP_KINDS].sort());
  assert.ok(ui, 'no task\'s known-good fixture touches frontend/src outside the generated client');
});

for (const name of (await readdir(tasksDir)).sort()) {
  const taskDir = join(tasksDir, name);
  const task = JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8'));
  const patches = await readdir(join(taskDir, 'fixtures'));

  test(`${name}: has a prompt, hidden tests, and at least two Traps of known kinds, each with a fixture`, async () => {
    assert.ok((await readFile(join(taskDir, 'prompt.md'), 'utf8')).trim());
    assert.ok((await readdir(join(taskDir, 'hidden'))).some((f) => /^test_.*\.py$/.test(f)));
    assert.ok(task.traps.length >= 2);
    for (const trap of task.traps) {
      assert.ok(TRAP_KINDS.includes(trap.kind), trap.kind);
      assert.ok(patches.includes(`trap-${trap.id}.patch`), trap.id);
    }
    assert.ok(patches.includes('good.patch'));
  });

  test(`${name}: every fixture applies to the pinned template`, async () => {
    for (const patch of patches) await fixtureTree(taskDir, patch);
  });

  const docker = { skip: !hasDocker && 'needs Docker' };

  test(`${name}: known-good fixture passes every hidden test and trips no Trap`, docker, async () => {
    const result = await score({ taskDir, tree: await fixtureTree(taskDir, 'good.patch') });
    assert.ok(Object.keys(result.tests).length > 0);
    assert.deepEqual(Object.values(result.tests).filter((r) => r !== 'pass'), [], JSON.stringify(result.tests));
    assert.deepEqual(tripped(result), []);
  });

  for (const trap of task.traps) {
    test(`${name}: trap-${trap.id} fixture is flagged for that Trap only`, docker, async () => {
      const result = await score({ taskDir, tree: await fixtureTree(taskDir, `trap-${trap.id}.patch`) });
      assert.deepEqual(tripped(result), [trap.id]);
    });
  }
}
