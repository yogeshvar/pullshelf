import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import * as pty from 'node-pty'
import { presetLabel, type PresetId, type PtySnapshot, type Settings, type ToolStatus } from '../src/shared/types'
import { emit } from './bus'

const SCROLLBACK_LIMIT = 200_000

let proc: pty.IPty | null = null
let generation = 0
let buffer = ''
let rev = 0
let cols = 100
let rows = 28
let status: ToolStatus = {
  running: false,
  presetId: 'claude',
  label: 'Claude Code',
  cwd: homedir(),
  error: null,
  exitCode: null
}

export function toolStatus(): ToolStatus {
  return status
}

export function isRunning(): boolean {
  return proc !== null
}

export function snapshot(): PtySnapshot {
  return { buffer, rev }
}

export function resize(nextCols: number, nextRows: number): void {
  cols = clampDim(nextCols, cols)
  rows = clampDim(nextRows, rows)
  try {
    proc?.resize(cols, rows)
  } catch {
    // The process can exit between the check and the resize.
  }
}

export function write(data: string): void {
  if (!data || data.length > 200_000) return
  try {
    proc?.write(data)
  } catch {
    // Ignore writes after the process has gone away.
  }
}

export function sendText(text: string): { ok: boolean; error?: string } {
  if (!proc) return { ok: false, error: 'Nothing is running in the tool pane.' }
  const payload = text.replace(/\u0000/g, '').slice(0, 200_000)
  if (!payload) return { ok: false, error: 'Nothing to send.' }
  const safe = payload.replaceAll('\u001b[201~', '')
  try {
    proc.write(`\u001b[200~${safe}\u001b[201~`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'The tool is no longer running.' }
  }
}

export async function start(settings: Settings): Promise<void> {
  const gen = ++generation
  stopProcess()
  buffer = ''
  rev = 0
  emit('pty:reset')
  status = {
    running: false,
    presetId: settings.presetId,
    label: presetLabel(settings.presetId),
    cwd: settings.cwd,
    error: null,
    exitCode: null
  }
  publishStatus()

  let spec: Resolved
  try {
    spec = await resolveCommand(settings)
  } catch (error) {
    if (gen !== generation) return
    // resolveCommand only throws Errors it creates itself.
    status = { ...status, error: (error as Error).message }
    publishStatus()
    return
  }
  if (gen !== generation) return

  try {
    const child = pty.spawn(spec.command, spec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: settings.cwd,
      env: spec.env
    })
    if (gen !== generation) {
      child.kill()
      return
    }
    proc = child
    status = { ...status, running: true, error: null, exitCode: null }
    publishStatus()
    child.onData((chunk) => {
      if (proc !== child) return
      buffer = (buffer + chunk).slice(-SCROLLBACK_LIMIT)
      rev += 1
      emit('pty:data', { rev, chunk })
    })
    child.onExit(({ exitCode }) => {
      if (proc === child) proc = null
      if (gen !== generation) return
      status = { ...status, running: false, exitCode: exitCode ?? null }
      publishStatus()
      emit('pty:exit', { exitCode: exitCode ?? null })
    })
  } catch (error) {
    status = {
      ...status,
      running: false,
      error: error instanceof Error ? error.message : 'Could not start the tool.'
    }
    publishStatus()
  }
}

export function stop(): void {
  generation += 1
  stopProcess()
  status = { ...status, running: false }
  publishStatus()
}

function stopProcess(): void {
  const current = proc
  proc = null
  if (!current) return
  try {
    current.kill()
  } catch {
    // Already gone.
  }
}

function publishStatus(): void {
  emit('tool:status', status)
}

type Resolved = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

async function resolveCommand(settings: Settings): Promise<Resolved> {
  const shell = userShell()
  const env = await userEnv(shell)
  if (settings.presetId === 'shell') {
    return { command: shell, args: ['-l'], env }
  }
  if (settings.presetId === 'custom') {
    const command = settings.customCommand.trim()
    if (!command) {
      throw new Error('Enter a command to run.')
    }
    return { command: shell, args: ['-ilc', command], env }
  }
  const bin = settings.presetId === 'codex' ? 'codex' : 'claude'
  const found = await which(shell, bin, env)
  if (!found) {
    throw new Error(`Couldn't find ${bin}. Install it, then start the tool again.`)
  }
  return { command: found, args: [], env }
}

function userShell(): string {
  const shell = process.env.SHELL
  if (shell && shell.startsWith('/')) return shell
  return '/bin/zsh'
}

async function userEnv(shell: string): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Pullshelf',
    PULLSHELF: '1'
  }
  // Rc files that export TERM=xterm-kitty override ours; let that name resolve.
  const kittyInfo = '/Applications/kitty.app/Contents/Resources/terminfo'
  if (existsSync(kittyInfo)) {
    env.TERMINFO_DIRS = [env.TERMINFO_DIRS, kittyInfo].filter(Boolean).join(':')
  }
  try {
    const output = await run(shell, ['-ilc', String.raw`printf '\n__PULLSHELF_PATH__%s__PULLSHELF_PATH__\n' "$PATH"`])
    const match = output.match(/__PULLSHELF_PATH__(.*)__PULLSHELF_PATH__/)
    if (match?.[1]?.includes('/')) env.PATH = match[1]
  } catch {
    // Keep the environment Electron was launched with.
  }
  return env
}

async function which(shell: string, bin: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const output = await run(
      shell,
      ['-ilc', String.raw`printf '\n__PULLSHELF_BIN__%s__PULLSHELF_BIN__\n' "$(command -v ${bin})"`],
      env
    )
    const match = output.match(/__PULLSHELF_BIN__(.*)__PULLSHELF_BIN__/)
    const found = match?.[1]?.trim()
    return found && found.startsWith('/') ? found : null
  } catch {
    return null
  }
}

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 8000, env, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

function clampDim(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(2, Math.min(500, Math.round(value)))
}

export function presetCommandName(id: PresetId): string {
  return presetLabel(id)
}
