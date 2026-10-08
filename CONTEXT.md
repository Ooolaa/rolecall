# Rolecall

A team of AI coding roles, each built on a popular open-source agent rule set, that discuss a task with each other and then build it together.

## Language

### The team

**Lead**:
The user's own agent session. It spawns the Teammates, coordinates the work and is the only one that talks to the user.
_Avoid_: Manager, orchestrator, main agent

**Role**:
A definition of one team member's job, instructions and upstream rule set. A Role never runs by itself.
_Avoid_: Persona, bot, agent (alone)

**Teammate**:
A Role running as a live session inside one team run.
_Avoid_: Agent (alone), worker, subagent

**Upstream**:
An open-source rule set that a Role or the Base rule is based on and credits, such as caveman or ponytail.
_Avoid_: Source, dependency, inspiration

**Base rule**:
A rule set every Teammate follows, with no Role of its own. Today that is ponytail.
_Avoid_: Global rule, foundation, always-on skill

**Team run**:
One use of the team on one task, from the Lead spawning Teammates to shutting them down.
_Avoid_: Session (that's a single Claude/Codex/Cursor session), job

**Direct mode**:
A Team run where Teammates message each other directly. Available only on agents with peer messaging (Claude Code agent teams).
_Avoid_: Full team, native mode

**Relayed mode**:
A Team run where Teammates report only to the Lead, and the Lead passes objections and replies between them. Used on agents without peer messaging (Codex, Cursor).
_Avoid_: Lite mode, subagent mode

**Role source**:
The single canonical description of a Role, from which each agent's Role file is generated.
_Avoid_: Template, master copy

### Measuring

**Bare baseline**:
One agent session with no Upstreams installed, given the same task as a Team run.

**Same-rules baseline**:
One agent session with every Upstream installed but no team, given the same task as a Team run. The headline comparison, because it isolates what the team itself adds.
_Avoid_: Control, plugin baseline

**Arm**:
One of the three setups a benchmark task is run under: Team run, Same-rules baseline or Bare baseline.
_Avoid_: Variant, condition

**Trial**:
One Arm run on one benchmark task, once. The full benchmark is 54 Trials; the pilot is three, one per Arm on task 1.
_Avoid_: Run (alone, collides with Team run), attempt

**Trap**:
A known mistake seeded into a benchmark task that a script can check, such as unvalidated input, an unneeded new dependency, scope-creep bait or a broken existing caller.
_Avoid_: Gotcha, test case

### Roles

**Skeptic**:
Challenges assumptions and keeps the work in scope. Upstream: andrej-karpathy-skills.

**Planner**:
Turns the agreed brief into a design and a task plan. Upstream: superpowers.

**Builder**:
The only Role that changes source code and tests. Upstream: mattpocock/skills.

**Gatekeeper**:
Runs the project's checks and owns docs and the changelog. Upstream: steipete/agent-rules.

**Reviewer**:
Reviews the code diff. Upstream: caveman.

**Design Lead**:
Defines the design system the UI must follow. Upstream: ui-ux-pro-max-skill.

**Art Director**:
Owns the visual direction and keeps the UI from looking generic. Upstream: taste-skill.

**Design Critic**:
Reviews the rendered UI, not the code. Upstream: impeccable.
_Avoid_: Reviewer (that Role reviews code)
