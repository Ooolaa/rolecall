# Security Role: candidate Upstreams

Researched 2026-11-02 against the GitHub repos themselves (`gh api repos/...`, README, the skill and rule files, `.claude-plugin/marketplace.json`). Star counts and dates are from that day. Anything not checked against a primary source is marked **(unverified)**.

## What the Role needs

Taken from ADR 0001, ADR 0004 and the existing Role sources (`roles/reviewer.mjs`, `roles/skeptic.mjs`):

- One popular open-source Upstream, credited, whose skill files can be named exactly (`skills: [{ name, path }]`), so the generator can point Claude Code at a plugin skill and Codex/Cursor at a file in the cloned repo.
- `edits: 'none'`, so it is read-only on Codex (`sandbox_mode = "read-only"`) and Cursor (`readonly: true`).
- No accounts, API keys or extra binaries, because every Teammate runs on the user's own agent with no setup beyond `install*.sh`.
- No startup hooks or "always use me" instructions that leak into other Teammates (the superpowers problem in ADR 0004).
- Useful before code exists (brief, plan review) as well as on a diff, because the Reviewer already owns the final diff.

## Candidates

| Candidate | Maintainer | License | Stars | Last commit | Claude Code / Codex / Cursor | External tools |
|---|---|---|---|---|---|---|
| [trailofbits/skills](https://github.com/trailofbits/skills) | Trail of Bits | CC-BY-SA-4.0 | 7,939 | 2026-10-28 | plugin marketplace / plugin marketplace / files only | None for the review skills; `static-analysis` needs CodeQL or Semgrep |
| [anthropics/claude-code-security-review](https://github.com/anthropics/claude-code-security-review) | Anthropic | MIT | 6,673 | 2026-02-11 | built in as `/security-review` / file only / file only | Action needs a Claude API key; the command needs nothing |
| [cosai-oasis/project-codeguard](https://github.com/cosai-oasis/project-codeguard) | CoSAI (OASIS Open Project) | CC-BY-4.0 | 360 | 2026-10-12 | plugin / plugin / generated rules and agent | None (optional MCP server) |
| [semgrep/skills](https://github.com/semgrep/skills) | Semgrep | Semgrep Rules License v1.0 | 337 | 2026-07-28 | `npx skills add` / same / same | `semgrep` skill needs the Semgrep CLI; `code-security` does not |
| [semgrep/mcp](https://github.com/semgrep/mcp) | Semgrep | MIT | 686 | 2025-10-28 | MCP | Semgrep CLI. **Archived.** |
| [openai/codex-security](https://github.com/openai/codex-security) | OpenAI | Apache-2.0 | 11,281 | 2026-11-02 | Codex plugin and CLI | Codex / OpenAI account; Codex-only |
| [snyk/studio-mcp](https://github.com/snyk/studio-mcp) | Snyk | Apache-2.0 | 58 | 2026-10-31 | MCP | Snyk account and CLI **(unverified: account requirement read from the product, not the repo)** |
| [snyk/agent-scan](https://github.com/snyk/agent-scan) | Snyk | Apache-2.0 | 3,195 | 2026-10-30 | CLI | Scans agents, MCP servers and skills, not app code. Off-target. |
| [wshobson/agents](https://github.com/wshobson/agents) | Seth Hobson | MIT | 42,084 | 2026-11-02 | plugins for all three | None |
| [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | VoltAgent | MIT | 26,259 | 2026-10-30 | Claude Code subagents | None |
| [OWASP/CheatSheetSeries](https://github.com/OWASP/CheatSheetSeries) | OWASP | CC-BY-SA-4.0 | 33,841 | 2026-11-01 | plain Markdown | None |
| [OWASP/ASVS](https://github.com/OWASP/ASVS) | OWASP | CC-BY-SA-4.0 | 3,740 | 2026-10-29 | plain Markdown/CSV | None |
| [OWASP Top 10 for LLM Apps](https://github.com/OWASP/www-project-top-10-for-large-language-model-applications) | OWASP GenAI Security Project | NOASSERTION | 1,476 | 2026-08-05 | plain Markdown | None |

### trailofbits/skills

A Claude Code plugin marketplace (`trailofbits`) of about 45 plugins, also installable in Codex with `codex plugin marketplace add trailofbits/skills` (stated in the README; Codex reads Claude plugin marketplaces). Many plugins are for smart contracts, C/C++, Rust, YARA or reverse engineering. The ones that fit a web-app team:

- `differential-review` (`plugins/differential-review/skills/differential-review/SKILL.md`, plus `methodology.md`, `adversarial.md`, `patterns.md`, `reporting.md` and an `adversarial-modeler` agent). Security review of a diff: risk-classify each file (HIGH = auth, crypto, external calls, validation removal), git blame on removed security code, blast radius by counting callers, test coverage, attacker model, report. Has a "rationalizations" table ("Small PR, quick review → Heartbleed was 2 lines").
- `sharp-edges` (`plugins/sharp-edges/skills/sharp-edges/SKILL.md`, `allowed-tools: Read Grep Glob`, references incl. `auth-patterns.md`, `config-patterns.md`, `lang-python.md`, `lang-javascript.md`). Finds APIs and configs where the easy path is insecure. Explicitly for design review, not implementation bugs, which makes it a plan-phase tool.
- `insecure-defaults` (fallback secrets, default credentials, fail-open switches, weak crypto, CORS `*`, tracebacks in responses). Runs as a parallel audit pipeline with a verifier per candidate file; heavy for a per-task check.
- `fp-check` (false-positive verification). Ships a `hooks/hooks.json`, so it would break ADR 0004 scoping; leave it out.

Fit: strong. The way of thinking (risk first, evidence for every finding, state coverage limits) is distinct from caveman's terse general review. Frictions: `differential-review` says "always generate a markdown report file" and its examples are Solidity-heavy, and its full workflow is slow (its own estimate: about 30 minutes for a small PR). The Role must use the quick-triage path and send findings as a message, the same way the Planner Role overrides superpowers' approval step. CC-BY-SA only matters if Rolecall copies the text; it only references the files.

### anthropics/claude-code-security-review

A GitHub Action (Python, Claude API key) plus `.claude/commands/security-review.md`, which is the same prompt Claude Code ships built in as `/security-review`. The command reads `git diff --merge-base origin/HEAD`, looks for injection, authn/authz bypass, hardcoded secrets, weak crypto, deserialization, XSS and sensitive-data logging, and filters to findings with confidence 8/10 or higher.

Fit: weak for this Role, for four reasons found in the file itself:
1. It is diff-only and post-build, so it has nothing to say at brief or plan time.
2. Its hard exclusions drop rate limiting, DoS, "lack of input validation on non-security-critical fields" and "lack of hardening measures". Those cover task 06 (login lockout) and most of the existing `unvalidated-input` Traps.
3. It is a command with `!`-backtick shell interpolation, a Claude Code feature. On Codex and Cursor a Teammate would have to read it as prose and run the git commands itself.
4. It ships inside Claude Code, so it is already present in every Arm, Bare included. That makes it a poor Upstream to attribute an effect to.

Last commit February 2026, about nine months before this research.

### cosai-oasis/project-codeguard

One skill, `skills/codeguard/SKILL.md` (v1.5.0), plus 23 rule files in `skills/codeguard/rules/` (input validation and injection, authorization and IDOR, authentication incl. "rate limits per IP, account" and lockout, logging incl. "never log credentials, tokens", hardcoded credentials, sessions, API services, supply chain and more). The skill picks rules by tag and language. Also a `codeguard-reviewer` agent (`sources/agents/codeguard-reviewer/AGENT.md`) that is read-only except for a SARIF file, generated for Claude Code, Codex, Cursor, OpenCode and Copilot. `.claude-plugin` and `.codex-plugin` manifests exist. The README says the rules are meant for "before code generation ... planning phase" as well as review.

Fit: the best coverage match for the benchmark and for all three agents, with no tools. Weakness: 360 stars, far below every other Rolecall Upstream (the smallest are in the thousands **(unverified: current star counts of the existing Upstreams not re-checked)**). There is also an older `project-codeguard/rules` repo (427 stars, last push 2026-01-29) that appears to be superseded by the CoSAI repo **(unverified: no deprecation notice found)**. The README does not state where the rule text came from; that it started at Cisco is **unverified**.

### semgrep/skills

Three skills: `code-security` (28 rule categories in 15+ languages, OWASP Top 10, described as "primarily generated by transforming open-source Semgrep rules"), `llm-security`, and `semgrep` (needs the CLI). Beta. License is the Semgrep Rules License v1.0, which restricts some commercial uses **(unverified: terms not read in full)**. Its description tells the agent to "always consult this skill when writing or reviewing any code", which would pull it into the Builder's session on Claude Code, against ADR 0004. Fit: medium content, poor scoping, small project.

### openai/codex-security

Large and active, but a Codex plugin plus CLI/SDK built around Codex Security scans, patch generation and Codex Security Cloud. Codex-only and it generates fixes. Does not fit a cross-agent, advise-only Role.

### wshobson/agents and VoltAgent/awesome-claude-code-subagents

Very popular collections that include single-file security personas (`plugins/backend-development/agents/security-auditor.md`, `backend-security-coder.md`; `categories/04-quality-security/...`). They are generic prompts inside large catalogs rather than a security project with its own method. Using one would make the Upstream "a file in someone's catalog", and installing the plugin brings unrelated agents. Fit: low.

### Community security skills

`gh search repos` for Claude Code security skills returns mostly small repos (under 100 stars), and several top hits (`r01-...-security`, `r18-anthropics-claude-code-security`, created the same day, near-identical descriptions) look like auto-generated spam. Nothing popular enough to qualify.

### OWASP ASVS, Cheat Sheet Series, Top 10 for LLM Apps

Authoritative rule content, but documents, not agent skills: no SKILL.md, no "way of working", and far too large to load whole (ASVS has hundreds of requirements). The LLM Top 10 is about apps that call an LLM, not about the FastAPI template the benchmark uses. Good as references the chosen Upstream already draws on, not as an Upstream.

## Recommendation

**Upstream: trailofbits/skills**, using two plugins: `differential-review` and `sharp-edges`.

- It is the most popular dedicated security project for agents (7.9k stars), maintained by a well-known security firm, and updated last week.
- It installs as plugins on Claude Code and Codex; Cursor reads the files from the clone, like every other Upstream.
- The two skills cover both halves of the job: `sharp-edges` for the brief and plan (read-only by its own `allowed-tools`), `differential-review` for per-task and final diffs.
- No hooks in either plugin, no accounts, no binaries.

**Fallback: cosai-oasis/project-codeguard.** Better rule coverage for web apps and explicit cross-agent support, but too small to sit next to the other Upstreams today. Switch to it if the ToB skills prove too slow or too smart-contract-minded in Trials, or if CodeGuard grows.

Not recommended as the Upstream: Anthropic's `/security-review`. It is already present in every Arm, and its exclusions skip the issue types the benchmark seeds.

## Role sketch: Security Reviewer

```js
// roles/security-reviewer.mjs (sketch, not written)
export default {
  id: 'security-reviewer',
  name: 'Security Reviewer',
  description: 'Rolecall Security Reviewer. Finds security risks in the brief, the plan and the diff: trust boundaries, auth checks, injection, secrets. Advises only; never edits code.',
  upstream: { name: 'trailofbits/skills', url: 'https://github.com/trailofbits/skills', license: 'CC-BY-SA-4.0' },
  skills: [
    { name: 'sharp-edges:sharp-edges', path: 'plugins/sharp-edges/skills/sharp-edges/SKILL.md' },
    { name: 'differential-review:differential-review', path: 'plugins/differential-review/skills/differential-review/SKILL.md' },
  ],
  edits: 'none',
  instructions: '...',
};
```

The Claude Code skill names assume plugin `<plugin>:<skill>` naming **(unverified until installed)**.

When it speaks:

1. **Discuss (brief).** Reads the code the task touches and sends the Skeptic and Planner a short threat note: which trust boundaries the task crosses (request input, auth, database, logs, files), the project's existing auth pattern (in the benchmark template, `CurrentUser` and the owner-or-superuser check), and any security requirement the prompt implies but does not state. Uses `sharp-edges`. If the task crosses no trust boundary, it says so in one line and goes quiet, the way the design Roles are skipped for non-UI work.
2. **Plan review.** Checks each planned endpoint or data path for auth, input validation at the boundary and secret handling. Sends at most a few concrete additions to the Planner, alongside the Skeptic's single pushback.
3. **Per-task check.** Only for tasks that `differential-review` rates HIGH risk (auth, validation, external calls, new public endpoints). Quick-triage path, no report file. Findings go to the Builder in the Reviewer's format: `file:L<line>: <problem>. <fix>.` with 🔴/🟡.
4. **Final review.** Runs `differential-review` on the full diff in parallel with the Reviewer and sends its findings to the Builder. Its result goes into the Reviewer's five-line summary as one line ("security: clean" or the open risks); it does not write its own summary.

Files it owns: none. `differential-review` asks for a report file, so the instructions override that (send the report as a message), and the read-only sandbox on Codex and Cursor enforces it.

How it stays out of the other Roles' way:

- **Reviewer** reviews the whole diff for bugs and quality. The Security Reviewer reports only findings with a concrete attacker or trust-boundary story. A plain bug (off-by-one, wrong status code) goes to the Reviewer, not here. If both flag the same line, the Builder fixes it once.
- **Skeptic** guards scope. The two can pull in opposite directions: the Skeptic cuts extras, the Security Reviewer asks for checks. The rule: a security fix for code the task adds or touches is in scope; general hardening of code the task doesn't touch is a note for the lead, not a request to the Builder. Ponytail already lists security measures as something never to simplify away, so the Base rule backs this split.
- **Gatekeeper** runs checks. If the project already has a security scanner in its checks, the Gatekeeper runs it; the Security Reviewer does not run tools.

Cost: one more Teammate, so nine sessions instead of eight (six instead of five without the design Roles), unless it goes quiet after the brief.

## What it means for the benchmark

- **Same-rules baseline (ADR 0002).** The `same-rules` Arm must get the same two Trail of Bits plugins. `benchmark/run.mjs` reads the plugin list from the `UPSTREAMS` block in `install.sh` (one `repo marketplace plugin` line per plugin), so adding two lines there (`trailofbits/skills trailofbits differential-review` and `trailofbits/skills trailofbits sharp-edges`) updates both the installs and the runner's plugin check. The uninstall loop removes the marketplace once per line, with `|| true`, so two lines for one marketplace should be harmless **(unverified: not run)**.
- In the baseline, `differential-review` and `sharp-edges` trigger only by their descriptions ("Use when reviewing a PR..."). Whether a headless single session ever invokes them is exactly what the comparison measures.
- All three Arms on Claude Code already have the built-in `/security-review`. It is not a plugin, so the runner's plugin check doesn't see it. Note it in the write-up rather than trying to remove it.
- **Existing Traps.** The current `unvalidated-input` Traps are mostly robustness bugs (LIKE wildcards in task 01, a 500 on a long title in 04, a 500 on an unknown owner in 05). Only the CSV-injection Trap in 02 is clearly a security issue. A security Role should help on 02 and perhaps 01; expect little effect on 04 and 05, and don't credit or blame the Role for them.
- Every auth rule in the current prompts (01, 02, 04, 05) is stated in the prompt and checked by a functional hidden test, so none of them is a Trap. A security Trap has to be something the prompt leaves unsaid.

### Suggested security Traps (script-checkable)

1. **`secret-logged` on 06-login-lockout.** Kind: secret logged in plaintext. A hidden test logs in with a wrong password containing a canary string, captures all log output (pytest `caplog` at DEBUG on the root logger), and fails if the canary appears. This adds a security Trap to the one task that is about authentication. As written, the prompt gives no reason to log, so the trip rate may be near zero. A bait line such as "Log each lockout so ops can see who is being targeted" makes it a real Trap, but it changes the task, and all fixtures and existing Trials for 06 would need redoing.
2. **`missing-ownership-check` on a new task**, for example "Archive an item: add `POST /api/v1/items/{id}/archive`", with no sentence about who may do it. A hidden test has user B archive user A's item and fails unless the answer is 403 or 404 and the item is unchanged. The template's other item routes show the owner-or-superuser pattern, so a careful agent copies it. This is the classic IDOR mistake and needs a new task (07), which would bring the full benchmark from 54 to 63 Trials.

An alternative to 2 is **`order-by-injection`**: a task to add `?sort=<field>` to the items list. A hidden test sends a sort value that is not a column, or a SQL expression, and fails unless the reply is a 4xx and the query never runs it. That catches `order_by(text(sort))`. SQL injection through values is unlikely in this template because SQLModel binds parameters, so a sort column is the realistic injection point.

Each new Trap needs its `trap-<id>.patch` fixture, and the fixture tests in `node --test` must show it trips only its own Trap.
