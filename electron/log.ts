import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

// A plain-text log at ~/Library/Logs/Pullshelf/main.log (Console.app shows it), so a crash report can say
// what happened. Every console.error/console.warn in the main process is copied there. Clip and note
// contents are never logged by the app. One rotated file (main.1.log) is kept.
const DEFAULT_MAX_BYTES = 1_000_000

let file = ''
let maxBytes = DEFAULT_MAX_BYTES
let wrapped = false

export function startLog(dir: string, limit = DEFAULT_MAX_BYTES): string {
  file = join(dir, 'main.log')
  maxBytes = limit
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // write() keeps failing quietly; the console still works.
  }
  if (!wrapped) {
    wrapped = true
    for (const level of ['error', 'warn'] as const) {
      const original = console[level].bind(console)
      console[level] = (...args: unknown[]) => {
        original(...args)
        write(level.toUpperCase(), args)
      }
    }
  }
  return file
}

export function logInfo(...args: unknown[]): void {
  write('INFO', args)
}

function write(level: string, args: unknown[]): void {
  if (!file) return
  const line = `${new Date().toISOString()} ${level} ${format(...args)}\n`
  try {
    if (statSafe(file) + line.length > maxBytes) renameSync(file, join(file, '..', 'main.1.log'))
    appendFileSync(file, line, 'utf8')
  } catch {
    // Logging must never take the app down.
  }
}

function statSafe(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
