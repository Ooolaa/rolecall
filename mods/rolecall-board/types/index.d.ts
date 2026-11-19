export type MemberStatus = 'idle' | 'working' | 'done' | 'blocked'
export type Member = { name: string; status: MemberStatus; note?: string }
export type Board = {
  task: string
  phase: number
  members: Member[]
  gates: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    'rolecall-board': { board: Shaped<Board> }
  }
}
