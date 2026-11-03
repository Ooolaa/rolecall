import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generate } from './generate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const rolesDir = join(root, 'roles');
const freshDir = () => mkdtemp(join(tmpdir(), 'rolecall-'));

const roles = await Promise.all(
  (await readdir(rolesDir)).map(async (f) => (await import(pathToFileURL(join(rolesDir, f)))).default),
);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const credit = (role) =>
  new RegExp(`\\[${escape(role.upstream.name)}\\]\\(${escape(role.upstream.url)}\\) \\(${escape(role.upstream.license)}\\)`);

const generated = await freshDir();
const written = await generate({ rolesDir, outDir: generated });
const claudeFile = (role) => readFile(join(generated, 'agents', `team-${role.id}.md`), 'utf8');
const cursorFile = (role) => readFile(join(generated, 'cursor', 'agents', `rolecall-${role.id}.md`), 'utf8');
const codexPath = (role) => join(generated, 'codex', 'agents', `rolecall-${role.id}.toml`);
// Parse with a real TOML parser (Python's stdlib tomllib) rather than trusting our own output.
const parseToml = (file) =>
  JSON.parse(execFileSync('python3', ['-c', 'import json,sys,tomllib;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))', file]));

test('there is one Role source per Role, named by job', () => {
  assert.deepEqual(roles.map((r) => r.name).sort(), [
    'Art Director', 'Builder', 'Design Critic', 'Design Lead',
    'Gatekeeper', 'Planner', 'Reviewer', 'Security Reviewer', 'Skeptic', 'Threat Modeler',
  ]);
});

test('generator writes exactly one Claude Code, one Codex and one Cursor Role file per Role', () => {
  assert.deepEqual(written.sort(), roles.flatMap((r) => [
    `agents/team-${r.id}.md`, `codex/agents/rolecall-${r.id}.toml`, `cursor/agents/rolecall-${r.id}.md`,
  ]).sort());
});

test('only the Builder, Planner and Gatekeeper may edit files', () => {
  const editors = roles.filter((r) => r.edits !== 'none').map((r) => `${r.name}: ${r.edits}`).sort();
  assert.deepEqual(editors, ['Builder: source and tests', 'Gatekeeper: docs and changelog', 'Planner: plans']);
});

for (const role of roles) {
  test(`${role.name} (Claude Code): name, description, model and instructions`, async () => {
    const [, frontmatter, body] = (await claudeFile(role)).split(/^---$/m);
    assert.match(frontmatter, new RegExp(`^name: team-${role.id}$`, 'm'));
    assert.match(frontmatter, /^description: ".+"$/m);
    assert.match(frontmatter, /^model: \S+$/m);
    assert.match(body, new RegExp(`You are the \\*\\*${role.name}\\*\\*`));
    assert.ok(body.includes(role.instructions));
  });

  test(`${role.name} (Claude Code): credits its Upstream and scopes to its own skills plus the Base rule`, async () => {
    const file = await claudeFile(role);
    assert.match(file, credit(role));
    assert.ok(role.skills.length > 0);
    for (const skill of role.skills) assert.ok(file.includes(`\`${skill.name}\``), skill.name);
    assert.match(file, /`ponytail:ponytail`/);
    assert.match(file, /Ignore every other skill/);
  });

  test(`${role.name} (Codex): valid TOML with name, description and developer instructions`, () => {
    const agent = parseToml(codexPath(role));
    assert.equal(agent.name, `rolecall_${role.id.replaceAll('-', '_')}`);
    assert.equal(agent.description, role.description);
    assert.match(agent.developer_instructions, new RegExp(`You are the \\*\\*${role.name}\\*\\*`));
    assert.equal(agent.sandbox_mode, role.edits === 'none' ? 'read-only' : 'workspace-write');
  });

  test(`${role.name} (Codex): credits its Upstream and points only at its own skills plus the Base rule`, () => {
    const text = parseToml(codexPath(role)).developer_instructions;
    assert.match(text, credit(role));
    const repo = new URL(role.upstream.url).pathname.slice(1);
    const skillPaths = [...new Set([...text.matchAll(/`~\/\.codex\/rolecall\/upstreams\/([^`]+)`/g)].map((m) => m[1]))].sort();
    assert.deepEqual(skillPaths, [
      ...role.skills.map((s) => `${repo}/${s.path}`),
      'DietrichGebert/ponytail/skills/ponytail/SKILL.md',
    ].sort());
    for (const skill of role.skills) assert.ok(!text.includes(skill.name), `Claude Code skill name left in: ${skill.name}`);
  });

  test(`${role.name} (Cursor): name, description, model, readonly and instructions`, async () => {
    const [, frontmatter, body] = (await cursorFile(role)).split(/^---$/m);
    assert.match(frontmatter, new RegExp(`^name: rolecall-${role.id}$`, 'm'));
    assert.match(frontmatter, new RegExp(`^description: ${escape(JSON.stringify(role.description))}$`, 'm'));
    assert.match(frontmatter, /^model: inherit$/m);
    assert.match(frontmatter, new RegExp(`^readonly: ${role.edits === 'none'}$`, 'm'));
    assert.match(body, new RegExp(`You are the \\*\\*${role.name}\\*\\* on a Rolecall team, in Relayed mode`));
  });

  test(`${role.name} (Cursor): credits its Upstream and points only at its own skills plus the Base rule`, async () => {
    const text = await cursorFile(role);
    assert.match(text, credit(role));
    const repo = new URL(role.upstream.url).pathname.slice(1);
    const skillPaths = [...new Set([...text.matchAll(/`~\/\.cursor\/rolecall\/upstreams\/([^`]+)`/g)].map((m) => m[1]))].sort();
    assert.deepEqual(skillPaths, [
      ...role.skills.map((s) => `${repo}/${s.path}`),
      'DietrichGebert/ponytail/skills/ponytail/SKILL.md',
    ].sort());
    for (const skill of role.skills) assert.ok(!text.includes(skill.name), `Claude Code skill name left in: ${skill.name}`);
  });
}

test('stale check passes when files match fresh output', async () => {
  const dir = await freshDir();
  await generate({ rolesDir, outDir: dir });
  assert.deepEqual(await generate({ rolesDir, outDir: dir, check: true }), []);
});

test('stale check reports drifted and missing files without writing', async () => {
  const dir = await freshDir();
  await generate({ rolesDir, outDir: dir });
  await writeFile(join(dir, 'agents', 'team-skeptic.md'), 'hand edit');
  await writeFile(join(dir, 'codex', 'agents', 'rolecall-builder.toml'), 'hand edit');
  await writeFile(join(dir, 'cursor', 'agents', 'rolecall-planner.md'), 'hand edit');
  assert.deepEqual(
    (await generate({ rolesDir, outDir: dir, check: true })).sort(),
    ['agents/team-skeptic.md', 'codex/agents/rolecall-builder.toml', 'cursor/agents/rolecall-planner.md'],
  );
  assert.equal(await readFile(join(dir, 'agents', 'team-skeptic.md'), 'utf8'), 'hand edit');

  const empty = await freshDir();
  assert.equal((await generate({ rolesDir, outDir: empty, check: true })).length, roles.length * 3);
  assert.deepEqual(await readdir(empty), []);
});

test('committed Role files are up to date', async () => {
  assert.deepEqual(await generate({ rolesDir, outDir: root, check: true }), []);
});

for (const script of ['install.sh', 'install-codex.sh', 'install-cursor.sh']) {
  test(`${script} clones every Upstream the Role files point at`, async () => {
    const installer = await readFile(join(root, script), 'utf8');
    for (const url of [...roles.map((r) => r.upstream.url), 'https://github.com/DietrichGebert/ponytail']) {
      assert.ok(installer.includes(new URL(url).pathname.slice(1)), url);
    }
  });
}

// Adding a Role touches every place that lists the Roles; these catch the ones a hand edit misses.
const LEADS = [
  { file: 'skills/dev-team/SKILL.md', row: (r) => `| ${r.name.replaceAll(' ', '-')} | team-${r.id} |` },
  { file: 'codex/skills/rolecall/SKILL.md', row: (r) => `| ${r.name} | rolecall_${r.id.replaceAll('-', '_')} |` },
  { file: 'cursor/skills/rolecall-cursor/SKILL.md', row: (r) => `| ${r.name} | rolecall-${r.id} |` },
];
for (const lead of LEADS) {
  test(`${lead.file} lists every Role in its table`, async () => {
    const text = await readFile(join(root, lead.file), 'utf8');
    for (const role of roles) assert.ok(text.includes(lead.row(role)), `missing row: ${lead.row(role)}`);
  });
}

test('README lists every Role and states the right counts', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  for (const role of roles) assert.ok(readme.includes(`| **${role.name}** |`), role.name);
  const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const count = (re) => [...readme.matchAll(re)].map((m) => NUMBERS.indexOf(m[1].toLowerCase()));
  const advisers = count(/\b(\w+) advise-only Roles/gi);
  assert.ok(advisers.length > 0);
  assert.deepEqual(advisers, advisers.map(() => roles.filter((r) => r.edits === 'none').length));
  assert.deepEqual(count(/team of (\w+) coding roles/gi), [roles.length]);
  assert.deepEqual(count(/copies the (\w+) Role files/gi), [roles.length, roles.length, roles.length]);
});
