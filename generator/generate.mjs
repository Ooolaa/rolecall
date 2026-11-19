// Turns each Role source in roles/ into its Role file for every agent:
//   Claude Code  agents/team-<id>.md
//   Codex        codex/agents/rolecall-<id>.toml
//   Cursor       cursor/agents/rolecall-<id>.md
// Usage: node generator/generate.mjs [--check]   (--check writes nothing, exits 1 if stale)
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE_RULE = {
  name: 'ponytail',
  url: 'https://github.com/DietrichGebert/ponytail',
  license: 'MIT',
  skill: { name: 'ponytail:ponytail', path: 'skills/ponytail/SKILL.md' },
};

// Where install-codex.sh / install-cursor.sh clone each Upstream: <dir>/<owner>/<repo>.
const CODEX_UPSTREAMS = '~/.codex/rolecall/upstreams';
const CURSOR_UPSTREAMS = '~/.cursor/rolecall/upstreams';

const EDITS = {
  none: 'none. You do not edit project files',
  plans: 'plans in `docs/plans/` only',
  'source and tests': 'source code and tests',
  'docs and changelog': 'docs and the changelog only',
};

const credit = (role) =>
  `Based on [${role.upstream.name}](${role.upstream.url}) (${role.upstream.license}). ` +
  `Base rule: [${BASE_RULE.name}](${BASE_RULE.url}) (${BASE_RULE.license}).`;

function renderClaude(role) {
  const skills = role.skills.map((s) => `\`${s.name}\``).join(', ');
  return `---
name: team-${role.id}
description: ${JSON.stringify(role.description)}
model: inherit
---

You are the **${role.name}** on a Rolecall team.

${credit(role)}

**Skills:** load and follow ${skills} and the Base rule \`${BASE_RULE.skill.name}\`. Ignore every other skill, even when a hook or another plugin tells you to use it; other Teammates own those.

**Files you may edit:** ${EDITS[role.edits]}.

${role.instructions}
${role.codexAsk ? codexSecondOpinion(role.codexAsk) : ''}`;
}

// Claude Code only: the other platforms run the team on Codex or Cursor already.
const codexSecondOpinion = (ask) => `
**Codex second opinion:** if \`command -v codex\` finds it, also run, read-only:
\`codex exec --sandbox read-only "${ask} Run git diff <start> to see it. One line per finding: file:line: problem. fix."\`
Weigh each Codex finding yourself: forward only ones you confirm in the code, tagged \`[codex]\`. Tell the lead the count (or \`skipped\` if codex is missing or errors). Never let Codex edit files.
`;

// Relayed mode (Codex, Cursor): Teammates report only to the lead, and skills are files under `upstreams`.
function relayedInstructions(role, upstreams) {
  const at = (url, skill) => `\`${upstreams}/${new URL(url).pathname.slice(1)}/${skill.path}\``;
  // These agents can't load Claude Code skill names, so point any the instructions mention at the file instead.
  const body = role.skills.reduce((text, s) => text.replaceAll(`\`${s.name}\``, at(role.upstream.url, s)), role.instructions);
  return `You are the **${role.name}** on a Rolecall team, in Relayed mode: you report only to the lead. Wherever these instructions say to message or send something to another Teammate, put it in your reply to the lead, addressed to that Teammate by job name; the lead relays it and brings back their answer.

${credit(role)}

**Skills:** read and follow these files before you start, and use no other skills:
${role.skills.map((s) => `- ${at(role.upstream.url, s)}`).join('\n')}
- Base rule: ${at(BASE_RULE.url, BASE_RULE.skill)}

**Files you may edit:** ${EDITS[role.edits]}.

${body}`;
}

function renderCodex(role) {
  const instructions = relayedInstructions(role, CODEX_UPSTREAMS);
  if (instructions.includes("'''")) throw new Error(`${role.id}: instructions can't contain '''`);
  return `# Generated from roles/${role.id}.mjs by generator/generate.mjs. Do not edit.
name = "rolecall_${role.id.replaceAll('-', '_')}"
description = ${JSON.stringify(role.description)}
sandbox_mode = "${role.edits === 'none' ? 'read-only' : 'workspace-write'}"
developer_instructions = '''
${instructions}
'''
`;
}

function renderCursor(role) {
  return `---
name: rolecall-${role.id}
description: ${JSON.stringify(role.description)}
model: inherit
readonly: ${role.edits === 'none'}
---

<!-- Generated from roles/${role.id}.mjs by generator/generate.mjs. Do not edit. -->

${relayedInstructions(role, CURSOR_UPSTREAMS)}
`;
}

const TARGETS = [
  { file: (role) => `agents/team-${role.id}.md`, render: renderClaude },
  { file: (role) => `codex/agents/rolecall-${role.id}.toml`, render: renderCodex },
  { file: (role) => `cursor/agents/rolecall-${role.id}.md`, render: renderCursor },
];

async function loadRoles(rolesDir) {
  const names = (await readdir(rolesDir)).filter((f) => f.endsWith('.mjs')).sort();
  return Promise.all(names.map(async (f) => (await import(pathToFileURL(join(rolesDir, f)))).default));
}

// Returns the Role files (relative to outDir) that are stale (check mode) or were written.
export async function generate({ rolesDir, outDir, check = false }) {
  const changed = [];
  for (const role of await loadRoles(rolesDir)) {
    if (!EDITS[role.edits]) throw new Error(`${role.id}: unknown edits "${role.edits}"`);
    for (const target of TARGETS) {
      const file = target.file(role);
      const content = target.render(role);
      const current = await readFile(join(outDir, file), 'utf8').catch(() => null);
      if (current === content) continue;
      changed.push(file);
      if (!check) {
        await mkdir(dirname(join(outDir, file)), { recursive: true });
        await writeFile(join(outDir, file), content);
      }
    }
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const check = process.argv.includes('--check');
  const changed = await generate({ rolesDir: join(root, 'roles'), outDir: root, check });
  if (check && changed.length) {
    console.error(`Stale Role files (run: node generator/generate.mjs):\n  ${changed.join('\n  ')}`);
    process.exit(1);
  }
  console.log(check ? 'Role files up to date.' : `Wrote ${changed.length} Role file(s).`);
}
