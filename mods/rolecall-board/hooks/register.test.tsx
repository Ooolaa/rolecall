import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'rolecall-board',
  component: 'Pane',
  requestId: 'rolecall-board',
  props: {
    title: 'Rolecall',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const
const TOOL = 'mcp__rolecall-board__rolecall_status'

test('status updates merge by name and reset starts over', async ($, on) => {
  on('command.register', () => ({ value: { command: 'rolecall' } }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: TOOL,
    reset: true,
    task: 'Demo',
    phase: 1,
    members: [{ name: 'Builder', status: 'idle' }],
  } as never)
  await $.tool.call({
    tool: TOOL,
    phase: 4,
    members: [{ name: 'Builder', status: 'working', note: 'task 2/3' }],
    gates: { tests: 'pass' },
  } as never)

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /4 Build/ }))?.text).toBe('► 4 Build')
  expect((await ui.find({ type: 'Text', text: /Builder/ }))?.text).toMatch(/^● Builder +task 2\/3$/)
  expect((await ui.find({ type: 'Text', text: /tests/ }))?.text).toMatch(/pass/)
  await ui.unmount()

  await $.tool.call({ tool: TOOL, reset: true, task: 'Next', phase: 1 } as never)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Builder/ })).toBeUndefined()
  await ui.unmount()
})

test('a failing gate is never green', async ($, on) => {
  on('command.register', () => ({ value: { command: 'rolecall' } }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: TOOL,
    reset: true,
    phase: 5,
    gates: { build: 'broken', tests: '0/3 passed', lint: 'pass', codex: 'skipped' },
  } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const color = async (k: string) =>
    (await ui.find({ type: 'Text', text: new RegExp(`^${k} `) }))?.props.color
  expect(await color('build')).toBe('red')
  expect(await color('tests')).not.toBe('green')
  expect(await color('lint')).toBe('green')
  expect(await color('codex')).toBeUndefined()
  await ui.unmount()
})

test('empty board says so', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No /dev-team run yet.')
  await ui.unmount()
})
