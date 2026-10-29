import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateLegacyData } from '../../electron/migrate'
import { openDatabase, readSettings, writeSettings } from '../../electron/db'
import { tempDir } from '../helpers/tmp'

afterEach(() => {
  vi.restoreAllMocks()
})

/** A layout like ~/Library/Application Support with Pullshelf, Perch and Ledge folders as siblings. */
function support() {
  const root = tempDir('pullshelf-migrate-')
  return { root, pullshelf: join(root, 'Pullshelf'), ledge: join(root, 'Ledge'), perch: join(root, 'Perch') }
}

const put = (dir: string, name: string, text: string) => {
  mkdirSync(join(dir, name, '..'), { recursive: true })
  writeFileSync(join(dir, name), text)
}
const read = (dir: string, name: string) => readFileSync(join(dir, name), 'utf8')

describe('migrateLegacyData', () => {
  it('does nothing on a fresh install', () => {
    const { pullshelf, ledge } = support()
    migrateLegacyData(pullshelf, ledge)
    expect(existsSync(pullshelf)).toBe(false)
    expect(existsSync(ledge)).toBe(false)
  })

  it('moves the whole Ledge folder to Perch and renames the database files', () => {
    const { pullshelf, ledge } = support()
    put(ledge, 'ledge.db', 'db')
    put(ledge, 'ledge.db-wal', 'wal')
    put(ledge, 'ledge.db-shm', 'shm')
    put(ledge, 'notes/one.md', 'my note')
    put(ledge, 'clips/img.png', 'png')
    migrateLegacyData(pullshelf, ledge)
    expect(existsSync(ledge)).toBe(false)
    expect(readdirSync(pullshelf).sort()).toEqual(['clips', 'notes', 'pullshelf.db', 'pullshelf.db-shm', 'pullshelf.db-wal'])
    expect(read(pullshelf, 'pullshelf.db')).toBe('db')
    expect(read(pullshelf, 'pullshelf.db-wal')).toBe('wal')
    expect(read(pullshelf, 'pullshelf.db-shm')).toBe('shm')
    expect(read(pullshelf, 'notes/one.md')).toBe('my note')
  })

  it('moves a Perch 0.1 folder to Pullshelf and renames its database files', () => {
    const { pullshelf, perch } = support()
    put(perch, 'perch.db', 'db')
    put(perch, 'perch.db-wal', 'wal')
    put(perch, 'perch.db-shm', 'shm')
    put(perch, 'notes/one.md', 'my note')
    migrateLegacyData(pullshelf, perch)
    expect(existsSync(perch)).toBe(false)
    expect(readdirSync(pullshelf).sort()).toEqual(['notes', 'pullshelf.db', 'pullshelf.db-shm', 'pullshelf.db-wal'])
    expect(read(pullshelf, 'pullshelf.db')).toBe('db')
    expect(read(pullshelf, 'notes/one.md')).toBe('my note')
  })

  it('fills in an existing Pullshelf folder from a Perch folder, renaming perch.db', () => {
    const { pullshelf, perch } = support()
    put(perch, 'perch.db', 'db')
    put(perch, 'perch.db-wal', 'wal')
    put(pullshelf, 'Preferences', 'new prefs')
    migrateLegacyData(pullshelf, perch)
    expect(readdirSync(pullshelf).sort()).toEqual(['Preferences', 'pullshelf.db', 'pullshelf.db-wal'])
    expect(read(pullshelf, 'pullshelf.db')).toBe('db')
  })

  it('uses Perch data and leaves Ledge alone when both old folders exist (Perch is migrated first)', () => {
    const { pullshelf, perch, ledge } = support()
    put(perch, 'perch.db', 'perch data')
    put(ledge, 'ledge.db', 'ledge data')
    migrateLegacyData(pullshelf, perch)
    migrateLegacyData(pullshelf, ledge)
    expect(read(pullshelf, 'pullshelf.db')).toBe('perch data')
    expect(read(ledge, 'ledge.db')).toBe('ledge data')
  })

  it('works when Ledge has only a database, with no -wal or -shm file', () => {
    const { pullshelf, ledge } = support()
    put(ledge, 'ledge.db', 'db')
    migrateLegacyData(pullshelf, ledge)
    expect(readdirSync(pullshelf)).toEqual(['pullshelf.db'])
  })

  it('leaves everything alone when Perch already has a database', () => {
    const { pullshelf, ledge } = support()
    put(ledge, 'ledge.db', 'old')
    put(ledge, 'notes/old.md', 'old')
    put(pullshelf, 'pullshelf.db', 'new')
    migrateLegacyData(pullshelf, ledge)
    expect(read(pullshelf, 'pullshelf.db')).toBe('new')
    expect(readdirSync(pullshelf)).toEqual(['pullshelf.db'])
    expect(read(ledge, 'ledge.db')).toBe('old')
    expect(read(ledge, 'notes/old.md')).toBe('old')
  })

  it('fills in a Perch folder that exists without a database, without overwriting anything', () => {
    const { pullshelf, ledge } = support()
    put(ledge, 'ledge.db', 'db')
    put(ledge, 'ledge.db-wal', 'wal')
    put(ledge, 'notes/one.md', 'legacy note')
    put(ledge, 'Preferences', 'legacy prefs')
    put(pullshelf, 'Preferences', 'new prefs')
    symlinkSync('nowhere', join(ledge, 'SingletonLock'))
    symlinkSync('elsewhere', join(pullshelf, 'SingletonLock')) // dangling, but still "there"
    migrateLegacyData(pullshelf, ledge)
    expect(readdirSync(pullshelf).sort()).toEqual(['Preferences', 'SingletonLock', 'notes', 'pullshelf.db', 'pullshelf.db-wal'])
    expect(read(pullshelf, 'pullshelf.db')).toBe('db')
    expect(read(pullshelf, 'notes/one.md')).toBe('legacy note')
    expect(read(pullshelf, 'Preferences')).toBe('new prefs')
    // What could not move stays behind, untouched.
    expect(read(ledge, 'Preferences')).toBe('legacy prefs')
    expect(readdirSync(ledge).sort()).toEqual(['Preferences', 'SingletonLock'])
  })

  it('is idempotent', () => {
    const { pullshelf, ledge } = support()
    put(ledge, 'ledge.db', 'db')
    put(ledge, 'notes/one.md', 'note')
    migrateLegacyData(pullshelf, ledge)
    put(pullshelf, 'notes/two.md', 'written after the first run')
    migrateLegacyData(pullshelf, ledge)
    expect(readdirSync(pullshelf).sort()).toEqual(['notes', 'pullshelf.db'])
    expect(readdirSync(join(pullshelf, 'notes')).sort()).toEqual(['one.md', 'two.md'])
    expect(existsSync(ledge)).toBe(false)
  })

  it('keeps going and logs when an entry cannot be moved', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { pullshelf, ledge } = support()
    put(ledge, 'ledge.db', 'db')
    put(ledge, 'notes/one.md', 'note')
    mkdirSync(pullshelf)
    chmodSync(pullshelf, 0o500) // Perch's folder cannot be written to
    try {
      migrateLegacyData(pullshelf, ledge)
    } finally {
      chmodSync(pullshelf, 0o700)
    }
    expect(error).toHaveBeenCalledWith(expect.stringContaining('could not move'), expect.anything())
    // Nothing was lost: the data is still in Ledge's folder.
    expect(read(ledge, 'ledge.db')).toBe('db')
    expect(read(ledge, 'notes/one.md')).toBe('note')
    // And once the problem is gone, the next launch finishes the job.
    migrateLegacyData(pullshelf, ledge)
    expect(read(pullshelf, 'pullshelf.db')).toBe('db')
    expect(read(pullshelf, 'notes/one.md')).toBe('note')
  })

  it('logs and returns when neither folder can be used at all', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const root = tempDir('pullshelf-migrate-')
    const ledge = join(root, 'Ledge')
    put(ledge, 'ledge.db', 'db')
    chmodSync(root, 0o500) // nothing can be created or renamed next to Ledge
    try {
      expect(() => migrateLegacyData(join(root, 'Pullshelf'), ledge)).not.toThrow()
    } finally {
      chmodSync(root, 0o700)
    }
    expect(error).toHaveBeenCalledWith('[pullshelf] could not bring over data from an older install', expect.anything())
    expect(read(ledge, 'ledge.db')).toBe('db')
  })

  it('the migrated database opens with its settings intact', () => {
    const { pullshelf, ledge } = support()
    const made = tempDir('pullshelf-migrate-')
    const db = openDatabase(made)
    writeSettings(db, { presetId: 'codex', customCommand: '', cwd: '/work', toolRatio: 0.3, clipRatio: 0.2, filesRatio: 0.2, heightRatio: 0.6, showTrayIcon: false })
    db.close() // closing checkpoints the write-ahead log into pullshelf.db
    mkdirSync(ledge)
    writeFileSync(join(ledge, 'ledge.db'), readFileSync(join(made, 'pullshelf.db')))
    migrateLegacyData(pullshelf, ledge)
    expect(readSettings(openDatabase(pullshelf), '/x')).toMatchObject({ presetId: 'codex', cwd: '/work', showTrayIcon: false })
  })
})
