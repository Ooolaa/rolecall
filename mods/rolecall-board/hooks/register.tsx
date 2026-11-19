import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Board, Member } from '../types'

const PANE = 'rolecall-board'
const TOOL = /^mcp__rolecall-board__rolecall_status$/
const PHASES = ['Discuss', 'Ask', 'Plan', 'Build', 'Review', 'Wrap up']
const GLYPH = { idle: '○', working: '●', done: '✓', blocked: '✗' } as const
const COLOR = { idle: undefined, working: 'yellow', done: 'green', blocked: 'red' } as const

const empty: Board = { task: '', phase: 0, members: [], gates: {} }
const board = atom({ plugin: 'rolecall-board', key: 'board' } as const, empty, {
  shape: 'board-1',
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rolecall',
      description: 'Show the /dev-team progress pane',
    })
    await $.tool.register({
      name: 'rolecall_status',
      isDeferred: false,
      description:
        'Update the Rolecall (/dev-team) progress pane. Call it when the team starts, at every phase change, and when a teammate or gate changes state. Members and gates merge by name; pass reset:true to start a new run.',
      inputSchema: {
        type: 'object',
        properties: {
          reset: { type: 'boolean' },
          task: { type: 'string' },
          phase: { type: 'integer', minimum: 1, maximum: 6, description: '1 Discuss, 2 Ask, 3 Plan, 4 Build, 5 Review, 6 Wrap up' },
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                status: { enum: ['idle', 'working', 'done', 'blocked'] },
                note: { type: 'string', description: 'max ~30 chars' },
              },
              required: ['name', 'status'],
            },
          },
          gates: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'e.g. {"security":"pass","tests":"3/3","codex":"2 findings"}',
          },
        },
      },
    })

    return next(e)
  })

  on('command.run', { command: 'rolecall' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Rolecall' })

    return { text: 'Rolecall pane opened.' }
  })

  on('tool.run', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as Partial<Board> & { reset?: boolean }
    await update($, board, prev => {
      const base = input.reset ? empty : prev
      const members = [...base.members]
      for (const m of (input.members ?? []) as Member[]) {
        const i = members.findIndex(x => x.name === m.name)
        if (i >= 0) members[i] = { ...members[i], ...m }
        else members.push(m)
      }

      return {
        task: input.task ?? base.task,
        phase: input.phase ?? base.phase,
        members,
        gates: { ...base.gates, ...(input.gates ?? {}) },
      }
    })
    void $.ui.open({ id: PANE, title: 'Rolecall' })

    return { result: 'Rolecall pane updated.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const b = await read($, board)
    if (!b.phase) return <Text dimColor>No /dev-team run yet.</Text>

    return (
      <Box flexDirection="column">
        <Text bold>{b.task.slice(0, 60)}</Text>
        <Text> </Text>
        {PHASES.map((p, i) => {
          const n = i + 1
          const glyph = n < b.phase ? '✓' : n === b.phase ? '►' : '○'

          return (
            <Text color={n === b.phase ? 'cyan' : n < b.phase ? 'green' : undefined} dimColor={n > b.phase}>
              {glyph} {n} {p}
            </Text>
          )
        })}
        <Text> </Text>
        <Text bold>Team</Text>
        {b.members.map(m => (
          <Text color={COLOR[m.status]} dimColor={m.status === 'idle'}>
            {GLYPH[m.status]} {m.name.padEnd(17)} {m.note ?? ''}
          </Text>
        ))}
        {Object.keys(b.gates).length > 0 && <Text> </Text>}
        {Object.keys(b.gates).length > 0 && <Text bold>Gates</Text>}
        {Object.entries(b.gates).map(([k, v]) => (
          <Text color={/fail|open|broken|blocked|🔴/i.test(v) ? 'red' : /^(pass|ok|✓)/i.test(v) ? 'green' : undefined}>
            {k.padEnd(10)} {v}
          </Text>
        ))}
      </Box>
    )
  })
}
