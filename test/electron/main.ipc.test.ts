import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootMain, mockFactories } from '../helpers/boot-main'
import { tempDir } from '../helpers/tmp'

vi.mock('../../electron/pty', () => mockFactories.pty())
vi.mock('../../electron/gesture', () => mockFactories.gesture())
vi.mock('../../electron/clipboard', () => mockFactories.clipboard())

afterEach(() => {
  vi.restoreAllMocks()
})

const aFile = (name = 'a.txt') => {
  const path = join(tempDir(), name)
  writeFileSync(path, 'x')
  return path
}

describe('state and layout', () => {
  it('app:get-state gathers everything the page needs', async () => {
    const m = await bootMain()
    const state = (await m.ipcMain.invoke('app:get-state')) as Record<string, unknown>
    expect(state).toMatchObject({
      files: [], clips: [], notes: [], shortcut: '⌘⇧L', gestureTrusted: false, canAutoLaunch: false, launchAtLogin: false,
      settings: { presetId: 'claude', toolRatio: 0.4, clipRatio: 0.18, filesRatio: 0.2, heightRatio: 0.52, showTrayIcon: true },
      tool: { running: false }
    })
  })

  it('pty:snapshot returns the scrollback', async () => {
    const m = await bootMain()
    expect(await m.ipcMain.invoke('pty:snapshot')).toEqual({ buffer: 'buf', rev: 3 })
  })

  it('settings:layout clamps and saves the pane ratios', async () => {
    const m = await bootMain()
    await m.ipcMain.invoke('settings:layout', 0.3, 5, -1)
    expect(m.savedSettings()).toMatchObject({ toolRatio: 0.3, clipRatio: 0.8, filesRatio: 0.08 })
    const state = (await m.ipcMain.invoke('app:get-state')) as { settings: { toolRatio: number } }
    expect(state.settings.toolRatio).toBe(0.3)
  })

  it('settings:layout ignores values that are not numbers', async () => {
    const m = await bootMain()
    await m.ipcMain.invoke('settings:layout', 0.3, 'x', 0.2)
    await m.ipcMain.invoke('settings:layout', 0.3, 0.2, undefined)
    await m.ipcMain.invoke('settings:layout', null, 0.2, 0.2)
    expect(m.savedSettings().toolRatio).toBe(0.4)
  })

  it('treats NaN ratios as the minimum', async () => {
    const m = await bootMain()
    await m.ipcMain.invoke('settings:layout', Number.NaN, 0.2, 0.2)
    expect(m.savedSettings().toolRatio).toBe(0.08)
  })
})

describe('the tool pane', () => {
  it('pty:write and pty:resize pass valid input through and drop anything else', async () => {
    const m = await bootMain()
    m.ipcMain.send('pty:write', 'ls')
    m.ipcMain.send('pty:write', 42)
    m.ipcMain.send('pty:resize', 120, 40)
    m.ipcMain.send('pty:resize', '120', 40)
    m.ipcMain.send('pty:resize', 120, undefined)
    expect(m.pty.write.mock.calls).toEqual([['ls']])
    expect(m.pty.resize.mock.calls).toEqual([[120, 40]])
  })

  it('tool:send forwards text, and refuses anything else', async () => {
    const m = await bootMain()
    expect(await m.ipcMain.invoke('tool:send', 'hello')).toEqual({ ok: true })
    expect(m.pty.sendText).toHaveBeenCalledWith('hello')
    expect(await m.ipcMain.invoke('tool:send', 5)).toEqual({ ok: false, error: 'Nothing to send.' })
  })

  it('tool:configure applies valid changes, saves them and restarts the tool', async () => {
    const m = await bootMain()
    await m.ipcMain.invoke('tool:configure', { presetId: 'custom', customCommand: 'htop', cwd: '/projects/app' })
    expect(m.savedSettings()).toMatchObject({ presetId: 'custom', customCommand: 'htop', cwd: '/projects/app' })
    expect(m.pty.start).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'custom', customCommand: 'htop', cwd: '/projects/app' }))
  })

  it('tool:configure ignores invalid fields but still restarts', async () => {
    const m = await bootMain()
    await m.ipcMain.invoke('tool:configure', { presetId: 'emacs', customCommand: 7, cwd: 'relative/path' })
    expect(m.savedSettings()).toMatchObject({ presetId: 'claude', customCommand: '' })
    expect(m.savedSettings().cwd).not.toBe('relative/path')
    expect(m.pty.start).toHaveBeenCalledTimes(1)
  })

  it('tool:configure with no changes object keeps everything', async () => {
    const m = await bootMain()
    await m.ipcMain.invoke('tool:configure', null)
    await m.ipcMain.invoke('tool:configure', 'text')
    expect(m.savedSettings().presetId).toBe('claude')
    expect(m.pty.start).toHaveBeenCalledTimes(2)
  })

  it('tool:restart restarts with the current settings, and counts as the first start', async () => {
    const m = await bootMain()
    await m.ipcMain.invoke('tool:restart')
    expect(m.pty.start).toHaveBeenCalledTimes(1)
    m.app.fire('activate') // showing the shelf must not start a second copy
    expect(m.pty.start).toHaveBeenCalledTimes(1)
  })
})

describe('menu-bar preferences', () => {
  const prefs = (m: Awaited<ReturnType<typeof bootMain>>) => m.sent().filter(([channel]) => channel === 'prefs:changed')

  it('app:quit quits the app', async () => {
    const m = await bootMain()
    m.ipcMain.send('app:quit')
    expect(m.app.quit).toHaveBeenCalledTimes(1)
  })

  it('app:set-tray-visible hides and restores the icon, saves the choice and tells the page', async () => {
    const m = await bootMain()
    const first = m.Tray.instances[0]
    m.ipcMain.send('app:set-tray-visible', false)
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(m.savedSettings().showTrayIcon).toBe(false)
    expect(prefs(m).at(-1)).toEqual(['prefs:changed', { showTrayIcon: false, launchAtLogin: false }])
    m.ipcMain.send('app:set-tray-visible', false) // already hidden: nothing more to destroy
    expect(first.destroy).toHaveBeenCalledTimes(1)

    m.ipcMain.send('app:set-tray-visible', true)
    expect(m.Tray.instances).toHaveLength(2)
    expect(m.savedSettings().showTrayIcon).toBe(true)
    expect(prefs(m).at(-1)).toEqual(['prefs:changed', { showTrayIcon: true, launchAtLogin: false }])
    m.ipcMain.send('app:set-tray-visible', true) // already shown: no second icon
    expect(m.Tray.instances).toHaveLength(2)
    const state = (await m.ipcMain.invoke('app:get-state')) as { settings: { showTrayIcon: boolean } }
    expect(state.settings.showTrayIcon).toBe(true)
  })

  it('app:set-tray-visible ignores anything that is not a boolean', async () => {
    const m = await bootMain()
    m.ipcMain.send('app:set-tray-visible', 'no')
    m.ipcMain.send('app:set-tray-visible', undefined)
    expect(m.Tray.instances[0].destroy).not.toHaveBeenCalled()
    expect(prefs(m)).toHaveLength(0)
  })

  it('app:set-tray-visible still works once the window is gone', async () => {
    const m = await bootMain()
    m.win().fire('closed')
    expect(() => m.ipcMain.send('app:set-tray-visible', false)).not.toThrow()
    expect(m.savedSettings().showTrayIcon).toBe(false)
  })

  it('app:set-launch-at-login toggles the login item of the installed app and tells the page', async () => {
    const m = await bootMain({ beforeImport: (e) => (e.electronState.isPackaged = true) })
    const state = (await m.ipcMain.invoke('app:get-state')) as { canAutoLaunch: boolean; launchAtLogin: boolean }
    expect(state).toMatchObject({ canAutoLaunch: true, launchAtLogin: false })
    m.ipcMain.send('app:set-launch-at-login', true)
    expect(m.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true })
    expect(prefs(m).at(-1)).toEqual(['prefs:changed', { showTrayIcon: true, launchAtLogin: true }])
    expect(((await m.ipcMain.invoke('app:get-state')) as { launchAtLogin: boolean }).launchAtLogin).toBe(true)
    m.ipcMain.send('app:set-launch-at-login', false)
    expect(m.app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false })
  })

  it('app:set-launch-at-login refuses in a dev build and ignores non-booleans', async () => {
    const dev = await bootMain()
    dev.ipcMain.send('app:set-launch-at-login', true)
    expect(dev.app.setLoginItemSettings).not.toHaveBeenCalled()
    expect(prefs(dev)).toHaveLength(0)
    const packaged = await bootMain({ beforeImport: (e) => (e.electronState.isPackaged = true) })
    packaged.ipcMain.send('app:set-launch-at-login', 'yes')
    expect(packaged.app.setLoginItemSettings).not.toHaveBeenCalled()
  })
})

describe('claude:open', () => {
  it('opens a new chat, with or without text', async () => {
    const m = await bootMain()
    expect(await m.ipcMain.invoke('claude:open', '', 'chat')).toEqual({ ok: true })
    expect(m.shell.openExternal).toHaveBeenLastCalledWith('claude://claude.ai/new')
    await m.ipcMain.invoke('claude:open', 'hi there & more', 'chat')
    expect(m.shell.openExternal).toHaveBeenLastCalledWith('claude://claude.ai/new?q=hi%20there%20%26%20more')
  })

  it('opens Claude Code in the current folder', async () => {
    const m = await bootMain()
    await m.ipcMain.invoke('tool:configure', { cwd: '/my project' })
    await m.ipcMain.invoke('claude:open', 'fix it', 'code')
    expect(m.shell.openExternal).toHaveBeenLastCalledWith('claude://code/new?q=fix%20it&folder=%2Fmy%20project')
    await m.ipcMain.invoke('claude:open', '', 'code')
    expect(m.shell.openExternal).toHaveBeenLastCalledWith('claude://code/new?folder=%2Fmy%20project')
  })

  it('cuts very long text at 14,000 characters and ignores non-string text', async () => {
    const m = await bootMain()
    await m.ipcMain.invoke('claude:open', 'a'.repeat(20_000), 'chat')
    expect(String(m.shell.openExternal.mock.calls.at(-1)?.[0]).length).toBe('claude://claude.ai/new?q='.length + 14_000)
    await m.ipcMain.invoke('claude:open', 123, 'chat')
    expect(m.shell.openExternal).toHaveBeenLastCalledWith('claude://claude.ai/new')
  })

  it('reports why Claude could not be opened', async () => {
    const m = await bootMain()
    m.shell.openExternal.mockRejectedValueOnce(new Error('No handler'))
    expect(await m.ipcMain.invoke('claude:open', 'x', 'chat')).toEqual({ ok: false, error: 'No handler' })
    m.shell.openExternal.mockRejectedValueOnce('weird')
    expect(await m.ipcMain.invoke('claude:open', 'x', 'chat')).toEqual({ ok: false, error: 'Could not open Claude Desktop.' })
  })
})

describe('clipboard handlers', () => {
  it('pass string ids through and refuse other types', async () => {
    const m = await bootMain()
    await m.ipcMain.invoke('clips:copy', 'c1')
    await m.ipcMain.invoke('clips:copy', 5)
    expect(m.clipboard.copyClip.mock.calls).toEqual([['c1']])

    m.clipboard.toggleFavorite.mockReturnValue([{ id: 'fav' }] as never)
    m.clipboard.listClips.mockReturnValue([{ id: 'listed' }] as never)
    expect(await m.ipcMain.invoke('clips:favorite', 'c1')).toEqual([{ id: 'fav' }])
    expect(await m.ipcMain.invoke('clips:favorite', 9)).toEqual([{ id: 'listed' }])
    m.clipboard.deleteClip.mockReturnValue([{ id: 'deleted' }] as never)
    expect(await m.ipcMain.invoke('clips:delete', 'c1')).toEqual([{ id: 'deleted' }])
    expect(await m.ipcMain.invoke('clips:delete', {})).toEqual([{ id: 'listed' }])
    m.clipboard.clearHistory.mockReturnValue([{ id: 'kept' }] as never)
    expect(await m.ipcMain.invoke('clips:clear')).toEqual([{ id: 'kept' }])
    m.clipboard.clipText.mockReturnValue('body')
    expect(await m.ipcMain.invoke('clips:text', 'c1')).toBe('body')
    expect(await m.ipcMain.invoke('clips:text', 1)).toBeNull()
  })
})

describe('notes handlers', () => {
  it('create, update, rename, read and delete work against the real database', async () => {
    const m = await bootMain()
    const note = (await m.ipcMain.invoke('notes:create')) as { id: string }
    expect(await m.ipcMain.invoke('notes:update', note.id, '# Hello\nworld')).toMatchObject({ title: 'Hello' })
    expect(await m.ipcMain.invoke('notes:rename', note.id, 'Custom')).toMatchObject({ title: 'Custom' })
    expect(await m.ipcMain.invoke('notes:body', note.id)).toBe('# Hello\nworld')
    const state = (await m.ipcMain.invoke('app:get-state')) as { notes: { title: string }[] }
    expect(state.notes.map((n) => n.title)).toEqual(['Custom'])
    expect(await m.ipcMain.invoke('notes:delete', note.id)).toEqual([])
  })

  it('refuse malformed arguments', async () => {
    const m = await bootMain()
    const note = (await m.ipcMain.invoke('notes:create')) as { id: string }
    expect(await m.ipcMain.invoke('notes:update', 1, 'x')).toBeNull()
    expect(await m.ipcMain.invoke('notes:update', note.id, 2)).toBeNull()
    expect(await m.ipcMain.invoke('notes:rename', 1, 'x')).toBeNull()
    expect(await m.ipcMain.invoke('notes:rename', note.id, 3)).toBeNull()
    expect(await m.ipcMain.invoke('notes:body', 4)).toBeNull()
    expect(await m.ipcMain.invoke('notes:delete', 5)).toHaveLength(1)
  })
})

describe('files handlers', () => {
  it('files:add keeps only string paths and returns the new list', async () => {
    const m = await bootMain()
    const path = aFile()
    const list = (await m.ipcMain.invoke('files:add', [path, 5, null])) as { path: string }[]
    expect(list.map((f) => f.path)).toEqual([path])
    expect(m.sent().some(([channel]) => channel === 'files:changed')).toBe(true)
  })

  it('files:add refuses a non-array and survives a failing add', async () => {
    const m = await bootMain()
    expect(await m.ipcMain.invoke('files:add', 'nope')).toEqual([])
    // Make every insert fail from a second connection to the same database.
    const Database = (await import('better-sqlite3')).default
    const other = new Database(`${m.electronState.userData}/pullshelf.db`)
    other.exec(`CREATE TRIGGER no_inserts BEFORE INSERT ON files BEGIN SELECT RAISE(ABORT, 'disk full'); END`)
    other.close()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await m.ipcMain.invoke('files:add', [aFile()])).toEqual([])
    expect(error).toHaveBeenCalledWith('Could not add files', expect.any(Error))
  })

  it('files:remove and files:clear', async () => {
    const m = await bootMain()
    const [a, b] = [aFile('a.txt'), aFile('b.txt')]
    const [first] = (await m.ipcMain.invoke('files:add', [a, b])) as { id: string }[]
    expect(await m.ipcMain.invoke('files:remove', 7)).toHaveLength(2)
    expect(await m.ipcMain.invoke('files:remove', first.id)).toHaveLength(1)
    expect(await m.ipcMain.invoke('files:clear')).toEqual([])
  })

  it('files:open opens the file, or says why it could not', async () => {
    const m = await bootMain()
    const path = aFile()
    const [entry] = (await m.ipcMain.invoke('files:add', [path])) as { id: string }[]
    expect(await m.ipcMain.invoke('files:open', entry.id)).toEqual({ ok: true })
    expect(m.shell.openPath).toHaveBeenCalledWith(path)
    m.shell.openPath.mockResolvedValueOnce('No application knows how to open this file')
    expect(await m.ipcMain.invoke('files:open', entry.id)).toEqual({ ok: false, error: 'No application knows how to open this file' })
    expect(await m.ipcMain.invoke('files:open', 'unknown')).toEqual({ ok: false, error: 'File not found.' })
    expect(await m.ipcMain.invoke('files:open', 12)).toEqual({ ok: false, error: 'File not found.' })
  })

  it('files:reveal shows the file in Finder, ignoring unknown or invalid ids', async () => {
    const m = await bootMain()
    const path = aFile()
    const [entry] = (await m.ipcMain.invoke('files:add', [path])) as { id: string }[]
    m.ipcMain.send('files:reveal', entry.id)
    m.ipcMain.send('files:reveal', 'unknown')
    m.ipcMain.send('files:reveal', 3)
    expect(m.shell.showItemInFolder.mock.calls).toEqual([[path]])
  })

  it('files:info describes a file, and reports invalid ids as missing', async () => {
    const m = await bootMain()
    const [entry] = (await m.ipcMain.invoke('files:add', [aFile('notes.txt')])) as { id: string }[]
    expect(await m.ipcMain.invoke('files:info', entry.id)).toEqual({ kind: 'file', ext: 'TXT', thumb: null })
    expect(await m.ipcMain.invoke('files:info', 5)).toEqual({ kind: 'missing', ext: '', thumb: null })
  })

  it('files:drag starts a native drag from the sender, and survives a drag that cannot start', async () => {
    const m = await bootMain()
    const path = aFile()
    const [entry] = (await m.ipcMain.invoke('files:add', [path])) as { id: string }[]
    const sender = { startDrag: vi.fn() }
    m.ipcMain.sendFrom('files:drag', sender, entry.id)
    expect(sender.startDrag).toHaveBeenCalledWith({ file: path, icon: expect.any(Object) })
    m.ipcMain.sendFrom('files:drag', sender, 'unknown')
    m.ipcMain.sendFrom('files:drag', sender, 4)
    expect(sender.startDrag).toHaveBeenCalledTimes(1)

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sender.startDrag.mockImplementationOnce(() => {
      throw new Error('drag failed')
    })
    m.ipcMain.sendFrom('files:drag', sender, entry.id)
    expect(error).toHaveBeenCalledWith('Could not start file drag', expect.any(Error))
  })
})

describe('shelf sizing', () => {
  it('shelf:resize sets the height from the top of the work area and remembers the ratio', async () => {
    const m = await bootMain()
    m.ipcMain.send('shelf:resize', 500)
    expect(m.win().bounds).toEqual({ x: 0, y: 34, width: 1600, height: 500 })
    m.ipcMain.send('shelf:resize-end')
    expect(m.savedSettings().heightRatio).toBeCloseTo(500 / 900)
  })

  it('shelf:resize clamps between 240px and the full work area', async () => {
    const m = await bootMain()
    m.ipcMain.send('shelf:resize', 10)
    expect(m.win().bounds.height).toBe(240)
    m.ipcMain.send('shelf:resize', 99_999)
    expect(m.win().bounds.height).toBe(900)
    m.ipcMain.send('shelf:resize-end')
    expect(m.savedSettings().heightRatio).toBe(0.92)
  })

  it('shelf:resize rounds fractions and ignores garbage or a missing window', async () => {
    const m = await bootMain()
    m.ipcMain.send('shelf:resize', 400.6)
    expect(m.win().bounds.height).toBe(401)
    m.win().setBounds.mockClear()
    m.ipcMain.send('shelf:resize', 'tall')
    m.ipcMain.send('shelf:resize', Number.NaN)
    m.ipcMain.send('shelf:resize', Number.POSITIVE_INFINITY)
    m.win().fire('closed')
    m.ipcMain.send('shelf:resize', 500)
    expect(m.win().setBounds).not.toHaveBeenCalled()
  })

  it('shelf:keep-open only needs to be accepted', async () => {
    const m = await bootMain()
    expect(() => m.ipcMain.send('shelf:keep-open')).not.toThrow()
  })

  it('new shows use the saved height', async () => {
    const m = await bootMain()
    m.ipcMain.send('shelf:resize', 600)
    m.ipcMain.send('shelf:resize-end')
    m.app.fire('activate')
    expect(m.win().bounds.height).toBe(600)
  })
})

describe('simple commands', () => {
  it('shelf:hide on a hidden shelf does nothing, gesture:prompt asks for trust', async () => {
    const m = await bootMain()
    m.ipcMain.send('shelf:hide')
    expect(m.win().hide).not.toHaveBeenCalled()
    m.ipcMain.send('gesture:prompt')
    expect(m.gesture.promptGestureTrust).toHaveBeenCalled()
  })
})
