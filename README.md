# Rolecall

Nine well-known agent rule sets, turned into a team of ten coding roles (five engineers, two security specialists and three designers) that discuss a task, challenge each other, and build it together.

_Formerly `claude-dev-team`; the old URL redirects here._

```
/dev-team add offline caching to the article list
```

Each Role is named by its job and based on one popular open-source project (its Upstream), keeping that project's way of thinking:

| Role | Upstream | Job | Edits |
|---|---|---|---|
| **Skeptic** | [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) | Reads the code, states assumptions, asks questions, sets success criteria, keeps changes small | Nothing |
| **Planner** | [obra/superpowers](https://github.com/obra/superpowers) | Writes the design and a step-by-step plan | `docs/plans/` |
| **Builder** | [mattpocock/skills](https://github.com/mattpocock/skills) | Implements test-first and debugs methodically | Source and tests |
| **Gatekeeper** | [steipete/agent-rules](https://github.com/steipete/agent-rules) | Build, lint, tests, docs, changelog | Docs and changelog |
| **Reviewer** | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | Terse diff review and final summary | Nothing |
| **Threat Modeler** | [trailofbits/skills](https://github.com/trailofbits/skills) (`sharp-edges`) | Before any code, lists the Abuse cases the task must withstand, each one a test the Builder writes first | Nothing |
| **Security Reviewer** | [trailofbits/skills](https://github.com/trailofbits/skills) (`differential-review`) | Reviews the diff for security risks and checks every Abuse case has a passing test. The team can't wrap up until it passes | Nothing |
| **Design Lead** | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Colors, type scale, spacing, component states, UX rules | Nothing |
| **Art Director** | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | One clear visual direction, keeps the UI from looking like a generic AI template | Nothing |
| **Design Critic** | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Audits screenshots of the built UI and sends exact polish fixes | Nothing |

The Threat Modeler and Security Reviewer form the **Security group**, a hard gate: the team doesn't wrap up while a 🔴 security finding is open or an Abuse case lacks a passing test, unless you waive it (ADR 0006). For work with no UI, the lead skips the three design Roles.

[Ponytail](https://github.com/DietrichGebert/ponytail) runs underneath all of them as an always-on rule: write only the code the task needs.

## How it works

The `/dev-team` skill makes your Claude Code session the **team lead**. It spawns the Roles as an [agent team](https://code.claude.com/docs/en/agent-teams): separate Claude sessions with a shared task list that message each other directly.

```
1. Discuss   Skeptic writes the brief, Gatekeeper finds the build/test
             commands, Planner reads the code, Threat Modeler lists the
             Abuse cases, Art Director and Design Lead agree a visual
             direction and design spec. They challenge each other.
2. Ask       Open questions come to you. The team waits for answers.
3. Plan      Planner writes the plan, with a test for every Abuse case
             before its logic. Skeptic pushes back once. You approve it before any code is written.
4. Build     Builder builds task by task, test-first, security tests red
             before the logic. Gatekeeper checks every task, Security
             Reviewer checks every task that touches a trust boundary,
             Design Critic audits screenshots of every visual task,
             Skeptic guards scope.
5. Review    Reviewer and Security Reviewer review the diff, Builder
             fixes, Gatekeeper runs final checks and updates docs.
6. Wrap up   Once the Security Reviewer reports a pass, you get a summary and a draft commit message.
             Nothing is committed or pushed unless you say so.
```

Every Role owns its own set of files, and the security and design Roles only advise, so they never overwrite each other's work.

## Install

Requires [Claude Code](https://code.claude.com), `git`, `jq` and `node`.

```bash
git clone https://github.com/Ooolaa/rolecall.git
cd rolecall
./install.sh
```

The script:

- installs the plugins for ponytail, caveman, superpowers, andrej-karpathy-skills, mattpocock/skills, ui-ux-pro-max, taste-skill, impeccable and trailofbits/skills (`sharp-edges` and `differential-review` only)
- copies steipete/agent-rules to `~/.claude/agent-rules/steipete/`
- copies the ten Role files to `~/.claude/agents/` (removing older person-named ones such as `team-karpathy.md`) and the skill to `~/.claude/skills/dev-team/`
- enables agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) in `~/.claude/settings.json`, after backing it up
- turns caveman's always-on voice off, so only the Reviewer talks that way

Restart Claude Code afterwards.

### Codex

Requires the [Codex CLI](https://developers.openai.com/codex) and `git`.

```bash
./install-codex.sh
```

Then start Codex in your project and type `$rolecall <what you want built>`. The script:

- clones each Upstream into `~/.codex/rolecall/upstreams/`, outside Codex's skill folders, so each Teammate reads only the skill files its Role names
- copies the ten Role files to `~/.codex/agents/` and the lead skill to `~/.agents/skills/rolecall/`
- changes no Codex settings (custom agents are on by default)

Codex Teammates can't message each other, so the team runs in Relayed mode: the lead passes every objection and reply between them. The five advise-only Roles run with a read-only sandbox. Remove it all with `./install-codex.sh --uninstall`.

### Cursor

Requires [Cursor](https://cursor.com) with custom subagents and `git`.

```bash
./install-cursor.sh
```

Then open your project in Cursor and type `/rolecall-cursor <what you want built>` in Agent chat. The script:

- clones each Upstream into `~/.cursor/rolecall/upstreams/`, outside Cursor's skill and rule folders, so each Teammate reads only the skill files its Role names
- copies the ten Role files to `~/.cursor/agents/` and the lead skill to `~/.cursor/skills/rolecall-cursor/` (not `rolecall`, because Cursor also loads the Codex lead from `~/.agents/skills/`)
- changes no Cursor settings

Like Codex, Cursor runs the team in Relayed mode, and the five advise-only Roles run read-only. steipete/agent-rules' `.mdc` rules are Cursor's own format, but they aren't installed as Cursor rules, which would apply to every Teammate; only the Gatekeeper reads them, from the clone. Cursor also loads agents and skills from `~/.claude/` and `~/.codex/`, so if you installed Rolecall for Claude Code too, ignore the `team-*` agents and `/dev-team` there. Remove it all with `./install-cursor.sh --uninstall`.

## Usage

Open a project, start `claude`, and type:

```
/dev-team <what you want built>
```

In the agent panel below the prompt, use ↑/↓ to select an agent and Enter to read its transcript or message it directly. For split panes (one per agent), run inside tmux or iTerm2 and set `"teammateMode": "auto"` in `~/.claude/settings.json`.

## Things to know

- **Cost:** every agent is a separate session, so the full team uses roughly ten times the tokens of one session (seven without the design Roles). Use the team for real features, not one-line fixes. The lead will tell you when a task is too small.
- **Agent teams are experimental** in Claude Code. Sessions with in-process teammates can't be resumed, and task status sometimes lags.
- **Overlaps:** superpowers and mattpocock/skills both ship test-driven development, debugging and review skills. Each Role file names the exact skills its Teammate uses and tells it to ignore the rest. Superpowers also loads a short guide into every session; the other Role files tell their Teammates to ignore it. Don't disable superpowers, because the Planner uses it.
- **Delegation changes:** with agent teams on, Claude may start teammates on its own when it delegates work. Set the variable to `0` to switch back.

## Uninstall

```bash
./install.sh --uninstall
```

This removes the Role files, the `/dev-team` skill, steipete/agent-rules, the ten plugins and their marketplaces, and the agent-teams setting (after backing up `~/.claude/settings.json`). It also uninstalls those plugins if you had them before Rolecall.

## Changing a Role

Each Role is defined once in `roles/<role>.mjs`. Regenerate the Role files in `agents/` (Claude Code), `codex/agents/` (Codex) and `cursor/agents/` (Cursor) with `node generator/generate.mjs`, and check them with `node --test` (it fails if a committed Role file is stale).

## Credits

Rolecall only contains the Role sources and generated Role files, the lead skills and the install scripts. All the rules come from these projects, installed from their own repositories:

- [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert (MIT)
- [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee (Apache 2.0)
- [obra/superpowers](https://github.com/obra/superpowers) by Jesse Vincent (MIT)
- [mattpocock/skills](https://github.com/mattpocock/skills) by Matt Pocock (MIT)
- [steipete/agent-rules](https://github.com/steipete/agent-rules) by Peter Steinberger (MIT)
- [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills), based on Andrej Karpathy's notes on LLM coding pitfalls
- [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) by nextlevelbuilder (MIT)
- [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) by Leonxlnx (MIT)
- [pbakaus/impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus (Apache 2.0)

## License

[MIT](LICENSE)
