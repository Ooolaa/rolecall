# Team office 3D viewer: design

Rebuild the viewer page (`viz/`) so it looks and works like the Claude Design prototype
"AI Agents Office" (the artboard "Team office · 3D prototype (Rolecall data)"), with live team
data and a replay scrubber over the session's memos. The server is untouched.

**The prototype** is the reference for every look the text does not spell out (walls, slabs,
figure shape, bubble, rings, panel). Its full source is checked in beside this document as
`2026-11-13-team-office-prototype.dc.html` (markup, CSS and logic; the `<x-dc>`/`sc-for` tags
are the Claude Design template syntax and `renderVals()` is the state-to-view function). The
live canvas is https://claude.ai/artifact/974SykQFDUuyoGudF5ZrKU. Port its CSS values; do not
invent a look.

## Intent

The user watches the Rolecall team work and wants it to feel like a game. The SVG isometric
office (commit c53459d) is "not like this". The prototype is: a CSS-3D floor you orbit by
dragging, little figures with name tags, a speech bubble over whoever is talking, a dashed line
to whoever is listening, a right-hand panel with the project's state, and a timeline you can
scrub and play. That UI becomes the real viewer.

## Goals

1. The prototype's look and interactions, with the real team: rooms, agents, memos, tasks, git.
2. A replay scrubber: every memo in the session is a step; prev, next, play, and a slider.
3. Keep every guarantee of the current build: read-only server, CSP `default-src 'self'`,
   A7 (no HTML writes, no inline styles, literal attribute names), A13 (view handlers read only
   event numbers and the view), reduced motion, keyboard access, the test suite.

## Non-goals

- Corridor routing for walks (the sender moves in a straight line, as in the prototype).
- Touch-screen pinch. Buttons and wheel zoom only.
- Task or git history per step. The task board, phase and git show the present at every step.
- The prototype's stand-up table and meetings. Rolecall has no Commons room.

## Anti-goals

- Anything that looks like the flat plan or the SVG isometric office.
- A library, a build step, a font or image from the network.
- Loosening the CSP or the A7/A13 scans to make the prototype's inline styles fit.

## Constraints

- CSP `default-src 'self'`: no inline `style=""`, no inline scripts, no Google Fonts. The
  prototype's inline styles become classes; positions and colours that vary per element are set
  with `el.style.setProperty()` from numbers or the fixed colour map. Fonts: `system-ui` for
  text, `ui-monospace` for labels.
- A7(b) scan (`viz/server.test.mjs`): no `innerHTML`, no ` style=`, no `.style.cssText`,
  only literal attribute names. Server strings reach the DOM through `textContent` only.
- A13d scan: the `wheel`, `pointer*` and `keydown` handler bodies must not mention
  `lastState`, `state`, `messages`, `rendered`, `queue` or `walkers`. The scrubber state is
  therefore named `cursor` and the camera `cam`; handlers call `goTo()`/`orbit()` with numbers.
- `GET /api/state` is unchanged: `{ team, project, members[{name, agentType, color}],
  messages[{from, to, summary, text, ts}] oldest first, tasks[{id, subject, status, owner,
  blockedBy}], git | null }`. The page polls it every 2 s.
- Reference frame 1440×900; must work at 375 px wide (panel stacks under the stage).

## Approaches

- **A. Port the prototype as is**: one render function rebuilds scene and panel from state on
  every change. Simplest to write, but a rebuild every 2 s poll breaks the 1 s figure-move
  transitions and the Post room's scroll position.
- **B. Keep the viewer's skeleton, swap the renderer** (chosen): build the scene once from the
  member list, then a step function updates positions, classes and text in place. The pure
  functions `phaseOf`, `deskState`, `department`, `ledgerUpdate` and the colour map stay and
  stay tested. The scrubber is a cursor over the message list.
- **C. Keep the SVG floor, add the panels and scrubber**: rejected by the user ("not like this").

## The page

Three regions. From 1024 px: stage left, panel 400 px right; the bottom bar under the stage.
Below 1024 px they stack: stage, bottom bar, panel.

```
┌ Team office                                   ↶ ↷  −  +  Fit ┐┌ TECHPULSE · session-a15e8d75 ┐
│ TECHPULSE · SESSION-… · 11 AGENTS · 6 ROOMS   Drag to orbit  ││ Team office                   │
│                                                              ││ PHASE | TASKS | GIT           │
│            ╱ Strategy ─ Lead ─ Security ─ Visitors ╲         ││ Task board (7 nodes, edges)   │
│           ╱     corridor                            ╲        ││ Agent card (name, room, type, │
│          ╱  Engineering          Design              ╲       ││   status, memos, task)        │
│                                                              ││ Post room (every memo)        │
├ ◀ ▶⏸ ▶ ═══════●══════════ MEMO 212 / 357   [Review] ─────────┤│                               │
└──────────────────────────────────────────────────────────────┘└───────────────────────────────┘
```

### Header (stage top)

Title "Team office"; subline `PROJECT · TEAM · N AGENTS · 6 ROOMS` in mono caps; hint "Drag the
floor to orbit"; buttons Rotate left, Rotate right, Zoom out (`id="zoom-out"`), Zoom in
(`id="zoom-in"`), Fit (`id="zoom-fit"`, text "Fit"). All 44 px tall, real `<button>`s with
`aria-label`s.

### Stage and floor

- `.stage` has `perspective: 2400px`; `.floor` is 840×600 with `transform-style: preserve-3d`
  and `transform: scale(zoom) rotateX(rx) rotateZ(rz)`, transition 0.45 s unless dragging.
- Camera `cam = { rz: -38, rx: 56, zoom: 0.9 }`. Drag: `rz += dx * 0.3` clamped −80..−8,
  `rx -= dy * 0.25` clamped 38..68; under 4 px is a click. Rotate buttons ±14°. Zoom buttons and
  the wheel ±0.1 per step, clamped 0.6..1.3. Fit resets the camera. Pointer capture on drag.
  `clampCam(cam)` is a pure export: non-finite input leaves the camera unchanged.
- The floor fits the stage (lead's call): the rendered scale is `base × cam.zoom`, where
  `base = min(1, stageWidth / 960, stageHeight / 640)` is recomputed on `resize` (a
  `ResizeObserver` on the stage), so at 1440 the office renders as in the prototype and at
  375 px it is fully visible at Fit. `cam.zoom` and its 0.6..1.3 clamp are relative to that
  base; the stage still clips whatever is zoomed past its edge. `base` is derived from element
  sizes only, never from server data.
- Rooms at the viewer's tiles, 35 px per tile, 20 px top offset: Strategy [0,0,7,6],
  Lead [7,0,5,6], Security [12,0,7,6], Visitors [19,0,5,6], corridor [0,6,24,2],
  Engineering [0,8,12,8], Design [12,8,12,8]. Each a `.zone` with its tint (the existing
  `--room-*` tokens), name and "N AGENTS"; the selected agent's room gets a 2 px ink ring.
- Back wall (64 tall, "ROLECALL · PROJECT" lettering), right wall and the two slabs, as in the
  prototype.
- Desks: 2×1 tiles at `(i0 + 1 + 4k, j0 + 2 + 3r)` as today; a 76×40 CSS box with six faces
  (top at `translateZ(24px)`), top tinted agent colour 18 % into ground, a hatch class when
  blocked, a monitor at the left end of the back edge, a memo square on the recipients' desks for
  the current step.
- Figures: the prototype's figure (antenna, head with two eyes, rounded body in the agent
  colour), a `<button class="fig">` billboarded with `rotateZ(-rz) rotateX(-rx)`, standing just
  behind its desk; a drop shadow ellipse; a name tag above the head and a mono caption above
  that (Idle / Working / Blocked / Delivering memo, or the in-progress task subject clipped to
  22 chars); a selection ring, a dashed "listening" ring, an accent pulse ring while speaking;
  the speech bubble with the memo text (summary if the text is empty, clipped to 160 chars) and a
  footer `HH:MM · to <recipients>`. The figure moves with a 1 s transition on `transform`.
- Worn paths: one rotated strip per sender→recipient pair seen up to the current step, from the
  sender's home to the recipient's "beside" point, width `min(8, 1 + 1.5 * sqrt(n))`, 14 % ink.
- Link geometry (lead's call): the API's `to` is one name, so a step has one recipient. The
  sender's destination is the fixed "beside" point of the recipient's desk (prototype:
  desk origin + (92, 22) px, in front of the desk's right end); the sender's figure transitions
  there over 1 s. The dashed accent link is drawn immediately from that destination to the
  recipient's home point (a short strip across the desk), animated flow under no-preference; it
  does not follow the transition. The sender's own worn path (home → beside) is what the walk
  visibly traces.
- Colours: the existing `COLOURS` map (blue, green, yellow, purple, orange, pink, cyan, red) and
  `--ink` for the lead; tokens stay in `:root` with the dark-mode block.

### Bottom bar

Previous memo, Play/Pause (one button, toggles label and icon), Next memo; a native
`<input type="range" min="0" max="N-1">` with `aria-label="Memo"` and `aria-valuetext`
"Memo k of N, HH:MM, from → to"; the mono label `MEMO k / N`; the phase pill (`PHASES[phaseOf]`
or "Not started").

### Panel

1. Head: `PROJECT · TEAM` mono caps, h2 "Team office".
2. Title block, three columns: Phase (text plus six ticks, done/current), Tasks (text plus a
   done/doing/todo bar), Git (branch, `commits · +ins −del`, or "no git").
3. Task board: one node per task (`"<id> <subject up to the colon or 12 chars>"`), completed
   nodes dark, in-progress nodes with an accent ring, a thin line from each task to the task it
   is blocked by; laid out in rows of five, at most 15 nodes, the rest counted in a footer line.
4. Agent card for the selected agent (default `team-lead`): colour swatch, name, room · agent
   type, status pill, `Memos: s sent, r received` (up to the current step), `Task: <in-progress
   subject or none>`.
5. Post room: every memo, oldest first, the existing `<ol id="ledger" role="log">` rows (time,
   `from → to`, summary, expandable body). The current step's row gets `.cur` and is scrolled into
   view; rows after the cursor are dimmed. Clicking a row jumps the cursor to it.

### Replay model

- Steps are `state.messages`, index `k = cursor`. `stepState(members, tasks, messages, k, now)`
  is a pure export returning, for step k: the sender and recipient, each agent's position
  (home, or the recipient's "beside" point for the sender), the link, the worn-pair counts over
  messages 0..k, sent/received counts, and each agent's desk state from
  `deskState(name, tasks, messages.slice(0, k + 1), now)`, with the sender's caption forced to
  "Delivering memo". `now` (lead's call): while the cursor follows live on the last step, the
  page passes `Date.now()`, so captions fall back to Idle after 2 min of silence as today; once
  the user has scrubbed, it passes `Date.parse(messages[k].ts)`, so a replayed step shows the
  team as it stood then. With no messages, every agent is at home and idle and the bar reads
  `MEMO 0 / 0`.
- Settled with the reviewer's defaults: recipients are `[m.to]`; clicking a figure only selects
  it (the ledger does not jump); when `ledgerUpdate` reports a reset, the cursor re-finds its
  memo by key `[from, to, ts, text]`, else clamps to the new range; each figure is a positioned
  wrapper (1 s transition) around a billboarded inner element (0.45 s with the floor), so
  orbiting does not lag the figures; the task-board lines may be inline SVG built with literal
  attribute names.
- Live follow: the cursor starts at the last message and, while it is on the last step, every
  poll that brings new messages advances it to the new last step. Once the user scrubs back the
  cursor stays put; new memos only extend the slider's range and the `N`.
- Play: advances one step every 3 s; at the last step it stays (no wrap) and keeps following
  live. Pause stops the timer. Prev/next clamp.
- Keys, on the stage or the bar: ArrowLeft/ArrowRight step, Space toggles play, `0` fits the
  camera, `+`/`-` zoom. The handler reads `e.key` only and calls the step/camera functions.
- Walk motion is the 1 s transition on the sender's transform; there is no cap or queue (one
  sender moves per step). Under reduced motion: no transitions, no pulse, no link flow; the
  sender appears beside the recipient.

### Accessibility

Figures are `<button>`s with `aria-label` "name, room, caption, n memos"; Tab reaches them. The
slider is native. Text uses only `--ink` and `--muted`; the accent is for rings, links and the
memo square. The selected agent's room ring and the current ledger row do not rely on colour alone
(ring width, left border).

## Tests

- Keep, unchanged: every server test (A1–A12), A7(b), A7(c) fixture, `page: phase`, `page: desk
  state`, `page: rooms`, `page: ledger`, and A13d (it must keep finding `wheel`, `pointerdown`,
  `pointermove` and `keydown` handlers).
- Remove with their functions: `iso`, `depthKey`, `route`, `legFacing`, `walkMs`, the walk
  cap/queue tests, A13a/A13b, and the "iso page" static test.
- Add: `clampCam` (non-finite input leaves the camera unchanged; rz, rx and zoom stay in range
  after 1000 wild steps); `stepState` (the sender stands beside the first recipient, recipients
  are listening, worn counts accumulate, the sender's caption is "Delivering memo", an agent who
  sent within 2 min before step k is Working, an agent whose open task is blocked is Blocked, an
  empty list gives all-idle at home); a static "office page" test: index.html has `id="zoom-fit"`
  with text `Fit`, a `type="range"` slider, no `http` in any `href`/`src`; app.css has no
  `url(` and no `@import`.

## Files

`viz/app.js`, `viz/app.css`, `viz/index.html` rewritten; `viz/server.test.mjs` updated as above;
README "Watch the team" paragraph rewritten (orbit, zoom, Fit, the scrubber and keys);
`docs/plans/2026-11-11-team-office-viewer.md` gains one line pointing at this design. `server.mjs`
and `xss.fixture.mjs` untouched.

## Left to the builder

Exact CSS values and spacing; how the ledger keeps its scroll position while rows are added
behind the cursor; the slider's styling; the task-board column widths; the memo-text clip length
if 160 looks wrong; whether the subline shows the room count.
