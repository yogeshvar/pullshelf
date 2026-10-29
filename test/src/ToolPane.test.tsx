import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { applyTheme, setTheme } from '../../src/shared/theme'
import { ToolPane } from '../../src/shelf/ToolPane'
import type { ToolStatus } from '../../src/shared/types'
import { FitAddon } from '../mocks/addon-fit'
import { Terminal } from '../mocks/xterm'
import { FakeResizeObserver, setSystemPrefersLight } from '../helpers/setup-dom'
import { installPullshelf, makeState } from '../helpers/pullshelf'

const running: ToolStatus = { running: true, presetId: 'claude', label: 'Claude Code', cwd: '/x', error: null, exitCode: null }

const setup = (status: ToolStatus = running, collapsed = false, overrides: Record<string, unknown> = {}) => {
  const bridge = installPullshelf(makeState(), overrides)
  const onToggle = vi.fn()
  const view = render(<ToolPane status={status} collapsed={collapsed} onToggle={onToggle} />)
  const term = Terminal.instances[0]
  return { ...bridge, onToggle, term, fit: FitAddon.instances[0], ...view }
}

/** Resolve the snapshot request and any microtasks it triggers. */
const settled = () => act(async () => undefined)

describe('terminal setup', () => {
  it('opens a terminal fitted to its host and tells the shell its size', () => {
    const { term, fit, pullshelf } = setup()
    expect(term.loadAddon).toHaveBeenCalledWith(fit)
    expect(term.open).toHaveBeenCalledWith(document.querySelector('.term-host'))
    expect(fit.fit).toHaveBeenCalled()
    expect(pullshelf.resizePty).toHaveBeenCalledWith(80, 24)
    expect(term.options).toMatchObject({ fontSize: 13, cursorBlink: true, scrollback: 4000 })
  })

  it('uses the dark palette by default and the light palette when the theme is light', () => {
    expect(setup().term.options.theme).toMatchObject({ background: '#121110' })
    document.body.innerHTML = ''
    Terminal.instances = []
    setSystemPrefersLight(true)
    expect(setup().term.options.theme).toMatchObject({ background: '#f7f4ee' })
  })

  it('sends typing to the shell', () => {
    const { term, pullshelf } = setup()
    term.dataHandler?.('ls\r')
    expect(pullshelf.writePty).toHaveBeenCalledWith('ls\r')
  })

  it('swaps colours in place when the theme changes, without recreating the terminal', () => {
    const { term } = setup()
    act(() => setTheme('light'))
    expect(term.options.theme).toMatchObject({ background: '#f7f4ee' })
    act(() => applyTheme('dark'))
    expect(term.options.theme).toMatchObject({ background: '#121110' })
    expect(Terminal.instances).toHaveLength(1)
  })
})

describe('terminal output', () => {
  it('replays the saved scrollback first, then only chunks newer than it', async () => {
    const { term, emit } = setup(running, false, {
      ptySnapshot: vi.fn(async () => ({ buffer: 'saved output', rev: 5 }))
    })
    emit('pty:data', { rev: 4, chunk: 'old (already in snapshot)' }) // arrives before the snapshot, rev too old
    emit('pty:data', { rev: 6, chunk: 'newer' })
    await settled()
    expect(term.written).toEqual(['saved output', 'newer'])
    emit('pty:data', { rev: 7, chunk: 'live' })
    emit('pty:data', { rev: 7, chunk: 'duplicate' })
    emit('pty:data', { rev: 3, chunk: 'stale' })
    expect(term.written).toEqual(['saved output', 'newer', 'live'])
  })

  it('writes nothing for an empty scrollback', async () => {
    const { term } = setup()
    await settled()
    expect(term.written).toEqual([])
  })

  it('clears the screen and starts counting again when the tool restarts', async () => {
    const { term, emit } = setup(running, false, { ptySnapshot: vi.fn(async () => ({ buffer: '', rev: 9 })) })
    await settled()
    emit('pty:data', { rev: 10, chunk: 'before' })
    emit('pty:reset')
    expect(term.resets).toBe(1)
    emit('pty:data', { rev: 1, chunk: 'after restart' })
    expect(term.written).toEqual(['before', 'after restart'])
  })

  it('a reset drops chunks that were waiting for the snapshot', async () => {
    const { term, emit } = setup()
    emit('pty:data', { rev: 1, chunk: 'queued' })
    emit('pty:reset')
    await settled()
    expect(term.written).toEqual([])
  })

  it('ignores a snapshot that arrives after the pane was closed', async () => {
    let resolve: (value: { buffer: string; rev: number }) => void = () => undefined
    const { term, unmount } = setup(running, false, {
      ptySnapshot: vi.fn(() => new Promise((r) => (resolve = r)))
    })
    unmount()
    await act(async () => resolve({ buffer: 'late', rev: 1 }))
    expect(term.written).toEqual([])
  })
})

describe('sizing and focus', () => {
  const host = () => document.querySelector('.term-host') as HTMLElement
  const sizeHost = (width: number, height: number) => {
    Object.defineProperty(host(), 'clientWidth', { value: width, configurable: true })
    Object.defineProperty(host(), 'clientHeight', { value: height, configurable: true })
  }

  it('refits and resizes the shell when the pane is resized', () => {
    const { fit, pullshelf } = setup()
    fit.fit.mockClear()
    pullshelf.resizePty.mockClear()
    sizeHost(600, 400)
    act(() => FakeResizeObserver.instances[0].trigger())
    expect(fit.fit).toHaveBeenCalledTimes(1)
    expect(pullshelf.resizePty).toHaveBeenCalledWith(80, 24)
  })

  it('does not shrink the shell when the pane is collapsed to nothing', () => {
    const { fit, pullshelf } = setup()
    fit.fit.mockClear()
    pullshelf.resizePty.mockClear()
    sizeHost(0, 400) // too narrow
    act(() => FakeResizeObserver.instances[0].trigger())
    sizeHost(600, 10) // too short
    act(() => FakeResizeObserver.instances[0].trigger())
    expect(fit.fit).not.toHaveBeenCalled()
    expect(pullshelf.resizePty).not.toHaveBeenCalled()
  })

  it('refits and takes focus each time the shelf is shown', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const { term, fit, emit } = setup()
    sizeHost(600, 400)
    fit.fit.mockClear()
    emit('shown')
    expect(fit.fit).toHaveBeenCalledTimes(1)
    expect(term.focused).toBe(1)
  })

  it('observes its host and cleans everything up on unmount', () => {
    const { term, unmount, listenerCount } = setup()
    expect(FakeResizeObserver.instances[0].observed).toEqual([host()])
    expect(listenerCount('pty:data')).toBe(1)
    unmount()
    expect(FakeResizeObserver.instances[0].disconnected).toBe(true)
    expect(term.disposed).toBe(true)
    for (const name of ['pty:data', 'pty:reset', 'shown']) expect(listenerCount(name)).toBe(0)
  })
})

describe('header and exit bar', () => {
  it('shows the running tool with a lit dot and no exit bar', () => {
    setup()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(document.querySelector('.dot')).toHaveClass('on')
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
  })

  it('explains why nothing is running, and offers to start it', () => {
    const { pullshelf, rerender, onToggle } = setup({ ...running, running: false, exitCode: null, error: null })
    expect(screen.getByText('Waiting to start')).toBeInTheDocument()
    expect(document.querySelector('.dot')).not.toHaveClass('on')
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(pullshelf.restartTool).toHaveBeenCalled()
    rerender(<ToolPane status={{ ...running, running: false, exitCode: 2 }} collapsed={false} onToggle={onToggle} />)
    expect(screen.getByText('Exited (2)')).toBeInTheDocument()
    rerender(<ToolPane status={{ ...running, running: false, error: "Couldn't find claude." }} collapsed={false} onToggle={onToggle} />)
    expect(screen.getByText("Couldn't find claude.")).toBeInTheDocument()
  })

  it('collapses to a rail without destroying the terminal', () => {
    const { onToggle, term } = setup(running, true)
    expect(document.querySelector('section')).toHaveClass('collapsed')
    fireEvent.click(screen.getByRole('button', { name: 'Expand Terminal' }))
    expect(onToggle).toHaveBeenCalled()
    expect(term.disposed).toBe(false)
  })
})
