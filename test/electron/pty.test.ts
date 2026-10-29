import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../src/shared/types'

type ExecCallback = (error: Error | null, stdout: string) => void
type ExecResponder = (file: string, args: string[], env: NodeJS.ProcessEnv | undefined) => string | Promise<string>

const hoisted = vi.hoisted(() => ({
  responder: null as null | ((file: string, args: string[], env: NodeJS.ProcessEnv | undefined) => string | Promise<string>),
  existing: new Set<string>()
}))

vi.mock('node:child_process', () => ({
  execFile: vi.fn((file: string, args: string[], options: { env?: NodeJS.ProcessEnv }, callback: ExecCallback) => {
    Promise.resolve()
      .then(() => hoisted.responder?.(file, args, options.env) ?? '')
      .then((stdout) => callback(null, stdout), (error: Error) => callback(error, ''))
  })
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn((path: string) => hoisted.existing.has(path))
}))

const settings = (patch: Partial<Settings> = {}): Settings => ({
  presetId: 'shell',
  customCommand: '',
  cwd: '/work',
  toolRatio: 0.4,
  clipRatio: 0.18,
  filesRatio: 0.2,
  heightRatio: 0.52,
  showTrayIcon: true,
  ...patch
})

const PATH_MARK = (value: string) => `noise\n__PULLSHELF_PATH__${value}__PULLSHELF_PATH__\n`
const BIN_MARK = (value: string) => `noise\n__PULLSHELF_BIN__${value}__PULLSHELF_BIN__\n`

/** Default login-shell behaviour: report a PATH, and find `claude` / `codex`. */
const happyShell: ExecResponder = (_file, args) => {
  const script = args[1]
  if (script.includes('__PULLSHELF_PATH__')) return PATH_MARK('/opt/bin:/usr/bin')
  return BIN_MARK(`/opt/bin/${script.match(/command -v (\w+)/)?.[1]}`)
}

async function load() {
  vi.resetModules()
  const pty = await import('../../electron/pty')
  const mock = await import('../mocks/node-pty')
  const { attachWebContents } = await import('../../electron/bus')
  const sent: [string, unknown][] = []
  attachWebContents({ isDestroyed: () => false, send: (c: string, p: unknown) => sent.push([c, p]) } as never)
  const statuses = () => sent.filter(([c]) => c === 'tool:status').map(([, p]) => p as { running: boolean; error: string | null; exitCode: number | null })
  return { ...pty, ...mock, sent, statuses, last: () => mock.FakePty.instances.at(-1)! }
}

beforeEach(() => {
  hoisted.responder = happyShell
  hoisted.existing.clear()
  process.env.SHELL = '/bin/zsh'
  delete process.env.TERMINFO_DIRS
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('starting a tool', () => {
  it('starts a login shell in the chosen folder with a Pullshelf terminal environment', async () => {
    const p = await load()
    await p.start(settings({ presetId: 'shell' }))
    expect(p.spawn).toHaveBeenCalledTimes(1)
    const pty = p.last()
    expect([pty.command, pty.args]).toEqual(['/bin/zsh', ['-l']])
    expect(pty.options).toMatchObject({ name: 'xterm-256color', cwd: '/work', cols: 100, rows: 28 })
    expect(pty.options.env).toMatchObject({ TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Pullshelf', PULLSHELF: '1', PATH: '/opt/bin:/usr/bin' })
  })

  it('announces a reset, then "starting", then "running"', async () => {
    const p = await load()
    await p.start(settings())
    expect(p.sent[0][0]).toBe('pty:reset')
    expect(p.statuses().map((s) => s.running)).toEqual([false, true])
    expect(p.toolStatus()).toMatchObject({ running: true, presetId: 'shell', label: 'Shell', cwd: '/work', error: null, exitCode: null })
    expect(p.isRunning()).toBe(true)
  })

  it('runs claude and codex from the path the login shell finds', async () => {
    const p = await load()
    await p.start(settings({ presetId: 'claude' }))
    expect([p.last().command, p.last().args]).toEqual(['/opt/bin/claude', []])
    await p.start(settings({ presetId: 'codex' }))
    expect(p.last().command).toBe('/opt/bin/codex')
  })

  it('says so when claude or codex cannot be found', async () => {
    const p = await load()
    hoisted.responder = (_f, args) => (args[1].includes('__PULLSHELF_PATH__') ? PATH_MARK('/usr/bin') : BIN_MARK(''))
    await p.start(settings({ presetId: 'claude' }))
    expect(p.toolStatus()).toMatchObject({ running: false, error: "Couldn't find claude. Install it, then start the tool again." })
    expect(p.spawn).not.toHaveBeenCalled()
    await p.start(settings({ presetId: 'codex' }))
    expect(p.toolStatus().error).toBe("Couldn't find codex. Install it, then start the tool again.")
  })

  it('treats a relative path or a failing shell lookup as "not found"', async () => {
    const p = await load()
    hoisted.responder = (_f, args) => (args[1].includes('__PULLSHELF_PATH__') ? PATH_MARK('/usr/bin') : BIN_MARK('claude not found'))
    await p.start(settings({ presetId: 'claude' }))
    expect(p.toolStatus().error).toMatch(/Couldn't find claude/)
    hoisted.responder = (_f, args) => {
      if (args[1].includes('__PULLSHELF_PATH__')) return PATH_MARK('/usr/bin')
      throw new Error('shell exploded')
    }
    await p.start(settings({ presetId: 'claude' }))
    expect(p.toolStatus().error).toMatch(/Couldn't find claude/)
    hoisted.responder = (_f, args) => (args[1].includes('__PULLSHELF_PATH__') ? PATH_MARK('/usr/bin') : 'no markers at all')
    await p.start(settings({ presetId: 'claude' }))
    expect(p.toolStatus().error).toMatch(/Couldn't find claude/)
  })

  it('runs a custom command through an interactive shell, trimmed', async () => {
    const p = await load()
    await p.start(settings({ presetId: 'custom', customCommand: '  htop -d 5  ' }))
    expect([p.last().command, p.last().args]).toEqual(['/bin/zsh', ['-ilc', 'htop -d 5']])
  })

  it('asks for a command when the custom one is empty', async () => {
    const p = await load()
    await p.start(settings({ presetId: 'custom', customCommand: '   ' }))
    expect(p.toolStatus()).toMatchObject({ running: false, error: 'Enter a command to run.' })
    expect(p.spawn).not.toHaveBeenCalled()
  })

  it('reports a non-Error thrown while spawning with a generic message', async () => {
    const p = await load()
    p.spawn.mockImplementationOnce(() => {
      throw 'nope'
    })
    await p.start(settings())
    expect(p.toolStatus()).toMatchObject({ running: false, error: 'Could not start the tool.' })
  })

  it('reports a spawn failure by its message', async () => {
    const p = await load()
    p.spawn.mockImplementationOnce(() => {
      throw new Error('posix_spawnp failed')
    })
    await p.start(settings())
    expect(p.toolStatus()).toMatchObject({ running: false, error: 'posix_spawnp failed' })
  })

  it('uses the SHELL from the environment when absolute, otherwise /bin/zsh', async () => {
    const p = await load()
    process.env.SHELL = '/usr/local/bin/fish'
    await p.start(settings())
    expect(p.last().command).toBe('/usr/local/bin/fish')
    process.env.SHELL = 'fish'
    await p.start(settings())
    expect(p.last().command).toBe('/bin/zsh')
    delete process.env.SHELL
    await p.start(settings())
    expect(p.last().command).toBe('/bin/zsh')
  })

  it('stops the previous tool before starting another', async () => {
    const p = await load()
    await p.start(settings())
    const first = p.last()
    await p.start(settings())
    expect(first.killed).toBe(true)
    expect(p.FakePty.instances).toHaveLength(2)
  })

  it('a start that was replaced while resolving does not spawn or report an error', async () => {
    const p = await load()
    let releaseFirst: (stdout: string) => void = () => undefined
    let calls = 0
    hoisted.responder = (_f, args) => {
      calls += 1
      // The first start's PATH lookup hangs until we release it; everything else answers at once.
      if (calls === 1) return new Promise<string>((resolve) => (releaseFirst = resolve))
      return happyShell(_f, args, undefined)
    }
    const first = p.start(settings({ presetId: 'shell' }))
    const second = p.start(settings({ presetId: 'shell', cwd: '/second' }))
    await second
    releaseFirst(PATH_MARK('/late'))
    await first
    expect(p.FakePty.instances).toHaveLength(1)
    expect(p.last().options.cwd).toBe('/second')
  })

  it('a replaced start that then fails stays quiet', async () => {
    const p = await load()
    let releaseFirst: (stdout: string) => void = () => undefined
    let calls = 0
    hoisted.responder = (_f, args) => {
      calls += 1
      if (calls === 1) return new Promise<string>((resolve) => (releaseFirst = resolve))
      return happyShell(_f, args, undefined)
    }
    // An empty custom command fails once its environment lookup finishes.
    const first = p.start(settings({ presetId: 'custom', customCommand: '' }))
    await p.start(settings())
    releaseFirst(PATH_MARK('/late'))
    await first
    expect(p.toolStatus()).toMatchObject({ running: true, error: null })
  })

  it('kills a process that finished spawning after it was superseded', async () => {
    const p = await load()
    p.spawn.mockImplementationOnce((command, args, options) => {
      const child = new p.FakePty(command, args, options)
      p.stop() // something stopped the tool while it was being created
      return child
    })
    await p.start(settings())
    expect(p.FakePty.instances[0].killed).toBe(true)
    expect(p.isRunning()).toBe(false)
  })
})

describe('the environment lookup', () => {
  it('keeps the launch PATH when the login shell prints nothing useful or fails', async () => {
    const p = await load()
    const original = process.env.PATH
    hoisted.responder = () => 'nothing here'
    await p.start(settings())
    expect(p.last().options.env).toMatchObject({ PATH: original })
    hoisted.responder = () => PATH_MARK('no-slash')
    await p.start(settings())
    expect(p.last().options.env).toMatchObject({ PATH: original })
    hoisted.responder = () => {
      throw new Error('shell failed')
    }
    await p.start(settings())
    expect(p.last().options.env).toMatchObject({ PATH: original })
  })

  it('lets TERM=xterm-kitty resolve when kitty is installed, keeping any existing TERMINFO_DIRS', async () => {
    const p = await load()
    await p.start(settings())
    expect((p.last().options.env as NodeJS.ProcessEnv).TERMINFO_DIRS).toBeUndefined()

    hoisted.existing.add('/Applications/kitty.app/Contents/Resources/terminfo')
    await p.start(settings())
    expect((p.last().options.env as NodeJS.ProcessEnv).TERMINFO_DIRS).toBe('/Applications/kitty.app/Contents/Resources/terminfo')

    process.env.TERMINFO_DIRS = '/custom/terminfo'
    await p.start(settings())
    expect((p.last().options.env as NodeJS.ProcessEnv).TERMINFO_DIRS).toBe('/custom/terminfo:/Applications/kitty.app/Contents/Resources/terminfo')
  })
})

describe('output and exit', () => {
  it('buffers output with increasing revisions and forwards each chunk', async () => {
    const p = await load()
    await p.start(settings())
    p.last().emitData('hello ')
    p.last().emitData('world')
    expect(p.snapshot()).toEqual({ buffer: 'hello world', rev: 2 })
    expect(p.sent.filter(([c]) => c === 'pty:data').map(([, d]) => d)).toEqual([
      { rev: 1, chunk: 'hello ' },
      { rev: 2, chunk: 'world' }
    ])
  })

  it('keeps only the last 200,000 characters of scrollback', async () => {
    const p = await load()
    await p.start(settings())
    p.last().emitData('a'.repeat(150_000))
    p.last().emitData('b'.repeat(150_000))
    const { buffer } = p.snapshot()
    expect(buffer).toHaveLength(200_000)
    expect(buffer.endsWith('b'.repeat(150_000))).toBe(true)
  })

  it('clears scrollback when a new tool starts', async () => {
    const p = await load()
    await p.start(settings())
    p.last().emitData('old')
    await p.start(settings())
    expect(p.snapshot()).toEqual({ buffer: '', rev: 0 })
  })

  it('ignores output from a process that has been replaced', async () => {
    const p = await load()
    await p.start(settings())
    const old = p.last()
    await p.start(settings())
    old.emitData('ghost')
    expect(p.snapshot().buffer).toBe('')
  })

  it('records the exit code and tells the window', async () => {
    const p = await load()
    await p.start(settings())
    p.last().emitExit(3)
    expect(p.toolStatus()).toMatchObject({ running: false, exitCode: 3 })
    expect(p.isRunning()).toBe(false)
    expect(p.sent.at(-1)).toEqual(['pty:exit', { exitCode: 3 }])
  })

  it('reports a missing exit code as null', async () => {
    const p = await load()
    await p.start(settings())
    p.last().exitHandler?.({} as never)
    expect(p.toolStatus().exitCode).toBeNull()
  })

  it('ignores the exit of a replaced process', async () => {
    const p = await load()
    await p.start(settings())
    const old = p.last()
    await p.start(settings())
    old.emitExit(1)
    expect(p.toolStatus()).toMatchObject({ running: true, exitCode: null })
  })

  it('ignores a late exit from a process that was stopped', async () => {
    const p = await load()
    await p.start(settings())
    const child = p.last()
    p.stop()
    const before = p.sent.length
    child.emitExit(0)
    expect(p.sent.length).toBe(before)
  })
})

describe('stop', () => {
  it('kills the process and reports not running', async () => {
    const p = await load()
    await p.start(settings())
    p.stop()
    expect(p.last().killed).toBe(true)
    expect(p.toolStatus().running).toBe(false)
  })

  it('is harmless with nothing running or when kill throws', async () => {
    const p = await load()
    expect(() => p.stop()).not.toThrow()
    await p.start(settings())
    p.last().killError = new Error('already gone')
    expect(() => p.stop()).not.toThrow()
  })
})

describe('write and resize', () => {
  it('writes keystrokes to the process, ignoring empty or oversized input and dead processes', async () => {
    const p = await load()
    expect(() => p.write('x')).not.toThrow()
    await p.start(settings())
    p.write('ls\r')
    p.write('')
    p.write('x'.repeat(200_001))
    expect(p.last().written).toEqual(['ls\r'])
    p.last().writeError = new Error('EIO')
    expect(() => p.write('y')).not.toThrow()
  })

  it('resizes within 2..500, rounding, and keeps the old size for non-finite values', async () => {
    const p = await load()
    expect(() => p.resize(80, 24)).not.toThrow()
    await p.start(settings())
    p.resize(120.4, 40.6)
    p.resize(1, 9999)
    p.resize(Number.NaN, Number.POSITIVE_INFINITY)
    expect(p.last().resizes).toEqual([
      [120, 41],
      [2, 500],
      [2, 500]
    ])
    p.last().resizeError = new Error('gone')
    expect(() => p.resize(90, 30)).not.toThrow()
  })

  it('starts the next tool at the last size it was resized to', async () => {
    const p = await load()
    p.resize(150, 50)
    await p.start(settings())
    expect(p.last().options).toMatchObject({ cols: 150, rows: 50 })
  })
})

describe('sendText', () => {
  it('refuses when nothing is running', async () => {
    const p = await load()
    expect(p.sendText('hi')).toEqual({ ok: false, error: 'Nothing is running in the tool pane.' })
  })

  it('pastes text using bracketed paste, stripping NULs and any embedded paste-end marker', async () => {
    const p = await load()
    await p.start(settings())
    expect(p.sendText('he\u0000llo\u001b[201~ there')).toEqual({ ok: true })
    expect(p.last().written).toEqual(['\u001b[200~hello there\u001b[201~'])
  })

  it('refuses text that is empty once cleaned', async () => {
    const p = await load()
    await p.start(settings())
    expect(p.sendText('\u0000\u0000')).toEqual({ ok: false, error: 'Nothing to send.' })
  })

  it('caps the pasted text at 200,000 characters', async () => {
    const p = await load()
    await p.start(settings())
    p.sendText('z'.repeat(250_000))
    expect(p.last().written[0]).toHaveLength(200_000 + '\u001b[200~'.length + '\u001b[201~'.length)
  })

  it('reports a process that died underneath it', async () => {
    const p = await load()
    await p.start(settings())
    p.last().writeError = new Error('EPIPE')
    expect(p.sendText('hi')).toEqual({ ok: false, error: 'The tool is no longer running.' })
  })
})

describe('presetCommandName', () => {
  it('names each preset', async () => {
    const p = await load()
    expect(p.presetCommandName('claude')).toBe('Claude Code')
    expect(p.presetCommandName('codex')).toBe('Codex')
  })
})
