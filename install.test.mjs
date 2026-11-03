// Runs install.sh against stand-in `claude` and `git` commands that log their calls,
// so no plugin is installed and nothing is cloned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const script = await readFile(join(root, 'install.sh'), 'utf8');
// "repo market plugin" per line, the same block benchmark/run.mjs reads.
const upstreams = script.match(/^UPSTREAMS="\n([\s\S]*?)\n"/m)[1].split('\n').map((l) => l.split(' '));
const markets = [...new Set(upstreams.map(([, market]) => market))];
const roleFiles = (await readdir(join(root, 'agents'))).filter((f) => f.startsWith('team-'));

async function sandbox(installed = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'rolecall-install-'));
  const bin = join(dir, 'bin');
  await mkdir(bin);
  await mkdir(join(dir, 'config', 'plugins'), { recursive: true });
  await writeFile(join(dir, 'config', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: installed }));
  await writeFile(join(bin, 'claude'), `#!/bin/sh\necho "$*" >> "${dir}/calls"\n`);
  // clone: make the two folders install.sh copies; rev-parse: a fake commit.
  await writeFile(join(bin, 'git'), `#!/bin/sh
case "$*" in
  clone*) for d; do :; done; mkdir -p "$d/project-rules" "$d/global-rules" ;;
  *rev-parse*) echo 0000000 ;;
esac
`);
  await chmod(join(bin, 'claude'), 0o755);
  await chmod(join(bin, 'git'), 0o755);
  const run = (...args) => {
    execFileSync('bash', [join(root, 'install.sh'), ...args], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: join(dir, 'config'), XDG_CONFIG_HOME: join(dir, 'xdg') },
      stdio: 'pipe',
    });
    return readFile(join(dir, 'calls'), 'utf8').then((t) => t.split('\n').filter(Boolean), () => []);
  };
  return { dir, config: join(dir, 'config'), run };
}

test('install adds each marketplace once and installs every Upstream plugin', async () => {
  const { config, run } = await sandbox();
  const calls = await run();
  const adds = calls.filter((c) => c.startsWith('plugin marketplace add '));
  assert.deepEqual(adds.length, markets.length, adds.join('\n'));
  assert.deepEqual(
    calls.filter((c) => c.startsWith('plugin install ')).sort(),
    upstreams.map(([, market, plugin]) => `plugin install ${plugin}@${market} -y`).sort(),
  );
  assert.deepEqual((await readdir(join(config, 'agents'))).sort(), roleFiles.sort());
  const settings = JSON.parse(await readFile(join(config, 'settings.json'), 'utf8'));
  assert.equal(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1');
});

test('--upstreams-only installs the plugins but no Role files (Same-rules baseline)', async () => {
  const { config, run } = await sandbox();
  const calls = await run('--upstreams-only');
  assert.equal(calls.filter((c) => c.startsWith('plugin install ')).length, upstreams.length);
  assert.deepEqual(await readdir(join(config, 'agents')).catch(() => []), []);
});

test('uninstall removes every plugin, but keeps a marketplace other plugins still use', async () => {
  const { run } = await sandbox({ 'static-analysis@trailofbits': [{}] });
  const calls = await run('--uninstall');
  assert.deepEqual(
    calls.filter((c) => c.startsWith('plugin uninstall ')).sort(),
    upstreams.map(([, market, plugin]) => `plugin uninstall ${plugin}@${market}`).sort(),
  );
  assert.deepEqual(
    calls.filter((c) => c.startsWith('plugin marketplace remove ')).sort(),
    markets.filter((m) => m !== 'trailofbits').map((m) => `plugin marketplace remove ${m}`).sort(),
  );
});
