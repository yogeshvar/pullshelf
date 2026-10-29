import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Shelf } from '../../src/shelf/Shelf'
import type { AppState } from '../../src/shared/types'
import { installPullshelf, makeClip, makeFile, makeNote, makeState } from '../helpers/pullshelf'

async function renderShelf(state: AppState = makeState(), overrides: Record<string, unknown> = {}) {
  const bridge = installPullshelf(state, overrides)
  const view = render(<Shelf />)
  await act(async () => undefined) // let getState resolve
  return { ...bridge, ...view }
}

const panes = () => Array.from(document.querySelectorAll<HTMLElement>('.columns > .pane'))
const dividers = () => Array.from(document.querySelectorAll<HTMLElement>('.columns > .divider'))
const columns = () => (document.querySelector('.columns') as HTMLElement).style.gridTemplateColumns
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

/** jsdom has no layout, so give each pane a width. */
function paneWidths(widths: number[]) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const index = panes().indexOf(this as HTMLElement)
    const width = index >= 0 ? widths[index] : 0
    return { width, height: 400, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 400, toJSON: () => ({}) } as DOMRect
  })
}

afterEach(() => vi.restoreAllMocks())

describe('loading', () => {
  it('shows the four panes with their data once the state arrives', async () => {
    await renderShelf(
      makeState({
        clips: [makeClip({ preview: 'clip one' })],
        notes: [makeNote({ body: 'note body' })],
        files: [makeFile({ name: 'Report.pdf' })],
        tool: { running: true, presetId: 'codex', label: 'Codex', cwd: '/', error: null, exitCode: null }
      })
    )
    expect(panes()).toHaveLength(4)
    expect(screen.getByText('clip one')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Start typing')).toHaveValue('note body')
    expect(screen.getByText('Report.pdf')).toBeInTheDocument()
    expect(screen.getByText('Codex')).toBeInTheDocument()
  })

  it('keeps showing the placeholder state until then, and ignores a late answer after unmount', async () => {
    let resolve: (state: AppState) => void = () => undefined
    installPullshelf(makeState(), { getState: vi.fn(() => new Promise<AppState>((r) => (resolve = r))) })
    const { unmount } = render(<Shelf />)
    expect(screen.getByText('Waiting to start')).toBeInTheDocument()
    unmount()
    await act(async () => resolve(makeState({ clips: [makeClip()] })))
    expect(screen.queryByText('copied text')).not.toBeInTheDocument()
  })

  it('updates live when the main process pushes changes, and unsubscribes on unmount', async () => {
    const { emit, listenerCount, unmount } = await renderShelf()
    act(() => emit('clips', [makeClip({ preview: 'pushed clip' })]))
    act(() => emit('notes', [makeNote({ body: 'pushed note' })]))
    act(() => emit('files', [makeFile({ name: 'pushed.txt' })]))
    act(() => emit('tool:status', { running: false, presetId: 'shell', label: 'Pushed tool', cwd: '/', error: null, exitCode: 0 }))
    expect(screen.getByText('pushed clip')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Start typing')).toHaveValue('pushed note')
    expect(screen.getByText('pushed.txt')).toBeInTheDocument()
    expect(screen.getByText('Pushed tool')).toBeInTheDocument()
    unmount()
    for (const name of ['clips', 'notes', 'files', 'tool:status', 'trust', 'prefs']) expect(listenerCount(name)).toBe(0)
  })

  it('shows the Accessibility banner only while the gesture is not trusted', async () => {
    const { pullshelf, emit } = await renderShelf(makeState({ gestureTrusted: false }))
    expect(screen.getByText(/Allow Accessibility to enable the pull gesture/)).toBeInTheDocument()
    click('Allow')
    expect(pullshelf.promptGesture).toHaveBeenCalled()
    act(() => emit('trust', true))
    expect(screen.queryByText(/Allow Accessibility to enable the pull gesture/)).not.toBeInTheDocument()
  })
})

describe('layout', () => {
  it('gives every open pane its share, with minimum widths, and a divider between each', async () => {
    await renderShelf()
    expect(columns()).toBe(
      'minmax(260px, 400fr) 9px minmax(200px, 180fr) 9px minmax(200px, 200fr) 9px minmax(220px, 220fr)'
    )
    expect(dividers().every((d) => !d.classList.contains('off'))).toBe(true)
  })

  it('normalises the weights of the panes that remain when one is collapsed', async () => {
    await renderShelf()
    click('Collapse Clipboard')
    expect(columns()).toBe('minmax(260px, 488fr) 0px 40px 9px minmax(200px, 244fr) 9px minmax(220px, 268fr)')
    expect(dividers().map((d) => d.classList.contains('off'))).toEqual([true, false, false])
  })

  it('hides dividers that have no open pane on one side', async () => {
    await renderShelf()
    click('Collapse Terminal')
    expect(dividers().map((d) => d.classList.contains('off'))).toEqual([true, false, false])
    click('Collapse Notes')
    expect(dividers().map((d) => d.classList.contains('off'))).toEqual([true, false, true])
  })

  it('floors very small saved ratios so no pane starts as a sliver', async () => {
    await renderShelf(makeState({ settings: { ...makeState().settings, toolRatio: 0.01, clipRatio: 0.01, filesRatio: 0.01 } }))
    const fr = [...columns().matchAll(/(\d+)fr/g)].map((m) => Number(m[1]))
    // Each of the three small panes is raised to 10% before normalising; Notes keeps the remainder.
    expect(fr.slice(0, 3)).toEqual([79, 79, 79])
    expect(fr[3]).toBeGreaterThan(700)
  })

  it('never lets all four panes collapse', async () => {
    await renderShelf()
    click('Collapse Terminal')
    click('Collapse Clipboard')
    click('Collapse Files')
    click('Collapse Notes') // last open pane: refused
    expect(screen.getByRole('button', { name: 'Collapse Notes' })).toBeInTheDocument()
    expect(panes().filter((p) => p.classList.contains('collapsed'))).toHaveLength(3)
    click('Expand Terminal')
    click('Collapse Notes')
    expect(panes().filter((p) => p.classList.contains('collapsed'))).toHaveLength(3)
  })

  it('remembers collapsed panes across restarts', async () => {
    const first = await renderShelf()
    click('Collapse Files')
    expect(JSON.parse(localStorage.getItem('pullshelf-collapsed') as string)).toEqual({ tool: false, clips: false, files: true, notes: false })
    first.unmount()
    await renderShelf()
    expect(screen.getByRole('button', { name: 'Expand Files' })).toBeInTheDocument()
  })

  it('carries over collapsed panes saved when the app was called Ledge', async () => {
    localStorage.setItem('ledge-collapsed', JSON.stringify({ tool: false, clips: true, files: false, notes: false }))
    await renderShelf()
    expect(screen.getByRole('button', { name: 'Expand Clipboard' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('pullshelf-collapsed') as string)).toMatchObject({ clips: true })
  })

  it('carries over collapsed panes saved when the app was called Perch', async () => {
    localStorage.setItem('perch-collapsed', JSON.stringify({ tool: false, clips: false, files: true, notes: false }))
    await renderShelf()
    expect(screen.getByRole('button', { name: 'Expand Files' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('pullshelf-collapsed') as string)).toMatchObject({ files: true })
  })

  it('starts fully open when the saved state is unusable', async () => {
    localStorage.setItem('pullshelf-collapsed', JSON.stringify({ tool: true, clips: true, files: true, notes: true }))
    await renderShelf()
    expect(panes().some((p) => p.classList.contains('collapsed'))).toBe(false)
    document.body.innerHTML = ''
    localStorage.setItem('pullshelf-collapsed', '{not json')
    await renderShelf()
    expect(panes().some((p) => p.classList.contains('collapsed'))).toBe(false)
  })

  it('starts fully open when storage cannot be read, and still collapses when it cannot be written', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await renderShelf()
    click('Collapse Clipboard')
    expect(screen.getByRole('button', { name: 'Expand Clipboard' })).toBeInTheDocument()
  })

  it('treats unknown fields in saved collapse state as open', async () => {
    localStorage.setItem('pullshelf-collapsed', JSON.stringify({ clips: true }))
    await renderShelf()
    expect(screen.getByRole('button', { name: 'Expand Clipboard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse Terminal' })).toBeInTheDocument()
  })
})

describe('dragging dividers', () => {
  const widths = [600, 300, 250, 300] // sums to 1450 with every pane open
  const share = (n: number) => n / 1450

  const drag = (index: number, from: number, to: number, end: 'pointerUp' | 'pointerCancel' = 'pointerUp') => {
    fireEvent.pointerDown(dividers()[index], { clientX: from })
    fireEvent.pointerMove(window, { clientX: to })
    fireEvent[end](window)
  }
  const saved = (pullshelf: ReturnType<typeof installPullshelf>['pullshelf']) => pullshelf.saveLayout.mock.calls.at(-1) as number[]

  it('moves space between the two panes beside the divider, and saves the layout', async () => {
    const { pullshelf } = await renderShelf()
    paneWidths(widths)
    drag(0, 500, 600)
    const [tool, clips, files] = saved(pullshelf)
    expect(tool).toBeCloseTo(share(700))
    expect(clips).toBeCloseTo(share(200))
    expect(files).toBeCloseTo(share(250))
    expect(columns()).toContain('minmax(260px, 483fr)')
  })

  it('shrinking leftwards grows the right-hand pane', async () => {
    const { pullshelf } = await renderShelf()
    paneWidths(widths)
    drag(0, 500, 400)
    const [tool, clips] = saved(pullshelf)
    expect(tool).toBeCloseTo(share(500))
    expect(clips).toBeCloseTo(share(400))
  })

  it('pushes into the next pane once a neighbour reaches its minimum width', async () => {
    const { pullshelf } = await renderShelf()
    paneWidths(widths)
    drag(0, 500, 650) // clipboard can give 100, files 50
    const [tool, clips, files] = saved(pullshelf)
    expect(tool).toBeCloseTo(share(750))
    expect(clips).toBeCloseTo(share(200))
    expect(files).toBeCloseTo(share(200))
  })

  it('pushes leftwards through the panes on the left when dragging left', async () => {
    const { pullshelf } = await renderShelf()
    paneWidths(widths)
    drag(2, 900, 700) // notes grows by 200: files gives 50, clipboard 100, terminal 50
    const [tool, clips, files] = saved(pullshelf)
    expect(tool).toBeCloseTo(share(550))
    expect(clips).toBeCloseTo(share(200))
    expect(files).toBeCloseTo(share(200))
  })

  it('stops at the minimums when dragged absurdly far', async () => {
    const { pullshelf } = await renderShelf()
    paneWidths(widths)
    drag(0, 500, 5000)
    const [tool, clips, files] = saved(pullshelf)
    expect(clips).toBeCloseTo(share(200))
    expect(files).toBeCloseTo(share(200))
    expect(tool).toBeCloseTo(share(1450 - 200 - 200 - 220))
  })

  it('works around collapsed panes: the divider beside a rail resizes the panes either side', async () => {
    const { pullshelf } = await renderShelf()
    click('Collapse Clipboard')
    paneWidths([600, 40, 250, 300])
    drag(1, 700, 760) // divider between the rail and Files: terminal vs files
    const [tool, , files] = saved(pullshelf)
    // Only the open panes (1150px) share the weights; the rail's weight is untouched.
    expect(tool / files).toBeCloseTo(660 / 200, 1)
  })

  it('does nothing when the divider has no open pane on the left, or the right pane is collapsed', async () => {
    const { pullshelf } = await renderShelf()
    click('Collapse Terminal')
    paneWidths([40, 300, 250, 300])
    fireEvent.pointerDown(dividers()[0], { clientX: 100 })
    expect(document.body.classList.contains('resizing')).toBe(false)
    click('Expand Terminal')
    click('Collapse Clipboard')
    fireEvent.pointerDown(dividers()[0], { clientX: 100 })
    expect(document.body.classList.contains('resizing')).toBe(false)
    expect(pullshelf.saveLayout).not.toHaveBeenCalled()
  })

  it('marks the page as resizing only while dragging, and ignores moves afterwards', async () => {
    const { pullshelf } = await renderShelf()
    paneWidths(widths)
    fireEvent.pointerDown(dividers()[0], { clientX: 500 })
    expect(document.body.classList.contains('resizing')).toBe(true)
    fireEvent.pointerMove(window, { clientX: 560 })
    fireEvent.pointerUp(window)
    expect(document.body.classList.contains('resizing')).toBe(false)
    const after = columns()
    fireEvent.pointerMove(window, { clientX: 900 })
    expect(columns()).toBe(after)
    expect(pullshelf.saveLayout).toHaveBeenCalledTimes(1)
  })

  it('a cancelled pointer ends the drag too', async () => {
    const { pullshelf } = await renderShelf()
    paneWidths(widths)
    drag(0, 500, 560, 'pointerCancel')
    expect(pullshelf.saveLayout).toHaveBeenCalledTimes(1)
    expect(document.body.classList.contains('resizing')).toBe(false)
  })

  it('copes with a layout that has no measurable width', async () => {
    const { pullshelf } = await renderShelf()
    paneWidths([0, 0, 0, 0])
    expect(() => drag(0, 0, 50)).not.toThrow()
    expect(pullshelf.saveLayout).toHaveBeenCalled()
  })
})

describe('the settings handle', () => {
  const open = () => click('Settings')

  it('opens and closes from the handle, Escape and outside clicks', async () => {
    await renderShelf()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    open()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerDown(screen.getByRole('menu')) // inside: stays open
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'a' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    open()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    open()
    act(() => {
      window.dispatchEvent(new Event('pointerdown')) // not from an element
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    open()
    open() // the handle toggles
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('switching the tool tells the main process', async () => {
    const { pullshelf } = await renderShelf()
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'codex' } })
    expect(pullshelf.configureTool).toHaveBeenCalledWith({ presetId: 'codex' })
    expect(screen.getByRole('combobox')).toHaveValue('codex')
  })

  it('a custom tool asks for a command and applies it on submit', async () => {
    const { pullshelf } = await renderShelf(makeState({ settings: { ...makeState().settings, presetId: 'custom', customCommand: 'htop' } }))
    open()
    const input = screen.getByPlaceholderText('command to run') as HTMLInputElement
    expect(input.value).toBe('htop')
    fireEvent.change(input, { target: { value: 'btop' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(pullshelf.configureTool).toHaveBeenCalledWith({ customCommand: 'btop' })
  })

  it('only shows the command field for the custom tool', async () => {
    await renderShelf()
    open()
    expect(screen.queryByPlaceholderText('command to run')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } })
    expect(screen.getByPlaceholderText('command to run')).toBeInTheDocument()
  })

  it('hides the shelf from the menu', async () => {
    const { pullshelf } = await renderShelf()
    open()
    click(/Hide shelf/)
    expect(pullshelf.hide).toHaveBeenCalled()
    expect(screen.getByText('⌘⇧L')).toBeInTheDocument()
  })

  it('no longer offers a folder or a restart', async () => {
    await renderShelf()
    open()
    expect(screen.queryByRole('button', { name: /Folder/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Restart/ })).not.toBeInTheDocument()
  })

  it('quits from the menu', async () => {
    const { pullshelf } = await renderShelf()
    open()
    click('Quit Pullshelf')
    expect(pullshelf.quit).toHaveBeenCalledTimes(1)
  })

  it('hides or shows the menu-bar icon, following the saved setting and later changes', async () => {
    const { pullshelf, emit } = await renderShelf()
    open()
    click('Hide menu bar icon')
    expect(pullshelf.setTrayVisible).toHaveBeenLastCalledWith(false)
    act(() => emit('prefs', { showTrayIcon: false, launchAtLogin: false }))
    click('Show menu bar icon')
    expect(pullshelf.setTrayVisible).toHaveBeenLastCalledWith(true)
    act(() => emit('prefs', { showTrayIcon: true, launchAtLogin: false }))
    expect(screen.getByRole('button', { name: 'Hide menu bar icon' })).toBeInTheDocument()
  })

  it('offers "Show menu bar icon" when the saved setting has it hidden', async () => {
    await renderShelf(makeState({ settings: { ...makeState().settings, showTrayIcon: false } }))
    open()
    expect(screen.getByRole('button', { name: 'Show menu bar icon' })).toBeInTheDocument()
  })

  it('"Launch at login" only appears for the installed app, and shows whether it is on', async () => {
    await renderShelf()
    open()
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument()
    document.body.innerHTML = ''
    const { pullshelf, emit } = await renderShelf(makeState({ canAutoLaunch: true }))
    open()
    const row = () => screen.getByRole('menuitemcheckbox', { name: /Launch at login/ })
    expect(row()).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(row())
    expect(pullshelf.setLaunchAtLogin).toHaveBeenLastCalledWith(true)
    act(() => emit('prefs', { showTrayIcon: true, launchAtLogin: true }))
    expect(row()).toHaveAttribute('aria-checked', 'true')
    expect(row()).toHaveTextContent('✓')
    fireEvent.click(row())
    expect(pullshelf.setLaunchAtLogin).toHaveBeenLastCalledWith(false)
  })

  it('shows the scroll gesture status and lets you enable it only when it is off', async () => {
    const { pullshelf, emit } = await renderShelf()
    open()
    const row = () => screen.getByRole('button', { name: /Scroll gesture/ })
    expect(row()).toHaveTextContent('On')
    expect(row()).toBeDisabled()
    act(() => emit('trust', false))
    expect(row()).toHaveTextContent('Enable…')
    expect(row()).toBeEnabled()
    fireEvent.click(row())
    expect(pullshelf.promptGesture).toHaveBeenCalled()
  })

  it('stops listening for preference changes when it goes away', async () => {
    const { listenerCount, unmount } = await renderShelf()
    expect(listenerCount('prefs')).toBe(1)
    unmount()
    expect(listenerCount('prefs')).toBe(0)
  })

  it('toggles between dark and light, and shows which is active', async () => {
    await renderShelf()
    open()
    expect(screen.getByRole('button', { name: /Theme/ })).toHaveTextContent('Dark')
    click(/Theme/)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByRole('button', { name: /Theme/ })).toHaveTextContent('Light')
    click(/Theme/)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('resizing the shelf height', () => {
  let frames: FrameRequestCallback[]
  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  const grip = () => document.querySelector('.resize-grip') as HTMLElement

  it('follows the pointer, at most once per frame, and finishes on release', async () => {
    const { pullshelf } = await renderShelf()
    fireEvent.pointerDown(grip(), { screenY: 500, pointerId: 3 })
    expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(3)
    expect(pullshelf.keepOpen).toHaveBeenCalled()
    fireEvent.pointerMove(grip(), { screenY: 560 })
    fireEvent.pointerMove(grip(), { screenY: 580 })
    expect(frames).toHaveLength(1)
    act(() => frames[0](0))
    expect(pullshelf.resizeShelf).toHaveBeenCalledWith(window.innerHeight + 80)
    fireEvent.pointerUp(grip())
    expect(pullshelf.resizeShelf).toHaveBeenLastCalledWith(window.innerHeight + 80)
    expect(pullshelf.resizeShelfEnd).toHaveBeenCalled()
  })

  it('releasing before the next frame cancels it and still applies the final height', async () => {
    const { pullshelf } = await renderShelf()
    fireEvent.pointerDown(grip(), { screenY: 500 })
    fireEvent.pointerMove(grip(), { screenY: 450 })
    fireEvent.pointerUp(grip())
    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(pullshelf.resizeShelf).toHaveBeenCalledTimes(1)
    expect(pullshelf.resizeShelf).toHaveBeenCalledWith(window.innerHeight - 50)
  })

  it('a click without movement keeps the current height; cancel ends the drag like release', async () => {
    const { pullshelf } = await renderShelf()
    fireEvent.pointerDown(grip(), { screenY: 500 })
    fireEvent.pointerCancel(grip())
    expect(pullshelf.resizeShelf).toHaveBeenCalledWith(window.innerHeight)
    expect(pullshelf.resizeShelfEnd).toHaveBeenCalledTimes(1)
    fireEvent.pointerMove(grip(), { screenY: 700 }) // listeners were removed
    expect(frames).toHaveLength(0)
  })
})

describe('notices and guards', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a toast from a pane and removes it after 2.4 seconds', async () => {
    const { pullshelf } = await renderShelf(makeState({ clips: [makeClip({ text: 'x' })] }))
    pullshelf.sendToTool.mockResolvedValue({ ok: false, error: 'Nothing is running' })
    await act(async () => {
      click('Send')
    })
    expect(screen.getByText('Nothing is running')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(2399))
    expect(screen.getByText('Nothing is running')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(2))
    expect(screen.queryByText('Nothing is running')).not.toBeInTheDocument()
  })

  it('a second toast restarts the timer', async () => {
    const { pullshelf } = await renderShelf(makeState({ clips: [makeClip({ text: 'x' })] }))
    pullshelf.sendToTool.mockResolvedValueOnce({ ok: false, error: 'first' }).mockResolvedValueOnce({ ok: false, error: 'second' })
    await act(async () => {
      click('Send')
    })
    await act(() => vi.advanceTimersByTimeAsync(2000))
    await act(async () => {
      click('Send')
    })
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(screen.getByText('second')).toBeInTheDocument()
  })

  it('stops stray file drops from navigating the window, until unmounted', async () => {
    const { unmount } = await renderShelf()
    for (const type of ['dragover', 'drop']) {
      const event = new Event(type, { cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented, type).toBe(true)
    }
    unmount()
    const after = new Event('drop', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
})
