import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray
} from 'electron'
import { attachWebContents } from './bus'
import { migrateLegacyData } from './migrate'
import { clearHistory, copyClip, deleteClip, listClips, startClipboard, stopClipboard, toggleFavorite, clipText } from './clipboard'
import { openDatabase, readSettings, rebaseClipImagePaths, writeSettings } from './db'
import { promptGestureTrust, setGestureVisible, startGesture, stopGesture, gestureTrusted, type CocoaFrame } from './gesture'
import { addFiles, clearFiles, dragImage, fileInfo, filePath, listFiles, removeFile, startFiles } from './files'
import { trayPng } from './icon'
import { createNote, deleteNote, listNotes, noteBody, renameNote, startNotes, updateNote } from './notes'
import { isRunning, resize, sendText, snapshot, start, stop, toolStatus, write } from './pty'
import { isPresetId, type Settings, type ToolConfig } from '../src/shared/types'

const SHORTCUT = 'CommandOrControl+Shift+L'
const SHORTCUT_LABEL = '⌘⇧L'

app.setName('Pullshelf')

if (process.platform !== 'darwin') {
  app.whenReady().then(() => {
    dialog.showErrorBox('Pullshelf', 'Pullshelf runs on macOS.')
    app.quit()
  })
} else {
  boot()
}

let database: ReturnType<typeof openDatabase> | null = null
let win: BrowserWindow | null = null
let tray: Tray | null = null
let settings: Settings = {
  presetId: 'claude',
  customCommand: '',
  cwd: homedir(),
  toolRatio: 0.4,
  clipRatio: 0.18,
  filesRatio: 0.2,
  heightRatio: 0.52,
  showTrayIcon: true
}
let visible = false
let blurArmed = false
let ignoreBlurUntil = 0
let slideToken = 0
let tracking = false
let settleTimer: NodeJS.Timeout | null = null
let frameTimer: NodeJS.Timeout | null = null
let frameMs = 1000 / 60
let trackTargetY = 0
let trackCurrentY = 0
let trackVelocity = 0
let trackLastEventAt = 0
let quitting = false
let startedOnce = false

function boot(): void {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  app.on('second-instance', () => showShelf())
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stop()
    stopClipboard()
    stopGesture()
  })
  app.on('window-all-closed', () => {
    // Stay in the menu bar.
  })
  app.on('activate', () => {
    if (!visible) showShelf()
  })

  app.whenReady().then(() => {
    app.setActivationPolicy('accessory')
    app.dock?.hide()
    const userData = app.getPath('userData')
    // Before Pullshelf the app was called Perch, and before that Ledge; bring the newest data along before the database opens.
    const legacyDirs = ['Perch', 'Ledge'].map((name) => join(dirname(userData), name))
    for (const legacyDir of legacyDirs) migrateLegacyData(userData, legacyDir)
    database = openDatabase(userData)
    for (const legacyDir of legacyDirs) rebaseClipImagePaths(database, legacyDir, userData)
    settings = readSettings(database, homedir())
    startNotes(database, userData)
    startFiles(database)
    startClipboard(database, userData)
    createWindow()
    if (settings.showTrayIcon) createTray()
    const registered = globalShortcut.register(SHORTCUT, toggleShelf)
    if (!registered) console.error(`Could not register ${SHORTCUT}`)
    startGesture({
      onDrag: (frame, delta, live) => trackShelf(frame, delta, live),
      onRelease: () => settleShelf(),
      onTrust: (trusted) => win?.webContents.send('gesture:trust', trusted)
    })
  }).catch((error: unknown) => {
    console.error(error)
    app.quit()
  })
}

function createWindow(): void {
  const area = screen.getPrimaryDisplay().workArea
  const height = shelfHeight(area.height)
  win = new BrowserWindow({
    x: area.x,
    y: area.y - height,
    width: area.width,
    height,
    show: false,
    enableLargerThanScreen: true,
    frame: false,
    transparent: false,
    backgroundColor: '#121110',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    hasShadow: true,
    roundedCorners: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'floating')
  attachWebContents(win.webContents)

  win.on('focus', () => {
    blurArmed = true
  })
  win.on('blur', () => {
    setTimeout(() => {
      if (tracking || !blurArmed || Date.now() < ignoreBlurUntil || !visible) return
      hideShelf()
    }, 160)
  })
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    hideShelf()
  })
  // After the window is destroyed, late timers and gesture events must not touch it.
  win.on('closed', () => {
    win = null
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  // A stray file drop must never replace the app with the dropped file.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win?.webContents.getURL()) event.preventDefault()
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[pullshelf] renderer gone:', details.reason, details.exitCode)
  })
  app.on('child-process-gone', (_event, details) => {
    console.error('[pullshelf] child process gone:', details.type, details.reason, details.exitCode)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.once('ready-to-show', () => {
    if (process.env.PULLSHELF_SHOW === '1') showShelf()
  })

  registerIpc()
}

function createTray(): void {
  const image = nativeImage.createFromBuffer(trayPng()).resize({ width: 18, height: 18 })
  image.setTemplateImage(true)
  const created = new Tray(image)
  tray = created // keep a reference so the tray icon is not garbage collected
  created.setToolTip('Pullshelf')
  created.on('click', toggleShelf)
  created.on('right-click', () => {
    created.popUpContextMenu(buildMenu())
  })
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: visible ? 'Hide Pullshelf' : 'Show Pullshelf',
      accelerator: SHORTCUT,
      click: toggleShelf
    },
    { type: 'separator' },
    // Login items only make sense for the installed app, not a dev build.
    ...(app.isPackaged
      ? [
          {
            label: 'Launch at login',
            type: 'checkbox' as const,
            checked: launchAtLogin(),
            click: () => setLaunchAtLogin(!launchAtLogin())
          }
        ]
      : []),
    { label: 'Hide menu bar icon', click: () => setTrayVisible(false) },
    {
      label: gestureTrusted() ? 'Scroll gesture on' : 'Enable scroll gesture…',
      enabled: !gestureTrusted(),
      click: () => promptGestureTrust()
    },
    {
      label: 'Toggle Developer Tools',
      visible: !app.isPackaged,
      click: () => win?.webContents.toggleDevTools()
    },
    { type: 'separator' },
    { label: 'Quit Pullshelf', click: () => app.quit() }
  ])
}

function launchAtLogin(): boolean {
  return app.isPackaged && app.getLoginItemSettings().openAtLogin
}

function setLaunchAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled })
  sendPrefs()
}

// Shows or hides the menu bar icon and remembers the choice. While it is hidden the shelf
// is still reachable by the shortcut, the scroll gesture, or opening the app again.
function setTrayVisible(show: boolean): void {
  if (show && !tray) createTray()
  else if (!show && tray) {
    tray.destroy()
    tray = null
  }
  settings = { ...settings, showTrayIcon: show }
  persist()
  sendPrefs()
}

function sendPrefs(): void {
  win?.webContents.send('prefs:changed', { showTrayIcon: settings.showTrayIcon, launchAtLogin: launchAtLogin() })
}

function registerIpc(): void {
  ipcMain.on('shelf:hide', () => hideShelf())
  ipcMain.on('gesture:prompt', () => promptGestureTrust())
  ipcMain.on('app:quit', () => app.quit())
  ipcMain.on('app:set-tray-visible', (_event, show: unknown) => {
    if (typeof show === 'boolean') setTrayVisible(show)
  })
  ipcMain.on('app:set-launch-at-login', (_event, enabled: unknown) => {
    if (typeof enabled === 'boolean') setLaunchAtLogin(enabled)
  })
  ipcMain.on('pty:write', (_event, data: unknown) => {
    if (typeof data === 'string') write(data)
  })
  ipcMain.on('pty:resize', (_event, cols: unknown, rows: unknown) => {
    if (typeof cols === 'number' && typeof rows === 'number') resize(cols, rows)
  })
  ipcMain.handle('files:add', (_event, paths: unknown) => {
    if (!Array.isArray(paths)) return listFiles()
    try {
      return addFiles(paths.filter((item): item is string => typeof item === 'string'))
    } catch (error) {
      console.error('Could not add files', error)
      return listFiles()
    }
  })
  ipcMain.handle('files:remove', (_event, id: unknown) => (typeof id === 'string' ? removeFile(id) : listFiles()))
  ipcMain.handle('files:clear', () => clearFiles())
  ipcMain.handle('files:open', async (_event, id: unknown) => {
    const path = typeof id === 'string' ? filePath(id) : null
    if (!path) return { ok: false, error: 'File not found.' }
    const failure = await shell.openPath(path)
    return failure ? { ok: false, error: failure } : { ok: true }
  })
  ipcMain.on('files:reveal', (_event, id: unknown) => {
    const path = typeof id === 'string' ? filePath(id) : null
    if (path) shell.showItemInFolder(path)
  })
  ipcMain.handle('files:info', (_event, id: unknown) =>
    typeof id === 'string' ? fileInfo(id) : { kind: 'missing', ext: '', thumb: null }
  )
  ipcMain.on('files:drag', (event, id: unknown) => {
    const path = typeof id === 'string' ? filePath(id) : null
    if (!path) return
    ignoreBlurUntil = Date.now() + 15_000
    try {
      event.sender.startDrag({ file: path, icon: dragImage(id as string) })
    } catch (error) {
      console.error('Could not start file drag', error)
    }
  })
  ipcMain.on('shelf:resize', (_event, height: unknown) => {
    if (!win || typeof height !== 'number' || !Number.isFinite(height)) return
    const bounds = win.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const next = Math.round(clamp(height, 240, area.height))
    ignoreBlurUntil = Date.now() + 5_000
    slideToken += 1 // cancel any slide still in flight
    win.setBounds({ x: area.x, y: area.y, width: area.width, height: next })
    visible = true
    settings = { ...settings, heightRatio: clamp(next / area.height, 0.25, 0.92) }
  })
  ipcMain.on('shelf:resize-end', () => {
    ignoreBlurUntil = Date.now() + 600
    persist()
  })
  ipcMain.on('shelf:keep-open', () => {
    ignoreBlurUntil = Date.now() + 5_000
  })
  ipcMain.handle('app:get-state', () => ({
    files: listFiles(),
    settings,
    clips: listClips(),
    notes: listNotes(),
    tool: toolStatus(),
    gestureTrusted: gestureTrusted(),
    shortcut: SHORTCUT_LABEL,
    canAutoLaunch: app.isPackaged,
    launchAtLogin: launchAtLogin()
  }))
  ipcMain.handle('pty:snapshot', () => snapshot())
  ipcMain.handle('settings:layout', (_event, tool: unknown, clips: unknown, files: unknown) => {
    if (typeof tool !== 'number' || typeof clips !== 'number' || typeof files !== 'number') return
    settings = {
      ...settings,
      toolRatio: clamp(tool, 0.08, 0.8),
      clipRatio: clamp(clips, 0.08, 0.8),
      filesRatio: clamp(files, 0.08, 0.8)
    }
    persist()
  })
  ipcMain.handle('tool:configure', async (_event, config: unknown) => {
    settings = applyConfig(settings, config)
    persist()
    await start(settings)
    startedOnce = true
  })
  ipcMain.handle('tool:restart', async () => {
    await start(settings)
    startedOnce = true
  })
  ipcMain.handle('tool:send', (_event, text: unknown) => {
    if (typeof text !== 'string') return { ok: false, error: 'Nothing to send.' }
    return sendText(text)
  })
  ipcMain.handle('claude:open', async (_event, text: unknown, mode: unknown) => {
    const body = typeof text === 'string' ? text.slice(0, 14_000) : ''
    const query = body ? `?q=${encodeURIComponent(body)}` : ''
    const url =
      mode === 'code'
        ? `claude://code/new${query}${query ? '&' : '?'}folder=${encodeURIComponent(settings.cwd)}`
        : `claude://claude.ai/new${query}`
    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not open Claude Desktop.'
      }
    }
  })
  ipcMain.handle('clips:copy', (_event, id: unknown) => {
    if (typeof id === 'string') copyClip(id)
  })
  ipcMain.handle('clips:favorite', (_event, id: unknown) => {
    if (typeof id !== 'string') return listClips()
    return toggleFavorite(id)
  })
  ipcMain.handle('clips:delete', (_event, id: unknown) => {
    if (typeof id !== 'string') return listClips()
    return deleteClip(id)
  })
  ipcMain.handle('clips:clear', () => clearHistory())
  ipcMain.handle('notes:create', () => createNote())
  ipcMain.handle('notes:update', (_event, id: unknown, body: unknown) => {
    if (typeof id !== 'string' || typeof body !== 'string') return null
    return updateNote(id, body)
  })
  ipcMain.handle('notes:rename', (_event, id: unknown, title: unknown) => {
    if (typeof id !== 'string' || typeof title !== 'string') return null
    return renameNote(id, title)
  })
  ipcMain.handle('notes:delete', (_event, id: unknown) => {
    if (typeof id !== 'string') return listNotes()
    return deleteNote(id)
  })
  ipcMain.handle('notes:body', (_event, id: unknown) => {
    if (typeof id !== 'string') return null
    return noteBody(id)
  })
  ipcMain.handle('clips:text', (_event, id: unknown) => {
    if (typeof id !== 'string') return null
    return clipText(id)
  })
}

function toggleShelf(): void {
  ignoreBlurUntil = Date.now() + 400
  if (visible) hideShelf()
  else showShelf()
}

// Time constant for following the fingers; bigger = softer, laggier.
const FOLLOW_TAU_MS = 70

function trackShelf(frame: CocoaFrame, delta: number, live: boolean): void {
  if (!win || delta === 0) return
  slideToken += 1
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
  const display = displayForCocoaFrame(frame)
  const area = display.workArea
  const height = shelfHeight(area.height)
  const openY = area.y
  const hiddenY = area.y - height
  const now = Date.now()
  if (!tracking) {
    tracking = true
    ignoreBlurUntil = Date.now() + 10_000
    app.setActivationPolicy('regular')
    const current = win.getBounds()
    const onThisDisplay = Math.abs(current.x - area.x) < 40 && Math.abs(current.width - area.width) < 40
    const startY = win.isVisible() && onThisDisplay ? clamp(current.y, hiddenY, openY) : hiddenY
    win.setBounds({ x: area.x, y: startY, width: area.width, height })
    if (!win.isVisible()) win.showInactive()
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setAlwaysOnTop(true, 'floating')
    trackCurrentY = startY
    trackTargetY = startY
    trackVelocity = 0
    trackLastEventAt = now
  }
  // Accumulate into a target; the frame loop eases the window toward it so
  // movement is decoupled from the irregular timing of scroll events.
  trackTargetY = clamp(trackTargetY + delta, hiddenY, openY)
  const dt = Math.max(1, now - trackLastEventAt)
  trackLastEventAt = now
  trackVelocity = trackVelocity * 0.75 + (delta / dt) * 0.25
  frameMs = 1000 / (display.displayFrequency || 60)
  if (!frameTimer) {
    let last = performance.now()
    const tick = () => {
      if (!win || !tracking) {
        frameTimer = null
        return
      }
      const t0 = performance.now()
      const dtMs = t0 - last
      last = t0
      // Frame-rate independent smoothing: same feel at 60/120Hz or under load.
      const alpha = 1 - Math.exp(-dtMs / FOLLOW_TAU_MS)
      const gap = trackTargetY - trackCurrentY
      trackCurrentY = Math.abs(gap) < 0.25 ? trackTargetY : trackCurrentY + gap * alpha
      const y = Math.round(trackCurrentY)
      if (y !== win.getBounds().y) win.setBounds({ x: area.x, y, width: area.width, height })
      visible = trackCurrentY > hiddenY + 4
      frameTimer = setTimeout(tick, Math.max(1, frameMs - (performance.now() - t0)))
    }
    frameTimer = setTimeout(tick, 0)
  }
  // Mouse wheels have no end phase; fingers can lose theirs. Settle after a pause either way.
  settleTimer = setTimeout(() => settleShelf(), live ? 700 : 130)
}

function stopFrameLoop(): void {
  if (!frameTimer) return
  clearTimeout(frameTimer)
  frameTimer = null
}

function settleShelf(): void {
  if (!tracking || !win) return
  tracking = false
  stopFrameLoop()
  clearTimeout(settleTimer as NodeJS.Timeout) // trackShelf always arms it before a gesture can settle
  settleTimer = null
  setGestureVisible(visible)
  const bounds = win.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const openY = display.workArea.y
  const progress = (trackTargetY - (openY - bounds.height)) / bounds.height
  // A release this fast (px/ms) counts as a flick and overrides position.
  const flick = 0.9
  const stale = Date.now() - trackLastEventAt > 120
  const v = stale ? 0 : trackVelocity
  if (v > flick) showShelf(display)
  else if (v < -flick) hideShelf()
  else if (progress > 0.28) showShelf(display)
  else hideShelf()
}

function showShelf(display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())): void {
  if (!win) return
  const area = display.workArea
  const height = shelfHeight(area.height)
  const bounds = { x: area.x, y: area.y, width: area.width, height }
  const wasVisible = visible
  visible = true
  ignoreBlurUntil = Date.now() + 800
  app.setActivationPolicy('regular')
  if (!wasVisible) {
    win.setBounds({ ...bounds, y: area.y - height })
    win.show()
  }
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'floating')
  win.moveTop()
  slideWindow(bounds.y)
  app.focus({ steal: true })
  win.focus()
  setGestureVisible(true)
  win.webContents.send('shelf:shown')
  if (!startedOnce && !isRunning()) {
    startedOnce = true
    void start(settings)
  }
}

function hideShelf(): void {
  if (!win) return
  if (!visible && !win.isVisible()) return
  visible = false
  blurArmed = false
  const bounds = win.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const hiddenY = display.workArea.y - bounds.height
  setGestureVisible(false)
  slideWindow(hiddenY, () => {
    /* v8 ignore next -- @preserve defensive: anything that shows the shelf or starts a drag also bumps slideToken, which cancels this slide before it can finish */
    if (visible || tracking || !win) return
    win.hide()
    app.dock?.hide()
    app.setActivationPolicy('accessory')
  })
}

function slideWindow(targetY: number, done?: () => void): void {
  /* v8 ignore next -- @preserve defensive: both callers have already checked that the window exists */
  if (!win) return
  const token = ++slideToken
  const start = win.getBounds()
  const fromY = start.y
  const distance = targetY - fromY
  if (Math.abs(distance) < 2) {
    done?.()
    return
  }
  const duration = 480
  const startedAt = Date.now()
  stopFrameLoop()
  const step = () => {
    if (token !== slideToken || !win) return
    const t0 = performance.now()
    const t = Math.min(1, (Date.now() - startedAt) / duration)
    const eased = 1 - (1 - t) ** 4
    win.setBounds({
      x: start.x,
      y: Math.round(fromY + distance * eased),
      width: start.width,
      height: start.height
    })
    if (t < 1) setTimeout(step, Math.max(1, frameMs - (performance.now() - t0)))
    else done?.()
  }
  step()
}

function displayForCocoaFrame(frame: { x: number; y: number; width: number; height: number }) {
  const primary = screen.getPrimaryDisplay()
  const top = primary.bounds.y + primary.bounds.height - (frame.y + frame.height)
  return screen.getDisplayNearestPoint({
    x: Math.round(frame.x + frame.width / 2),
    y: Math.round(top + frame.height / 2)
  })
}

function shelfHeight(workAreaHeight: number): number {
  const wanted = Math.round(workAreaHeight * settings.heightRatio)
  return Math.min(workAreaHeight, Math.max(240, wanted))
}

function persist(): void {
  /* v8 ignore next -- @preserve defensive: only IPC handlers call this, and they are registered after the database is opened */
  if (!database) return
  writeSettings(database, settings)
}

function applyConfig(current: Settings, config: unknown): Settings {
  if (!config || typeof config !== 'object') return current
  const patch = config as ToolConfig
  return {
    ...current,
    presetId: isPresetId(patch.presetId) ? patch.presetId : current.presetId,
    customCommand: typeof patch.customCommand === 'string' ? patch.customCommand : current.customCommand,
    cwd: typeof patch.cwd === 'string' && patch.cwd.startsWith('/') ? patch.cwd : current.cwd
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}
