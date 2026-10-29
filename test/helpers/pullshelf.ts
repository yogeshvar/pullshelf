import { vi } from 'vitest'
import type { ActionResult, AppState, Clip, FileInfo, Note, ShelfFile } from '../../src/shared/types'

export const makeState = (patch: Partial<AppState> = {}): AppState => ({
  settings: { presetId: 'claude', customCommand: '', cwd: '/Users/me/project', toolRatio: 0.4, clipRatio: 0.18, filesRatio: 0.2, heightRatio: 0.52, showTrayIcon: true },
  clips: [],
  notes: [],
  files: [],
  tool: { running: true, presetId: 'claude', label: 'Claude Code', cwd: '/Users/me/project', error: null, exitCode: null },
  gestureTrusted: true,
  shortcut: '⌘⇧L',
  canAutoLaunch: false,
  launchAtLogin: false,
  ...patch
})

export const makeClip = (patch: Partial<Clip> = {}): Clip => ({
  id: 'c1', kind: 'text', preview: 'copied text', text: 'copied text', thumb: null, favorite: false, createdAt: Date.now(), ...patch
})

export const makeNote = (patch: Partial<Note> = {}): Note => ({
  id: 'n1', title: 'First note', body: 'First note body', createdAt: 1, updatedAt: Date.now(), ...patch
})

export const makeFile = (patch: Partial<ShelfFile> = {}): ShelfFile => ({
  id: 'f1', path: '/Users/me/Readme.txt', name: 'Readme.txt', addedAt: 1, ...patch
})

type Listener = (payload: never) => void

/** Install a fake `window.pullshelf` (the preload bridge) and return handles to drive it. */
export function installPullshelf(state: AppState = makeState(), overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, Set<Listener>>()
  const subscribe = (name: string) =>
    vi.fn((callback: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name)?.add(callback)
      return vi.fn(() => {
        listeners.get(name)?.delete(callback)
      })
    })
  const ok = () => vi.fn(async (..._args: unknown[]): Promise<ActionResult> => ({ ok: true }))

  const pullshelf = {
    hide: vi.fn(),
    getState: vi.fn(async () => state),
    saveLayout: vi.fn(async (..._args: number[]) => undefined),
    configureTool: vi.fn(async (_config: unknown) => undefined),
    restartTool: vi.fn(async () => undefined),
    writePty: vi.fn(),
    resizePty: vi.fn(),
    ptySnapshot: vi.fn(async () => ({ buffer: '', rev: 0 })),
    sendToTool: ok(),
    openInClaude: ok(),
    copyClip: vi.fn(async (_id: string) => undefined),
    toggleFavorite: vi.fn(async (_id: string) => [] as Clip[]),
    deleteClip: vi.fn(async (_id: string) => [] as Clip[]),
    clearHistory: vi.fn(async () => [] as Clip[]),
    createNote: vi.fn(async () => makeNote({ id: 'new', title: 'New note', body: '' })),
    updateNote: vi.fn(async (_id: string, _body: string) => null as Note | null),
    renameNote: vi.fn(async (_id: string, _title: string) => null as Note | null),
    deleteNote: vi.fn(async (_id: string) => [] as Note[]),
    resizeShelf: vi.fn(),
    resizeShelfEnd: vi.fn(),
    pathForFile: vi.fn((file: { name: string }) => `/dropped/${file.name}`),
    addFiles: vi.fn(async (_paths: string[]) => [] as ShelfFile[]),
    removeFile: vi.fn(async (_id: string) => [] as ShelfFile[]),
    clearFiles: vi.fn(async () => [] as ShelfFile[]),
    openFile: ok(),
    revealFile: vi.fn(),
    fileInfo: vi.fn(async (_id: string): Promise<FileInfo> => ({ kind: 'file', ext: 'TXT', thumb: null })),
    dragFile: vi.fn(),
    keepOpen: vi.fn(),
    promptGesture: vi.fn(),
    quit: vi.fn(),
    setTrayVisible: vi.fn(),
    setLaunchAtLogin: vi.fn(),
    onPtyData: subscribe('pty:data'),
    onPtyReset: subscribe('pty:reset'),
    onPtyExit: subscribe('pty:exit'),
    onToolStatus: subscribe('tool:status'),
    onClips: subscribe('clips'),
    onNotes: subscribe('notes'),
    onFiles: subscribe('files'),
    onShown: subscribe('shown'),
    onGestureTrust: subscribe('trust'),
    onPrefs: subscribe('prefs'),
    ...overrides
  }
  ;(window as unknown as { pullshelf: unknown }).pullshelf = pullshelf
  return {
    pullshelf,
    /** Deliver an event from the main process, e.g. emit('clips', [...]). */
    emit: (name: string, payload?: unknown) => {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(payload as never)
    },
    listenerCount: (name: string) => listeners.get(name)?.size ?? 0
  }
}
