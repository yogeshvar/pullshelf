import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, readSettings, writeSettings } from '../../electron/db'
import { bootMain, mockFactories } from '../helpers/boot-main'
import { tempDir } from '../helpers/tmp'

vi.mock('../../electron/pty', () => mockFactories.pty())
vi.mock('../../electron/gesture', () => mockFactories.gesture())
vi.mock('../../electron/clipboard', () => mockFactories.clipboard())

afterEach(() => {
  vi.restoreAllMocks()
})

describe('starting up', () => {
  it('names the app and, once ready, hides the Dock icon and opens the database', async () => {
    const m = await bootMain()
    expect(m.app.setName).toHaveBeenCalledWith('Pullshelf')
    expect(m.app.setActivationPolicy).toHaveBeenCalledWith('accessory')
    expect(m.app.dock.hide).toHaveBeenCalled()
    expect(existsSync(join(m.electronState.userData, 'pullshelf.db'))).toBe(true)
    expect(existsSync(join(m.electronState.userData, 'notes'))).toBe(true)
    expect(m.clipboard.startClipboard).toHaveBeenCalledWith(expect.anything(), m.electronState.userData)
  })

  it('works on a Mac without a Dock object', async () => {
    const m = await bootMain({ beforeImport: (e) => ((e.app as { dock?: unknown }).dock = undefined) })
    expect(m.win()).toBeDefined()
  })

  it('creates the window, the tray, the shortcut and the gesture listener', async () => {
    const m = await bootMain()
    expect(m.BrowserWindow.instances).toHaveLength(1)
    expect(m.Tray.instances).toHaveLength(1)
    expect(m.globalShortcut.register).toHaveBeenCalledWith('CommandOrControl+Shift+L', expect.any(Function))
    expect(m.gesture.startGesture).toHaveBeenCalledTimes(1)
  })

  it('reports a shortcut that is already taken, and carries on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const m = await bootMain({
      beforeImport: (e) => e.globalShortcut.register.mockReturnValue(false)
    })
    expect(error).toHaveBeenCalledWith('Could not register CommandOrControl+Shift+L')
    expect(m.gesture.startGesture).toHaveBeenCalled()
  })

  it('quits when start-up fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const m = await bootMain({
      ready: Promise.reject(new Error('no display')),
      waitForWindow: false
    })
    await vi.waitFor(() => expect(m.app.quit).toHaveBeenCalled())
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'no display' }))
    expect(m.BrowserWindow.instances).toHaveLength(0)
  })

  it('refuses to run on anything but macOS', async () => {
    const m = await bootMain({ platform: 'linux' })
    await vi.waitFor(() => expect(m.dialog.showErrorBox).toHaveBeenCalledWith('Pullshelf', 'Pullshelf runs on macOS.'))
    expect(m.app.quit).toHaveBeenCalled()
    expect(m.BrowserWindow.instances).toHaveLength(0)
  })

  it('quits at once when another copy is already running', async () => {
    const m = await bootMain({ singleInstanceLock: false })
    expect(m.app.quit).toHaveBeenCalled()
    expect(m.app.whenReady).not.toHaveBeenCalled()
    expect(m.BrowserWindow.instances).toHaveLength(0)
  })
})

describe('saved preferences and older data', () => {
  const saved = { presetId: 'shell', customCommand: '', cwd: '/legacy', toolRatio: 0.4, clipRatio: 0.18, filesRatio: 0.2, heightRatio: 0.52 } as const

  it('leaves the menu-bar icon out when it was turned off last time', async () => {
    const dir = join(tempDir(), 'Pullshelf')
    const db = openDatabase(dir)
    writeSettings(db, { ...saved, showTrayIcon: false })
    db.close()
    const m = await bootMain({ beforeImport: (e) => (e.electronState.userData = dir) })
    expect(m.Tray.instances).toHaveLength(0)
    expect(m.globalShortcut.register).toHaveBeenCalled()
    m.ipcMain.send('app:set-tray-visible', true)
    expect(m.Tray.instances).toHaveLength(1)
  })

  it('brings a Perch 0.1 install along, ahead of an older Ledge folder', async () => {
    const support = tempDir()
    const perch = openDatabase(join(support, 'Perch'))
    writeSettings(perch, { ...saved, showTrayIcon: true, cwd: '/from-perch' })
    perch.close()
    const ledge = openDatabase(join(support, 'Ledge'))
    writeSettings(ledge, { ...saved, showTrayIcon: true, cwd: '/from-ledge' })
    ledge.close()
    const m = await bootMain({ beforeImport: (e) => (e.electronState.userData = join(support, 'Pullshelf')) })
    const state = (await m.ipcMain.invoke('app:get-state')) as { settings: { cwd: string } }
    expect(state.settings.cwd).toBe('/from-perch')
    expect(existsSync(join(support, 'Perch'))).toBe(false)
    expect(existsSync(join(support, 'Ledge'))).toBe(true)
  })

  it('brings the data of the app\'s old name along before opening the database', async () => {
    const support = tempDir()
    const legacy = openDatabase(join(support, 'Ledge'))
    writeSettings(legacy, { ...saved, showTrayIcon: true })
    legacy
      .prepare(`INSERT INTO clips (id, kind, text, image_path, preview, favorite, created_at) VALUES ('img', 'image', NULL, ?, 'Image', 0, 1)`)
      .run(join(support, 'Ledge', 'clips', 'img.png'))
    legacy.close()
    mkdirSync(join(support, 'Ledge', 'notes'))
    writeFileSync(join(support, 'Ledge', 'notes', 'a.md'), 'kept')
    const m = await bootMain({ beforeImport: (e) => (e.electronState.userData = join(support, 'Pullshelf')) })
    const state = (await m.ipcMain.invoke('app:get-state')) as { settings: { cwd: string } }
    expect(state.settings.cwd).toBe('/legacy')
    expect(existsSync(join(support, 'Ledge'))).toBe(false)
    expect(existsSync(join(support, 'Pullshelf', 'notes', 'a.md'))).toBe(true)
    const db = openDatabase(join(support, 'Pullshelf'))
    expect(readSettings(db, '/x').cwd).toBe('/legacy')
    // Image clips must follow the folder, or their previews would point at a place that no longer exists.
    expect(db.prepare('SELECT image_path FROM clips WHERE id = ?').get('img')).toEqual({
      image_path: join(support, 'Pullshelf', 'clips', 'img.png')
    })
  })
})

describe('gesture trust', () => {
  it('forwards trust changes to the page, and ignores them once the window is gone', async () => {
    const m = await bootMain()
    m.listener().onTrust(true)
    expect(m.sent().at(-1)).toEqual(['gesture:trust', true])
    m.win().fire('closed')
    expect(() => m.listener().onTrust(false)).not.toThrow()
  })
})

describe('app lifecycle events', () => {
  it('shows the shelf when a second copy is launched or the app is activated while hidden', async () => {
    const m = await bootMain()
    m.app.fire('second-instance')
    expect(m.win().show).toHaveBeenCalledTimes(1)
    m.win().show.mockClear()
    m.app.fire('activate') // already visible: nothing to do
    expect(m.win().show).not.toHaveBeenCalled()
  })

  it('ignores launches and activations that happen before the window exists', async () => {
    let release: () => void = () => undefined
    const m = await bootMain({
      ready: new Promise<void>((resolve) => (release = resolve)),
      waitForWindow: false
    })
    expect(() => {
      m.app.fire('second-instance')
      m.app.fire('activate')
    }).not.toThrow()
    release()
    await vi.waitFor(() => expect(m.BrowserWindow.instances).toHaveLength(1))
    expect(m.win().show).not.toHaveBeenCalled()
  })

  it('stays in the menu bar when the last window closes', async () => {
    const m = await bootMain()
    m.app.fire('window-all-closed')
    expect(m.app.quit).not.toHaveBeenCalled()
  })

  it('cleans everything up on quit', async () => {
    const m = await bootMain()
    m.app.fire('will-quit')
    expect(m.globalShortcut.unregisterAll).toHaveBeenCalled()
    expect(m.pty.stop).toHaveBeenCalled()
    expect(m.clipboard.stopClipboard).toHaveBeenCalled()
    expect(m.gesture.stopGesture).toHaveBeenCalled()
  })

  it('lets the window really close once the app is quitting, and forgets it afterwards', async () => {
    const m = await bootMain()
    const prevent = vi.fn()
    m.win().fire('close', { preventDefault: prevent })
    expect(prevent).toHaveBeenCalled() // a normal close just hides the shelf

    prevent.mockClear()
    m.app.fire('before-quit')
    m.win().fire('close', { preventDefault: prevent })
    expect(prevent).not.toHaveBeenCalled()
    m.win().fire('closed')
    expect(() => m.listener().onDrag({ x: 0, y: 0, width: 1600, height: 900 }, 10, true)).not.toThrow()
  })

  it('logs when a child process or the renderer dies', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const m = await bootMain()
    m.app.fire('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 5 })
    m.win().webContents.fire('render-process-gone', {}, { reason: 'oom', exitCode: 9 })
    expect(error).toHaveBeenCalledWith('[pullshelf] child process gone:', 'GPU', 'crashed', 5)
    expect(error).toHaveBeenCalledWith('[pullshelf] renderer gone:', 'oom', 9)
  })
})

describe('the window', () => {
  it('is a frameless, always-on-top panel sitting just above the work area', async () => {
    const m = await bootMain()
    const w = m.win()
    expect(w.options).toMatchObject({
      x: 0, y: 34 - 468, width: 1600, height: 468, show: false, frame: false, alwaysOnTop: true,
      enableLargerThanScreen: true, resizable: false, movable: false, skipTaskbar: true, backgroundColor: '#121110',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    expect(String((w.options.webPreferences as { preload: string }).preload)).toMatch(/preload\/preload\.js$/)
    expect(w.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true })
    expect(w.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
  })

  it('loads the built page, or the dev server when one is configured', async () => {
    const built = await bootMain({ env: { ELECTRON_RENDERER_URL: undefined } })
    expect(built.win().loadFile).toHaveBeenCalledWith(expect.stringMatching(/renderer\/index\.html$/))
    expect(built.win().loadURL).not.toHaveBeenCalled()
    const dev = await bootMain({ env: { ELECTRON_RENDERER_URL: 'http://localhost:5173' } })
    expect(dev.win().loadURL).toHaveBeenCalledWith('http://localhost:5173')
  })

  it('opens itself on launch only when PULLSHELF_SHOW=1', async () => {
    const quiet = await bootMain({ env: { PULLSHELF_SHOW: undefined } })
    quiet.win().fire('ready-to-show')
    expect(quiet.win().show).not.toHaveBeenCalled()
    const eager = await bootMain({ env: { PULLSHELF_SHOW: '1' } })
    process.env.PULLSHELF_SHOW = '1'
    eager.win().fire('ready-to-show')
    delete process.env.PULLSHELF_SHOW
    expect(eager.win().show).toHaveBeenCalled()
  })

  it('keeps navigation inside the app and sends links to the browser', async () => {
    const m = await bootMain()
    const same = { preventDefault: vi.fn() }
    m.win().webContents.fire('will-navigate', same, 'http://localhost:5173/')
    expect(same.preventDefault).not.toHaveBeenCalled()
    const other = { preventDefault: vi.fn() }
    m.win().webContents.fire('will-navigate', other, 'file:///Users/me/dropped.txt')
    expect(other.preventDefault).toHaveBeenCalled()
    expect(m.win().webContents.openHandler?.({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(m.shell.openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('still blocks navigation after the window is gone', async () => {
    const m = await bootMain()
    m.win().fire('closed')
    const event = { preventDefault: vi.fn() }
    m.win().webContents.fire('will-navigate', event, 'http://localhost:5173/')
    expect(event.preventDefault).toHaveBeenCalled()
  })
})
