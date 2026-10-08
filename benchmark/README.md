# Benchmark

Feature tasks on [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template), pinned in `template.json`, scored by script with no LLM (ADR 0002).

Each task in `tasks/<task>/` has:

- `prompt.md`: what the agent sees
- `hidden/`: pytest files the agent never sees
- `task.json`: its Traps, each checked by hidden or template tests failing (`tests`), by changed files matching a glob (`changed`), or both
- `fixtures/`: patches against the pinned template, `good.patch` plus one `trap-<id>.patch` per Trap

`04-item-duplicate` is deliberately small, one endpoint a single session should handle well, so the results also show where the team is overkill.

`scorer/score.mjs` takes a finished working tree and a task and returns pass or fail per hidden test and per Trap. It runs the tests in Docker against a throwaway Postgres (`scorer/compose.yml`), using the template's own tests as pinned rather than any edits the agent made to them.

`node --test` checks every task's fixtures: the good one passes every hidden test and trips no Trap, and each trap fixture trips only its own Trap. It also checks that the tasks together cover every Trap kind and that at least one needs UI work. Those checks need Docker running (Docker Desktop, OrbStack or Colima) and are skipped without it. Work copies go in `~/.cache/rolecall/`, because Colima shares only your home directory with its VM.

## Running Trials

A Trial is one Arm on one task, once. Each Arm gets its own Claude Code config dir under `~/.cache/rolecall/arms/`, so your own plugins, hooks and `CLAUDE.md` never leak in (ADR 0005):

- **Bare baseline:** nothing installed.
- **Same-rules baseline:** every Upstream, installed the way a user would have it: caveman's voice on, steipete's rules wired in through that dir's `CLAUDE.md`.
- **Team run:** the full Rolecall install.

Set the Arms up once, then log each in to your subscription with the commands it prints:

```bash
node benchmark/run.mjs setup
```

Run a Trial:

```bash
node benchmark/run.mjs 01-item-search bare        # headless
node benchmark/run.mjs 01-item-search same-rules  # headless
node benchmark/run.mjs 01-item-search team        # you drive it
```

Every Trial gets a fresh clone of the pinned template, the task's `prompt.md` plus "No more information is available beyond this prompt; use your judgement.", model `claude-sonnet-5-5`, permissions bypassed, and 90 minutes. The two baselines run headlessly. A Team run needs an interactive session: the runner prints the exact command, and you type nothing except the scripted replies it lists, then answer whether you kept to them.

Before each Trial the runner checks the Arm's config dir, and a headless session's loaded plugins, against what that Arm should have. Afterwards it scores the tree and appends one line to `results/runs.jsonl`:

- `status`: `ok`, `timeout`, or `invalid` (wrong setup, usage limit, crash, script not followed, scorer error). Rerun invalid Trials; write-ups count only `ok` and `timeout`.
- `tests` and `traps` from the scorer, and `linesChanged` against the pinned commit, not counting lockfiles or `frontend/src/client/**`.
- `tokens`, `costUsd` and `seconds`, from every transcript of the Trial (the Lead and every Teammate). Cost is API-equivalent, priced from `prices.json`, the same way for every Arm, even on a subscription.
- The Claude Code version and each Upstream's commit.

The Trial's diff is saved to `results/patches/<task>-<arm>-<n>.patch`, so it can be re-scored without re-running. Transcripts stay in the Arm's config dir.
