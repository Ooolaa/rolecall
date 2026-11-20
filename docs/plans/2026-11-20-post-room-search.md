# Post room search: filter memos by text and Role, URL in sync

Starting commit: 1e90bcb. Baseline is 122 tests: 121 pass, 1 todo (A9 waiver).
Fast loop: `node --test viz/server.test.mjs` and `node --check viz/app.js`.

## Design

There's a search box and a Role picker above `<ol id="ledger">` in the Post room. They hide memo rows that don't match, client side. The state is mirrored in `?q=&role=` so a filtered view can be shared. There are no new dependencies and no new files. The server must also serve `/` when there's a query string, which it doesn't today (Task 0).

- **Role** = the member's agentType with a leading `team-` removed (`team-skeptic` → `skeptic`, `team-lead` → `lead`, `weird` → `weird`). An empty agentType has no Role. A memo matches `role` if its sender OR its recipient has that Role. The lookup goes name → member → Role through one `Map`, never a plain object keyed by input (AC5).
- **Text** = a case-insensitive literal substring (`toLowerCase().includes`) over `text`, `summary`, `from` and `to`. Never a RegExp (AC2). Empty `q` matches everything.
- **Unknown or empty role** = all memos (the user's decision). This covers `?role=nope`, `?role=__proto__`, and a Role no current member has. The raw `?role` value is kept in state, so it applies if a member with that Role joins later. `q` is clamped to 200 chars on read and on input (AC3).
- **Hide, don't rebuild.** Rows stay in the list and only `li.hidden` changes. The replay reads rows by position (`showStep`, app.js:454-468), so the cursor, `.cur`/`.later` and scroll keep working. The filter runs at the end of `renderLedger`, so rows that arrive by polling are filtered too. The office scene, scrub bar, memo counter and phase stay unfiltered.
- **Scroll guard.** If the cursor sits on a hidden row, `showStep` doesn't scroll. A hidden row has `offsetTop` 0, which would jump the list to the top.
- **URL.** On load, the URL is never rewritten (no replaceState until the user edits), so a shared `?role=x` stays as sent. It's read once on load with `URLSearchParams.get` (the first value wins, AC8). It's written on every edit with `history.replaceState(null, '', …)`, using the existing search with `q` and `role` set or deleted, and never by string concatenation (AC7). When both are empty, the written URL is `location.pathname`. No pushState.
- **UI** uses only existing app.css tokens: `<div class="filter" role="search">` with a visible `<label>` + `<input type="search" id="f-q" maxlength="200" autocomplete="off">` and a `<label>` + `<select id="f-role">`. The first option is `All roles` (value `''`), then the Roles present in `snapshot.members`, sorted. The options are rebuilt only when the members change (the existing `layKey` branch in `render`). Option text goes in through `textContent` (via `el()`) and the value through the `.value` property (AC4, AC6). There's also `<p id="no-match" class="muted empty" role="status" hidden>No matching memos</p>`, shown when there are memos and all are hidden. Escape needs no handler: `type=search` clears natively in Chromium and Safari.

New exports in app.js. There are three because each holds an abuse case that needs a unit test:
- `filterRows(messages, members, { q, role })` returns `boolean[]` (visible per message).
- `parseFilter(search)` returns `{ q, role }` (strings; q clamped to 200).
- `filterQuery(search, { q, role })` returns a query string without `?` (other params kept, empty ones dropped).
Keep `parseFilter` and `filterQuery` to about 3 lines each, as thin URLSearchParams wrappers.

Out of scope: server-side filtering, regex/fuzzy, match highlighting, filtering the scene or scrub, debounce, back-button history, keyboard shortcuts, persisting beyond the URL.

## File ownership

| Who | Files |
|---|---|
| Builder | `viz/server.mjs` (Task 0 only), `viz/app.js`, `viz/index.html`, `viz/app.css`, `viz/server.test.mjs`, `viz/xss.fixture.mjs` |
| Gatekeeper | `README.md` (the Post room paragraph, line 126-128), runs tests and the Playwright steps |
| Planner | this plan |

## Tasks

Every test is written first and seen failing (red) before the logic it guards.

### 0. Serve the page when a query string is present (blocker: shared links 404 today)
`viz/server.mjs:222` looks up `STATIC.get(req.url)` using the raw URL, so `/?q=x` returns 404.
- **Files:** `viz/server.test.mjs`, then `viz/server.mjs` (the `createServer` handler).
- **Tests (red first):**
  - `GET /?q=x&role=skeptic` and `GET /?q=` + encodeURIComponent('<img src=x onerror=1>') return 200 text/html, and the body is byte-identical to `GET /` (the query is not reflected). The `/?q=x` response carries the CSP and nosniff headers (A7).
  - `GET /app.js?v=1` returns 200 JS. `GET /api/state?q=1` returns 200 with the readTeam JSON. `GET /api/state?x=1` with a bad Host header is still refused with 403, as it is today without the query.
  - A6 regression: add `/%2e%2e/server.mjs` to the A6 list, and run every A6 path both as-is and with `?q=1` appended (e.g. `/..%2fpackage.json?q=1`, `//etc/passwd?q=1`). All return 404. `/server.mjs?x=1` returns 404.
- **Change:** `const path = req.url.split('?')[0];` inside the existing `try`. Use `path` for both the `/api/state` check and `STATIC.get`. This is a plain split, not `new URL(...).pathname`: URL normalises dot segments and `//host/…`, so `/x/../server.mjs` or `//evil/app.js` would hit the STATIC map. The split leaves the A6 behaviour exactly as it is and can't throw. The Host, Origin and method checks are unchanged, and STATIC stays an exact-match whitelist.
- **Done when:** the new tests and A1-A7 are green.

### 1. Ban RegExp construction in app.js (AC2)
- **Files:** `viz/server.test.mjs` (A7 test, line 383).
- **Test:** add `'RegExp('` to the banned list in the A7 test.
- **Done when:** A7 still passes (app.js has no `RegExp(` today) and the full fast loop is green.

### 2. `filterRows` abuse and behaviour tests, then `filterRows` (AC2, AC3, AC5, AC8, AC9)
- **Files:** `viz/server.test.mjs` (new tests after the ledgerUpdate test, same `await import('./app.js')` pattern), then `viz/app.js` (pure section, above the "DOM from here down" line).
- **Tests (red first):**
  - Behaviour: q is case-insensitive over text/summary/from/to. `role: 'skeptic'` matches a memo whose sender is the team-skeptic member, and one whose recipient is. `role: 'lead'` matches team-lead memos. q and role together AND. Empty `{q:'', role:''}` gives all `true`.
  - AC2: `q: '.*'` matches only text containing `.*`. `q: '['`, `q: '('`, `q: '\\'` and `q: '(a+)+$'` don't throw and match only text that literally contains them. This catches any `.match`/`.search`/`.split`/`.replace` path that turns q into a regex. `'(a+)+$'` against a 50,000-char `'a…a!'` text returns `false`. No timing bounds.
  - AC3: a 100,000-char q doesn't throw and returns all `false` for normal memos.
  - AC4/AC5 (unknown role = all): for each of `'nope'`, `'__proto__'`, `'constructor'`, `'toString'` and `'hasOwnProperty'`, the role gives the same result as `role: ''` and doesn't throw. Afterwards `({}).polluted === undefined` and `Object.getOwnPropertyNames(Object.prototype)` is unchanged. `q: '__proto__'` is a literal substring. `q: 'constructor'` with `role: ''` against a memo whose fields don't contain "constructor" gives `false`.
  - Lookup edges: a memo whose sender or recipient name is missing from members matches no Role on that end (no fallback). Two members sharing one agentType both match that Role.
  - AC6 (data side): a member with agentType `'__proto__'` has Role `'__proto__'` and matches its own memos. It doesn't throw.
  - AC8: empty q and role never mean "match nothing".
  - AC9: a memo with `summary` undefined, `text: ''` and unknown from/to doesn't throw. It matches q only via from/to/text/summary content. With a known role it is `false`.
- **Done when:** the tests are red, then green after `filterRows` (about 10 lines: a Set of present Roles, a Map name→Role, `role = present.has(role) ? role : ''`, then lowercase includes).

### 3. URL helper tests, then `parseFilter` and `filterQuery` (AC3, AC7, AC8)
- **Files:** `viz/server.test.mjs`, then `viz/app.js` (pure section).
- **Tests (red first):**
  - AC7: `new URLSearchParams(filterQuery('', { q: 'a&role=x#y', role: '' }))` gives `.get('q') === 'a&role=x#y'` and `.get('role') === null`. `filterQuery('?x=1&q=old', { q: '', role: 'skeptic' })` keeps `x=1`, drops q and sets role. Both empty from `''` gives `''`.
  - AC8: `parseFilter('?role=a&role=b').role === 'a'`. `parseFilter('')` gives `{ q: '', role: '' }`.
  - AC3: `parseFilter('?q=' + 'x'.repeat(100000)).q.length === 200`, and `filterQuery` of that stays bounded.
  - AC1 (data side): `parseFilter('?q=' + encodeURIComponent(IMG)).q === IMG`, where IMG is the literal string.
- **Done when:** red, then green after both helpers (URLSearchParams only).

### 4. Browser abuse checks in the XSS fixture (AC1, AC4, AC6)
- **Files:** `viz/xss.fixture.mjs`. Add two NEW members: `{ name: 'Proto', agentType: '__proto__' }` and `{ name: 'Hostile', agentType: IMG }`. Leave the existing members untouched, so steps 3-5 render as before. Add steps 6-8 to the header comment.
- **Test (Playwright steps, written now, run by Gatekeeper after Task 5. Before Task 5 they fail because there's no `#f-q`):**
  - 6 (AC1): navigate `/?q=` + encodeURIComponent(IMG), wait 3 s. Evaluate `{ pwned: window.__pwned, imgs: document.querySelectorAll('img').length, value: document.getElementById('f-q').value }`. Pass: `{ pwned: undefined, imgs: 0, value: IMG }`.
  - 7 (AC4): navigate `/?role=` + encodeURIComponent(IMG + 'x'). Pass: no option's `value` or `textContent` equals `IMG + 'x'`, `#f-role` value is `''`, and no `.memo` is hidden.
  - 8 (AC6): on `/`, `[...document.getElementById('f-role').options].map((o) => o.textContent)` includes the literal IMG and `'__proto__'`, `imgs === 0`, and `pwned` is undefined.
- **Done when:** the steps are in the header and `node viz/xss.fixture.mjs <tmp>` still writes the fixture. Existing steps 3-5 are unaffected (re-run in Task 7).

### 5. Wire the controls
- **Files:** `viz/index.html`, `viz/app.js` (DOM section), `viz/app.css`.
- **What:**
  - Markup: inside `.post`, between `.post-head` and `#ledger`, add the `.filter` block (see Design). After `#empty`, add `#no-match`.
  - app.js: a module `filter = parseFilter(location.search)` read once at start-up, which fills `#f-q.value`. `applyFilter()` runs `filterRows(rendered, snapshot.members, filter)` and sets `li.hidden` per row (rows and messages share an index). It shows `#no-match` when `rendered.length && every hidden`. Call it at the end of `renderLedger` and on every edit. In `render`'s `layKey` branch, rebuild the `#f-role` options with `el('option', null, role)` + `.value = role`, then set `select.value = present ? filter.role : ''`. On `input` (q, sliced to 200) or `change` (role): update `filter`, `applyFilter()`, then `history.replaceState(null, '', s ? '?' + s : location.pathname)` with `s = filterQuery(location.search, filter)`. Nothing uses innerHTML or a non-literal setAttribute.
  - app.css: `.filter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-bottom: 8px; }`. The labels use `font-size: 12px; color: var(--muted)`. The input and select get `min-height: 44px` and use `var(--surface)` background, `var(--ink)` text and a `1px solid var(--rule)` border. The input gets `flex: 1 1 140px`. Focus-visible gets `2px solid var(--ink)`, as `.memo summary` already does. `.memo` sets no display, so the native `[hidden]` already hides rows and no CSS rule is needed. `#no-match` reuses `.empty`.
- **Test:** the fast loop is green, including A7. `node --check viz/app.js` passes. Gatekeeper runs Playwright steps 6-8 and they pass.
- **Done when:** loading `/?q=foo&role=skeptic` pre-fills both controls and shows only matching rows. Typing updates the URL with no new history entry. Clearing both gives a clean `/`. Opening a shared link leaves its URL as sent.

### 6. Scroll guard for a hidden cursor row
- **Files:** `viz/app.js` (`showStep`, line ~463): `if (r && key !== shown)` becomes `if (r && !r.hidden && key !== shown)`.
- **Test:** a manual or Playwright check (there's no DOM unit harness). Filter so the newest memo is hidden, scroll the Post room partway, then scrub onto the hidden memo. The scroll doesn't move. Clearing the filter scrolls back to the cursor row.
- **Done when:** the check passes and the fast loop is green.

### 7. Docs and final checks
- **Files:** `README.md` (Gatekeeper). Add one sentence after the Post room description: the search box and Role picker filter the Post room, the filter lives in `?q=&role=` so it can be shared.
- **Test:** the full fast loop. Playwright steps 3-8 against the xss fixture. Step 5 (S2) against a live team, with a filter active: a new memo arriving by poll respects the filter, and `.cur`/`.later` still move.
- **Done when:** all of the above pass, the diff touches only the files in the ownership table, and there are no new dependencies.

## Abuse case to test map

| AC | Test | Task |
|---|---|---|
| AC1 XSS via q | parseFilter literal (unit) + Playwright step 6 | 3, 4 |
| AC2 regex/ReDoS | A7 `RegExp(` ban + filterRows timing/literal | 1, 2 |
| AC3 huge q | filterRows 100k + parseFilter clamp | 2, 3 |
| AC4 unknown role | filterRows (= all) + Playwright step 7 | 2, 4 |
| AC5 prototype keys | filterRows proto roles + prototype untouched | 2 |
| AC6 hostile member data | filterRows `__proto__` Role + Playwright step 8 | 2, 4 |
| AC7 param injection | filterQuery round-trip | 3 |
| AC8 duplicate/empty params | parseFilter first-wins + empty = all | 2, 3 |
| AC9 missing fields | filterRows with undefined summary | 2 |
| Shared link (query string 404) | GET /?q=… serves index.html unreflected with CSP; A6 paths ± `?q=1` still 404 | 0 |

Deviation from the Threat Modeler: in AC4/AC5, unknown Roles give "all rows" rather than `[]`, per the user's decision. The safety assertions (no throw, prototype untouched, no option built from `?role`) are unchanged.
