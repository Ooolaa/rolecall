// Runs one Trial (one Arm on one benchmark task), scores it and appends it to results/runs.jsonl.
// Each Arm has its own config dir under ~/.cache/rolecall/arms/ (ADR 0005).
// Usage: node benchmark/run.mjs setup          set up the three Arms' config dirs
//        node benchmark/run.mjs <task> <arm>   arm: bare | same-rules | team
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, matchesGlob } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { score } from './scorer/score.mjs';

const benchDir = fileURLToPath(new URL('.', import.meta.url));
const repoDir = join(benchDir, '..');
const CACHE = join(homedir(), '.cache', 'rolecall');
const ARMS = ['bare', 'same-rules', 'team'];
const MODEL = 'claude-sonnet-5-5';
const TIME_CAP_S = 90 * 60;
const NO_MORE_INFO = 'No more information is available beyond this prompt; use your judgement.';
// Lockfiles and the generated API client would swamp the count.
const NOT_COUNTED = ['**/*.lock', '**/package-lock.json', '**/pnpm-lock.yaml', 'frontend/src/client/**'];

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
const sameList = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const steipeteLine = (dir) =>
  `Follow the project rules in ${dir}/agent-rules/steipete/project-rules/: read the rule that matches what you're doing.`;

export function armEnv(arm) {
  // Drop the caller's Claude session and any API key, so Trials run on the Arm's own login.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC_)/.test(k)));
  return { ...env, CLAUDE_CONFIG_DIR: join(CACHE, 'arms', arm, 'claude'), XDG_CONFIG_HOME: join(CACHE, 'arms', arm, 'xdg') };
}

// "plugin@marketplace" for every Upstream install.sh installs.
async function upstreamPlugins() {
  const block = (await readFile(join(repoDir, 'install.sh'), 'utf8')).match(/^UPSTREAMS="\n([\s\S]*?)\n"/m)[1];
  return block.split('\n').map((line) => line.split(' ')).map(([, market, plugin]) => `${plugin}@${market}`);
}

/** What's wrong with an Arm's config dir; empty when it holds exactly what the Arm should. */
export async function checkArm(dir, arm) {
  const json = (f) => readFile(join(dir, f), 'utf8').then(JSON.parse, () => ({}));
  const list = (d) => readdir(join(dir, d)).then((fs) => fs.filter((f) => !f.startsWith('.')), () => []);
  const teamAgents = (await readdir(join(repoDir, 'agents'))).filter((f) => f.startsWith('team-'));
  const settings = await json('settings.json');
  const want = {
    plugins: arm === 'bare' ? [] : await upstreamPlugins(),
    'agent-rules': arm === 'bare' ? [] : ['steipete'],
    agents: arm === 'team' ? teamAgents : [],
    skills: arm === 'team' ? ['dev-team'] : [],
  };
  const have = {
    plugins: Object.keys((await json('plugins/installed_plugins.json')).plugins ?? {}),
    'agent-rules': await list('agent-rules'),
    agents: await list('agents'),
    skills: await list('skills'),
  };
  const problems = Object.keys(want)
    .filter((k) => !sameList(want[k], have[k]))
    .map((k) => `${k}: want [${want[k].join(', ')}], have [${have[k].join(', ')}]`);
  const claudeMd = (await readFile(join(dir, 'CLAUDE.md'), 'utf8').catch(() => '')).trim();
  if (claudeMd !== (arm === 'same-rules' ? steipeteLine(dir) : '')) problems.push('unexpected CLAUDE.md');
  // install.sh rewrites ~/.claude/ in Role files to this dir; a path it missed would read the real home dir.
  for (const f of have.agents) {
    if (/(~|\$HOME)\/\.claude\b/.test(await readFile(join(dir, 'agents', f), 'utf8'))) problems.push(`agents/${f} points at ~/.claude`);
  }
  if (settings.hooks) problems.push('settings.json has hooks');
  if (Boolean(settings.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) !== (arm === 'team')) problems.push('agent teams setting');
  return problems;
}

/** Tokens, API-equivalent cost and seconds from every transcript under a project dir (Lead and Teammates). */
export async function usage(dir, prices) {
  const files = await readdir(dir, { recursive: true }).then((fs) => fs.filter((f) => f.endsWith('.jsonl')), () => []);
  const messages = new Map(); // one transcript line per content block, so dedupe by message id
  let first = Infinity, last = -Infinity;
  for (const f of files) {
    for (const line of (await readFile(join(dir, f), 'utf8')).split('\n')) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const t = Date.parse(e.timestamp);
      if (t) [first, last] = [Math.min(first, t), Math.max(last, t)];
      if (e.type === 'assistant' && e.message?.usage && !e.message.model?.startsWith('<')) messages.set(e.message.id, e.message);
    }
  }
  const tokens = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
  let cost = 0;
  for (const { model, usage: u } of messages.values()) {
    const price = prices[model];
    if (!price) throw new Error(`no price for ${model} in prices.json`);
    const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const t = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheWrite5m: (u.cache_creation_input_tokens ?? 0) - write1h,
      cacheWrite1h: write1h,
      cacheRead: u.cache_read_input_tokens ?? 0,
    };
    for (const k in tokens) {
      tokens[k] += t[k];
      cost += (t[k] * price[k]) / 1e6;
    }
  }
  const seconds = last > first ? Math.round((last - first) / 1000) : 0;
  return { tokens, costUsd: Math.round(cost * 100) / 100, seconds };
}

/** Lines added plus removed against the pinned commit, untracked files included. Stages everything in the tree. */
export function linesChanged(tree, commit) {
  git(tree, 'add', '-A');
  return git(tree, 'diff', '--cached', '--numstat', commit)
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .filter(([, , file]) => !NOT_COUNTED.some((g) => matchesGlob(file, g)))
    .reduce((n, [added, removed]) => n + (Number(added) || 0) + (Number(removed) || 0), 0);
}

async function setup() {
  for (const arm of ARMS) {
    const env = armEnv(arm);
    await mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true });
    await mkdir(env.XDG_CONFIG_HOME, { recursive: true });
    if (arm !== 'bare' && !existsSync(join(env.CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'))) {
      execFileSync('./install.sh', arm === 'team' ? [] : ['--upstreams-only'], { cwd: repoDir, env, stdio: 'inherit' });
    }
    if (arm === 'same-rules') await writeFile(join(env.CLAUDE_CONFIG_DIR, 'CLAUDE.md'), `${steipeteLine(env.CLAUDE_CONFIG_DIR)}\n`);
  }
  console.log('\nLog each Arm in to your subscription once (run, then /login, then /exit):');
  for (const arm of ARMS) {
    const env = armEnv(arm);
    console.log(`  CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR} XDG_CONFIG_HOME=${env.XDG_CONFIG_HOME} claude`);
  }
  for (const arm of ARMS) {
    const problems = await checkArm(armEnv(arm).CLAUDE_CONFIG_DIR, arm);
    console.log(`${arm}: ${problems.length ? problems.join('; ') : 'ok'}`);
  }
}

async function prepareTree(id) {
  const { repo, commit } = JSON.parse(await readFile(join(benchDir, 'template.json'), 'utf8'));
  const mirror = join(CACHE, 'template.git');
  await mkdir(join(CACHE, 'trials'), { recursive: true });
  if (!existsSync(mirror)) git(CACHE, 'clone', '--bare', '-q', repo, mirror);
  const tree = join(CACHE, 'trials', id);
  git(CACHE, 'clone', '-q', mirror, tree);
  git(tree, 'checkout', '-q', '--detach', commit);
  return { tree, commit };
}

function runHeadless(tree, env, prompt, plugins) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--model', MODEL, '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
    const child = spawn('claude', args, { cwd: tree, env, stdio: ['ignore', 'pipe', 'inherit'] });
    let outcome = null;
    let result = null;
    const timer = setTimeout(() => {
      outcome = { status: 'timeout' };
      child.kill();
    }, TIME_CAP_S * 1000);
    createInterface({ input: child.stdout }).on('line', (line) => {
      let e;
      try { e = JSON.parse(line); } catch { return; }
      if (e.type === 'system' && e.subtype === 'init') {
        // @builtin plugins ship with Claude Code itself, so every Arm has them.
        const loaded = (e.plugins ?? []).map((p) => p.source).filter((s) => !s.endsWith('@builtin'));
        if (!sameList(loaded, plugins)) {
          outcome = { status: 'invalid', note: `session loaded plugins [${loaded.join(', ')}]` };
          child.kill();
        }
      }
      if (e.type === 'result') result = e;
    });
    child.on('close', () => {
      clearTimeout(timer);
      if (outcome) return resolve(outcome);
      if (result && !result.is_error) return resolve({ status: 'ok' });
      const why = result ? `${String(result.result ?? result.subtype).slice(0, 200)}${result.api_error_status ? `, API ${result.api_error_status}` : ''}` : 'no result';
      resolve({ status: 'invalid', note: `session failed (${why})` });
    });
  });
}

async function driveTeam(tree, env, prompt, id) {
  const promptFile = join(CACHE, 'trials', `${id}.prompt.md`);
  await writeFile(promptFile, `/dev-team ${prompt}\n`);
  console.log(`
Team run. In another terminal:

  cd ${tree}
  CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR} XDG_CONFIG_HOME=${env.XDG_CONFIG_HOME} \\
    claude --model ${MODEL} --dangerously-skip-permissions "$(cat ${promptFile})"

Type nothing except these replies:
  - when the team asks you questions: ${NO_MORE_INFO}
  - when it asks you to approve the plan: Approved.
  - when it asks whether to commit: No.
Stop at ${TIME_CAP_S / 60} minutes. When the Lead has wrapped up, /exit the session.
`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('Press Enter once the session has exited. ');
  const followed = (await rl.question('Did you type only the scripted replies, and no usage limit was hit? [y/N] ')).trim();
  rl.close();
  return /^y/i.test(followed) ? { status: 'ok' } : { status: 'invalid', note: 'keyboard script not followed or usage limit hit' };
}

async function trial(task, arm) {
  const taskDir = join(benchDir, 'tasks', task);
  if (!existsSync(join(taskDir, 'task.json'))) throw new Error(`no task ${task}`);
  const env = armEnv(arm);
  const configDir = env.CLAUDE_CONFIG_DIR;
  const resultsDir = join(benchDir, 'results');
  await mkdir(join(resultsDir, 'patches'), { recursive: true });
  const runsFile = join(resultsDir, 'runs.jsonl');
  const earlier = (await readFile(runsFile, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(JSON.parse);
  const n = earlier.filter((r) => r.task === task && r.arm === arm).length + 1;

  const installed = JSON.parse(await readFile(join(configDir, 'plugins', 'installed_plugins.json'), 'utf8').catch(() => '{}'));
  const steipete = await readFile(join(configDir, 'agent-rules', 'steipete', 'COMMIT'), 'utf8').catch(() => null);
  const record = {
    task, arm, n, model: MODEL, date: new Date().toISOString(),
    claudeCode: execFileSync('claude', ['--version'], { env, encoding: 'utf8' }).split(' ')[0],
    upstreams: {
      ...Object.fromEntries(Object.entries(installed.plugins ?? {}).map(([k, [p]]) => [k, p.gitCommitSha ?? p.version])),
      ...(steipete && { 'steipete/agent-rules': steipete.trim() }),
    },
  };
  const save = async (r) => {
    await appendFile(runsFile, `${JSON.stringify(r)}\n`);
    console.log(JSON.stringify(r, null, 2));
  };

  const problems = await checkArm(configDir, arm);
  if (problems.length) return save({ ...record, status: 'invalid', note: problems.join('; ') });

  const id = `${task}-${arm}-${Date.now()}`;
  const { tree, commit } = await prepareTree(id);
  const prompt = `${(await readFile(join(taskDir, 'prompt.md'), 'utf8')).trim()}\n\n${NO_MORE_INFO}`;
  let { status, note } =
    arm === 'team'
      ? await driveTeam(tree, env, prompt, id)
      : await runHeadless(tree, env, prompt, arm === 'bare' ? [] : await upstreamPlugins());

  const { models: prices } = JSON.parse(await readFile(join(benchDir, 'prices.json'), 'utf8'));
  const spent = await usage(join(configDir, 'projects', tree.replace(/[^a-zA-Z0-9]/g, '-')), prices);
  if (status === 'ok' && spent.seconds > TIME_CAP_S) status = 'timeout';
  if (status === 'invalid') return save({ ...record, status, note, tree, ...spent });

  let scored;
  try {
    scored = await score({ taskDir, tree });
  } catch (err) {
    return save({ ...record, status: 'invalid', note: `scorer: ${err.message.split('\n')[0]}`, tree, ...spent });
  }
  const lines = linesChanged(tree, commit);
  await writeFile(join(resultsDir, 'patches', `${task}-${arm}-${n}.patch`), git(tree, 'diff', '--cached', '--binary', commit));
  return save({ ...record, status, ...(note && { note }), ...scored, linesChanged: lines, ...spent, tree });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, arm] = process.argv.slice(2);
  if (cmd === 'setup') await setup();
  else if (cmd && ARMS.includes(arm)) await trial(cmd, arm);
  else {
    console.error('Usage: node benchmark/run.mjs setup | <task> <bare|same-rules|team>');
    process.exit(1);
  }
}
