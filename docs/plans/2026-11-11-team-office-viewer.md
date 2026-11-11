# Team office viewer: plan

Starting commit `faf63a9`. Leave the user's dirty `.gitignore` and `benchmark/results/` alone.

## Goal

A local web page that shows a live Team run as an architect's floor plan. Departments are rooms, Teammates are desks, and messages are memos carried along a corridor. A message ledger ("Post room") and a title block show project health from the tasks and git.

Launch it by hand: `node viz/server.mjs [team]`, then open `http://127.0.0.1:4747`. There are no changes to `install.sh` or `/dev-team`.

## Design

**Files** (all new, all owned by Builder except the README section):

| File | What |
|---|---|
| `viz/server.mjs` | Stdlib only. Exports `readTeam(root, team)`, `gitHealth(cwd, sinceMs, {timeout = 3000, bin = 'git'} = {})` (`bin` is test-only, for the A9 hang stub; it is never set from config, env or HTTP, and `createServer` never passes it) and `createServer({root, team})`. When run directly (`import.meta.main`), it listens on 127.0.0.1. |
| `viz/server.test.mjs` | Every test, with fixtures built in a tmpdir. Picked up by `node --test`. |
| `viz/index.html` | Markup and the three region headings. |
| `viz/app.css` | Tokens and layout (Design-Lead spec). |
| `viz/app.js` | Polling, the SVG floor plan, the ledger and the title block. |

Why three static files rather than one: the CSP is `default-src 'self'`, which blocks inline `<script>` and `<style>`. Separate files keep the CSP strict with no hashes to maintain.

**Root:** `process.env.CLAUDE_CONFIG_DIR || ~/.claude`. This is the same convention `install.test.mjs` uses, so the tests point it at a tmpdir.

**Team:** `argv[2]`, or the team in `<root>/teams/` whose `config.json` is newest. It must match `/^[A-Za-z0-9_-]+$/`.

**`GET /api/state`** returns:

```
{ team, project, createdAt,
  members:  [{ name, agentType, color }],                // whitelist only: no prompt, cwd, pid
  messages: [{ from, to, summary, text, ts }],           // oldest first
  tasks:    [{ id, subject, status, owner, blockedBy }],
  git:      { branch, commits, insertions, deletions } | null }
```

**Messages come from the transcripts.**

- **Locating the files:**
  - `config.leadSessionId` must match a UUID regex.
  - `slug = leadCwd.replace(/[^A-Za-z0-9]/g, '-')`, where leadCwd is the `cwd` of the member whose `agentType === 'team-lead'`.
  - `dir = resolve(root, 'projects', slug)` must start with `resolve(root, 'projects') + sep`.
  - **Sessions:** a resumed lead gets a new session id, and `config.leadSessionId` keeps the old one. Builder-2 verified this on the live team: our -2 agents are under `86e3430a…`, not `a15e8d75…`. So the team's sessions are:
    - `config.leadSessionId` (if it matches the UUID regex), plus
    - every directory entry of `dir` that matches the UUID regex and whose `subagents/` holds an `agent-a*.meta.json` with `teamName === team`. Each meta file is under the 5 MB cap and parsed in a try/catch; a bad one doesn't count.
  - For each session `sid`, the lead's file is `dir/<sid>.jsonl`, with `from = "team-lead"`.
  - Teammate files are found with `readdir(dir/<sid>/subagents)`. Keep only names matching `/^agent-a([A-Za-z0-9_-]+)-[0-9a-f]+\.jsonl$/`. The capture group is the sender, so `agent-aSkeptic-2-c75f…` gives `Skeptic-2`. A file path is never built from a member name.
- **Parsing:**
  - Read each file with `readline` over `createReadStream` and `JSON.parse` each line in a try/catch.
  - Keep only `message.content[]` blocks with `type === 'tool_use' && name === 'SendMessage'`.
  - Emit `{from, to: input.to, summary: input.summary || '', text: input.message, ts: line.timestamp}`.
  - If `input.message` is not a string (a protocol message), emit `text: ''` and `summary: input.message?.type || 'protocol'`.
  - Nothing else from the line ever leaves the function.
  - The recipient's copy of a message (the `<teammate-message>` block) is ignored.
  - **Dedup:** a resumed session copies earlier transcripts (the same `agent-aPlanner-4fcc…` file is in both session dirs). So the union across sessions is deduped on `from|to|ts|text`, then sorted by `ts`. Message-level dedup also covers lead history that a resume copies into the new `<sid>.jsonl`, which filename dedup can't catch. Old pre-resume members (Planner, Skeptic, Builder) share the teamName and show as desks; that is accurate history.
- **Cache:** parsed messages are cached per path, keyed by `mtimeMs + size`. `// ponytail: per-file reparse on any change; tail from last offset if transcripts get huge.`
- **No inbox polling:** the transcripts already hold the full history.

**Tasks** come from `<root>/tasks/<team>/*.json`. Each file is parsed in a try/catch, and a bad file is skipped.

**Git: the hardened form only.** Every call is

```
execFile(bin, ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'log.showSignature=false',
  '-c', 'core.attributesFile=/dev/null', '--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-C', cwd, ...args], { timeout: 3000 })
```

Here are the four calls:

| Call | Gives |
|---|---|
| `rev-parse --abbrev-ref HEAD` | Branch. |
| `log --since=@<sec> --format=%h` | Commit count (number of lines). |
| `log -1 --before=@<sec> --format=%H` | The base commit. |
| `diff --shortstat --no-ext-diff --no-textconv <base>` | Lines changed since the team started: working tree against base, uncommitted edits included (the user's choice). |

Rules:

- `<sec>` is `config.createdAt`, converted from milliseconds to seconds.
- `cwd` must be absolute, exist as a directory, and not start with `-`. Otherwise `git: null`.
- Any failure gives `git: null`.
- With no base commit, `insertions` and `deletions` are null.

How the hardening works:

- **`--attr-source`:** the empty-tree value (git ≥ 2.40) stops in-tree `.gitattributes` drivers.
- **`log.showSignature=false`:** stops `log` running `gpg.program` on signed commits.
- **`core.attributesFile=/dev/null`:** stops the user-level attributes file.
- **WAIVED by the user (2026-11-11), a known limitation:** a worktree diff still applies `.git/info/attributes`, so a repo whose `.git/info/attributes` names a filter defined in its `.git/config` can run code when the viewer reads git state. No flag fixes it. The user accepted this to keep counting uncommitted lines. List it in the wrap-up summary and the README.
- **Older git:** the flag errors, which gives `git: null`, so it fails safe.

**HTTP:**

- Bind `127.0.0.1`; the port comes from `PORT`, default 4747. Tests use port 0.
- Every request:
  - `Host` must be `127.0.0.1:<port>` or `localhost:<port>`, or the response is 403.
  - If `Origin` is present, it must be `http://127.0.0.1:<port>` or `http://localhost:<port>`, or the response is 403.
  - Any method other than GET or HEAD gets 405.
- Routes are a fixed map: `/` → `index.html`, `/app.js`, `/app.css`, `/api/state`. Anything else is 404, so the server never touches the filesystem from a URL path.
- No `Access-Control-*` headers are sent.
- Every response carries:
  - `Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
  - `X-Content-Type-Options: nosniff`
- Nothing is logged except the startup URL.

**Page.** The look follows Design-Lead's merged spec exactly; this section only adds the decisions that spec left open.

- **Font:** `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. There are no Google Fonts, because the tool is local-only (Skeptic-2). Every `font-stretch` in the spec is deleted. Title-block labels are 12px, weight 500, `--muted`, with letter-spacing 0.01em. The rest of the type spec stands, tabular-nums included.
- **Desks:** activating one (click, Enter or Space) selects that agent's most recent ledger row and scrolls it into view. That keeps `role="button"` honest.
- **Ledger:** it auto-scrolls to the newest message only when the reader is within 40 px of the bottom. Selecting a row expands its full text and draws its route. There is no desk filter and no "N new" button; add them when someone asks.
- **Polling and memos:**
  - It polls `/api/state` every 2 s.
  - New messages are those past the previous count. History loaded on the first poll does not animate.
  - At most 3 memos are in flight; the rest queue.
- **Departments come from `agentType`:**
  - Lead: `team-lead`
  - Strategy: `team-skeptic`, `team-planner`
  - Engineering: `team-builder`, `team-gatekeeper`, `team-reviewer`
  - Security: `team-threat-modeler`, `team-security-reviewer`
  - Design: `team-design-lead`, `team-art-director`, `team-design-critic`
  - Anything else goes in the Visitors bay.
- **Routes, paths and ledger:** the server maps a recipient of `"main"` to `"team-lead"`. The ledger, routes and worn paths show only messages whose sender and recipient are both in `config.members`.
- **Desk states:**
  - Blocked: the member owns a pending or in-progress task with an unfinished `blockedBy` task. Blocked wins over Active.
  - Active: the member sent something in the last 2 min. The caption is their in-progress task's subject, or "Working".
  - Idle: otherwise.
- **Phase:**
  - It comes from the in-progress task whose subject starts with `Discuss:`, `Ask:`, `Plan:`, `Build:`, `Review:` or `Wrap up:`. If several match, the furthest wins.
  - With none, it shows "Not started" and no tick gets `aria-current`.
- **Title block:** five rows, in order:
  - Project: basename of the lead's cwd.
  - Git: "branch · N commits · +I −D" (U+00B7 separator, U+2212 minus), or "no git" in muted. A long branch is truncated with an ellipsis, with the full name in `title`.
  - Phase.
  - Tasks.
  - Last activity: the newest message `ts`.
- **Safety rules (A7):**
  - All data goes in with `textContent`, `createElement` or `setAttribute`. An attribute name is always a string literal and never starts with `on`.
  - Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`.
  - No inline `style=""` (blocked by the CSP). Set colours with `el.style.setProperty('--agent', c)` or SVG presentation attributes.

**Skipped, add when needed:**

- inbox polling
- a team switcher in the UI
- a replay scrubber
- websockets
- the ledger desk filter and the "N new" button
- web fonts
- **Waived by user:** `.git/info/attributes` plus `filter.clean` in `.git/config` runs on each poll's worktree diff, and it needs local write access to `.git`. It is documented by a `todo` test in task 3.
- incremental transcript tailing

## Abuse cases → tests

Every abuse case has a test in a task before the logic it guards (tasks 1, 3, 5 and 6b come before 2, 4, 6 and 7).

| # | Test | Task |
|---|---|---|
| A1 | The server's `address().address === '127.0.0.1'`; there is no host option. | 5 |
| A2 | `Host: evil.example:<port>`, no Host header, and `Host: 127.0.0.1:<port>.evil.example` each get 403. `127.0.0.1:<port>` and `localhost:<port>` get 200. | 5 |
| A3 | `Origin: https://evil.example` and `Origin: null` each get 403. No response has `Access-Control-Allow-Origin`. | 5 |
| A4 | POST, PUT and DELETE on `/`, `/api/state` and `/x` get 405. Fixture file mtimes are unchanged. | 5 |
| A5 | `readTeam(root, id)` with `..`, `../x`, `a%00b`, `/etc` or `a/b` rejects before any read (task 1). `node viz/server.mjs ../x` exits non-zero (task 5). | 1, 5 |
| A6 | `/../../etc/passwd`, `/%2e%2e/%2e%2e/etc/passwd`, `/..%2fpackage.json` and `/server.mjs` get 404. | 5 |
| A7 | (a) Every HTML response carries the CSP above. (b) A static scan of `app.js` finds no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or ` style=`, and no `setAttribute(` whose first argument is not a string literal or is a literal starting with `on`. (c) A browser check, written by Builder-2 and run red in task 6b, then run by Gatekeeper-2: the fixture payload `<img src=x onerror="window.__pwned=1">` as message text, member name and task subject, and `"><script>window.__pwned=1</script>` as the cwd, renders as literal text, and `window.__pwned` stays undefined. | 5, 6b |
| A8 | A transcript with a truncated last line, a non-JSON line, and `null` and `{}` lines still returns the other messages. A bad task file is skipped. | 1 |
| A9 | Each of these, with an uncommitted change, leaves no pwned file after `gitHealth`: (i) `filter.x.clean`, `core.fsmonitor` and `core.pager` set to `touch <tmp>/pwned`, plus `.gitattributes` `* filter=x`; (iii) the same set through `core.attributesFile`; (iv) a commit after `sinceMs` signed using `gpg.program=<script that touches pwned>` with `log.showSignature=true` (a faked signature header is acceptable). Plus (ii), the same filter set through `.git/info/attributes`: written as `test(..., { todo: 'waived by user: .git/info/attributes' })`, so it documents the limitation and doesn't fail the suite. A cwd of `/tmp/x; touch <tmp>/pwned2`, `--upload-pack=touch <tmp>/pwned3`, or a relative path gives `null` and no file. A stub git script that sleeps 10 s, called as `gitHealth(cwd, since, {timeout: 200, bin: stub})`, returns `null` in under 1 s, and the server still answers. | 3 |
| A10 | A transcript over 50 MB (generated junk lines plus one SendMessage, built once in the tmpdir and deleted afterwards; drop it to 10 MB if `node --test viz/` takes over about 10 s) returns that message, and the server still answers the next request. | 1 |
| A11 | A transcript with a tool_result holding `sk-test-SECRET-123`, a Read tool_use whose input has `sk-test-SECRET-456`, a member prompt `PROMPT-SECRET`, and one SendMessage. The JSON from `/api/state` contains the SendMessage text and none of the three secrets. A SendMessage text that quotes a secret is allowed. | 1 (readTeam), 5 (over HTTP) |
| A12 | (a) A `leadSessionId` of `../../../.ssh` gives no messages and no read outside `projects/`. (b) A lead cwd of `/../../etc` keeps the resolved dir inside `projects/`, or gives no messages. (c) A member named `../x` causes no crash and no outside read. (d) A file named `agent-a..-x.jsonl` or `notes.jsonl` in `subagents/` is ignored. (e) A non-UUID entry in `projects/<slug>/` (such as `memory`, or a `..`-like name) is never scanned, and a meta file with corrupt JSON or one over the cap is skipped. A tool_result secret in a matched second session's transcript is absent from `/api/state`. | 1 |

Skeptic-2's parse cases go in the same fixture as task 1: a hyphenated name from the filename (`agent-aSkeptic-2-<hash>`), a protocol SendMessage whose `message` is an object, and the lead's own SendMessage to `Skeptic-2`.

## Tasks

Verification:

| When | Command |
|---|---|
| Fast loop, after every task | `cd /Users/johnchen/Desktop/Programming/06_Tools/claude-dev-team && node --test viz/server.test.mjs install.test.mjs generator/generate.test.mjs benchmark/run.test.mjs` |
| Full suite, at Review | `node --test`. This is the same as CI: about 6 min, with Docker. The baseline is 113/113 at faf63a9. |
| Generator check | `node generator/generate.mjs --check` must still exit 0, since roles/ is untouched. |

There is no build step and no linter.

### 1. Data tests (red)
- **Files:** `viz/server.test.mjs`
- **Test:** a `fixture()` helper builds a tmp root holding:
  - `teams/t1/config.json` with a lead and three members (one with a prompt and one named `../x`)
  - `tasks/t1/1.json` to `3.json`, plus one corrupt file
  - `projects/<slug>/<sid>.jsonl` (the lead's file)
  - `projects/<slug>/<sid>/subagents/agent-a*.jsonl` files
  - a second session `<sid2>` (not in config) whose `subagents/agent-a*.meta.json` has `teamName: "t1"`, holding new messages and one copied transcript that duplicates a message from `<sid>`
  - a third session whose meta has `teamName: "other"`. Its messages must not appear.

  Then write the A5, A8, A10, A11 (readTeam level), A12 and Skeptic parse-case tests, plus one happy-path test: members are whitelisted, messages are oldest first with exact `{from,to,summary,text,ts}` keys, and tasks have exact keys.
- **Done when:** all of them fail because `readTeam` doesn't exist yet.

### 2. `readTeam`
- **Files:** `viz/server.mjs`
- **Test:** task 1.
- **Done when:** task 1 is green and the 50 MB test runs in under 5 s.

### 3. Git tests (red)
- **Files:** `viz/server.test.mjs`
- **Test:**
  - the A9 cases
  - a happy path on a temp repo (`git init`, one commit before `sinceMs` and one after, then an uncommitted change) giving `{branch, commits: 1, insertions, deletions}`, where insertions and deletions include both the committed and the uncommitted change.
  - a missing cwd giving `null`
- **Done when:** they fail because `gitHealth` doesn't exist yet.

### 4. `gitHealth`
- **Files:** `viz/server.mjs`
- **Test:** task 3.
- **Done when:** task 3 is green, and `readTeam` includes `git` from the lead's cwd and `createdAt`.

### 5. HTTP tests (red)
- **Files:** `viz/server.test.mjs`
- **Test:**
  - A1 to A4 (including the A2/A3 edge cases), A6, A7(a), A7(b) and A11 over HTTP
  - A5's CLI case: `node viz/server.mjs ../x` exits non-zero
  - `GET /api/state` returns the readTeam JSON
  - `GET /` returns `text/html`

  Each test starts `createServer` on port 0 and uses `http.request` with a custom `Host`. Write a placeholder `viz/app.js` only if A7(b) needs the file to exist; it's better for that test to fail on a missing file.
- **Done when:** they fail.

### 6. Server and CLI
- **Files:** `viz/server.mjs`
- **Test:** task 5.
- **Done when:**
  - task 5 is green
  - `node viz/server.mjs` with no argument picks the newest team, prints `http://127.0.0.1:4747`, and serves the live `session-a15e8d75`
  - `curl` on `/api/state` shows its members and the lead → Skeptic message (Skeptic-2's S2)

### 6b. Browser checks (Builder-2 writes them, Gatekeeper-2 runs them; red before any page code)
- **Files:** `viz/xss.fixture.mjs`. `node viz/xss.fixture.mjs <dir>` writes the fixture into `<dir>` and prints the serve command. Its header comment holds the exact Playwright steps and the `browser_evaluate` expression.
- **Fixture:** a tmp root used as `CLAUDE_CONFIG_DIR`, holding:
  - `teams/xss/config.json`, where one member's name is `<img src=x onerror="window.__pwned=1">` and the lead's cwd is `/"><script>window.__pwned=1</script>`
  - `tasks/xss/1.json`, whose subject is the img payload
  - the lead's transcript at `projects/<slug of that cwd>/<uuid>.jsonl`, with one SendMessage whose text is the img payload
- **Test:** Gatekeeper-2 runs `CLAUDE_CONFIG_DIR=<tmp> node viz/server.mjs xss` and then follows the Playwright steps:
  - A7(c): every payload is visible as literal text, and `window.__pwned === undefined`
  - S2, against the live team: members, tasks and the lead → Skeptic message render
  - S3: a new SendMessage appears in the ledger within 5 s
- **Done when:** Gatekeeper-2 reports the checks red, because there is no page yet.

### 7. The page
- **Files:** `viz/index.html`, `viz/app.css`, `viz/app.js`
- **Test:** A7(b) stays green, the task 6b checks go green, plus:
  - Design-Lead's checks 1 to 6: no text filled with an agent or accent colour; a caption on every desk state; nothing travels under reduced motion; no horizontal scroll at 375 px; textContent only; dark tokens with no shadows or gradients
- **Done when:** all of those pass after B, and Design-Critic's single audit (after B, at 1440 and 375 px, light and dark) has no open findings. Build it in two steps; Gatekeeper-2 reruns 6b after each:
  - **A:** grid layout, ledger (selection, auto-scroll, empty state) and title block
  - **B:** SVG plan, then memo motion with reduced motion. Rooms, poché walls and worn paths are plain SVG strokes with no extra logic.

### 8. Docs (Gatekeeper-2)
- **Files:** `README.md`, a short "Watch the team" section under Usage. There is no CHANGELOG.md: the repo has none, and this feature doesn't start one (Skeptic-2).
- **Test:** `node --test` is green across the repo.
- **Done when:** the README says how to run it, that it's read-only and local-only (127.0.0.1), what it reads (transcripts, tasks, git), and that it needs Node ≥ 22.18 and git ≥ 2.40 for the git row. Also state the waived known limitation: don't point the viewer at a team whose project repo you don't trust, because `.git/info/attributes` filters can run during the git read.

### 9. Characters (scope add from the user, 2026-11-11)
- **Owner:** Builder-2. **Files:** `viz/app.js` and `viz/app.css` only, with no server change.
- **What:** a seated person at each desk, which carries each memo down the corridor and back. The final figure (2026-11-11, settled by team-lead) is a PROFILE (side-view) person facing right, with typing arms and walking legs. It replaces the top-down version, and a brief front-facing correction was withdrawn. Design-Lead's "Side-view people spec", which Builder-2 holds, has the exact values:
  - **Desk:** each becomes a 130-wide elevation vignette: chair, the profile figure, a 96x38 desk panel holding the name and caption in ink, and a monitor.
  - **Figure:**
    - 64 units tall standing and 52 seated.
    - The torso is the agent colour 70% into ink, the legs are ink 75% into ground, the head is `--muted` and the hair is ink.
    - The limb `<g>`s pivot at the joints. No face, no shadows and no new tokens.
    - Drawn with `--agent` set via `style.setProperty`, with `aria-hidden="true"`.
  - **Layout:** the corridor is 80 tall (y 270–350). The top row is Strategy 310, Lead 200, Security 310 and Visitors 180, at height 270. The bottom row is Engineering 500 and Design 500, at height 290. The desk pitch is 142x90, with the first baseline at y+96.
  - **States** are a class on the figure's `<g>`: `.working` (typing loop, steps(2) at 450 ms), `.idle` (leaning back 8°, still), `.blocked` (head in hands, still), and `.walking`.
  - **Walking:**
    - The figure carries the 8x8 accent memo square along the pair's worn path with `<animateMotion><mpath href="#path-A-B">` and `rotate="0"`, with feet on y=340 in the corridor and one scaleX flip per trip leg.
    - The legs swing ±20° with the arms counter-swinging, at steps(2), 300 ms per step.
    - The duration is `clamp(600, getTotalLength()/0.16, 1800)` ms, linear.
    - While it's away, the empty chair shows and the desk caption reads "Delivering memo".
    - The walk runs from the sender's door all the way to the recipient's desk edge.
    - On arrival, the square drops on the recipient's desk, stays for 2 s, then fades out over 200 ms. The recipient's desk pulses, and the figure walks back.
    - No more than 3 walk at once across the team. A sender's further walks queue. Past 3 queued for one sender, the extras get only the ledger flash.
  - **Reduced motion:** `matchMedia` is checked before creating any `<animateMotion>`, and all CSS keyframes sit under `@media (prefers-reduced-motion: no-preference)`. Figures hold their state pose, and the square appears on the recipient's desk for 2 s with the ledger flash and no pulse.
- **Must keep:**
  - All data via `textContent`, `createElement` or literal `setAttribute`, so the A7(b) scan stays green.
  - Colours only from the fixed agent-colour map.
  - No external assets: characters are inline SVG shapes built in JS. No images, fonts or sprites from anywhere.
  - No inline `style=""` attributes, because of the CSP. Use classes, SVG presentation attributes or `el.style.setProperty`.
  - Animation through CSS transforms and opacity, plus SVG `<animateMotion>` created with `createElementNS`, which the CSP allows.
  - Under `prefers-reduced-motion: reduce`, characters stand still. Nothing walks, bobs or pulses, and the memo appears at its destination with the ledger row highlighted.
- **Test:**
  - `node --test viz/` stays green, including the A7(b) scan.
  - Gatekeeper-2 reruns the 6b checks (A7(c), S2, S3) and the layout checks (no horizontal scroll at 375 px, Design-Lead's checks 1 to 6, with check 3 now covering characters), plus the character spec's five checks:
    - under reduced motion, there's no `<animateMotion>` in the DOM and `document.getAnimations().length === 0`
    - every figure is `aria-hidden`
    - a walking figure's desk reads "Delivering memo"
    - at most 3 figures are `.walking` at once
    - infinite animations exist only on `.working` arms and on the limbs of a `.walking` figure, and none remain when no figure is walking)
  - Security-Reviewer-2 re-checks the `app.js` diff.
  - Design-Critic audits screenshots at 1440 and 375 px, light and dark, plus one mid-walk frame.
- **Done when:** all four pass with no open findings.

## File ownership

| Who | Edits |
|---|---|
| Builder-2 | `viz/*`, including `viz/xss.fixture.mjs` |
| Gatekeeper-2 | `README.md` |
| Planner | this plan |

Nobody touches `install.sh`, `skills/`, `roles/`, `agents/`, `.gitignore` or `benchmark/`.
