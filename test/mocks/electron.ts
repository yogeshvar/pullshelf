import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

/** Controls shared by the fake Electron modules. Reset between tests with `resetElectron()`. */
export const electronState = {
  singleInstanceLock: true,
  ready: Promise.resolve() as Promise<void>,
  isPackaged: false,
  openAtLogin: false,
  userData: '/tmp/pullshelf-test-user-data',
  workArea: { x: 0, y: 34, width: 1600, height: 900 },
  displayFrequency: 60,
  cursor: { x: 800, y: 400 },
  clipboardText: '',
  clipboardImage: null as Buffer | null
}

export class FakeImage {
  constructor(
    public empty = false,
    public width = 100,
    public height = 100,
    public png: Buffer = Buffer.from('fake-png-bytes')
  ) {}

  isEmpty() {
    return this.empty
  }

  getSize() {
    return { width: this.width, height: this.height }
  }

  resize(options: { width?: number; height?: number } = {}) {
    return new FakeImage(this.empty, options.width ?? this.width, options.height ?? this.height, this.png)
  }

  toPNG() {
    return this.png
  }

  toDataURL() {
    return `data:image/png;base64,${this.png.toString('base64')}`
  }

  setTemplateImage = vi.fn()
}

export const nativeImage = {
  createFromBuffer: vi.fn((buffer: Buffer) => new FakeImage(false, 100, 100, buffer)),
  createFromPath: vi.fn((_path: string) => new FakeImage(false))
}

class FakeEmitter {
  private readonly emitter = new EventEmitter()
  on = vi.fn((event: string, handler: (...args: never[]) => void) => {
    this.emitter.on(event, handler as never)
    return this
  })
  once = vi.fn((event: string, handler: (...args: never[]) => void) => {
    this.emitter.once(event, handler as never)
    return this
  })
  /** Test helper: fire an event as Electron would. */
  fire(event: string, ...args: unknown[]) {
    this.emitter.emit(event, ...args)
  }
  listenerCount(event: string) {
    return this.emitter.listenerCount(event)
  }
}

export class FakeWebContents extends FakeEmitter {
  send = vi.fn()
  getURL = vi.fn(() => 'http://localhost:5173/')
  toggleDevTools = vi.fn()
  startDrag = vi.fn()
  openHandler: ((details: { url: string }) => { action: string }) | null = null
  setWindowOpenHandler = vi.fn((handler: (details: { url: string }) => { action: string }) => {
    this.openHandler = handler
  })
  destroyed = false
  isDestroyed = vi.fn(() => this.destroyed)
}

export class BrowserWindow extends FakeEmitter {
  static instances: BrowserWindow[] = []
  webContents = new FakeWebContents()
  bounds: { x: number; y: number; width: number; height: number }
  shown = false
  options: Record<string, unknown>

  constructor(options: Record<string, unknown>) {
    super()
    this.options = options
    this.bounds = {
      x: Number(options.x ?? 0),
      y: Number(options.y ?? 0),
      width: Number(options.width ?? 0),
      height: Number(options.height ?? 0)
    }
    BrowserWindow.instances.push(this)
  }

  setVisibleOnAllWorkspaces = vi.fn()
  setAlwaysOnTop = vi.fn()
  loadURL = vi.fn(async (_url: string) => undefined)
  loadFile = vi.fn(async (_path: string) => undefined)
  show = vi.fn(() => {
    this.shown = true
  })
  showInactive = vi.fn(() => {
    this.shown = true
  })
  hide = vi.fn(() => {
    this.shown = false
  })
  focus = vi.fn()
  moveTop = vi.fn()
  isVisible = vi.fn(() => this.shown)
  getBounds = vi.fn(() => ({ ...this.bounds }))
  setBounds = vi.fn((next: Partial<typeof this.bounds>) => {
    this.bounds = { ...this.bounds, ...next }
  })
}

export class Tray extends FakeEmitter {
  static instances: Tray[] = []
  setToolTip = vi.fn()
  popUpContextMenu = vi.fn()
  destroy = vi.fn()
  constructor(public image: unknown) {
    super()
    Tray.instances.push(this)
  }
}

export const Menu = {
  buildFromTemplate: vi.fn((template: unknown[]) => ({ template }))
}

export const globalShortcut = {
  register: vi.fn((_accelerator: string, _callback: () => void) => true),
  unregisterAll: vi.fn()
}

export const screen = {
  getPrimaryDisplay: vi.fn(() => ({
    bounds: { x: 0, y: 0, width: 1600, height: 934 },
    workArea: electronState.workArea,
    displayFrequency: electronState.displayFrequency
  })),
  getDisplayNearestPoint: vi.fn((_point: { x: number; y: number }) => ({
    bounds: { x: 0, y: 0, width: 1600, height: 934 },
    workArea: electronState.workArea,
    displayFrequency: electronState.displayFrequency
  })),
  getDisplayMatching: vi.fn((_bounds: unknown) => ({
    bounds: { x: 0, y: 0, width: 1600, height: 934 },
    workArea: electronState.workArea,
    displayFrequency: electronState.displayFrequency
  })),
  getCursorScreenPoint: vi.fn(() => electronState.cursor)
}

export const shell = {
  openExternal: vi.fn(async (_url: string) => undefined),
  openPath: vi.fn(async (_path: string) => ''),
  showItemInFolder: vi.fn()
}

export const dialog = {
  showErrorBox: vi.fn()
}

class FakeApp extends FakeEmitter {
  setName = vi.fn()
  requestSingleInstanceLock = vi.fn(() => electronState.singleInstanceLock)
  quit = vi.fn()
  whenReady = vi.fn(() => electronState.ready)
  getPath = vi.fn((_name: string) => electronState.userData)
  getAppPath = vi.fn(() => '/app')
  setActivationPolicy = vi.fn()
  setLoginItemSettings = vi.fn((settings: { openAtLogin: boolean }) => {
    electronState.openAtLogin = settings.openAtLogin
  })
  getLoginItemSettings = vi.fn(() => ({ openAtLogin: electronState.openAtLogin }))
  dock = { hide: vi.fn() }
  focus = vi.fn()
  get isPackaged() {
    return electronState.isPackaged
  }
}

export const app = new FakeApp()

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const listeners = new Map<string, Handler>()

export const ipcMain = {
  handle: vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  }),
  on: vi.fn((channel: string, handler: Handler) => {
    listeners.set(channel, handler)
  }),
  /** Test helper: call an `ipcMain.handle` handler the way the renderer would. */
  async invoke(channel: string, ...args: unknown[]) {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ sender: new FakeWebContents() }, ...args)
  },
  /** Test helper: call an `ipcMain.on` listener. */
  send(channel: string, ...args: unknown[]) {
    const listener = listeners.get(channel)
    if (!listener) throw new Error(`No listener for ${channel}`)
    return listener({ sender: new FakeWebContents() }, ...args)
  },
  sendFrom(channel: string, sender: unknown, ...args: unknown[]) {
    const listener = listeners.get(channel)
    if (!listener) throw new Error(`No listener for ${channel}`)
    return listener({ sender }, ...args)
  },
  has: (channel: string) => handlers.has(channel) || listeners.has(channel)
}

export class ClipboardItem {
  constructor(public data: Record<string, Blob>) {}
  get types() {
    return Object.keys(this.data)
  }
  async getType(type: string) {
    return this.data[type]
  }
}

export const clipboard = {
  readText: vi.fn(async () => electronState.clipboardText),
  writeText: vi.fn(async (text: string) => {
    electronState.clipboardText = text
  }),
  has: vi.fn(async (_type: string) => electronState.clipboardImage !== null),
  read: vi.fn(async () =>
    electronState.clipboardImage
      ? [new ClipboardItem({ 'image/png': new Blob([Uint8Array.from(electronState.clipboardImage)]) })]
      : []
  ),
  write: vi.fn(async (_items: ClipboardItem[]) => undefined)
}

export const contextBridge = {
  exposed: {} as Record<string, unknown>,
  exposeInMainWorld: vi.fn((key: string, api: unknown) => {
    contextBridge.exposed[key] = api
  })
}

const ipcRendererListeners = new Map<string, Set<(...args: unknown[]) => void>>()

export const ipcRenderer = {
  send: vi.fn(),
  invoke: vi.fn(async (_channel: string, ..._args: unknown[]) => undefined),
  on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    if (!ipcRendererListeners.has(channel)) ipcRendererListeners.set(channel, new Set())
    ipcRendererListeners.get(channel)?.add(listener)
  }),
  removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    ipcRendererListeners.get(channel)?.delete(listener)
  }),
  /** Test helper: deliver a message from the main process. */
  deliver(channel: string, payload?: unknown) {
    for (const listener of ipcRendererListeners.get(channel) ?? []) listener({}, payload)
  },
  listenerCount: (channel: string) => ipcRendererListeners.get(channel)?.size ?? 0
}

export const webUtils = {
  getPathForFile: vi.fn((file: { name: string }) => `/dropped/${file.name}`)
}

/** Restore every fake to its initial state (call from `beforeEach`). */
export function resetElectron(): void {
  Object.assign(electronState, {
    singleInstanceLock: true,
    ready: Promise.resolve(),
    isPackaged: false,
    openAtLogin: false,
    userData: '/tmp/pullshelf-test-user-data',
    workArea: { x: 0, y: 34, width: 1600, height: 900 },
    displayFrequency: 60,
    cursor: { x: 800, y: 400 },
    clipboardText: '',
    clipboardImage: null
  })
  BrowserWindow.instances = []
  Tray.instances = []
  handlers.clear()
  listeners.clear()
  ipcRendererListeners.clear()
  contextBridge.exposed = {}
}
