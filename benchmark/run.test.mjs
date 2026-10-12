import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkArm, linesChanged, usage } from './run.mjs';

const prices = { m: { input: 1, output: 10, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 } };
const line = (id, usage, timestamp) => JSON.stringify({ type: 'assistant', timestamp, message: { id, model: 'm', usage } });

test('usage counts each message once across Lead and Teammate transcripts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'usage-'));
  await mkdir(join(dir, 's', 'subagents'), { recursive: true });
  const u = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 2e6, cache_creation: { ephemeral_1h_input_tokens: 1e6 } };
  // the same message logged twice (one line per content block)
  await writeFile(join(dir, 's.jsonl'), [line('a', u, '2026-01-01T00:00:00Z'), line('a', u, '2026-01-01T00:00:00Z')].join('\n'));
  await writeFile(join(dir, 's', 'subagents', 't.jsonl'), line('b', { output_tokens: 1e6 }, '2026-01-01T00:01:30Z'));
  const got = await usage(dir, prices);
  assert.deepEqual(got.tokens, { input: 1e6, output: 2e6, cacheWrite5m: 1e6, cacheWrite1h: 1e6, cacheRead: 1e6 });
  assert.equal(got.costUsd, 1 + 20 + 1.25 + 2 + 0.1);
  assert.equal(got.seconds, 90);
});

test('linesChanged counts untracked files but not lockfiles or the generated client', async () => {
  const tree = await mkdtemp(join(tmpdir(), 'lines-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: tree });
  git('init', '-q');
  await writeFile(join(tree, 'a.py'), 'x\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').toString().trim();
  await writeFile(join(tree, 'a.py'), 'y\n'); // 1 added, 1 removed
  await writeFile(join(tree, 'new.py'), '1\n2\n3\n'); // untracked, 3 added
  await writeFile(join(tree, 'uv.lock'), 'lots\nof\nlines\n');
  await mkdir(join(tree, 'frontend', 'src', 'client'), { recursive: true });
  await writeFile(join(tree, 'frontend', 'src', 'client', 'sdk.gen.ts'), 'generated\n');
  assert.equal(linesChanged(tree, base), 5);
});

test('checkArm accepts an empty dir only for the Bare baseline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'arm-'));
  assert.deepEqual(await checkArm(dir, 'bare'), []);
  assert.ok((await checkArm(dir, 'same-rules')).some((p) => p.startsWith('plugins:')));
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [] } }));
  assert.deepEqual(await checkArm(dir, 'bare'), ['settings.json has hooks']);
});

test('checkArm flags a Role file still pointing at the real ~/.claude', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'arm-'));
  await mkdir(join(dir, 'agents'));
  await writeFile(join(dir, 'agents', 'team-gatekeeper.md'), 'load `$HOME/.claude/agent-rules/steipete/`');
  assert.ok((await checkArm(dir, 'team')).includes('agents/team-gatekeeper.md points at ~/.claude'));
});
