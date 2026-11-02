import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { tempDir } from '../helpers/tmp'

async function load() {
  vi.resetModules()
  return import('../../electron/log')
}

describe('the log file', () => {
  it('copies console errors and warnings into main.log with a time and a level, and still prints them', async () => {
    const printed = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { startLog } = await load()
    const dir = join(tempDir(), 'Logs', 'Pullshelf')
    const file = startLog(dir)
    expect(file).toBe(join(dir, 'main.log'))
    console.error('[pullshelf] renderer gone:', 'oom', 9)
    console.warn('careful')
    expect(printed).toHaveBeenCalledWith('[pullshelf] renderer gone:', 'oom', 9)
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z ERROR \[pullshelf\] renderer gone: oom 9$/)
    expect(lines[1]).toMatch(/ WARN careful$/)
  })

  it('writes info lines without printing them twice', async () => {
    const { startLog, logInfo } = await load()
    const file = startLog(tempDir())
    logInfo('Pullshelf 1.2.3 starting')
    expect(readFileSync(file, 'utf8')).toMatch(/ INFO Pullshelf 1\.2\.3 starting\n$/)
  })

  it('includes the stack of an Error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { startLog } = await load()
    const file = startLog(tempDir())
    console.error(new Error('kaput'))
    expect(readFileSync(file, 'utf8')).toMatch(/ERROR Error: kaput\n\s+at /)
  })

  it('rotates to main.1.log once the file passes the size limit, keeping one old file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { startLog } = await load()
    const dir = tempDir()
    const file = startLog(dir, 200)
    for (let i = 0; i < 12; i += 1) console.error(`line ${i} ${'x'.repeat(40)}`)
    const current = readFileSync(file, 'utf8')
    const old = readFileSync(join(dir, 'main.1.log'), 'utf8')
    expect(current.length).toBeLessThanOrEqual(200 + 100)
    expect(current).toContain('line 11')
    expect(old).not.toContain('line 11')
    expect(existsSync(join(dir, 'main.2.log'))).toBe(false)
  })

  it('never throws when the log cannot be written', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { startLog, logInfo } = await load()
    const blocker = join(tempDir(), 'file')
    writeFileSync(blocker, 'x')
    expect(() => startLog(join(blocker, 'Logs'))).not.toThrow()
    expect(() => console.error('still fine')).not.toThrow()
    expect(() => logInfo('still fine')).not.toThrow()
  })

  it('does nothing before it is started', async () => {
    const { logInfo } = await load()
    expect(() => logInfo('nowhere')).not.toThrow()
  })

  it('starting again only switches the file, without wrapping the console twice', async () => {
    const printed = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { startLog } = await load()
    const first = startLog(tempDir())
    const second = startLog(tempDir())
    console.error('once')
    expect(printed).toHaveBeenCalledTimes(1)
    expect(existsSync(first) ? readFileSync(first, 'utf8') : '').not.toContain('once')
    expect(readFileSync(second, 'utf8').match(/once/g)).toHaveLength(1)
  })
})
