// Polls /api/state and draws the office. Every string from the server is untrusted:
// it goes in through textContent, and attribute names are always literals.

export const PHASES = ['Discuss', 'Ask', 'Plan', 'Build', 'Review', 'Wrap up'];
const ROOMS = new Map([
  ['team-lead', 'Lead'],
  ['team-skeptic', 'Strategy'], ['team-planner', 'Strategy'],
  ['team-builder', 'Engineering'], ['team-gatekeeper', 'Engineering'], ['team-reviewer', 'Engineering'],
  ['team-threat-modeler', 'Security'], ['team-security-reviewer', 'Security'],
  ['team-design-lead', 'Design'], ['team-art-director', 'Design'], ['team-design-critic', 'Design'],
]);
const ACTIVE_MS = 2 * 60 * 1000;

export const department = (agentType) => ROOMS.get(agentType) ?? 'Visitors';

export function phaseOf(tasks) {
  let best = -1;
  for (const t of tasks) {
    if (t.status === 'in_progress') best = Math.max(best, PHASES.findIndex((p) => t.subject.startsWith(`${p}:`)));
  }
  return best;
}

export function deskState(name, tasks, messages, now) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const open = tasks.filter((t) => t.owner === name && (t.status === 'pending' || t.status === 'in_progress'));
  if (open.some((t) => t.blockedBy.some((id) => byId.has(id) && byId.get(id).status !== 'completed'))) {
    return { state: 'blocked', caption: 'Blocked' };
  }
  if (messages.some((m) => m.from === name && now - Date.parse(m.ts) < ACTIVE_MS)) {
    return { state: 'active', caption: open.find((t) => t.status === 'in_progress')?.subject || 'Working' };
  }
  return { state: 'idle', caption: 'Idle' };
}

// The floor is a 24 x 16 grid of tiles. [i0, j0, w, d] per room; the corridor runs between the rows.
export const ROOM_TILES = new Map([
  ['Strategy', [0, 0, 7, 6]], ['Lead', [7, 0, 5, 6]], ['Security', [12, 0, 7, 6]], ['Visitors', [19, 0, 5, 6]],
  ['Engineering', [0, 8, 12, 8]], ['Design', [12, 8, 12, 8]],
]);
export const CORRIDOR = [0, 6, 24, 2];
const COLOURS = new Map([
  ['blue', '#2F6FDB'], ['green', '#2E8B57'], ['yellow', '#B58900'], ['purple', '#7B4FD6'],
  ['orange', '#D9661F'], ['pink', '#C2417A'], ['cyan', '#0E8A9E'], ['red', '#C93A3A'],
]);
const hhmm = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

// The 3D office. Rooms are drawn at T px per tile on an 840 x 600 floor.
export const T = 35;
export const OY = 20;
export const FLOOR_PX = { w: 840, h: 600 };
export const ROOM_TINTS = new Map([
  ['Strategy', '--room-strategy'], ['Lead', '--room-lead'], ['Security', '--room-security'], ['Visitors', '--surface'],
  ['Engineering', '--room-engineering'], ['Design', '--room-design'], ['Corridor', '--surface'],
]);
const roomBox = (name, [i0, j0, w, d], count) => ({ name, left: i0 * T, top: OY + j0 * T, width: w * T, height: d * T, count });

// Desk slot n of a room: 2 x 1 tiles at (i0 + 1 + 4k, j0 + 2 + 3r); the figure stands behind it,
// and "beside" is where a visiting sender stops, in front of the desk's right end.
export function layout(members) {
  const byRoom = new Map([...ROOM_TILES.keys()].map((r) => [r, []]));
  for (const m of members) byRoom.get(department(m.agentType)).push(m);
  const agents = new Map();
  const rooms = [];
  for (const [room, tiles] of ROOM_TILES) {
    const [i0, j0, w] = tiles;
    const cols = Math.floor((w - 3) / 4) + 1;
    // ponytail: past capacity (2 rows each) desks spill outside the room; page or shrink if teams get that big.
    byRoom.get(room).forEach((m, n) => {
      const di = i0 + 1 + 4 * (n % cols);
      const dj = j0 + 2 + 3 * Math.floor(n / cols);
      agents.set(m.name, {
        name: m.name, agentType: m.agentType, color: COLOURS.get(m.color) ?? null, room,
        desk: { left: di * T - 3, top: OY + dj * T - 2 },
        home: { x: di * T + 35, y: OY + dj * T - 8 },
        beside: { x: di * T + 92, y: OY + dj * T + 22 },
      });
    });
    rooms.push(roomBox(room, tiles, byRoom.get(room).length));
  }
  rooms.push(roomBox('Corridor', CORRIDOR, 0));
  return { rooms, agents };
}

// The camera: rotateZ (orbit), rotateX (tilt) and a zoom relative to the fitted size.
export const HOME_CAM = { rz: -38, rx: 56, zoom: 0.9 };
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function clampCam(next, prev = HOME_CAM) {
  if (![next.rz, next.rx, next.zoom].every(Number.isFinite)) return prev;
  return { rz: clampN(next.rz, -80, -8), rx: clampN(next.rx, 38, 68), zoom: Math.round(clampN(next.zoom, 0.6, 1.3) * 100) / 100 };
}

// Everything that varies with the memo under the cursor. `now` decides who still reads Working.
const clipText = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export function stepState(lay, tasks, messages, k, now) {
  const step = messages[k] ?? null;
  const positions = new Map();
  for (const [name, a] of lay.agents) positions.set(name, a.home);
  const worn = new Map();
  const sent = new Map();
  const got = new Map();
  for (let i = 0; i <= k && i < messages.length; i++) {
    const m = messages[i];
    sent.set(m.from, (sent.get(m.from) ?? 0) + 1);
    got.set(m.to, (got.get(m.to) ?? 0) + 1);
    if (lay.agents.has(m.from) && lay.agents.has(m.to)) {
      const key = `${m.from}|${m.to}`;
      worn.set(key, (worn.get(key) ?? 0) + 1);
    }
  }
  let link = null;
  if (step && lay.agents.has(step.from) && lay.agents.has(step.to)) {
    const to = lay.agents.get(step.to);
    positions.set(step.from, to.beside);
    link = { x1: to.beside.x, y1: to.beside.y, x2: to.home.x, y2: to.home.y };
  }
  const at = Number.isFinite(now) ? now : -Infinity;
  const upTo = messages.slice(0, k + 1);
  const desks = new Map();
  for (const name of lay.agents.keys()) {
    desks.set(name, step && step.from === name ? { state: 'away', caption: 'Delivering memo' } : deskState(name, tasks, upTo, at));
  }
  return {
    step, from: step?.from ?? null, to: step?.to ?? null, positions, link, worn, sent, got, desks,
    say: step ? clipText(step.text || step.summary || '(no text)', 160) : '',
    when: step ? hhmm(step.ts) : '',
  };
}

// The agent figure from the Claude Design image pack (docs/superpowers/specs/agent-images): a 56 x 72
// box standing on its bottom centre. Only the body colour differs between agents.
export const FIGURE_INK = '#1C2126';
export function figureShapes(color) {
  return [
    { tag: 'rect', x: 27, y: 8, width: 2, height: 6, fill: FIGURE_INK },
    { tag: 'rect', x: 17, y: 15, width: 22, height: 18, rx: 6, fill: '#FFFFFF', stroke: FIGURE_INK, 'stroke-width': 2 },
    { tag: 'circle', cx: 24, cy: 23, r: 2, fill: FIGURE_INK },
    { tag: 'circle', cx: 32, cy: 23, r: 2, fill: FIGURE_INK },
    { tag: 'path', d: 'M22 36H34A11 11 0 0 1 45 47V63A7 7 0 0 1 38 70H18A7 7 0 0 1 11 63V47A11 11 0 0 1 22 36Z', fill: color },
  ];
}

// After a ledger reset the cursor follows its memo by key, else clamps; -1 when nothing is left.
const memoKey = (m) => JSON.stringify([m.from, m.to, m.ts, m.text]);
export function recursor(prev, next, cursor) {
  if (!next.length) return -1;
  const want = prev[cursor] && memoKey(prev[cursor]);
  const i = want ? next.findIndex((m) => memoKey(m) === want) : -1;
  return i >= 0 ? i : Math.min(cursor, next.length - 1);
}

// Post room: oldest first, appended in place. A late message with an older timestamp lands
// mid-list, and then the ledger is rebuilt without motion.
export function ledgerUpdate(prev, next) {
  const n = prev.length;
  if (n > next.length || (n && memoKey(prev[n - 1]) !== memoKey(next[n - 1]))) return { reset: true, fresh: next };
  return { reset: false, fresh: next.slice(n) };
}

// ---------------------------------------------------------------------------------------------
// DOM from here down. Nothing above touches the document.

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const px = (node, prop, n) => node.style.setProperty(prop, `${n}px`);
// Names keep their tail, because a -2 suffix is what tells agents apart.
const clipName = (s) => (s.length > 16 ? `${s.slice(0, 10)}…${s.slice(-5)}` : s);

let snapshot = null;        // the last /api/state
let lay = null;             // layout(snapshot.members)
let layKey = '';
let cursor = -1;            // index of the memo on show
const figs = new Map();     // name -> the nodes applyStep() updates
const byId = (id) => document.getElementById(id);

// ---- Scene -----------------------------------------------------------------------------------

// Draws figureShapes() as an inline SVG. Attribute names are literal; values are the pack's numbers
// and a colour from the fixed COLOURS map.
const NS = 'http://www.w3.org/2000/svg';
const LEAD_BODY = '#1C2321';
function figureSvg(color) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 56 72');
  // The lead has no team colour: its body follows --ink, so it stays visible in dark mode.
  svg.setAttribute('class', color ? 'figimg' : 'figimg lead');
  svg.setAttribute('aria-hidden', 'true');
  for (const s of figureShapes(color ?? LEAD_BODY)) {
    const n = document.createElementNS(NS, s.tag);
    if (s.tag === 'rect') {
      n.setAttribute('x', String(s.x));
      n.setAttribute('y', String(s.y));
      n.setAttribute('width', String(s.width));
      n.setAttribute('height', String(s.height));
      if (s.rx !== undefined) n.setAttribute('rx', String(s.rx));
    } else if (s.tag === 'circle') {
      n.setAttribute('cx', String(s.cx));
      n.setAttribute('cy', String(s.cy));
      n.setAttribute('r', String(s.r));
    } else {
      n.setAttribute('d', s.d);
    }
    n.setAttribute('fill', s.fill);
    if (s.stroke) {
      n.setAttribute('stroke', s.stroke);
      n.setAttribute('stroke-width', String(s['stroke-width']));
    }
    svg.append(n);
  }
  return svg;
}

function strip(cls, x1, y1, x2, y2, h) {
  const s = el('div', cls);
  const dx = x2 - x1;
  const dy = y2 - y1;
  px(s, 'left', x1);
  px(s, 'top', y1);
  px(s, 'width', Math.round(Math.hypot(dx, dy)));
  if (h) px(s, 'height', h);
  s.style.setProperty('transform', `translateZ(2px) rotate(${(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2)}deg)`);
  return s;
}

function buildScene(lay) {
  const rooms = byId('rooms');
  const desks = byId('desks');
  const figures = byId('figures');
  for (const layer of [rooms, desks, figures, byId('worn'), byId('link')]) layer.replaceChildren();
  figs.clear();

  for (const r of lay.rooms) {
    const z = el('div', 'zone');
    z.dataset.room = r.name;
    px(z, 'left', r.left);
    px(z, 'top', r.top);
    px(z, 'width', r.width);
    px(z, 'height', r.height);
    z.style.setProperty('background', `var(${ROOM_TINTS.get(r.name)})`);
    if (r.name !== 'Corridor') z.append(el('div', 'zname', r.name), el('div', 'zsub', `${r.count} AGENTS`));
    rooms.append(z);
  }

  for (const a of lay.agents.values()) {
    const d = el('div', 'desk');
    px(d, 'left', a.desk.left);
    px(d, 'top', a.desk.top);
    if (a.color) d.style.setProperty('--agent', a.color);
    const top = el('div', 't');
    const memo = el('div', 'memo');
    memo.hidden = true;
    d.append(el('div', 'b'), el('div', 'l'), el('div', 'r'), el('div', 'f'), top, el('div', 'm'), memo);
    desks.append(d);

    const pt = el('div', 'pt');
    px(pt, 'left', a.home.x);
    px(pt, 'top', a.home.y);
    if (a.color) pt.style.setProperty('--agent', a.color);
    const ring = (cls) => { const r = el('div', `ring ${cls}`); r.hidden = true; return r; };
    const selring = ring('selring');
    const hear = ring('hear');
    const pulse = ring('pulse');
    const fig = el('button', 'fig bb');
    fig.setAttribute('type', 'button');
    fig.dataset.name = a.name;
    const cap = el('span', 'cap');
    const tag = el('span', 'tag', clipName(a.name));
    const bubble = el('span', 'bubble');
    bubble.hidden = true;
    const btext = el('span', 'btext');
    const bmod = el('span', 'bmod');
    bubble.append(btext, bmod);
    fig.append(figureSvg(a.color), cap, tag, bubble);
    fig.addEventListener('click', () => selectAgent(a.name));
    pt.append(el('div', 'shadow'), selring, hear, pulse, fig);
    figures.append(pt);
    figs.set(a.name, { pt, fig, tag, cap, bubble, btext, bmod, hear, pulse, selring, deskTop: top, memo, room: a.room });
  }
}

// Writes one stepState() result into the scene; CSS transitions carry the sender's move.
function applyStep(s) {
  for (const [name, f] of figs) {
    const p = s.positions.get(name);
    px(f.pt, 'left', p.x);
    px(f.pt, 'top', p.y);
    const ds = s.desks.get(name);
    const speaking = s.from === name;
    f.cap.textContent = clipText(ds.caption, 22);
    f.cap.classList.toggle('blocked', ds.state === 'blocked');
    f.tag.classList.toggle('on', speaking);
    f.pulse.hidden = !speaking;
    f.hear.hidden = s.to !== name;
    f.bubble.hidden = !speaking;
    if (speaking) {
      f.btext.textContent = s.say;
      f.bmod.textContent = `${s.when} · to ${s.to}`;
    }
    f.deskTop.classList.toggle('blocked', ds.state === 'blocked');
    f.memo.hidden = s.to !== name;
    const n = s.sent.get(name) ?? 0;
    f.fig.setAttribute('aria-label', `${name}, ${f.room}, ${ds.caption}, ${n} ${n === 1 ? 'memo' : 'memos'}`);
  }
  const worn = [];
  for (const [key, n] of s.worn) {
    const [from, to] = key.split('|');
    const a = lay.agents.get(from);
    const b = lay.agents.get(to);
    worn.push(strip('worn', a.home.x, a.home.y, b.beside.x, b.beside.y, Math.min(8, 1 + 1.5 * Math.sqrt(n))));
  }
  byId('worn').replaceChildren(...worn);
  byId('link').replaceChildren(...(s.link ? [strip('link', s.link.x1, s.link.y1, s.link.x2, s.link.y2)] : []));
}

// ---- Camera ------------------------------------------------------------------------------------
// The floor is scaled to fit the stage first (base), and cam.zoom is relative to that.

let cam = HOME_CAM;
let base = 1;
let press = null;

function applyCam() {
  const floor = byId('floor');
  floor.style.setProperty('transform', `scale(${(base * cam.zoom).toFixed(4)}) rotateX(${cam.rx}deg) rotateZ(${cam.rz}deg)`);
  floor.style.setProperty('--bb', `rotateZ(${-cam.rz}deg) rotateX(${-cam.rx}deg)`);
}
function setCam(next) {
  cam = clampCam(next, cam);
  applyCam();
}
function fitBase() {
  const stage = byId('stage');
  // The rotated floor measures about 1032 x 580 px at scale 1 (perspective included), so this fits it.
  base = Math.min(1, stage.clientWidth / 1060, stage.clientHeight / 600) || 1;
  applyCam();
}

function wireCamera() {
  const stage = byId('stage');
  // Every handler here reads event numbers and `cam` only, then goes through clampCam().
  stage.addEventListener('pointerdown', (e) => {
    if (e.button === 0) press = { x: e.clientX, y: e.clientY, rz: cam.rz, rx: cam.rx, id: e.pointerId, moved: false };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!e.buttons) return endPress(e);
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!press.moved && Math.hypot(dx, dy) < 4) return; // under 4 px is a click
    if (!press.moved) {
      press.moved = true;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('dragging');
    }
    setCam({ rz: press.rz + dx * 0.3, rx: press.rx - dy * 0.25, zoom: cam.zoom });
  });
  const endPress = (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (press.moved) stage.classList.remove('dragging');
    press = null;
  };
  stage.addEventListener('pointerup', endPress);
  stage.addEventListener('pointercancel', endPress);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    setCam({ rz: cam.rz, rx: cam.rx, zoom: cam.zoom - Math.sign(e.deltaY) * 0.1 });
  }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') setCam({ rz: cam.rz, rx: cam.rx, zoom: cam.zoom + 0.1 });
    else if (e.key === '-' || e.key === '_') setCam({ rz: cam.rz, rx: cam.rx, zoom: cam.zoom - 0.1 });
    else if (e.key === '0') setCam(HOME_CAM);
    else return;
    e.preventDefault();
  });
  byId('rot-l').addEventListener('click', () => setCam({ rz: cam.rz + 14, rx: cam.rx, zoom: cam.zoom }));
  byId('rot-r').addEventListener('click', () => setCam({ rz: cam.rz - 14, rx: cam.rx, zoom: cam.zoom }));
  byId('zoom-in').addEventListener('click', () => setCam({ rz: cam.rz, rx: cam.rx, zoom: cam.zoom + 0.1 }));
  byId('zoom-out').addEventListener('click', () => setCam({ rz: cam.rz, rx: cam.rx, zoom: cam.zoom - 0.1 }));
  byId('zoom-fit').addEventListener('click', () => setCam(HOME_CAM));
  new ResizeObserver(fitBase).observe(stage);
  fitBase();
}

// ---- Post room ----------------------------------------------------------------------------------

let rendered = [];
function renderLedger(messages) {
  const ledger = byId('ledger');
  const { reset, fresh } = ledgerUpdate(rendered, messages);
  if (reset) ledger.replaceChildren();
  const start = reset ? 0 : rendered.length;
  ledger.append(...fresh.map((m, i) => row(m, start + i)));
  rendered = messages;
  byId('empty').hidden = messages.length > 0;
}

function row(m, index) {
  const li = el('li', 'memo');
  li.dataset.index = String(index);
  const details = el('details');
  const summary = el('summary');
  const time = el('time', 'when', hhmm(m.ts));
  time.setAttribute('datetime', m.ts);
  summary.append(time, el('span', 'route', `${m.from} → ${m.to}`), el('span', 'gist', m.summary || m.text.slice(0, 140) || '(no text)'));
  details.append(summary, el('p', 'body', m.text || '(no text)'));
  // Opening a memo jumps the replay to it.
  details.addEventListener('toggle', () => { if (details.open) goTo(index); });
  li.append(details);
  return li;
}

// ---- Replay -------------------------------------------------------------------------------------
// The cursor follows the newest memo until you scrub back; then new memos only extend the range.

let following = true;
let playTimer = null;
let prevMessages = [];
let shown = null;

function showStep() {
  const msgs = snapshot.messages;
  const n = msgs.length;
  const m = msgs[cursor];
  // Live, captions age with the clock; replayed, the team is shown as it stood at that memo.
  const s = stepState(lay, snapshot.tasks, msgs, cursor, following ? Date.now() : Date.parse(m?.ts));
  applyStep(s);
  const scrub = byId('scrub');
  scrub.max = String(Math.max(0, n - 1));
  scrub.value = String(Math.max(0, cursor));
  scrub.disabled = n === 0;
  scrub.setAttribute('aria-valuetext', m ? `Memo ${cursor + 1} of ${n}, ${hhmm(m.ts)}, ${m.from} → ${m.to}` : 'No memos');
  byId('memo-label').textContent = `MEMO ${cursor + 1} / ${n}`;
  const p = phaseOf(snapshot.tasks);
  byId('phase').textContent = p < 0 ? 'Not started' : PHASES[p];
  renderCard(s);
  const rows = byId('ledger').children;
  for (const li of rows) {
    const i = Number(li.dataset.index);
    li.classList.toggle('cur', i === cursor);
    li.classList.toggle('later', i > cursor);
  }
  const key = m ? memoKey(m) : null;
  if (key !== shown) {
    rows[cursor]?.scrollIntoView({ block: 'nearest' });
    shown = key;
  }
}

function goTo(k) {
  const n = snapshot ? snapshot.messages.length : 0;
  if (!n) return;
  cursor = Math.min(n - 1, Math.max(0, k));
  following = cursor === n - 1;
  showStep();
}

function setPlaying(on) {
  clearInterval(playTimer);
  playTimer = on ? setInterval(() => goTo(cursor + 1), 3000) : null;
  const b = byId('play');
  b.textContent = on ? '⏸' : '▶';
  b.setAttribute('aria-label', on ? 'Pause replay' : 'Play replay');
}

function wireBar() {
  byId('prev').addEventListener('click', () => goTo(cursor - 1));
  byId('next').addEventListener('click', () => goTo(cursor + 1));
  byId('play').addEventListener('click', () => setPlaying(!playTimer));
  byId('scrub').addEventListener('input', (e) => goTo(Number(e.target.value)));
  // Arrow keys step and Space plays, from the office or the bar. The slider and buttons keep their own keys.
  for (const id of ['stage', 'bar']) {
    byId(id).addEventListener('keydown', (e) => {
      if (e.target.closest('input, button')) return;
      if (e.key === 'ArrowLeft') goTo(cursor - 1);
      else if (e.key === 'ArrowRight') goTo(cursor + 1);
      else if (e.key === ' ') setPlaying(!playTimer);
      else return;
      e.preventDefault();
    });
  }
  setPlaying(false);
}

// ---- Panel --------------------------------------------------------------------------------------

let selected = null;
let lastStep = null;
const STATUS = new Map([['away', 'Delivering memo'], ['active', 'Working'], ['blocked', 'Blocked'], ['idle', 'Idle']]);

function selectAgent(name) {
  selected = name;
  if (lastStep) renderCard(lastStep);
}

// Phase, task counts and git: the present, whatever memo is on show.
function renderPanel() {
  const project = snapshot.project ?? snapshot.team;
  byId('panel-sub').textContent = `${project} · ${snapshot.team}`;
  const cell = (label, ...nodes) => {
    const d = el('div', 'tb-cell');
    d.append(el('div', 'tb-k', label), ...nodes);
    return d;
  };
  const phase = phaseOf(snapshot.tasks);
  const ticks = el('div', 'ticks');
  ticks.setAttribute('aria-hidden', 'true');
  PHASES.forEach((_, i) => ticks.append(el('span', i < phase ? 'tick done' : i === phase ? 'tick cur' : 'tick')));
  const count = (st) => snapshot.tasks.filter((t) => t.status === st).length;
  const [done, doing, todo] = [count('completed'), count('in_progress'), count('pending')];
  const bar = el('div', 'tbar');
  bar.setAttribute('aria-hidden', 'true');
  for (const [cls, n] of [['d', done], ['g', doing], ['t', todo]]) {
    const seg = el('span', cls);
    seg.style.setProperty('flex-grow', String(n));
    bar.append(seg);
  }
  const g = snapshot.git;
  byId('title-block').replaceChildren(
    cell('PHASE', el('div', 'tb-v', phase < 0 ? 'Not started' : `${PHASES[phase]}, ${phase + 1} of ${PHASES.length}`), ticks),
    cell('TASKS', el('div', 'tb-v', `${done} done · ${doing} in progress · ${todo} pending`), bar),
    cell('GIT', el('div', 'tb-v', g ? g.branch : 'no git'),
      el('div', 'tb-s', g ? `${g.commits} ${g.commits === 1 ? 'commit' : 'commits'}${g.insertions === null ? '' : ` · +${g.insertions} −${g.deletions}`}` : '')),
  );
  renderBoard();
}

// The task board: one node per task in rows of five, a line from each task to what blocks it.
const BOARD = { cols: 5, pitch: 68, row: 52, w: 64, max: 15 };
function renderBoard() {
  const tasks = snapshot.tasks.slice(0, BOARD.max);
  const at = new Map(tasks.map((t, i) => [t.id, { x: 8 + (i % BOARD.cols) * BOARD.pitch, y: 26 + Math.floor(i / BOARD.cols) * BOARD.row }]));
  const box = el('div', 'board');
  px(box, 'height', 26 + Math.ceil(tasks.length / BOARD.cols) * BOARD.row - 12);
  for (const t of tasks) {
    for (const b of t.blockedBy) {
      const p = at.get(b);
      const q = at.get(t.id);
      if (p && q) box.append(strip('medge', p.x + BOARD.w / 2, p.y, q.x + BOARD.w / 2, q.y));
    }
  }
  for (const t of tasks) {
    const p = at.get(t.id);
    const n = el('div', `mnode${t.status === 'completed' ? ' seen' : ''}${t.status === 'in_progress' ? ' doing' : ''}`, `${t.id} ${t.subject.split(':')[0].slice(0, 12)}`);
    n.setAttribute('title', t.subject);
    px(n, 'left', p.x);
    px(n, 'top', p.y);
    box.append(n);
  }
  const head = el('div', 'panel-row');
  head.append(el('h3', '', 'Task board'), el('span', 'mono sub', snapshot.tasks.length > BOARD.max ? `+${snapshot.tasks.length - BOARD.max} more` : `${snapshot.tasks.length} tasks`));
  const note = el('p', 'note', 'Dark tasks are done; a ring marks tasks in progress. A line joins a task to the one it waits on.');
  byId('board').replaceChildren(head, ...(snapshot.tasks.length ? [box, note] : [el('p', 'note', 'No tasks yet')]));
}

// The selected agent: who they are, what they are doing at this memo, and their traffic so far.
function renderCard(s) {
  lastStep = s;
  if (!lay.agents.has(selected)) selected = lay.agents.has('team-lead') ? 'team-lead' : lay.agents.keys().next().value ?? null;
  for (const [name, f] of figs) f.selring.hidden = name !== selected;
  const a = lay.agents.get(selected);
  for (const z of byId('rooms').children) z.classList.toggle('sel', !!a && z.dataset.room === a.room);
  if (!a) return byId('card').replaceChildren();
  const ds = s.desks.get(selected);
  const sw = el('span', 'swatch');
  if (a.color) sw.style.setProperty('--agent', a.color);
  const who = el('div', 'who');
  who.append(el('div', 'who-n', a.name), el('div', 'who-r', `${a.room} · ${a.agentType}`));
  const top = el('div', 'card-top');
  top.append(sw, who, el('span', 'pill', STATUS.get(ds.state) ?? 'Idle'));
  const task = snapshot.tasks.find((t) => t.owner === selected && t.status === 'in_progress');
  byId('card').replaceChildren(top,
    el('p', 'card-l', `Memos: ${s.sent.get(selected) ?? 0} sent, ${s.got.get(selected) ?? 0} received`),
    el('p', 'card-l', `Task: ${task ? task.subject : 'none in progress'}`));
}

// ---- Render -------------------------------------------------------------------------------------

function render(next) {
  snapshot = next;
  const project = snapshot.project ?? snapshot.team;
  document.title = `Team office · ${project}`;
  const key = JSON.stringify(snapshot.members);
  if (key !== layKey) {
    lay = layout(snapshot.members);
    layKey = key;
    buildScene(lay);
    byId('wall-text').textContent = `ROLECALL · ${project}`.toUpperCase();
    byId('tb-project').textContent = `${project} · ${snapshot.team} · ${snapshot.members.length} agents · ${ROOM_TILES.size} rooms`;
  }
  renderLedger(snapshot.messages);
  renderPanel();
  const msgs = snapshot.messages;
  cursor = following ? msgs.length - 1 : recursor(prevMessages, msgs, cursor);
  following = cursor === msgs.length - 1;
  prevMessages = msgs;
  showStep();
}

async function poll() {
  const status = byId('status');
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    render(await res.json());
    status.textContent = '';
  } catch {
    status.textContent = 'Server not answering, retrying';
  }
  setTimeout(poll, 2000);
}

if (typeof document !== 'undefined') {
  wireCamera();
  wireBar();
  poll();
}
