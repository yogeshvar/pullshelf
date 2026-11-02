import { existsSync } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'

export type CocoaFrame = { x: number; y: number; width: number; height: number }

type Listener = {
  onDrag: (frame: CocoaFrame, delta: number, live: boolean) => void
  onRelease: () => void
  onTrust: (trusted: boolean) => void
}

let child: ChildProcessWithoutNullStreams | null = null
let trusted = false
let restarts = 0
let retryTimer: NodeJS.Timeout | null = null
let savedListener: Listener | null = null

// A crashing helper is retried after 1, 2, 4, 8 and 16 seconds, then left off until restartGesture().
const MAX_RESTARTS = 5
// A helper that stayed up this long was healthy: its crash starts a fresh round of retries.
const STABLE_MS = 60_000

export function gestureTrusted(): boolean {
  return trusted
}

/** Whether a helper process is currently running (false while waiting to retry, or after giving up). */
export function gestureRunning(): boolean {
  return child !== null
}

export function startGesture(listener: Listener): void {
  savedListener = listener
  const binary = helperPath()
  if (!binary) {
    console.error('Gesture helper is missing. Run npm run compile:gesture.')
    return
  }
  let proc: ChildProcessWithoutNullStreams
  try {
    proc = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    console.error('[gesture] helper failed:', (error as Error).message)
    scheduleRestart(listener)
    return
  }
  child = proc
  const startedAt = Date.now()
  let pending = ''
  proc.stdout.on('data', (buf: Buffer) => {
    pending += buf.toString('utf8')
    let index = pending.indexOf('\n')
    while (index >= 0) {
      const line = pending.slice(0, index).trim()
      pending = pending.slice(index + 1)
      handleLine(line, listener)
      index = pending.indexOf('\n')
    }
  })
  proc.stderr.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8').trim()
    if (text) console.error(text)
  })
  const gone = () => {
    if (child !== proc) return
    child = null
    if (Date.now() - startedAt >= STABLE_MS) restarts = 0
    scheduleRestart(listener)
  }
  // Without an 'error' listener a helper that cannot launch (ENOENT, EACCES) would crash the app.
  proc.on('error', (error: Error) => {
    console.error('[gesture] helper failed:', error.message)
    gone()
  })
  proc.on('exit', gone)
}

/** Start the helper again after it gave up (from the menu), with a fresh set of retries. */
export function restartGesture(): void {
  if (child || !savedListener) return
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  restarts = 0
  startGesture(savedListener)
}

function scheduleRestart(listener: Listener): void {
  if (restarts >= MAX_RESTARTS) {
    console.error('[gesture] helper keeps stopping; the scroll gesture is off until it is restarted from the menu.')
    return
  }
  const delay = 1000 * 2 ** restarts
  restarts += 1
  retryTimer = setTimeout(() => {
    retryTimer = null
    startGesture(listener)
  }, delay)
}

export function setGestureVisible(visible: boolean): void {
  child?.stdin.write(visible ? 'visible\n' : 'hidden\n')
}

export function promptGestureTrust(): void {
  child?.stdin.write('prompt-trust\n')
}

export function stopGesture(): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  child?.kill()
  child = null
}

function handleLine(line: string, listener: Listener): void {
  if (!line) return
  if (line === 'ready trusted' || line === 'trusted') {
    trusted = true
    listener.onTrust(true)
    return
  }
  if (line === 'ready untrusted') {
    trusted = false
    listener.onTrust(false)
    return
  }
  if (line === 'release') {
    listener.onRelease()
    return
  }
  if (line.startsWith('drag ')) {
    const parts = line.slice(5).split(' ').map(Number)
    if (parts.length !== 6 || parts.some((part) => Number.isNaN(part))) return
    const [x, y, width, height, delta, live] = parts
    listener.onDrag({ x, y, width, height }, delta, live === 1)
  }
}

function helperPath(): string | null {
  const candidates = [
    join(process.resourcesPath, 'GestureHelper'),
    join(app.getAppPath(), 'native/bin/GestureHelper'),
    join(__dirname, '../../native/bin/GestureHelper')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}
