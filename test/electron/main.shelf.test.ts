import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootMain, mockFactories, type Booted } from '../helpers/boot-main'

vi.mock('../../electron/pty', () => mockFactories.pty())
vi.mock('../../electron/gesture', () => mockFactories.gesture())
vi.mock('../../electron/clipboard', () => mockFactories.clipboard())

// Work area is y=34, 900 tall, so the shelf is 468px (52%): open at y=34, hidden at y=-434.
const OPEN_Y = 34
const HIDDEN_Y = 34 - 468
const FRAME = { x: 0, y: 0, width: 1600, height: 934 }

const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'], now: 1_000_000 })
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function booted(options: Parameters<typeof bootMain>[0] = {}) {
  const m = await bootMain(options)
  fake()
  return m
}

/** Show the shelf via the shortcut and let the slide finish. */
async function open(m: Booted) {
  m.app.fire('activate')
  await advance(600)
}

const menu = (m: Booted) => {
  m.Tray.instances[0].fire('right-click')
  return (m.Menu.buildFromTemplate.mock.calls.at(-1)?.[0] ?? []) as Record<string, unknown>[]
}

const item = (items: Record<string, unknown>[], label: string) => {
  const found = items.find((i) => i.label === label)
  if (!found) throw new Error(`no menu item "${label}"`)
  return found as Record<string, unknown> & { click: () => void }
}
const click = (items: Record<string, unknown>[], label: string) => item(items, label).click()

describe('the menu-bar icon', () => {
  it('is a template image with a tooltip, and clicking it toggles the shelf', async () => {
    const m = await booted()
    const tray = m.Tray.instances[0]
    expect((tray.image as { setTemplateImage: unknown }).setTemplateImage).toHaveBeenCalledWith(true)
    expect(tray.setToolTip).toHaveBeenCalledWith('Pullshelf')
    tray.fire('click')
    await advance(600)
    expect(m.win().bounds.y).toBe(OPEN_Y)
    tray.fire('click')
    await advance(600)
    expect(m.win().hide).toHaveBeenCalled()
  })

  it('right-click shows a menu that reflects the current state', async () => {
    const m = await booted()
    m.gesture.gestureTrusted.mockReturnValue(false)
    let items = menu(m)
    expect(m.Tray.instances[0].popUpContextMenu).toHaveBeenCalledWith({ template: items })
    // A dev build has no "Launch at login".
    expect(items.map((i) => i.label)).toEqual([
      'Show Pullshelf', undefined, 'Hide menu bar icon', 'Enable scroll gesture…', 'Toggle Developer Tools', undefined, 'Quit Pullshelf'
    ])
    expect(item(items, 'Enable scroll gesture…').enabled).toBe(true)
    expect(item(items, 'Toggle Developer Tools').visible).toBe(true)

    await open(m)
    m.gesture.gestureTrusted.mockReturnValue(true)
    m.electronState.isPackaged = true
    items = menu(m)
    expect(items[0].label).toBe('Hide Pullshelf')
    expect(items[0].accelerator).toBe('CommandOrControl+Shift+L')
    expect(item(items, 'Scroll gesture on')).toMatchObject({ enabled: false })
    expect(item(items, 'Toggle Developer Tools').visible).toBe(false)
    expect(item(items, 'Launch at login')).toMatchObject({ type: 'checkbox', checked: false })
    m.electronState.openAtLogin = true
    expect(item(menu(m), 'Launch at login').checked).toBe(true)
  })

  it('menu items do what they say', async () => {
    const m = await booted()
    const items = menu(m)
    click(items, 'Enable scroll gesture…')
    expect(m.gesture.promptGestureTrust).toHaveBeenCalled()
    click(items, 'Toggle Developer Tools')
    expect(m.win().webContents.toggleDevTools).toHaveBeenCalled()
    click(items, 'Quit Pullshelf')
    expect(m.app.quit).toHaveBeenCalled()
    click(items, 'Show Pullshelf')
    await advance(600)
    expect(m.win().bounds.y).toBe(OPEN_Y)
  })

  it('"Launch at login" flips the login item', async () => {
    const m = await booted({ beforeImport: (e) => (e.electronState.isPackaged = true) })
    click(menu(m), 'Launch at login')
    expect(m.app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true })
    expect(item(menu(m), 'Launch at login').checked).toBe(true)
    click(menu(m), 'Launch at login')
    expect(m.app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false })
  })

  it('"Hide menu bar icon" removes the icon but the shelf stays reachable', async () => {
    const m = await booted()
    const tray = m.Tray.instances[0]
    click(menu(m), 'Hide menu bar icon')
    expect(tray.destroy).toHaveBeenCalled()
    expect(m.savedSettings().showTrayIcon).toBe(false)
    const toggle = m.globalShortcut.register.mock.calls[0][1]
    toggle()
    await advance(600)
    expect(m.win().bounds.y).toBe(OPEN_Y)
  })

  it('the developer-tools item is harmless once the window is gone', async () => {
    const m = await booted()
    const items = menu(m)
    m.win().fire('closed')
    expect(() => click(items, 'Toggle Developer Tools')).not.toThrow()
  })
})

describe('showing and hiding', () => {
  it('slides the shelf down from just above the screen, focused, and tells everyone', async () => {
    const m = await booted()
    m.app.fire('activate')
    expect(m.app.setActivationPolicy).toHaveBeenLastCalledWith('regular')
    expect(m.win().show).toHaveBeenCalledTimes(1)
    expect(m.win().setBounds.mock.calls[0][0]).toEqual({ x: 0, y: HIDDEN_Y, width: 1600, height: 468 })
    expect(m.win().moveTop).toHaveBeenCalled()
    expect(m.app.focus).toHaveBeenCalledWith({ steal: true })
    expect(m.win().focus).toHaveBeenCalled()
    expect(m.gesture.setGestureVisible).toHaveBeenLastCalledWith(true)
    expect(m.sent().at(-1)).toEqual(['shelf:shown'])
    await advance(100)
    const midway = m.win().bounds.y
    expect(midway).toBeGreaterThan(HIDDEN_Y)
    expect(midway).toBeLessThan(OPEN_Y)
    await advance(500)
    expect(m.win().bounds.y).toBe(OPEN_Y)
  })

  it('starts the tool the first time the shelf opens, and not again', async () => {
    const m = await booted()
    await open(m)
    expect(m.pty.start).toHaveBeenCalledTimes(1)
    m.app.fire('second-instance')
    expect(m.pty.start).toHaveBeenCalledTimes(1)
  })

  it('does not start a tool that is already running', async () => {
    const m = await booted()
    m.pty.isRunning.mockReturnValue(true)
    await open(m)
    expect(m.pty.start).not.toHaveBeenCalled()
  })

  it('showing an already visible shelf just re-raises it', async () => {
    const m = await booted()
    await open(m)
    m.win().show.mockClear()
    m.app.fire('second-instance')
    expect(m.win().show).not.toHaveBeenCalled()
    expect(m.win().focus).toHaveBeenCalled()
  })

  it('slides back up and hides the window, then returns to a menu-bar-only app', async () => {
    const m = await booted()
    await open(m)
    m.ipcMain.send('shelf:hide')
    expect(m.gesture.setGestureVisible).toHaveBeenLastCalledWith(false)
    await advance(100)
    expect(m.win().hide).not.toHaveBeenCalled()
    await advance(600)
    expect(m.win().bounds.y).toBe(HIDDEN_Y)
    expect(m.win().hide).toHaveBeenCalled()
    expect(m.app.setActivationPolicy).toHaveBeenLastCalledWith('accessory')
    expect(m.app.dock.hide).toHaveBeenCalledTimes(2)
  })

  it('hiding works without a Dock object', async () => {
    const m = await booted({ beforeImport: (e) => ((e.app as { dock?: unknown }).dock = undefined) })
    await open(m)
    m.ipcMain.send('shelf:hide')
    await advance(700)
    expect(m.win().hide).toHaveBeenCalled()
  })

  it('does not hide if the shelf was shown again while sliding away', async () => {
    const m = await booted()
    await open(m)
    m.ipcMain.send('shelf:hide')
    await advance(200)
    m.app.fire('second-instance')
    await advance(1000)
    expect(m.win().hide).not.toHaveBeenCalled()
    expect(m.win().bounds.y).toBe(OPEN_Y)
  })

  it('does not hide a window that is being dragged, or one that was destroyed', async () => {
    const m = await booted()
    await open(m)
    m.ipcMain.send('shelf:hide')
    await advance(100)
    m.listener().onDrag(FRAME, 5, true) // a new gesture grabs the shelf mid-slide
    await advance(1000)
    expect(m.win().hide).not.toHaveBeenCalled()

    const n = await booted()
    await open(n)
    n.ipcMain.send('shelf:hide')
    await advance(100)
    n.win().fire('closed')
    await advance(1000)
    expect(n.win().hide).not.toHaveBeenCalled()
  })

  it('hiding a shelf that is already hidden and offscreen does nothing', async () => {
    const m = await booted()
    m.ipcMain.send('shelf:hide')
    expect(m.gesture.setGestureVisible).not.toHaveBeenCalled()
  })

  it('hides immediately when the visible shelf is already at the hidden position', async () => {
    const m = await booted()
    await open(m)
    m.win().bounds.y = HIDDEN_Y // moved out of sight by something else
    m.ipcMain.send('shelf:hide')
    expect(m.win().hide).toHaveBeenCalled()
  })

  it('the global shortcut toggles', async () => {
    const m = await booted()
    const toggle = m.globalShortcut.register.mock.calls[0][1]
    toggle()
    await advance(600)
    expect(m.win().bounds.y).toBe(OPEN_Y)
    toggle()
    await advance(600)
    expect(m.win().hide).toHaveBeenCalled()
  })

  it('ignores show and hide after the window has been destroyed', async () => {
    const m = await booted()
    m.win().fire('closed')
    expect(() => {
      m.app.fire('activate')
      m.ipcMain.send('shelf:hide')
    }).not.toThrow()
    expect(m.win().show).not.toHaveBeenCalled()
  })
})

describe('clicking away', () => {
  it('hides the shelf shortly after it loses focus', async () => {
    const m = await booted()
    await open(m)
    await advance(400) // past the 800 ms grace period after opening
    m.win().fire('focus')
    m.win().fire('blur')
    await advance(159)
    expect(m.gesture.setGestureVisible).toHaveBeenLastCalledWith(true)
    await advance(10)
    expect(m.gesture.setGestureVisible).toHaveBeenLastCalledWith(false)
  })

  it('keeps it open when it never had focus, is not visible, or just opened', async () => {
    const m = await booted()
    // not visible at all
    m.win().fire('focus')
    m.win().fire('blur')
    await advance(200)
    expect(m.gesture.setGestureVisible).not.toHaveBeenCalled()

    // visible but never focused
    const n = await booted()
    await open(n)
    n.win().fire('blur')
    await advance(200)
    expect(n.gesture.setGestureVisible).toHaveBeenLastCalledWith(true)

    // blur right after opening is ignored for the first 800 ms
    const o = await booted()
    o.app.fire('activate')
    o.win().fire('focus')
    o.win().fire('blur')
    await advance(200)
    expect(o.gesture.setGestureVisible).toHaveBeenLastCalledWith(true)
  })

  it('keeps it open while a gesture is dragging it', async () => {
    const m = await booted()
    await open(m)
    m.win().fire('focus')
    m.listener().onDrag(FRAME, -5, true)
    m.win().fire('blur')
    await advance(200)
    expect(m.gesture.setGestureVisible).not.toHaveBeenCalledWith(false)
  })

  it('keeps it open while a file drag or a resize is in progress', async () => {
    const m = await booted()
    await open(m)
    m.win().fire('focus')
    m.ipcMain.send('shelf:keep-open')
    m.win().fire('blur')
    await advance(200)
    expect(m.gesture.setGestureVisible).toHaveBeenLastCalledWith(true)
  })
})

describe('pulling the shelf with the trackpad', () => {
  it('follows the fingers, then opens when released past the threshold', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 250, true)
    expect(m.app.setActivationPolicy).toHaveBeenCalledWith('regular')
    expect(m.win().showInactive).toHaveBeenCalled()
    expect(m.win().setBounds.mock.calls[0][0]).toEqual({ x: 0, y: HIDDEN_Y, width: 1600, height: 468 })
    await advance(300)
    expect(m.win().bounds.y).toBeGreaterThan(HIDDEN_Y)
    expect(m.win().bounds.y).toBeLessThanOrEqual(HIDDEN_Y + 250)
    await advance(300)
    expect(m.win().bounds.y).toBe(HIDDEN_Y + 250) // eased all the way to the finger position
    m.listener().onRelease()
    await advance(700)
    expect(m.win().bounds.y).toBe(OPEN_Y)
    expect(m.gesture.setGestureVisible).toHaveBeenLastCalledWith(true)
  })

  it('springs back closed when released with only a small pull', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 50, true)
    await advance(300) // long enough that the release is not treated as a flick
    m.listener().onRelease()
    await advance(700)
    expect(m.win().bounds.y).toBe(HIDDEN_Y)
    expect(m.win().hide).toHaveBeenCalled()
  })

  it('a quick flick down opens it even from a small pull', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 20, true)
    m.listener().onRelease()
    await advance(700)
    expect(m.win().bounds.y).toBe(OPEN_Y)
  })

  it('a quick flick up closes it even when it is mostly open', async () => {
    const m = await booted()
    await open(m)
    m.listener().onDrag(FRAME, -20, true)
    m.listener().onRelease()
    await advance(700)
    expect(m.win().bounds.y).toBe(HIDDEN_Y)
    expect(m.win().hide).toHaveBeenCalled()
  })

  it('a slow pull back up past the halfway point still closes it, but a small nudge leaves it open', async () => {
    const m = await booted()
    await open(m)
    m.listener().onDrag(FRAME, -100, true)
    await advance(300)
    m.listener().onRelease()
    await advance(700)
    expect(m.win().bounds.y).toBe(OPEN_Y)

    m.listener().onDrag(FRAME, -400, true)
    await advance(300)
    m.listener().onRelease()
    await advance(700)
    expect(m.win().bounds.y).toBe(HIDDEN_Y)
  })

  it('never goes beyond fully open or fully hidden', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 5000, true)
    await advance(800)
    expect(m.win().bounds.y).toBe(OPEN_Y)
    m.listener().onDrag(FRAME, -9000, true)
    await advance(800)
    expect(m.win().bounds.y).toBe(HIDDEN_Y)
  })

  it('does not restart the gesture on later events', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 10, true)
    m.listener().onDrag(FRAME, 10, true)
    m.listener().onDrag(FRAME, 10, true)
    expect(m.win().showInactive).toHaveBeenCalledTimes(1)
    expect(m.app.setActivationPolicy.mock.calls.filter(([policy]) => policy === 'regular')).toHaveLength(1)
  })

  it('does not show the window again when it is already on screen', async () => {
    const m = await booted()
    await open(m)
    m.listener().onDrag(FRAME, -5, true)
    expect(m.win().showInactive).not.toHaveBeenCalled()
  })

  it('starts from the top when the window sits on a different display', async () => {
    const m = await booted()
    await open(m)
    m.win().bounds.x = 3000
    m.listener().onDrag(FRAME, 5, true)
    expect(m.win().setBounds.mock.calls.at(-1)?.[0]).toEqual({ x: 0, y: HIDDEN_Y, width: 1600, height: 468 })
  })

  it('also starts from the top when the window is visible but its width differs', async () => {
    const m = await booted()
    await open(m)
    m.win().bounds.width = 800
    m.listener().onDrag(FRAME, 5, true)
    expect(m.win().setBounds.mock.calls.at(-1)?.[0].y).toBe(HIDDEN_Y)
  })

  it('ignores zero-length movements and releases when nothing is being dragged', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 0, true)
    m.listener().onRelease()
    expect(m.win().setBounds).not.toHaveBeenCalled()
    expect(m.app.setActivationPolicy).not.toHaveBeenCalledWith('regular')
  })

  it('settles by itself for a mouse wheel (no release event) after 130 ms', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 300, false)
    await advance(129)
    expect(m.gesture.setGestureVisible).not.toHaveBeenCalled()
    await advance(2)
    expect(m.gesture.setGestureVisible).toHaveBeenCalled()
    await advance(700)
    expect(m.win().bounds.y).toBe(OPEN_Y)
  })

  it('settles by itself after 700 ms of silence when a finger release is lost', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 300, true)
    await advance(650)
    expect(m.gesture.setGestureVisible).not.toHaveBeenCalled()
    await advance(100)
    expect(m.gesture.setGestureVisible).toHaveBeenCalled()
  })

  it('each new movement postpones the automatic settle', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 100, false)
    await advance(100)
    m.listener().onDrag(FRAME, 100, false)
    await advance(100)
    expect(m.gesture.setGestureVisible).not.toHaveBeenCalled()
    await advance(60)
    expect(m.gesture.setGestureVisible).toHaveBeenCalled()
  })

  it('works on 120 Hz displays', async () => {
    const m = await booted()
    m.electronState.displayFrequency = 120
    m.listener().onDrag(FRAME, 200, true)
    await advance(600) // before the 700 ms lost-release settle
    expect(m.win().bounds.y).toBe(HIDDEN_Y + 200)
  })

  it('falls back to 60 Hz when the refresh rate is unknown', async () => {
    const m = await booted()
    m.electronState.displayFrequency = 0
    m.listener().onDrag(FRAME, 200, true)
    await advance(600) // before the 700 ms lost-release settle
    expect(m.win().bounds.y).toBe(HIDDEN_Y + 200)
  })

  it('stops following when the window is destroyed mid-gesture', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 200, true)
    await advance(50)
    m.win().fire('closed')
    const calls = m.win().setBounds.mock.calls.length
    await advance(2000)
    expect(m.win().setBounds.mock.calls.length).toBe(calls)
    expect(() => {
      m.listener().onDrag(FRAME, 10, true)
      m.listener().onRelease()
    }).not.toThrow()
  })

  it('a gesture takes over from a slide that is still running', async () => {
    const m = await booted()
    m.app.fire('activate') // slide starts
    await advance(100)
    const y = m.win().bounds.y
    m.listener().onDrag(FRAME, -20, true)
    await advance(300)
    // The old slide no longer drives the window: it would be nearly open by now.
    // Only the gesture loop moves it, easing towards 20px above where it was grabbed.
    expect(m.win().bounds.y).toBeLessThanOrEqual(y)
    expect(m.win().bounds.y).toBeGreaterThanOrEqual(y - 20)
  })

  it('reports the shelf as not visible to the helper when released while still hidden', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 2, true)
    await advance(300)
    m.listener().onRelease()
    expect(m.gesture.setGestureVisible).toHaveBeenCalledWith(false)
  })

  it('finds the right display for a frame offset from the primary', async () => {
    const m = await booted()
    m.listener().onDrag({ x: 1600, y: 0, width: 1200, height: 800 }, 5, true)
    expect(m.screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 2200, y: 534 })
  })

  it('animates the cancel path: a settle during a show does not double-slide', async () => {
    const m = await booted()
    m.listener().onDrag(FRAME, 400, true)
    m.listener().onRelease()
    m.listener().onRelease() // a second release is a no-op
    await advance(700)
    expect(m.win().bounds.y).toBe(OPEN_Y)
  })
})
