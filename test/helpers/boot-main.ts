import { vi } from 'vitest'
import { tempDir } from './tmp'

export type BootOptions = {
  platform?: NodeJS.Platform
  singleInstanceLock?: boolean
  ready?: Promise<void>
  env?: Record<string, string | undefined>
  beforeImport?: (electron: typeof import('../mocks/electron')) => void
  /** Skip waiting for the window (for failure paths). */
  waitForWindow?: boolean
}

/**
 * Load electron/main.ts fresh, with the native-heavy collaborators mocked
 * (pty, clipboard, gesture) and everything else real (SQLite, notes, files).
 */
export async function bootMain(options: BootOptions = {}) {
  vi.resetModules()
  const electron = await import('../mocks/electron')
  electron.electronState.userData = tempDir('pullshelf-main-')
  if (options.singleInstanceLock !== undefined) electron.electronState.singleInstanceLock = options.singleInstanceLock
  if (options.ready) electron.electronState.ready = options.ready
  options.beforeImport?.(electron)

  const previous = { platform: process.platform, env: {} as Record<string, string | undefined> }
  if (options.platform) Object.defineProperty(process, 'platform', { value: options.platform, configurable: true })
  for (const [key, value] of Object.entries(options.env ?? {})) {
    previous.env[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  await import('../../electron/main')

  Object.defineProperty(process, 'platform', { value: previous.platform, configurable: true })
  for (const [key, value] of Object.entries(previous.env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  const pty = await import('../../electron/pty')
  const gesture = await import('../../electron/gesture')
  const clipboard = await import('../../electron/clipboard')
  const { readSettings } = await import('../../electron/db')
  const Database = (await import('better-sqlite3')).default

  if (options.waitForWindow !== false && options.platform === undefined && options.singleInstanceLock !== false && !options.ready) {
    await vi.waitFor(() => {
      if (electron.BrowserWindow.instances.length === 0) throw new Error('window not created yet')
    })
  }

  const win = () => electron.BrowserWindow.instances[0]
  return {
    ...electron,
    pty: vi.mocked(pty),
    gesture: vi.mocked(gesture),
    clipboard: vi.mocked(clipboard),
    win,
    /** The callbacks main.ts handed to startGesture. */
    listener: () => vi.mocked(gesture).startGesture.mock.calls[0][0],
    /** Saved settings as persisted in the real database. */
    savedSettings: () => {
      const db = new Database(`${electron.electronState.userData}/pullshelf.db`)
      const result = readSettings(db as never, '/fallback')
      db.close()
      return result
    },
    /** Messages sent to the renderer. */
    sent: () => win().webContents.send.mock.calls as [string, unknown?][]
  }
}

export type Booted = Awaited<ReturnType<typeof bootMain>>

/** Mocks shared by every main.ts test file: use `vi.mock` with these in each file. */
export const mockFactories = {
  pty: () => ({
    isRunning: vi.fn(() => false),
    resize: vi.fn(),
    sendText: vi.fn((_text: string) => ({ ok: true })),
    snapshot: vi.fn(() => ({ buffer: 'buf', rev: 3 })),
    start: vi.fn(async (_settings: unknown) => undefined),
    stop: vi.fn(),
    toolStatus: vi.fn(() => ({ running: false, presetId: 'claude', label: 'Claude Code', cwd: '/', error: null, exitCode: null })),
    write: vi.fn()
  }),
  gesture: () => ({
    promptGestureTrust: vi.fn(),
    setGestureVisible: vi.fn(),
    startGesture: vi.fn(),
    stopGesture: vi.fn(),
    gestureTrusted: vi.fn(() => false)
  }),
  clipboard: () => ({
    clearHistory: vi.fn(() => []),
    copyClip: vi.fn(async (_id: string) => undefined),
    deleteClip: vi.fn((_id: string) => []),
    listClips: vi.fn(() => []),
    startClipboard: vi.fn(),
    stopClipboard: vi.fn(),
    toggleFavorite: vi.fn((_id: string) => []),
    clipText: vi.fn((_id: string) => null as string | null)
  })
}
