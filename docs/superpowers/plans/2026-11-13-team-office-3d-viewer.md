# Team Office 3D Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SVG isometric office in `viz/` with the Claude Design prototype's CSS-3D office, side panel and replay scrubber, fed by the unchanged `/api/state`.

**Architecture:** `viz/app.js` keeps its shape: pure exports at the top (tested from node), DOM code below a `typeof document` guard. The scene is built once per member list as CSS-3D DOM; `stepState()` derives everything that varies per memo, and `applyStep()` writes it into existing nodes so CSS transitions carry the motion. A `cursor` over `messages` drives the scrubber; the camera is a `cam` object applied as one transform on the floor and its inverse on every figure.

**Tech Stack:** Plain HTML, CSS (3D transforms, custom properties, `color-mix`), ES modules, `node --test`. No libraries, no build step, no network assets. Server static whitelist is `index.html`, `app.js`, `app.css`, so no new files under `viz/`.

**Spec:** `docs/superpowers/specs/2026-11-13-team-office-3d-viewer-design.md` (look reference: `docs/superpowers/specs/2026-11-13-team-office-prototype.dc.html`).

## Global Constraints

- CSP `default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`: no inline `style=""`, no inline `<script>`, no fonts, images or stylesheets from the network.
- A7(b) scan (`server.test.mjs` "A7: app.js never writes HTML…"): app.js must not contain `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, ` style=`, `.style.cssText`, `eval(`, `new Function`; every `setAttribute` name is a single-quoted literal and never starts with `on`.
- A13d scan: the bodies of `addEventListener('wheel' | 'pointer*' | 'keydown', …)` must not contain the words `lastState`, `state`, `messages`, `rendered`, `queue`, `walkers`. All four kinds must exist. Name the poll result `snapshot`, the scrubber index `cursor`, the camera `cam`.
- Server strings (names, captions, memo text, task subjects, branch) reach the DOM only via `textContent`. Transforms and positions are built from numbers only. Agent colours come only from `COLOURS`.
- Fonts: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` for text; `ui-monospace, SFMono-Regular, Menlo, monospace` for mono labels.
- Tokens stay in `:root` with the existing `@media (prefers-color-scheme: dark)` block; text uses `--ink` and `--muted` only; `--accent` only for rings, links and memo squares.
- Reference frame 1440×900; stacks below 1024 px; whole office visible at Fit at 375 px.
- Commit after every task with the message shown; `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` as the trailer.

## Review Focus

1. A memo whose sender or recipient is not a current member (a stale pre-resume teammate): the step must still render, with no figure moved, no link, no worn path, and the bar still counting it. (Task 1 test `stepState: unknown names`.)
2. A memo with an unparseable `ts`: scrubbing to it must not throw, every desk reads Idle, and the bubble footer shows a blank time. (Task 1 test `stepState: bad timestamp`.)
3. A protocol memo (`text: ''`, `summary: 'protocol'`) and one with both empty: the bubble shows the summary, else "(no text)". (Task 1 test `stepState: bubble text`.)
4. The ledger resets (a late memo lands mid-list) while the user is scrubbed back: the cursor must re-find the same memo, or clamp. (Task 1 test `recursor`.)
5. A wheel event with a huge or non-finite `deltaY`, or a drag with NaN coordinates: the camera stays finite and in range. (Task 1 test `clampCam`.)

---

### Task 1: Pure core (layout, camera clamp, step state, cursor re-find)

**Files:**
- Modify: `viz/app.js` (add exports near the top, after `deskState`; old SVG code stays for now)
- Test: `viz/server.test.mjs` (append after the `ledgerUpdate` test)

**Interfaces:**
- Consumes: `department(agentType)`, `deskState(name, tasks, messages, now)`, `COLOURS`, `ROOM_TILES` (existing exports).
- Produces:
  - `export const T = 35, OY = 20, FLOOR = { w: 840, h: 600 }`
  - `export const ROOM_TINTS = new Map([['Strategy','--room-strategy'],['Lead','--room-lead'],['Security','--room-security'],['Visitors','--surface'],['Engineering','--room-engineering'],['Design','--room-design'],['Corridor','--surface']])`
  - `export function layout(members) → { rooms: [{ name, left, top, width, height, count }], agents: Map<name, { name, agentType, color, room, desk: { left, top }, home: { x, y }, beside: { x, y } }> }`. Rooms in `ROOM_TILES` order plus `Corridor` from `CORRIDOR`; px: `left = i0*T`, `top = OY + j0*T`, `width = w*T`, `height = d*T`. Desk slot n in a room of width w tiles: `cols = floor((w-3)/4)+1`, `di = i0+1+4*(n%cols)`, `dj = j0+2+3*floor(n/cols)`; `desk = { left: di*T-3, top: OY+dj*T-2 }`, `home = { x: di*T+35, y: OY+dj*T-8 }`, `beside = { x: di*T+92, y: OY+dj*T+22 }`. `color` is `COLOURS.get(m.color) ?? null` (null = ink).
  - `export const HOME_CAM = { rz: -38, rx: 56, zoom: 0.9 }`
  - `export function clampCam(next, prev = HOME_CAM) → cam`: returns `prev` if any of `next.rz`, `next.rx`, `next.zoom` is not finite; else `{ rz: clamp(rz,-80,-8), rx: clamp(rx,38,68), zoom: round2(clamp(zoom,0.6,1.3)) }`.
  - `export function stepState(lay, tasks, messages, k, now) → { step, from, to, positions: Map<name,{x,y}>, link: {x1,y1,x2,y2}|null, worn: Map<'from|to', n>, sent: Map<name,n>, got: Map<name,n>, desks: Map<name,{state,caption}>, say, when }`. `step = messages[k] ?? null`. Positions: every agent at `home`; the sender (if a known agent, and the recipient is known) at the recipient's `beside`. `link` from the sender's position to the recipient's `home`, else null. `worn`, `sent`, `got` count messages `0..k` (worn only for pairs where both are known). `desks`: `deskState(name, tasks, messages.slice(0,k+1), now)` per agent, except the sender gets `{ state: 'away', caption: 'Delivering memo' }`. `say = (step.text || step.summary || '(no text)')` clipped to 160 chars with `…`; `when = hhmm(step.ts)` or `''`. With `step` null: everyone home, idle, `say = ''`, `when = ''`. `now` non-finite is treated as `-Infinity` (nothing recent).
  - `export function recursor(prev, next, cursor) → number`: index in `next` of the memo with the same key `JSON.stringify([from,to,ts,text])` as `prev[cursor]`, else `min(cursor, next.length-1)`, else `0` when `next` is empty (returns -1 only when `next` is empty).

- [ ] **Step 1: Write the failing tests** in `viz/server.test.mjs`:

```js
test('layout: rooms at 35 px per tile, desks and figure points per slot, visitors for odd types', async () => {
  const { layout, T } = await import('./app.js');
  const lay = layout([{ name: 'A', agentType: 'team-skeptic', color: 'pink' }, { name: 'B', agentType: 'team-planner', color: 'orange' }, { name: 'Z', agentType: 'odd', color: null }]);
  assert.equal(T, 35);
  assert.deepEqual(lay.rooms.find((r) => r.name === 'Strategy'), { name: 'Strategy', left: 0, top: 20, width: 245, height: 210, count: 2 });
  assert.deepEqual(lay.agents.get('A').desk, { left: 32, top: 88 });            // di 1, dj 2
  assert.deepEqual(lay.agents.get('A').home, { x: 70, y: 82 });
  assert.deepEqual(lay.agents.get('A').beside, { x: 127, y: 112 });
  assert.deepEqual(lay.agents.get('B').desk, { left: 172, top: 88 });           // di 5
  assert.equal(lay.agents.get('Z').room, 'Visitors');
  assert.equal(lay.agents.get('Z').color, null);
  assert.equal(lay.agents.get('A').color, '#C2417A');
});

test('clampCam: ranges hold and non-finite input leaves the camera as it was', async () => {
  const { clampCam, HOME_CAM } = await import('./app.js');
  assert.deepEqual(clampCam({ rz: -200, rx: 0, zoom: 9 }), { rz: -80, rx: 38, zoom: 1.3 });
  assert.deepEqual(clampCam({ rz: 5, rx: 90, zoom: 0.1 }), { rz: -8, rx: 68, zoom: 0.6 });
  assert.deepEqual(clampCam({ rz: NaN, rx: 50, zoom: 1 }), HOME_CAM);
  const prev = { rz: -30, rx: 50, zoom: 1 };
  assert.equal(clampCam({ rz: -30, rx: Infinity, zoom: 1 }, prev), prev);
  let cam = HOME_CAM;
  for (let i = 0; i < 1000; i++) cam = clampCam({ rz: cam.rz + (i % 2 ? 1e9 : -1e9), rx: cam.rx - 1e6, zoom: cam.zoom * 7 }, cam);
  assert.ok(cam.rz >= -80 && cam.rz <= -8 && cam.rx >= 38 && cam.rx <= 68 && cam.zoom >= 0.6 && cam.zoom <= 1.3);
});

test('stepState: sender beside the recipient, counts, desk states, bubble text', async () => {
  const { layout, stepState } = await import('./app.js');
  const lay = layout([{ name: 'A', agentType: 'team-skeptic', color: 'pink' }, { name: 'B', agentType: 'team-builder', color: 'cyan' }]);
  const tasks = [{ id: '1', subject: 'Build: b', status: 'in_progress', owner: 'B', blockedBy: [] }, { id: '2', subject: 'Review: r', status: 'pending', owner: 'A', blockedBy: ['1'] }];
  const msgs = [
    { from: 'A', to: 'B', ts: '2026-11-11T10:00:00Z', text: 'hi', summary: 's1' },
    { from: 'B', to: 'A', ts: '2026-11-11T10:01:00Z', text: '', summary: 'protocol' },
    { from: 'A', to: 'B', ts: '2026-11-11T10:02:00Z', text: '', summary: '' },
  ];
  const s0 = stepState(lay, tasks, msgs, 0, Date.parse(msgs[0].ts));
  assert.deepEqual(s0.positions.get('A'), lay.agents.get('B').beside);
  assert.deepEqual(s0.positions.get('B'), lay.agents.get('B').home);
  const b = lay.agents.get('B');
  assert.deepEqual(s0.link, { x1: b.beside.x, y1: b.beside.y, x2: b.home.x, y2: b.home.y });
  assert.deepEqual(s0.desks.get('A'), { state: 'away', caption: 'Delivering memo' });
  assert.deepEqual(s0.desks.get('B'), { state: 'active', caption: 'Build: b' });
  assert.equal(s0.say, 'hi');
  const s2 = stepState(lay, tasks, msgs, 2, Date.parse(msgs[2].ts));
  assert.equal(s2.worn.get('A|B'), 2);
  assert.equal(s2.worn.get('B|A'), 1);
  assert.equal(s2.sent.get('A'), 2);
  assert.equal(s2.got.get('A'), 1);
  assert.equal(s2.say, '(no text)');
  assert.equal(stepState(lay, tasks, msgs, 1, Date.parse(msgs[1].ts)).say, 'protocol');
  const idle = stepState(lay, tasks, msgs, 1, Date.parse('2026-11-11T11:00:00Z'));
  assert.deepEqual(idle.desks.get('A'), { state: 'blocked', caption: 'Blocked' });
  const none = stepState(lay, tasks, [], 0, Date.now());
  assert.equal(none.step, null);
  assert.deepEqual(none.positions.get('A'), lay.agents.get('A').home);
  assert.equal(none.say, '');
});

test('stepState: unknown names, bad timestamp', async () => {
  const { layout, stepState } = await import('./app.js');
  const lay = layout([{ name: 'A', agentType: 'team-skeptic', color: 'pink' }]);
  const s = stepState(lay, [], [{ from: 'Ghost', to: 'A', ts: 'nope', text: 'x', summary: '' }], 0, NaN);
  assert.equal(s.link, null);
  assert.equal(s.worn.size, 0);
  assert.deepEqual(s.positions.get('A'), lay.agents.get('A').home);
  assert.deepEqual(s.desks.get('A'), { state: 'idle', caption: 'Idle' });
  assert.equal(s.when, '');
  assert.equal(s.sent.get('Ghost'), 1);
});

test('recursor: the cursor follows its memo through a ledger reset, else clamps', async () => {
  const { recursor } = await import('./app.js');
  const m = (ts) => ({ from: 'a', to: 'b', ts, text: ts });
  const [one, two, three, late] = [m('1'), m('2'), m('3'), m('1.5')];
  assert.equal(recursor([one, two, three], [one, late, two, three], 1), 2);
  assert.equal(recursor([one, two, three], [one], 2), 0);
  assert.equal(recursor([one, two, three], [], 2), -1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test viz/server.test.mjs 2>&1 | grep -E "^(✖|ℹ (pass|fail))"`
Expected: the five new tests FAIL (`layout is not a function` and the like); everything else as before (40 pass, 1 todo).

- [ ] **Step 3: Implement the exports in `viz/app.js`** after `deskState`, using `ROOM_TILES`, `CORRIDOR` and a local `hhmm` (move the existing `hhmm` helper up so the pure code can use it). `stepState` builds `positions` from `lay.agents`, then overrides the sender.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test viz/server.test.mjs 2>&1 | grep -E "^ℹ (pass|fail|todo)"`
Expected: `pass 45`, `fail 0`, `todo 1`.

- [ ] **Step 5: Commit**

```bash
git add viz/app.js viz/server.test.mjs
git commit -m "Derive the office layout, camera and each memo's step state as pure functions"
```

---

### Task 2: Page skeleton, scene and camera

**Files:**
- Rewrite: `viz/index.html`, `viz/app.css`
- Modify: `viz/app.js` (delete the SVG scene, routing, walkers and viewBox code; keep the poll, ledger, title-block pieces for Task 4 to rework)
- Test: `viz/server.test.mjs` (delete the `iso`, `depthKey`, `route`, `legFacing`, `walkMs`, `enqueue/nextWalk`, `A13a`, `A13b` and "iso page" tests; add the "office page" test)

**Interfaces:**
- Consumes: `layout`, `HOME_CAM`, `clampCam`, `stepState`, `COLOURS`, `ROOM_TINTS` (Task 1).
- Produces (DOM, module-private, used by Tasks 3–5):
  - `index.html` ids: `stage`, `floor`, `rooms`, `worn`, `desks`, `link`, `figures`, `zoom-in`, `zoom-out`, `zoom-fit`, `rot-l`, `rot-r`, `tb-project`, `ledger`, `empty`, `status`, plus Task 3's bar ids and Task 4's panel ids as empty containers.
  - `buildScene(lay)`: fills `#rooms` (one `.zone` per room with `.zname`/`.zsub`), `#desks` (one `.desk` per agent with faces `.b .l .r .f .t .m` and a hidden `.memo`), `#figures` (one `.pt` wrapper per agent holding `.shadow`, `.selring`, `.hear`, `.pulse`, and a `<button class="fig">` with `.ant`, `.head` (two `.eye`), `.body`, `.cap`, `.tag`, `.bubble` (with `.btext` and `.bmod`)). Positions via `el.style.setProperty('left'|'top', \`${n}px\`)`; agent colour via `--agent`.
  - `applyStep(s)`: for a `stepState` result, sets each `.pt`'s `left`/`top`, toggles `.on` on the sender's tag, `.hear` on the recipient, `.pulse` on the sender, `.bubble` text/footer, `.cap` text and `blocked` class, `.t.blocked` hatch, the recipient desk's `.memo`, rebuilds `#worn` strips and the `#link` strip (both `left/top/width/transform: rotate(deg)` from numbers).
  - `applyCam()`: sets `#floor` `transform: scale(base*zoom) rotateX(rx) rotateZ(rz)` and `--bb: rotateZ(-rz) rotateX(-rx)` on `#floor` (figures use `.bb { transform: var(--bb) }`); `base = Math.min(1, stage.clientWidth / 960, stage.clientHeight / 640)`, recomputed by a `ResizeObserver` on `#stage`.
  - Handlers: `pointerdown/move/up/cancel` on `#stage` (orbit, 4 px click threshold, pointer capture), `wheel` on `#stage` (`zoom ± 0.1` by the sign of `deltaY`), `keydown` on `#stage` (`+`/`=`, `-`/`_`, `0`), the five buttons. Every handler reads only event numbers and `cam`, then calls `setCam(clampCam(next, cam))`.

- [ ] **Step 1: Replace the "iso page" test with the failing "office page" test**

```js
test('office page: Fit button, a range scrubber, nothing from the network', async () => {
  const html = await readFile(join(here, 'index.html'), 'utf8');
  assert.match(html, /id="zoom-fit"[^>]*>Fit</, 'a Fit button');
  assert.match(html, /<input[^>]*type="range"/, 'a range scrubber');
  assert.doesNotMatch(html, /(href|src)="https?:/, 'no network assets');
  const css = await readFile(join(here, 'app.css'), 'utf8');
  for (const bad of ['url(', '@import']) assert.ok(!css.includes(bad), bad);
  const js = await readFile(join(here, 'app.js'), 'utf8');
  for (const gone of ['animateMotion', 'viewBox', 'createElementNS']) assert.ok(!js.includes(gone), gone);
});
```

Delete the tests named in **Files**. Keep A7(b), A13d, `page: phase`, `page: desk state`, `page: rooms`, `page: ledger` and Task 1's tests.

- [ ] **Step 2: Run to verify the new test fails**

Run: `node --test viz/server.test.mjs 2>&1 | grep -E "^(✖|ℹ (pass|fail))"`
Expected: `office page` FAILS on the range scrubber; A13d still passes against the old handlers.

- [ ] **Step 3: Rewrite `viz/index.html`**: `<main class="sheet">` with `<section class="office">` (header: `h1` "Team office", `#tb-project` subline, hint, the five buttons; `<div id="stage" tabindex="0" role="group" aria-label="Office">` → `#floor` with `.slabF .slabL .wallB .wallR` and the five layer containers; `<div class="bar" id="bar">` left empty for Task 3) and `<aside class="panel">` with Task 4's empty containers plus the existing `#ledger`/`#empty`/`#status`. Add `<p id="status" role="status">`.

- [ ] **Step 4: Rewrite `viz/app.css`** from the prototype's `<helmet>` CSS: keep the current `:root` tokens and dark block; port `.stage .floor .slab* .wall* .zone .zname .zsub .desk (.t .f .b .l .r .m .memo) .link .worn .pt .shadow .pulse .hear .selring .fig (.head .eye .ant .body) .tag .cap .bubble .bmod .ctl` with the prototype's values, replacing fixed hexes with tokens (`#1C2126`→`var(--ink)`, `#454F57`→`var(--muted)`, `#FFFFFF` panel/desk surfaces→`var(--surface)`, `#ECEEE9`→`var(--ground)`, rings/links→`var(--accent)`); desk top `color-mix(in srgb, var(--agent) 18%, var(--ground))`, hatch via `repeating-linear-gradient` on `.t.blocked`; `.pt { transition: left 1s ease, top 1s ease }`; `.bb { transform: var(--bb) }`; `@media (prefers-reduced-motion: reduce)` zeroes `.pulse`, `.link` animation and `.pt`/`#floor` transitions; the sheet grid `"office panel"` with the panel 400 px from 1024 px, stacked below.

- [ ] **Step 5: Rewrite the scene part of `viz/app.js`**: delete `iso`, `depthKey`, `route`, `makeGrid`, `svg*`, `person`, `deskNode`, `buildPlan`, `renderPlan`, the viewBox block, `walk*`, `enqueue`, `nextWalk`, `legFacing`, `placeByDepth`, `dropMemo`, `deliver`, `pump`; add `buildScene`, `applyStep`, `applyCam`, `setCam`, `wireCamera` per **Interfaces**. In `render(snapshot)`: rebuild the scene when `JSON.stringify(snapshot.members)` changes; `cursor = snapshot.messages.length - 1`; `applyStep(stepState(lay, snapshot.tasks, snapshot.messages, cursor, Date.now()))`. Keep `renderLedger` and `renderTitle` compiling (Task 4 reworks them; `#tb-project` is the subline for now).

- [ ] **Step 6: Run the tests**

Run: `node --test viz/server.test.mjs 2>&1 | grep -E "^ℹ (pass|fail|todo)"`
Expected: `fail 0`, `todo 1` (pass count = 45 − 9 deleted + 1 added = 37).

- [ ] **Step 7: Browser check**: `node viz/server.mjs session-a15e8d75 &`, open `http://127.0.0.1:4747` at 1440×900 with the Playwright tools, screenshot. Expected: the six rooms and corridor tinted, 11 desks and figures with name tags, the last memo's sender beside its recipient with a bubble, the dashed link and worn paths; drag orbits, wheel zooms, Fit resets; at 375 px the whole floor is visible. Kill the server.

- [ ] **Step 8: Commit**

```bash
git add viz/index.html viz/app.css viz/app.js viz/server.test.mjs
git commit -m "Draw the office as a CSS-3D floor you orbit, from the Claude Design prototype"
```

---

### Task 3: Replay scrubber and live follow

**Files:**
- Modify: `viz/index.html` (fill `#bar`), `viz/app.css` (`.bar .ctl .scrub .phase`), `viz/app.js`
- Test: none new (pure parts are `stepState`/`recursor` from Task 1); browser check

**Interfaces:**
- Consumes: `applyStep`, `stepState`, `recursor`, `phaseOf`, `PHASES`.
- Produces: `goTo(k)` (clamps to `0..N-1`, sets `cursor`, `following = cursor === N-1`, applies the step with `now = following ? Date.now() : Date.parse(messages[cursor].ts)`, updates `#scrub` value, `#memo-label` "MEMO k+1 / N", the ledger's `.cur`/`.later` rows and scrolls the current row into view); `setPlaying(bool)` (3000 ms interval calling `goTo(cursor + 1)`; at the last step it stays). ids: `prev`, `play`, `next`, `scrub` (`<input type="range" min="0" max="0" value="0" aria-label="Memo">`), `memo-label`, `phase`.

- [ ] **Step 1: Add the bar markup and CSS** (prev/play/next 44 px `.ctl`, the range filling the middle, mono label, phase pill).

- [ ] **Step 2: Implement `goTo`, `setPlaying`, the bar wiring and keys** in `app.js`: `#scrub` `input` → `goTo(Number(value))`; `keydown` on `#stage` and `#bar`: `ArrowLeft`/`ArrowRight` → `goTo(cursor ∓ 1)`, `' '` → toggle play (the handler reads `e.key` and calls these; it must not mention `cursor`'s backing `snapshot`). In `render(snapshot)`: `cursor = following ? N-1 : recursor(prevMessages, snapshot.messages, cursor)`; set `#scrub.max = N-1`; `aria-valuetext` = "Memo k of N, HH:MM, from → to". Ledger rows get `data-index`; clicking a row's summary calls `goTo(index)`.

- [ ] **Step 3: Run the tests** (A13d must still pass with the new `keydown` handler).

Run: `node --test viz/server.test.mjs 2>&1 | grep -E "^ℹ (pass|fail|todo)"`
Expected: `fail 0`.

- [ ] **Step 4: Browser check**: scrub to memo 1, figures and links replay; press play, steps advance every 3 s; press next at the last step, nothing changes; while on the last step, trigger a new memo (send a message in the live team or use the S3 fixture) and confirm the cursor follows; scrub back and trigger another, confirm the cursor stays and `N` grows; click a ledger row, cursor jumps.

- [ ] **Step 5: Commit**

```bash
git add viz/index.html viz/app.css viz/app.js
git commit -m "Scrub, step and replay the session's memos, and follow live from the last one"
```

---

### Task 4: Side panel

**Files:**
- Modify: `viz/index.html` (panel containers: `panel-head`, `tb-phase`, `tb-tasks`, `tb-git`, `board`, `card`, the existing ledger block), `viz/app.css` (`.panel .tb .ticks .tick .bar-tasks .board .mnode .medge .card .msg .cur .later`), `viz/app.js`

**Interfaces:**
- Consumes: `phaseOf`, `PHASES`, `stepState` result (`sent`, `got`, `desks`), `layout` agents, the ledger from Task 3.
- Produces: `renderPanel(snapshot)` (title block from `snapshot.tasks`/`snapshot.git`, task board), `renderCard(name, s)` (called by `goTo` and by figure clicks; `selected` name defaults to `'team-lead'` else the first agent), `.zone.sel` ring on the selected agent's room.

- [ ] **Step 1: Title block**: reuse the existing `renderTitle` pieces: phase text + six `.tick`s (`done`/`cur`), task counts + a three-segment bar (`--n` flex-grow), git `branch` + `commits · +ins −del` or "no git". Subline `#tb-project`: `PROJECT · TEAM · N AGENTS · 6 ROOMS`.

- [ ] **Step 2: Task board**: nodes in rows of five (node width 64, pitch 68, row pitch 68, at most 15 nodes; a footer line "+n more" past that), label `id + ' ' + subject.split(':')[0].slice(0, 12)`, `.seen` when `completed`, accent ring when `in_progress`; edges as `.medge` strips from each task to each `blockedBy` task it can find.

- [ ] **Step 3: Agent card**: swatch (`--agent`), name, `room · agentType`, status pill (`Delivering memo` / `Working` / `Blocked` / `Idle`), `Memos: s sent, r received`, `Task: <in-progress subject or none in progress>`. Figure `click` → `selected = name; renderCard(...)`; `.selring` on that figure, `.sel` on its room.

- [ ] **Step 4: Ledger**: rows after `cursor` get `.later` (opacity .45); the current row `.cur` (2 px ink inset); keep `details` expansion.

- [ ] **Step 5: Run the tests**, then **browser check** at 1440 and 375: panel fills, ticks and bar match the task list, board edges run 2→1→…→5, clicking a figure updates the card, dark mode readable.

- [ ] **Step 6: Commit**

```bash
git add viz/index.html viz/app.css viz/app.js
git commit -m "Show phase, tasks, git, the task board, an agent card and the Post room beside the office"
```

---

### Task 5: Accessibility, reduced motion, docs, final gate

**Files:**
- Modify: `viz/app.js`, `viz/app.css`, `README.md` ("Watch the team"), `docs/plans/2026-11-11-team-office-viewer.md` (one line under task 10 pointing at the spec)

- [ ] **Step 1: ARIA**: figure buttons `aria-label` = `name, room, caption, n memos` (refresh in `applyStep`); `#stage` `aria-label` "Office, drag to orbit"; `#scrub` `aria-valuetext` kept current; the play button toggles `aria-label` Play/Pause; `#ledger` keeps `role="log" aria-live="polite"`.

- [ ] **Step 2: Reduced motion**: with `prefers-reduced-motion: reduce`, no `.pulse`, no link flow, no `.pt` or `#floor` transitions (CSS only). Browser check with `emulate_media reducedMotion: reduce`: `document.getAnimations().length === 0` after a step.

- [ ] **Step 3: README**: replace the zoom/pan paragraph: orbit by dragging or the rotate buttons, zoom with the wheel or the buttons, Fit; the scrubber (slider, prev/next, play every 3 s, arrow keys and space), live follow from the last memo; click a figure for its card, click a memo to jump to it. Plan: add "Superseded by the 3D viewer: see docs/superpowers/specs/2026-11-13-team-office-3d-viewer-design.md" under task 10.

- [ ] **Step 4: Final gate**: `node --test` (full), expected `fail 0`, `todo 1`; A7(c) in the browser against the `viz/xss.fixture.mjs` team as task 6b of `docs/plans/2026-11-11-team-office-viewer.md` describes (payload shown literally, no image or script created); screenshots at 1440/375, light/dark; no console errors.

- [ ] **Step 5: Commit**

```bash
git add viz/app.js viz/app.css README.md docs/plans/2026-11-11-team-office-viewer.md
git commit -m "Make the 3D office readable by keyboard and screen reader, still under reduced motion, and document it"
```
