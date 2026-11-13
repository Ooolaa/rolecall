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

// The 3D office. Rooms are the same tiles as before, drawn at T px per tile on an 840 x 600 floor.
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

// After a ledger reset the cursor follows its memo by key, else clamps; -1 when nothing is left.
const memoKey = (m) => JSON.stringify([m.from, m.to, m.ts, m.text]);
export function recursor(prev, next, cursor) {
  if (!next.length) return -1;
  const want = prev[cursor] && memoKey(prev[cursor]);
  const i = want ? next.findIndex((m) => memoKey(m) === want) : -1;
  return i >= 0 ? i : Math.min(cursor, next.length - 1);
}

// Isometric office maths. The plan is a 24 x 16 grid of tiles (i, j); iso() projects a tile point at
// height z to SVG user units (2:1 dimetric, 64 x 32 per tile). The view is the SVG viewBox.
export const iso = (i, j, z = 0) => ({ x: (i - j) * 32, y: (i + j) * 16 - z });

// Draw order: a larger i+j of the front-most tile is nearer the viewer. Walkers sit half a step into
// their tile, and a figure draws before its desk.
export function depthKey({ i, j, kind }) {
  if (kind === 'walker') return Math.floor(i) + Math.floor(j) + 0.5;
  return i + j + (kind === 'desk' ? 0.0005 : 0);
}

export const GRID_W = 24;
export const GRID_H = 16;
// [i0, j0, w, d]. Top rooms (j0 = 0) are open to the corridor; bottom rooms have a 2-tile door.
export const ROOM_TILES = new Map([
  ['Strategy', [0, 0, 7, 6]], ['Lead', [7, 0, 5, 6]], ['Security', [12, 0, 7, 6]], ['Visitors', [19, 0, 5, 6]],
  ['Engineering', [0, 8, 12, 8]], ['Design', [12, 8, 12, 8]],
]);
export const CORRIDOR = [0, 6, 24, 2];
export const isDoor = (i0, w, i) => i === i0 + w / 2 - 1 || i === i0 + w / 2;
const tileKey = (i, j) => `${i},${j}`;

// Walkable tiles (all but desk footprints) and the partition edges between rooms.
export function makeGrid(blocked = []) {
  const walk = new Set();
  for (let i = 0; i < GRID_W; i++) for (let j = 0; j < GRID_H; j++) walk.add(tileKey(i, j));
  for (const t of blocked) walk.delete(tileKey(t.i, t.j));
  const walls = new Set();
  const wall = (a, b) => walls.add(`${a}|${b}`).add(`${b}|${a}`);
  for (const [i0, j0, w, d] of ROOM_TILES.values()) {
    if (i0 > 0) for (let j = j0; j < j0 + d; j++) wall(tileKey(i0 - 1, j), tileKey(i0, j));
    if (j0 > 0) for (let i = i0; i < i0 + w; i++) if (!isDoor(i0, w, i)) wall(tileKey(i, j0 - 1), tileKey(i, j0));
  }
  return { walk, walls };
}

// Shortest walk between two tiles, as the list of tiles from `from` to `to`, or null.
export function route(grid, from, to) {
  const start = tileKey(from.i, from.j);
  const goal = tileKey(to.i, to.j);
  if (!grid.walk.has(start) || !grid.walk.has(goal)) return null;
  const prev = new Map([[start, null]]);
  const todo = [from];
  while (todo.length) {
    const t = todo.shift();
    const k = tileKey(t.i, t.j);
    if (k === goal) {
      const path = [];
      for (let c = k; c !== null; c = prev.get(c)) {
        const [i, j] = c.split(',').map(Number);
        path.unshift({ i, j });
      }
      return path;
    }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { i: t.i + di, j: t.j + dj };
      const nk = tileKey(n.i, n.j);
      if (!grid.walk.has(nk) || prev.has(nk) || grid.walls.has(`${k}|${nk}`)) continue;
      prev.set(nk, k);
      todo.push(n);
    }
  }
  return null;
}

// The view is the viewBox. Zoom z = HOME.w / view.w, kept within [MIN_ZOOM, MAX_ZOOM]; the view's
// centre stays inside the floor box so the office can't be lost off screen.
export const HOME = { x: -544, y: -112, w: 1344, h: 784 };
export const FLOOR = { x0: -512, x1: 768, y0: -64, y1: 640 };
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
const ASPECT = HOME.h / HOME.w;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function clampView(view, box = FLOOR) {
  const cx = Number.isFinite(view.x) ? view.x + view.w / 2 : (box.x0 + box.x1) / 2;
  const cy = Number.isFinite(view.y) ? view.y + view.h / 2 : (box.y0 + box.y1) / 2;
  return { x: clamp(cx, box.x0, box.x1) - view.w / 2, y: clamp(cy, box.y0, box.y1) - view.h / 2, w: view.w, h: view.h };
}

// Zoom about (px, py) in user units by 1.0015^(-deltaY), so the point under the cursor stays put.
export function zoomAt(view, deltaY, px, py) {
  if (![deltaY, px, py].every(Number.isFinite)) return view;
  const w = clamp(view.w * 1.0015 ** clamp(deltaY, -2000, 2000), HOME.w / MAX_ZOOM, HOME.w / MIN_ZOOM);
  const k = w / view.w;
  return clampView({ x: px - (px - view.x) * k, y: py - (py - view.y) * k, w, h: w * ASPECT });
}

const zoomBy = (view, f) => zoomAt(view, -Math.log(f) / Math.log(1.0015), view.x + view.w / 2, view.y + view.h / 2);

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

// The isometric scene. Layers, back to front: floor tiles, worn paths, the selected route and the
// outer walls; then one depth-sorted objects layer (partitions, figures, desks, walkers); then the
// labels and desk tags, which stay on top and keep a constant on-screen size via --z.
const COLOURS = new Map([
  ['blue', '#2F6FDB'], ['green', '#2E8B57'], ['yellow', '#B58900'], ['purple', '#7B4FD6'],
  ['orange', '#D9661F'], ['pink', '#C2417A'], ['cyan', '#0E8A9E'], ['red', '#C93A3A'],
]);
const NS = 'http://www.w3.org/2000/svg';
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// Names keep their tail, because a -2 suffix is what tells agents apart.
const clipName = (s) => (s.length > 16 ? `${s.slice(0, 10)}…${s.slice(-5)}` : s);
const DESK_Z = 18;
const SEATED_DROP = 16; // a seated person sits this much lower, so the desk hides the legs

function svgEl(tag, cls) {
  const e = document.createElementNS(NS, tag);
  if (cls) e.setAttribute('class', cls);
  return e;
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
// A polygon through tile points [i, j, z]; only numbers reach the attribute.
function poly(points, cls) {
  const p = svgEl('polygon', cls);
  p.setAttribute('points', points.map(([i, j, z]) => { const q = iso(i, j, z); return `${q.x},${q.y}`; }).join(' '));
  return p;
}
// The two viewer-facing sides and the top of an iso box, in draw order.
function isoBox(i, j, w, d, h, z0, [left, right, top]) {
  return [
    poly([[i, j + d, z0], [i + w, j + d, z0], [i + w, j + d, z0 + h], [i, j + d, z0 + h]], left),
    poly([[i + w, j, z0], [i + w, j + d, z0], [i + w, j + d, z0 + h], [i + w, j, z0 + h]], right),
    poly([[i, j, z0 + h], [i + w, j, z0 + h], [i + w, j + d, z0 + h], [i, j + d, z0 + h]], top),
  ];
}
const linePath = (pts) => `M${pts.map((p) => `${p.x},${p.y}`).join(' L')}`;

// name -> { g, figure, tag, room, i, j (desk), seat, target, fx, fy }
let desks = new Map();
let deskKey = '';
let grid = makeGrid();
const routes = new Map();

// The tiles a walk from `from`'s seat to beside `to`'s desk takes, cached until the scene rebuilds.
function routeFor(from, to) {
  const a = desks.get(from);
  const b = desks.get(to);
  if (!a || !b || a === b) return null;
  const k = JSON.stringify([from, to]);
  if (!routes.has(k)) routes.set(k, route(grid, a.seat, b.target));
  return routes.get(k);
}
function routeD(from, to) {
  const tiles = routeFor(from, to);
  return tiles && tiles.length > 1 ? linePath(tiles.map((t) => iso(t.i + 0.5, t.j + 0.5))) : null;
}

// A viewer-facing person, feet at (0, 0), 46 tall. No face. Pose classes on the outer g move the
// limbs; colour comes from --agent on an ancestor.
function person(pose) {
  const f = svgEl('g', `figure ${pose}`);
  f.setAttribute('aria-hidden', 'true');
  const limb = (cls, d) => {
    const g = svgEl('g', cls);
    g.append(svgPath(d, cls.startsWith('leg') ? 'leg' : 'limb'));
    return g;
  };
  const shoe = (x) => {
    const r = svgEl('rect', 'shoe');
    r.setAttribute('x', String(x));
    r.setAttribute('y', '-3');
    r.setAttribute('width', '5');
    r.setAttribute('height', '3');
    return r;
  };
  const torso = svgEl('rect', 'torso');
  torso.setAttribute('x', '-6');
  torso.setAttribute('y', '-34');
  torso.setAttribute('width', '12');
  torso.setAttribute('height', '16');
  torso.setAttribute('rx', '4');
  const head = svgEl('g', 'head');
  const skull = svgEl('circle', 'skull');
  skull.setAttribute('cy', '-40');
  skull.setAttribute('r', '6');
  head.append(skull);
  const upper = svgEl('g', 'upper');
  upper.append(limb('arm-l', 'M-6,-32 L-7,-21'), limb('arm-r', 'M6,-32 L7,-21'), torso, head);
  f.append(limb('leg-l', 'M-3,-18 L-3,-3'), limb('leg-r', 'M3,-18 L3,-3'), shoe(-6), shoe(1), upper);
  return f;
}

function deskNode(m, room, di, dj, figure, tag) {
  const g = svgEl('g', 'desk idle');
  g.setAttribute('role', 'button');
  g.setAttribute('tabindex', '0');
  g.style.setProperty('--agent', COLOURS.get(m.color) ?? 'var(--ink)');
  g.dataset.name = m.name;
  const top = [[di, dj, DESK_Z], [di + 2, dj, DESK_Z], [di + 2, dj + 1, DESK_Z], [di, dj + 1, DESK_Z]];
  const hatch = poly(top, 'hatch');
  hatch.setAttribute('fill', 'url(#hatch)');
  const key = iso(di + 1.25, dj + 0.275, DESK_Z + 1);
  const hand = (cls, dx) => {
    const c = svgEl('circle', `hand ${cls}`);
    c.setAttribute('cx', String(key.x + dx));
    c.setAttribute('cy', String(key.y));
    c.setAttribute('r', '2.5');
    return c;
  };
  g.append(
    svgEl('title'),
    ...isoBox(di, dj, 2, 1, DESK_Z, 0, ['face-l', 'face-r', 'top']),
    hatch,
    poly(top, 'pulse'),
    // The monitor stands on the back edge at the left end, so it never hides the person behind the desk.
    ...isoBox(di + 0.1, dj + 0.05, 0.6, 0.1, 16, DESK_Z, ['mon-l', 'mon-r', 'mon']),
    poly([[di + 1, dj + 0.2, DESK_Z], [di + 1.5, dj + 0.2, DESK_Z], [di + 1.5, dj + 0.35, DESK_Z], [di + 1, dj + 0.35, DESK_Z]], 'key'),
    hand('hand-l', -5),
    hand('hand-r', 5),
  );
  const open = () => openLatest(m.name);
  g.addEventListener('click', () => { if (!suppressClick) open(); });
  g.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  g.addEventListener('focus', () => {
    tag.classList.add('focus');
    if (g.matches(':focus-visible')) reveal(iso(di + 1, dj + 0.5)); // keyboard focus only, not a click
  });
  g.addEventListener('blur', () => tag.classList.remove('focus'));
  return g;
}

function buildPlan(members) {
  const tiles = document.getElementById('tiles');
  const outer = document.getElementById('walls');
  const objects = document.getElementById('objects');
  const labels = document.getElementById('labels');
  const tagLayer = document.getElementById('tags');
  for (const layer of [tiles, outer, objects, labels, tagLayer]) layer.replaceChildren();
  desks = new Map();
  routes.clear();

  // Floors: one flat shape per room, and one for the corridor. Depth comes from the wall tones only.
  const floor = (i0, j0, w, d, room) => {
    const g = svgEl('g', `floor floor-${room}`);
    g.setAttribute('aria-hidden', 'true');
    g.append(poly([[i0, j0], [i0 + w, j0], [i0 + w, j0 + d], [i0, j0 + d]], 'tile'));
    tiles.append(g);
  };
  for (const [room, [i0, j0, w, d]] of ROOM_TILES) floor(i0, j0, w, d, room.toLowerCase());
  floor(...CORRIDOR, 'corridor');

  // Outer walls along the back edges: 64 tall with a 4-unit ink cap. Every other wall is a stub.
  const WALL = 64;
  const STUB = 8;
  const face = (pts, cls, h) => [poly(pts(0, h - 4), cls), poly(pts(h - 4, h), 'cap')];
  for (let j = 0; j < GRID_H; j++) outer.append(...face((a, b) => [[0, j, a], [0, j + 1, a], [0, j + 1, b], [0, j, b]], 'wall-l', WALL));
  for (let i = 0; i < GRID_W; i++) outer.append(...face((a, b) => [[i, 0, a], [i + 1, 0, a], [i + 1, 0, b], [i, 0, b]], 'wall-r', WALL));

  // Statics for the objects layer, sorted once by depth.
  const statics = [];
  const add = (node, i, j, kind) => {
    const d = depthKey({ i, j, kind });
    node.dataset.depth = String(d);
    statics.push([d, node]);
  };
  const segment = (pts, cls) => {
    const g = svgEl('g', 'partition');
    g.setAttribute('aria-hidden', 'true');
    g.append(...face(pts, cls, STUB));
    return g;
  };
  const alongJ = (i, j) => (a, b) => [[i, j, a], [i, j + 1, a], [i, j + 1, b], [i, j, b]];
  const alongI = (i, j) => (a, b) => [[i, j, a], [i + 1, j, a], [i + 1, j, b], [i, j, b]];
  for (const [i0, j0, w, d] of ROOM_TILES.values()) {
    if (i0 > 0) for (let j = j0; j < j0 + d; j++) add(segment(alongJ(i0, j), 'wall-l'), i0, j, 'wall');
    if (j0 > 0) {
      for (let i = i0; i < i0 + w; i++) if (!isDoor(i0, w, i)) add(segment(alongI(i, j0), 'wall-r'), i, j0, 'wall');
    }
  }
  // The front stubs along the two viewer-facing edges of the floor close the dollhouse.
  for (let j = 0; j < GRID_H; j++) add(segment(alongJ(GRID_W, j), 'wall-l'), GRID_W, j, 'wall');
  for (let i = 0; i < GRID_W; i++) add(segment(alongI(i, GRID_H), 'wall-r'), i, GRID_H, 'wall');

  // Desks 2 x 1 at (i0 + 1 + 4k, j0 + 2 + 3r), the seat tile behind at j - 1, the person facing +j.
  const byRoom = new Map([...ROOM_TILES.keys()].map((r) => [r, []]));
  for (const m of members) byRoom.get(department(m.agentType)).push(m);
  const footprints = [];
  for (const [room, [i0, j0, w]] of ROOM_TILES) {
    const cols = Math.floor((w - 3) / 4) + 1;
    // ponytail: past capacity (2 rows each: dj 2 and 5 in top rooms, 10 and 13 in bottom rooms) desks spill outside the room; page or shrink if teams get that big.
    byRoom.get(room).forEach((m, n) => {
      const di = i0 + 1 + 4 * (n % cols);
      const dj = j0 + 2 + 3 * Math.floor(n / cols);
      footprints.push({ i: di, j: dj }, { i: di + 1, j: dj });
      const at = iso(di + 0.5, dj - 0.5);
      const seat = svgEl('g', 'seat');
      seat.setAttribute('transform', `translate(${at.x},${at.y + SEATED_DROP})`);
      seat.style.setProperty('--agent', COLOURS.get(m.color) ?? 'var(--ink)');
      const figure = person('idle');
      seat.append(figure);
      const tag = svgEl('g', 'tag');
      tag.setAttribute('transform', `translate(${at.x},${at.y - 36})`);
      const name = svgText(0, 0, clipName(m.name), 'name');
      name.setAttribute('dy', '-1.25em');
      tag.append(name, svgText(0, 0, '', 'caption'));
      tagLayer.append(tag);
      const g = deskNode(m, room, di, dj, figure, tag);
      add(seat, di, dj - 1, 'figure');
      add(g, di + 1, dj, 'desk');
      desks.set(m.name, { g, figure, tag, room, i: di, j: dj, seat: { i: di, j: dj - 1 }, target: null });
    });
  }
  grid = makeGrid(footprints);
  // A walk ends beside the receiver's seat, or the nearest free tile around the desk.
  for (const d of desks.values()) {
    const options = [[d.i + 1, d.j - 1], [d.i - 1, d.j - 1], [d.i - 1, d.j], [d.i + 2, d.j], [d.i, d.j + 1]];
    const free = options.find(([i, j]) => grid.walk.has(tileKey(i, j)));
    d.target = free ? { i: free[0], j: free[1] } : d.seat;
  }
  statics.sort((a, b) => a[0] - b[0]);
  objects.append(...statics.map(([, node]) => node));

  // Room labels sit in each room's left (+j) corner, clear of the desks and their tags.
  for (const [room, [i0, j0, , d]] of ROOM_TILES) {
    const at = iso(i0 + 1.5, j0 + d - 1);
    labels.append(svgText(at.x, at.y, room, 'room-label'));
  }
}

function markDesk(name) {
  for (const [n, { g, tag }] of desks) {
    g.classList.toggle('selected', n === name);
    tag.classList.toggle('selected', n === name);
  }
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
    const k = JSON.stringify([m.from, m.to]);
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

  for (const [name, { g, figure, tag, room }] of desks) {
    const ds = deskState(name, state.tasks, state.messages, now);
    const away = walkers.has(name);
    const caption = away ? 'Delivering memo' : ds.caption;
    const pose = away ? 'away' : POSES.get(ds.state);
    g.classList.remove('idle', 'active', 'blocked');
    g.classList.add(ds.state);
    g.classList.toggle('typing', pose === 'working');
    figure.setAttribute('class', `figure ${pose}`);
    tag.classList.toggle('blocked', ds.state === 'blocked');
    tag.querySelector('.caption').textContent = clip(caption, 22);
    const n = sent.get(name) ?? 0;
    g.setAttribute('aria-label', `${name}, ${room}, ${caption}, ${n} ${n === 1 ? 'memo' : 'memos'}`);
    g.querySelector('title').textContent = `${name}\n${caption}`;
  }
}

// Zoom and pan only ever change the viewBox. The handlers read event numbers and the view, nothing else.
let view = HOME;
let press = null;
let suppressClick = false;
const ARROWS = new Map([['ArrowLeft', [-48, 0]], ['ArrowRight', [48, 0]], ['ArrowUp', [0, -48]], ['ArrowDown', [0, 48]]]);

function setView(v) {
  view = v;
  const svg = document.getElementById('plan');
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  // --z is rendered pixels per SVG unit, so text sized calc(Npx / var(--z)) shows at N px on screen.
  // (HOME.w / v.w is the zoom level, used only for the clamp.)
  const ppu = svg.getBoundingClientRect().width / v.w || 1;
  svg.style.setProperty('--z', String(ppu));
  svg.classList.toggle('far', ppu < 0.5);
}

function toUser(svg, cx, cy) {
  const r = svg.getBoundingClientRect();
  return { x: view.x + ((cx - r.left) * view.w) / r.width, y: view.y + ((cy - r.top) * view.h) / r.height };
}

// Focusing a desk that is off screen pans it into view.
function reveal(p) {
  if (p.x < view.x || p.x > view.x + view.w || p.y < view.y || p.y > view.y + view.h) {
    setView(clampView({ ...view, x: p.x - view.w / 2, y: p.y - view.h / 2 }));
  }
}

function wireView() {
  const svg = document.getElementById('plan');
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toUser(svg, e.clientX, e.clientY);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // line mode (Firefox mouse wheels) to pixels
    setView(zoomAt(view, dy, p.x, p.y));
  }, { passive: false });
  svg.addEventListener('pointerdown', (e) => {
    if (e.button === 0) press = { x: e.clientX, y: e.clientY, start: view, id: e.pointerId, dragging: false };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!e.buttons) return end(e); // the button came up outside the window
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!press.dragging && Math.hypot(dx, dy) < 4) return; // under 4 px is a click
    if (!press.dragging) {
      press.dragging = true;
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('dragging');
    }
    const u = press.start.w / svg.clientWidth;
    setView(clampView({ ...press.start, x: press.start.x - dx * u, y: press.start.y - dy * u }));
  });
  const end = (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (press.dragging) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      svg.classList.remove('dragging');
    }
    press = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') setView(zoomBy(view, 1.25));
    else if (e.key === '-' || e.key === '_') setView(zoomBy(view, 1 / 1.25));
    else if (e.key === '0') setView(HOME);
    else if (ARROWS.has(e.key)) {
      const [dx, dy] = ARROWS.get(e.key);
      setView(clampView({ ...view, x: view.x + dx, y: view.y + dy }));
    } else return;
    e.preventDefault();
  });
  document.getElementById('zoom-in').addEventListener('click', () => setView(zoomBy(view, 1.25)));
  document.getElementById('zoom-out').addEventListener('click', () => setView(zoomBy(view, 1 / 1.25)));
  document.getElementById('zoom-fit').addEventListener('click', () => setView(HOME));
  // Double-clicking the floor fits the office; a desk's double-click is still a click on the desk.
  svg.addEventListener('dblclick', (e) => { if (!e.target.closest('.desk')) setView(HOME); });
  window.addEventListener('resize', () => setView(view)); // keep --z true to the rendered size
  setView(HOME);
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

export const walkMs = (tiles) => Math.min(1800, Math.max(600, tiles * 250));

// A leg faces the way it nets out on screen (+i is screen-right, +j screen-left), once, so a
// staircase route doesn't flicker. A leg with no net sideways motion keeps the previous facing.
export function legFacing(seq, prev) {
  const a = seq[0];
  const b = seq[seq.length - 1];
  const dx = (b.i - a.i) - (b.j - a.j);
  return dx < 0 ? -1 : dx > 0 ? 1 : prev;
}

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
  const tiles = routeFor(m.from, m.to);
  if (!tiles || tiles.length < 2 || document.hidden) return;
  if (!enqueue(queue, m)) return flash(li);
  pump();
}

function pump() {
  for (let m; (m = nextWalk(queue, walkers));) walk(m);
}

const refresh = () => lastState && renderPlan(lastState);

// The memo lies on the receiver's desk top for 2 s, then fades.
function dropMemo(name, pulse) {
  const d = desks.get(name);
  if (!d) return;
  const at = iso(d.i + 0.35, d.j + 0.6, DESK_Z);
  const memo = svgEl('rect', 'memo-sq dropped');
  memo.setAttribute('x', String(at.x - 4));
  memo.setAttribute('y', String(at.y - 4));
  memo.setAttribute('width', '8');
  memo.setAttribute('height', '8');
  d.g.append(memo);
  setTimeout(() => memo.classList.add('gone'), 2000);
  setTimeout(() => memo.remove(), 2200);
  const p = pulse && d.g.querySelector('.pulse');
  if (p) {
    p.classList.remove('on');
    p.getBBox();
    p.classList.add('on');
  }
}

// Re-insert a walker before the first object nearer the viewer, so walls and desks overlap it right.
function placeByDepth(layer, node, depth) {
  node.dataset.depth = String(depth);
  for (const other of layer.children) {
    if (other !== node && Number(other.dataset.depth) > depth) return layer.insertBefore(node, other);
  }
  layer.append(node);
}

function walk(m) {
  const tiles = routeFor(m.from, m.to);
  if (!tiles || tiles.length < 2) return;
  const objects = document.getElementById('objects');
  const ms = walkMs(tiles.length - 1);
  walkers.add(m.from);
  const node = svgEl('g', 'walker');
  node.style.setProperty('--agent', desks.get(m.from).g.style.getPropertyValue('--agent'));
  const body = person('walking');
  const memo = svgEl('rect', 'memo-sq');
  memo.setAttribute('x', '-4');
  memo.setAttribute('y', '-30');
  memo.setAttribute('width', '8');
  memo.setAttribute('height', '8');
  body.append(memo);
  node.append(body);
  refresh();

  let depth = null;
  let facing = 1;
  // Tile centre to tile centre at a steady pace. The one viewer-facing sprite mirrors once per leg.
  const run = (seq, done) => {
    const n = seq.length - 1;
    const t0 = performance.now();
    facing = legFacing(seq, facing);
    const step = (now) => {
      // The first frame's timestamp can predate t0, so clamp below as well.
      const k = clamp((now - t0) / ms, 0, 1);
      const s = Math.min(n - 1, Math.floor(k * n));
      const f = k * n - s;
      const a = seq[s];
      const b = seq[s + 1];
      const i = a.i + (b.i - a.i) * f + 0.5;
      const j = a.j + (b.j - a.j) * f + 0.5;
      const at = iso(i, j);
      node.setAttribute('transform', `translate(${at.x},${at.y}) scale(${facing},1)`);
      const dk = depthKey({ i, j, kind: 'walker' });
      if (dk !== depth) { depth = dk; placeByDepth(objects, node, dk); }
      if (k < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  };
  run(tiles, () => {
    memo.remove();
    dropMemo(m.to, true);
    run([...tiles].reverse(), () => {
      node.remove();
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

if (typeof document !== 'undefined') {
  wireView();
  poll();
}
