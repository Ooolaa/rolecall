// Writes a hostile Team into <dir> for the browser checks (A7c, S2, S3). Not a test file.
//
//   node viz/xss.fixture.mjs <dir>            write the fixture, print the serve command
//   node viz/xss.fixture.mjs <dir> --append   add one new message (for S3)
//
// Playwright steps (Gatekeeper-2):
//   1. CLAUDE_CONFIG_DIR=<dir> PORT=4748 node viz/server.mjs xss
//   2. browser_navigate http://127.0.0.1:4748 and wait 3 s (one poll is 2 s).
//   3. A7c: browser_evaluate
//        () => ({ pwned: window.__pwned, imgs: document.querySelectorAll('img').length,
//                 scripts: [...document.scripts].filter((s) => !s.src.endsWith('/app.js')).length,
//                 literal: document.body.innerText.includes('<img src=x onerror="window.__pwned=1">') })
//      Pass: { pwned: undefined, imgs: 0, scripts: 0, literal: true }.
//      Also check the browser console for no CSP violations from the page's own code.
//   4. S3: run `node viz/xss.fixture.mjs <dir> --append`, then within 5 s
//        () => document.body.innerText.includes('S3-PING')   must be true.
//   5. S2, against the live team: `node viz/server.mjs` (port 4747), navigate, and check that
//      members, tasks and a team-lead -> Skeptic message render.
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const IMG = '<img src=x onerror="window.__pwned=1">';
const CWD = '/"><script>window.__pwned=1</script>';
const SID = '99999999-9999-4999-8999-999999999999';
const CREATED = Date.parse('2026-01-01T00:00:00Z');

const [dir, flag] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node viz/xss.fixture.mjs <dir> [--append]');
  process.exit(1);
}
const transcript = join(dir, 'projects', CWD.replace(/[^A-Za-z0-9]/g, '-'), `${SID}.jsonl`);
const send = (ts, to, message, summary) => JSON.stringify({
  type: 'assistant', timestamp: ts,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'SendMessage', input: { to, message, summary } }] },
}) + '\n';

if (flag === '--append') {
  await appendFile(transcript, send(new Date().toISOString(), IMG, 'S3-PING arrived', 'S3-PING'));
  console.log('appended S3-PING');
} else {
  const put = async (path, body) => {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, body);
  };
  await put(join(dir, 'teams', 'xss', 'config.json'), JSON.stringify({
    name: 'xss', createdAt: CREATED, leadSessionId: SID,
    members: [
      { name: 'team-lead', agentType: 'team-lead', cwd: CWD },
      { name: IMG, agentType: 'team-builder', color: 'red" onerror="window.__pwned=1' },
      { name: 'Skeptic', agentType: 'team-skeptic', color: 'blue' },
    ],
  }));
  await put(join(dir, 'tasks', 'xss', '1.json'), JSON.stringify({ id: '1', subject: IMG, status: 'in_progress', owner: IMG, blockedBy: [] }));
  await put(join(dir, 'tasks', 'xss', '2.json'), JSON.stringify({ id: '2', subject: `Build: ${IMG}`, status: 'pending', owner: 'Skeptic', blockedBy: ['1'] }));
  await put(transcript, send(new Date().toISOString(), IMG, IMG, IMG) + send(new Date().toISOString(), 'Skeptic', 'plain hello', 'hello'));
  console.log(`CLAUDE_CONFIG_DIR=${dir} PORT=4748 node viz/server.mjs xss`);
}
