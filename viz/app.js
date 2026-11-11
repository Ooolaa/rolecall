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

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const hhmm = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

// Post room: oldest first, appended in place. A late message with an older timestamp lands
// mid-list, and then the ledger is rebuilt without motion.
const key = (m) => JSON.stringify([m.from, m.to, m.ts, m.text]);
export function ledgerUpdate(prev, next) {
  const n = prev.length;
  if (n > next.length || (n && key(prev[n - 1]) !== key(next[n - 1]))) return { reset: true, fresh: next };
  return { reset: false, fresh: next.slice(n) };
}

let rendered = [];
let selected = null;
function renderLedger(messages) {
  const ledger = document.getElementById('ledger');
  const { reset, fresh } = ledgerUpdate(rendered, messages);
  if (reset) { ledger.replaceChildren(); select(null); }
  const atBottom = reset || ledger.scrollHeight - ledger.scrollTop - ledger.clientHeight < 40;
  const rows = fresh.map(row);
  ledger.append(...rows);
  rendered = messages;
  document.getElementById('empty').hidden = messages.length > 0;
  if (atBottom) ledger.scrollTop = ledger.scrollHeight;
  return reset ? [] : fresh.map((m, i) => [m, rows[i]]);
}

function row(m) {
  const li = el('li', 'memo');
  li.dataset.from = m.from;
  li.dataset.to = m.to;
  const details = el('details');
  const summary = el('summary');
  const time = el('time', 'when', hhmm(m.ts));
  time.setAttribute('datetime', m.ts);
  summary.append(time, el('span', 'route', `${m.from} → ${m.to}`), el('span', 'gist', m.summary || m.text.slice(0, 140) || '(no text)'));
  details.append(summary, el('p', 'body', m.text || '(no text)'));
  details.addEventListener('toggle', () => {
    if (details.open) select(li);
    else if (selected === li) select(null);
  });
  li.append(details);
  return li;
}

function select(li) {
  if (selected && selected !== li) {
    selected.classList.remove('selected');
    selected.querySelector('details').open = false;
  }
  selected = li;
  li?.classList.add('selected');
  if (!li) markDesk(null);
  const d = li && routeD(li.dataset.from, li.dataset.to);
  document.getElementById('route').replaceChildren(...(d ? [svgPath(d, 'route')] : []));
}

// Floor plan. Rooms sit either side of an 80-unit corridor (270-350); [x, y, w, h, side of corridor].
const BOXES = new Map([
  ['Strategy', [0, 0, 310, 270, 'top']], ['Lead', [310, 0, 200, 270, 'top']],
  ['Security', [510, 0, 310, 270, 'top']], ['Visitors', [820, 0, 180, 270, 'top']],
  ['Engineering', [0, 350, 500, 290, 'bottom']], ['Design', [500, 350, 500, 290, 'bottom']],
]);
const CORRIDOR_Y = 310; // worn paths run down the middle
const WALK_Y = 344; // walkers' feet: a ~67-tall person's head clears the top wall at 270
// Each desk is a side-on vignette: a person seated at a desk and monitor, name and caption below.
const DESK_W = 140;
const DESK_H = 100;
const PITCH_X = DESK_W + 12;
const PITCH_Y = DESK_H + 8;
const FEET_Y = 66; // floor line of the vignette; a walker's feet stand on it
const SEAT_X = 40; // where the seated person is
const COLOURS = new Map([
  ['blue', '#2F6FDB'], ['green', '#2E8B57'], ['yellow', '#B58900'], ['purple', '#7B4FD6'],
  ['orange', '#D9661F'], ['pink', '#C2417A'], ['cyan', '#0E8A9E'], ['red', '#C93A3A'],
]);
const NS = 'http://www.w3.org/2000/svg';
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// Names keep their tail, because a -2 suffix is what tells agents apart.
const clipName = (s) => (s.length > 16 ? `${s.slice(0, 10)}…${s.slice(-5)}` : s);

function svgEl(tag, cls) {
  const e = document.createElementNS(NS, tag);
  if (cls) e.setAttribute('class', cls);
  return e;
}
function svgRect(x, y, w, h, cls) {
  const r = svgEl('rect', cls);
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', String(w));
  r.setAttribute('height', String(h));
  return r;
}
function svgText(x, y, str, cls) {
  const t = svgEl('text', cls);
  t.setAttribute('x', String(x));
  t.setAttribute('y', String(y));
  t.textContent = str;
  return t;
}
function svgPath(d, cls) {
  const p = svgEl('path', cls);
  p.setAttribute('d', d);
  return p;
}

// name -> { g, room, door, lane, walkLane, ex, ey, col, sx, sy, dx, dy }: a route leaves the desk's left edge
// at (ex, ey) into the column gutter at x=col, so it never crosses another desk. A walk starts
// where the person sits (sx, sy) and ends standing just left of the recipient's chair.
let desks = new Map();
let deskKey = '';

// One orthogonal route: desk -> lane inside its room -> door -> corridor -> door -> lane -> desk.
function routeD(from, to, walk = false) {
  const a = desks.get(from);
  const b = desks.get(to);
  if (!a || !b || a === b) return null;
  const out = walk ? `M${a.sx},${a.sy} H${a.col} V${a.walkLane}` : `M${a.ex},${a.ey} H${a.col} V${a.lane}`;
  const back = walk ? `H${b.col} V${b.sy} H${b.dx + 14}` : `H${b.col} V${b.ey} H${b.ex}`;
  if (a.room === b.room) return `${out} ${back}`;
  return `${out} H${a.door} V${walk ? WALK_Y : CORRIDOR_Y} H${b.door} V${walk ? b.walkLane : b.lane} ${back}`;
}

function buildPlan(members) {
  const rooms = document.getElementById('rooms');
  const layer = document.getElementById('desks');
  rooms.replaceChildren();
  layer.replaceChildren();
  desks = new Map();
  const byRoom = new Map([...BOXES.keys()].map((r) => [r, []]));
  for (const m of members) byRoom.get(department(m.agentType)).push(m);

  for (const [room, [x, y, w, h, side]] of BOXES) {
    const top = side === 'top';
    const door = x + w / 2;
    const edge = top ? y + h : y;
    rooms.append(svgRect(x, y, w, h, `floor-${room.toLowerCase()}`));
    rooms.append(svgPath(`M${door + 20},${edge} H${x + w} V${top ? y : y + h} H${x} V${edge} H${door - 20}`, 'wall'));
    rooms.append(svgText(x + 16, top ? y + 28 : y + h - 16, room, 'room-label'));

    const list = byRoom.get(room);
    const cols = Math.max(1, Math.floor((w - 32 + 12) / PITCH_X));
    const gx = x + (w - (cols * PITCH_X - 12)) / 2;
    // ponytail: a room with more desks than rows spills past its wall; add paging if teams get that big.
    list.forEach((m, i) => {
      const dx = gx + (i % cols) * PITCH_X;
      // Bottom rooms leave 90 units above their desks so a standing walker stays inside the room.
      const dy = (top ? y + 40 : y + 90) + Math.floor(i / cols) * PITCH_Y;
      const g = desk(m, room, dx, dy);
      layer.append(g);
      const lane = top ? y + h - 18 : y + 18;
      const walkLane = top ? lane : y + 80;
      desks.set(m.name, {
        g, room, door, lane, walkLane, dx, dy,
        ex: dx, ey: dy + DESK_H / 2, col: dx - 6,
        sx: dx + SEAT_X, sy: dy + FEET_Y,
      });
    });
  }
  // The two ends of the corridor.
  rooms.append(svgPath(`M0,270 V350 M1000,270 V350`, 'wall'));
}

function desk(m, room, dx, dy) {
  const g = svgEl('g', 'desk idle');
  g.setAttribute('transform', `translate(${dx},${dy})`);
  g.setAttribute('role', 'button');
  g.setAttribute('tabindex', '0');
  g.style.setProperty('--agent', COLOURS.get(m.color) ?? 'var(--ink)');
  g.dataset.name = m.name;
  g.dataset.room = room;
  g.append(
    svgEl('title'),
    svgRect(-4, -4, DESK_W + 8, DESK_H + 8, 'ring'),
    svgRect(0, 0, DESK_W, DESK_H, 'top'),
    svgRect(0, 0, DESK_W, DESK_H, 'pulse'),
    svgRect(0, 0, DESK_W, DESK_H, 'hatch'),
  );
  g.lastChild.setAttribute('fill', 'url(#hatch)');
  g.append(seated(), svgText(10, 84, clipName(m.name), 'name'), svgText(10, 97, '', 'caption'));
  const open = () => openLatest(m.name);
  g.addEventListener('click', open);
  g.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return g;
}

// People are flat side-on silhouettes facing +x, drawn from code per desk so the pose classes
// (.working/.idle/.blocked/.away on the outer g) reach every part. Colour comes from --agent.
function rr(x, y, w, h, r, cls) {
  const e = svgRect(x, y, w, h, cls);
  e.setAttribute('rx', String(r));
  return e;
}

// Each arm has one path per pose, and the pose class shows one of them.
function arm(cls, poses) {
  const a = svgEl('g', `arm ${cls}`);
  for (const [pose, d] of poses) a.append(svgPath(d, `limb pose ${pose}`));
  return a;
}

function seated() {
  const f = svgEl('g', 'figure idle');
  f.setAttribute('aria-hidden', 'true');
  const furniture = svgEl('g', 'furniture');
  furniture.append(
    rr(26, 28, 4, 26, 2, 'kit'), rr(26, 52, 26, 4, 2, 'kit'), svgRect(37, 56, 3, 9, 'kit'), rr(30, 64, 18, 3, 1.5, 'kit'),
    svgRect(62, 44, 66, 4, 'kit'), svgRect(120, 48, 4, 19, 'kit'),
    rr(94, 18, 28, 20, 2, 'kit'), svgRect(106, 38, 4, 6, 'kit'), rr(70, 41, 16, 3, 1, 'key'),
  );
  const person = svgEl('g', 'person');
  const upper = svgEl('g', 'upper');
  const head = svgEl('circle', 'head');
  head.setAttribute('cx', '41');
  head.setAttribute('cy', '18');
  head.setAttribute('r', '7');
  upper.append(
    arm('arm-far', [['type', 'M42,33 L54,43 L70,43'], ['rest', 'M42,33 L45,45 L55,47'], ['hold', 'M42,33 L56,41 L50,23']]),
    rr(33, 26, 15, 27, 6, 'torso'),
    head,
    arm('arm-near', [['type', 'M44,32 L56,42 L74,42'], ['rest', 'M44,32 L47,44 L58,46'], ['hold', 'M44,32 L58,40 L52,22']]),
  );
  person.append(svgPath('M40,52 L58,53 L58,66', 'leg far'), svgPath('M42,52 L62,52 L62,66', 'leg'), upper);
  f.append(furniture, person);
  return f;
}

// A standing person for the walk: feet at (0, 0), facing +x, holding the memo out front.
function standing() {
  const f = svgEl('g', 'figure walking');
  f.setAttribute('aria-hidden', 'true');
  const head = svgEl('circle', 'head');
  head.setAttribute('cy', '-60');
  head.setAttribute('r', '7');
  f.append(
    svgPath('M0,-26 L0,0', 'leg far leg-a'),
    svgPath('M0,-26 L0,0', 'leg leg-b'),
    rr(-7, -52, 14, 27, 6, 'torso'),
    head,
    svgPath('M2,-46 L10,-36 L18,-40', 'limb'),
    svgRect(15, -46, 8, 8, 'memo-sq'),
  );
  return f;
}

function markDesk(name) {
  for (const [n, { g }] of desks) g.classList.toggle('selected', n === name);
}

// A desk opens that agent's most recent memo in the Post room.
function openLatest(name) {
  markDesk(name);
  const rows = document.getElementById('ledger').children;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].dataset.from === name || rows[i].dataset.to === name) {
      rows[i].querySelector('details').open = true;
      rows[i].scrollIntoView({ block: 'nearest' });
      return;
    }
  }
}

function renderPlan(state) {
  const key = JSON.stringify(state.members);
  if (key !== deskKey) { buildPlan(state.members); deskKey = key; }
  const now = Date.now();
  const sent = new Map();
  const pairs = new Map();
  for (const m of state.messages) {
    sent.set(m.from, (sent.get(m.from) ?? 0) + 1);
    if (!desks.has(m.from) || !desks.has(m.to)) continue;
    const k = JSON.stringify([m.from, m.to].sort());
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  const worn = [];
  for (const [k, n] of pairs) {
    const d = routeD(...JSON.parse(k));
    if (!d) continue;
    const p = svgPath(d, 'worn');
    p.setAttribute('stroke-width', String(Math.min(8, 1 + 1.5 * Math.sqrt(n))));
    worn.push(p);
  }
  document.getElementById('worn').replaceChildren(...worn);

  for (const [name, { g, room }] of desks) {
    const ds = deskState(name, state.tasks, state.messages, now);
    const away = walkers.has(name);
    const caption = away ? 'Delivering memo' : ds.caption;
    g.classList.remove('idle', 'active', 'blocked');
    g.classList.add(ds.state);
    g.querySelector('.figure').setAttribute('class', `figure ${away ? 'away' : POSES.get(ds.state)}`);
    g.querySelector('.caption').textContent = clip(caption, 18);
    const n = sent.get(name) ?? 0;
    g.setAttribute('aria-label', `${name}, ${room}, ${caption}, ${n} ${n === 1 ? 'memo' : 'memos'}`);
    g.querySelector('title').textContent = `${name}\n${caption}`;
  }
}

// Memo motion: the sender stands up and walks the memo along the route, the memo stays on the
// recipient's desk for 2 s while that desk pulses, and the sender walks back and sits down.
// At most 3 walk at once; a busy sender queues, and past 3 queued the ledger flash alone carries it.
// Under reduced motion nothing moves: the memo just appears on the desk and the ledger row flashes.
const POSES = new Map([['active', 'working'], ['idle', 'idle'], ['blocked', 'blocked']]);
const queue = [];
const walkers = new Set();
let lastState = null;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const walkMs = (length) => Math.round(Math.min(1800, Math.max(600, (length / 160) * 1000)));

export function enqueue(queue, m, max = 3) {
  if (queue.filter((q) => q.from === m.from).length >= max) return false;
  queue.push(m);
  return true;
}

export function nextWalk(queue, walking, cap = 3) {
  if (walking.size >= cap) return null;
  const i = queue.findIndex((q) => !walking.has(q.from));
  return i < 0 ? null : queue.splice(i, 1)[0];
}

function flash(li) {
  li.classList.add('flash');
  setTimeout(() => li.classList.remove('flash'), 2000);
}

function deliver(m, li) {
  if (still()) {
    flash(li);
    dropMemo(m.to, false);
    return;
  }
  if (!routeD(m.from, m.to) || document.hidden) return;
  if (!enqueue(queue, m)) return flash(li);
  pump();
}

function pump() {
  for (let m; (m = nextWalk(queue, walkers));) walk(m);
}

const refresh = () => lastState && renderPlan(lastState);

function dropMemo(name, pulse) {
  const d = desks.get(name);
  if (!d) return;
  // Left on the desk top, beside the keyboard.
  const memo = svgRect(d.dx + 88, d.dy + 34, 8, 8, 'memo-sq dropped');
  document.getElementById('air').append(memo);
  setTimeout(() => memo.classList.add('gone'), 2000);
  setTimeout(() => memo.remove(), 2200);
  const p = pulse && d.g.querySelector('.pulse');
  if (p) {
    p.classList.remove('on');
    p.getBBox();
    p.classList.add('on');
  }
}

function walk(m) {
  const d = routeD(m.from, m.to, true);
  if (!d) return;
  const air = document.getElementById('air');
  const track = svgPath(d, 'ghost');
  air.append(track);
  const length = track.getTotalLength();
  const ms = walkMs(length);

  walkers.add(m.from);
  const walker = standing();
  walker.style.setProperty('--agent', desks.get(m.from).g.style.getPropertyValue('--agent'));
  air.append(walker);
  refresh();

  // Upright the whole way: the walker faces its direction of travel and keeps facing that way on
  // vertical runs.
  let facing = 1;
  const run = (back, done) => {
    const t0 = performance.now();
    let lastX = null;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const at = track.getPointAtLength((back ? 1 - k : k) * length);
      if (lastX !== null && Math.abs(at.x - lastX) > 0.01) facing = at.x < lastX ? -1 : 1;
      lastX = at.x;
      walker.setAttribute('transform', `translate(${at.x},${at.y}) scale(${facing},1)`);
      if (k < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  };
  run(false, () => {
    walker.querySelector('.memo-sq').remove();
    dropMemo(m.to, true);
    run(true, () => {
      walker.remove();
      track.remove();
      walkers.delete(m.from);
      refresh();
      pump();
    });
  });
}

// Title block
function renderTitle(state) {
  const set = (id, ...nodes) => document.getElementById(id).replaceChildren(...nodes);
  document.getElementById('tb-project').textContent = state.project ?? state.team;

  const git = document.getElementById('tb-git');
  git.classList.toggle('none', !state.git);
  if (!state.git) {
    git.textContent = 'no git';
  } else {
    const { branch, commits, insertions, deletions } = state.git;
    const b = el('span', 'branch', branch);
    b.setAttribute('title', branch);
    const stats = `${commits} ${commits === 1 ? 'commit' : 'commits'}` + (insertions === null ? '' : ` · +${insertions} −${deletions}`);
    git.replaceChildren(b, el('span', 'git-stats', stats));
  }

  const phase = phaseOf(state.tasks);
  document.getElementById('tb-phase').classList.toggle('none', phase < 0);
  const ticks = el('span', 'ticks');
  ticks.setAttribute('aria-hidden', 'true');
  PHASES.forEach((name, i) => {
    const tick = el('span', i < phase ? 'tick done' : i === phase ? 'tick current' : 'tick');
    if (i === phase) tick.setAttribute('aria-current', 'step');
    ticks.append(tick);
  });
  set('tb-phase', document.createTextNode(phase < 0 ? 'Not started' : `${PHASES[phase]}, ${phase + 1} of ${PHASES.length}`), ticks);

  const count = (s) => state.tasks.filter((t) => t.status === s).length;
  const [done, doing, todo] = [count('completed'), count('in_progress'), count('pending')];
  const bar = el('span', 'bar');
  bar.setAttribute('aria-hidden', 'true');
  for (const [cls, n] of [['done', done], ['doing', doing], ['todo', todo]]) {
    const seg = el('span', cls);
    seg.style.setProperty('--n', String(n));
    bar.append(seg);
  }
  set('tb-tasks', bar, el('span', 'counts', `${done} done · ${doing} in progress · ${todo} pending`));

  const last = state.messages.at(-1);
  const lastEl = document.getElementById('tb-last');
  lastEl.classList.toggle('none', !last);
  lastEl.textContent = last ? hhmm(last.ts) : 'No memos yet';
}

// History from the first poll lands without motion; only later messages are carried.
let first = true;
function render(state) {
  document.title = `Team office · ${state.project ?? state.team}`;
  lastState = state;
  renderTitle(state);
  renderPlan(state);
  const fresh = renderLedger(state.messages);
  if (!first) for (const [m, li] of fresh) deliver(m, li);
  first = false;
}

async function poll() {
  const status = document.getElementById('status');
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

if (typeof document !== 'undefined') poll();
