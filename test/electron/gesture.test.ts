import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeProc extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = { write: vi.fn() }
  kill = vi.fn()
  say(text: string) {
    this.stdout.emit('data', Buffer.from(text))
  }
}

const spawned: FakeProc[] = []
const existing = new Set<string>()

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const proc = new FakeProc()
    spawned.push(proc)
    return proc
  })
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn((path: string) => existing.has(path))
}))

const RESOURCES = '/Applications/Pullshelf.app/Contents/Resources/GestureHelper'

async function load() {
  vi.resetModules()
  const gesture = await import('../../electron/gesture')
  const { app } = await import('electron')
  const { spawn } = await import('node:child_process')
  const listener = { onDrag: vi.fn(), onRelease: vi.fn(), onTrust: vi.fn() }
  return { ...gesture, app, spawn: vi.mocked(spawn), listener }
}

beforeEach(() => {
  spawned.length = 0
  existing.clear()
  existing.add(RESOURCES)
  Object.defineProperty(process, 'resourcesPath', { value: '/Applications/Pullshelf.app/Contents/Resources', configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('finding the helper', () => {
  it('prefers the packaged copy in the app resources', async () => {
    const g = await load()
    g.startGesture(g.listener)
    expect(g.spawn).toHaveBeenCalledWith(RESOURCES, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  })

  it('falls back to native/bin inside the app folder', async () => {
    const g = await load()
    existing.clear()
    vi.mocked(g.app.getAppPath).mockReturnValue('/project')
    existing.add('/project/native/bin/GestureHelper')
    g.startGesture(g.listener)
    expect(g.spawn.mock.calls[0][0]).toBe('/project/native/bin/GestureHelper')
  })

  it('falls back to the path relative to the compiled file', async () => {
    const g = await load()
    existing.clear()
    // From the built out/main/main.js this resolves to <project>/native/bin; here __dirname is electron/.
    const relative = resolve(__dirname, '../../electron/../../native/bin/GestureHelper')
    existing.add(relative)
    g.startGesture(g.listener)
    expect(g.spawn.mock.calls[0][0]).toBe(relative)
  })

  it('logs and does nothing when the helper was never compiled', async () => {
    const g = await load()
    existing.clear()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    g.startGesture(g.listener)
    expect(g.spawn).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('Gesture helper is missing. Run npm run compile:gesture.')
  })
})

describe('reading the helper output', () => {
  it('reports trust from "ready trusted", "trusted" and "ready untrusted"', async () => {
    const g = await load()
    g.startGesture(g.listener)
    expect(g.gestureTrusted()).toBe(false)
    spawned[0].say('ready untrusted\n')
    expect(g.listener.onTrust).toHaveBeenLastCalledWith(false)
    spawned[0].say('ready trusted\n')
    expect(g.listener.onTrust).toHaveBeenLastCalledWith(true)
    expect(g.gestureTrusted()).toBe(true)
    spawned[0].say('ready untrusted\ntrusted\n')
    expect(g.listener.onTrust.mock.calls.map((c) => c[0])).toEqual([false, true, false, true])
  })

  it('parses drag lines into a frame, a delta and the live flag', async () => {
    const g = await load()
    g.startGesture(g.listener)
    spawned[0].say('drag 0.00 0.00 1600.00 900.00 12.50 1\ndrag -5 10 800 600 -3 0\n')
    expect(g.listener.onDrag).toHaveBeenNthCalledWith(1, { x: 0, y: 0, width: 1600, height: 900 }, 12.5, true)
    expect(g.listener.onDrag).toHaveBeenNthCalledWith(2, { x: -5, y: 10, width: 800, height: 600 }, -3, false)
  })

  it('handles lines split across chunks', async () => {
    const g = await load()
    g.startGesture(g.listener)
    spawned[0].say('drag 0 0 100 ')
    expect(g.listener.onDrag).not.toHaveBeenCalled()
    spawned[0].say('100 4 1\nrelease\n')
    expect(g.listener.onDrag).toHaveBeenCalledTimes(1)
    expect(g.listener.onRelease).toHaveBeenCalledTimes(1)
  })

  it('ignores blank lines, unknown lines and malformed drag lines', async () => {
    const g = await load()
    g.startGesture(g.listener)
    spawned[0].say('\n   \nhello\ndrag 1 2 3\ndrag a b c d e f\ndrag 1 2 3 4 5 6 7\n')
    expect(g.listener.onDrag).not.toHaveBeenCalled()
    expect(g.listener.onRelease).not.toHaveBeenCalled()
    expect(g.listener.onTrust).not.toHaveBeenCalled()
  })

  it('prints helper stderr and skips empty output', async () => {
    const g = await load()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    g.startGesture(g.listener)
    spawned[0].stderr.emit('data', Buffer.from('[gesture] pull start\n'))
    spawned[0].stderr.emit('data', Buffer.from('  \n'))
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('[gesture] pull start')
  })
})

describe('restarting and stopping', () => {
  it('restarts a crashed helper with a growing delay, then gives up after five tries', async () => {
    vi.useFakeTimers()
    const g = await load()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    g.startGesture(g.listener)
    for (const [i, delay] of [1000, 2000, 4000, 8000, 16000].entries()) {
      spawned[i].emit('exit', 1)
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(spawned).toHaveLength(i + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(spawned).toHaveLength(i + 2)
    }
    spawned[5].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(spawned).toHaveLength(6)
    expect(g.gestureRunning()).toBe(false)
  })

  it('forgets earlier crashes once a helper has stayed up for a minute', async () => {
    vi.useFakeTimers()
    const g = await load()
    g.startGesture(g.listener)
    spawned[0].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(1000)
    spawned[1].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(60_000)
    spawned[2].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(4)
  })

  it('survives a helper that cannot be launched, logs why, and retries', async () => {
    vi.useFakeTimers()
    const g = await load()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    g.startGesture(g.listener)
    const failure = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })
    expect(() => spawned[0].emit('error', failure)).not.toThrow()
    expect(error).toHaveBeenCalledWith('[gesture] helper failed:', 'spawn EACCES')
    expect(g.gestureRunning()).toBe(false)
    spawned[0].emit('exit', null) // an exit after the error must not schedule a second restart
    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(2)
    expect(g.gestureRunning()).toBe(true)
  })

  it('survives spawn itself throwing', async () => {
    vi.useFakeTimers()
    const g = await load()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    g.spawn.mockImplementationOnce(() => {
      throw new Error('bad args')
    })
    expect(() => g.startGesture(g.listener)).not.toThrow()
    expect(g.gestureRunning()).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(1)
    expect(g.gestureRunning()).toBe(true)
  })

  it('restartGesture brings back a helper that gave up, with a fresh set of retries', async () => {
    vi.useFakeTimers()
    const g = await load()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    g.startGesture(g.listener)
    for (let i = 0; i < 6; i += 1) {
      spawned[i].emit('exit', 1)
      await vi.advanceTimersByTimeAsync(20_000)
    }
    expect(g.gestureRunning()).toBe(false)
    g.restartGesture()
    expect(spawned).toHaveLength(7)
    expect(g.gestureRunning()).toBe(true)
    spawned[6].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(8)
  })

  it('restartGesture does nothing while a helper is running, or before one was ever started', async () => {
    const g = await load()
    g.restartGesture()
    expect(spawned).toHaveLength(0)
    g.startGesture(g.listener)
    g.restartGesture()
    expect(spawned).toHaveLength(1)
  })

  it('ignores the exit of a helper that was already replaced', async () => {
    vi.useFakeTimers()
    const g = await load()
    g.startGesture(g.listener)
    g.startGesture(g.listener)
    spawned[0].emit('exit')
    await vi.advanceTimersByTimeAsync(2000)
    expect(spawned).toHaveLength(2)
  })

  it('stopGesture kills the helper and prevents restarts', async () => {
    vi.useFakeTimers()
    const g = await load()
    g.startGesture(g.listener)
    g.stopGesture()
    expect(spawned[0].kill).toHaveBeenCalled()
    spawned[0].emit('exit')
    await vi.advanceTimersByTimeAsync(5000)
    expect(spawned).toHaveLength(1)
  })

  it('stopGesture cancels a retry that is already scheduled', async () => {
    vi.useFakeTimers()
    const g = await load()
    g.startGesture(g.listener)
    spawned[0].emit('exit', 1)
    g.stopGesture()
    await vi.advanceTimersByTimeAsync(5000)
    expect(spawned).toHaveLength(1)
  })

  it('restartGesture during a scheduled retry starts at once and does not start twice', async () => {
    vi.useFakeTimers()
    const g = await load()
    g.startGesture(g.listener)
    spawned[0].emit('exit', 1)
    g.restartGesture()
    expect(spawned).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(spawned).toHaveLength(2)
  })

  it('stopGesture with no helper running is harmless', async () => {
    const g = await load()
    expect(() => g.stopGesture()).not.toThrow()
  })
})

describe('talking to the helper', () => {
  it('tells it when the shelf is shown or hidden, and can ask it to prompt for trust', async () => {
    const g = await load()
    g.startGesture(g.listener)
    g.setGestureVisible(true)
    g.setGestureVisible(false)
    g.promptGestureTrust()
    expect(spawned[0].stdin.write.mock.calls.map((c) => c[0])).toEqual(['visible\n', 'hidden\n', 'prompt-trust\n'])
  })

  it('does nothing when there is no helper', async () => {
    const g = await load()
    expect(() => {
      g.setGestureVisible(true)
      g.promptGestureTrust()
    }).not.toThrow()
  })
})
