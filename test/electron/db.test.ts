import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openDatabase, readSettings, rebaseClipImagePaths, writeSettings } from '../../electron/db'
import type { Settings } from '../../src/shared/types'
import { tempDir } from '../helpers/tmp'

const names = (db: ReturnType<typeof openDatabase>) =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]).map(
    (row) => row.name
  )

describe('openDatabase', () => {
  it('creates the data directory and every table', () => {
    const dir = join(tempDir(), 'nested', 'data')
    const db = openDatabase(dir)
    expect(existsSync(join(dir, 'pullshelf.db'))).toBe(true)
    expect(names(db)).toEqual(expect.arrayContaining(['clips', 'files', 'notes', 'settings']))
  })

  it('adds the title_locked column to notes', () => {
    const db = openDatabase(tempDir())
    db.prepare('INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('n', 't', 'b', 1, 2)
    expect(db.prepare('SELECT title_locked FROM notes WHERE id = ?').get('n')).toEqual({ title_locked: 0 })
  })

  it('opens an existing database again without error (migration already applied)', () => {
    const dir = tempDir()
    openDatabase(dir)
    expect(() => openDatabase(dir)).not.toThrow()
  })

  it('upgrades a notes table created before title_locked existed and keeps its rows', () => {
    const dir = tempDir()
    const old = new Database(join(dir, 'pullshelf.db'))
    old.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    old.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?)').run('keep', 'Old note', 'text', 1, 2)
    old.close()

    const db = openDatabase(dir)
    expect(db.prepare('SELECT id, title, title_locked FROM notes').all()).toEqual([
      { id: 'keep', title: 'Old note', title_locked: 0 }
    ])
  })
})

describe('readSettings', () => {
  const defaults: Settings = {
    presetId: 'claude',
    customCommand: '',
    cwd: '/home/me',
    toolRatio: 0.4,
    clipRatio: 0.18,
    filesRatio: 0.2,
    heightRatio: 0.52,
    showTrayIcon: true
  }

  it('returns the defaults with the fallback cwd when nothing is saved', () => {
    expect(readSettings(openDatabase(tempDir()), '/home/me')).toEqual(defaults)
  })

  it('round-trips saved settings', () => {
    const db = openDatabase(tempDir())
    const saved: Settings = { ...defaults, presetId: 'codex', customCommand: 'ls', cwd: '/work', toolRatio: 0.3, filesRatio: 0.25 }
    writeSettings(db, saved)
    expect(readSettings(db, '/home/me')).toEqual(saved)
  })

  it('overwrites on a second write instead of adding a row', () => {
    const db = openDatabase(tempDir())
    writeSettings(db, defaults)
    writeSettings(db, { ...defaults, cwd: '/second' })
    expect(db.prepare('SELECT COUNT(*) AS c FROM settings').get()).toEqual({ c: 1 })
    expect(readSettings(db, '/x').cwd).toBe('/second')
  })

  it('clamps every ratio into its allowed range', () => {
    const db = openDatabase(tempDir())
    writeSettings(db, { ...defaults, toolRatio: 5, clipRatio: -1, filesRatio: 0.5, heightRatio: 3 })
    expect(readSettings(db, '/x')).toMatchObject({ toolRatio: 0.8, clipRatio: 0.08, filesRatio: 0.5, heightRatio: 0.92 })
    writeSettings(db, { ...defaults, heightRatio: 0.01 })
    expect(readSettings(db, '/x').heightRatio).toBe(0.25)
  })

  it('clamps each of the three pane ratios at both ends', () => {
    const db = openDatabase(tempDir())
    writeSettings(db, { ...defaults, toolRatio: -1, clipRatio: 9, filesRatio: 9 })
    expect(readSettings(db, '/x')).toMatchObject({ toolRatio: 0.08, clipRatio: 0.8, filesRatio: 0.8 })
    writeSettings(db, { ...defaults, toolRatio: 9, clipRatio: -1, filesRatio: -1 })
    expect(readSettings(db, '/x')).toMatchObject({ toolRatio: 0.8, clipRatio: 0.08, filesRatio: 0.08 })
  })

  it('falls back per field when a ratio is missing, not a number, or NaN', () => {
    const db = openDatabase(tempDir())
    db.prepare(`INSERT INTO settings (key, value) VALUES ('settings', ?)`).run(
      JSON.stringify({ filesRatio: 'wide', toolRatio: 0.5, heightRatio: null, cwd: '', presetId: undefined })
    )
    const result = readSettings(db, '/home/me')
    // filesRatio is present, so the layout is treated as current; the bad value uses the default.
    expect(result).toMatchObject({ filesRatio: 0.2, toolRatio: 0.5, clipRatio: 0.18, heightRatio: 0.52, cwd: '/home/me', presetId: 'claude', customCommand: '' })
  })

  it('treats NaN-like numbers as missing', () => {
    const db = openDatabase(tempDir())
    // JSON cannot encode NaN, so null stands in for a value that was NaN when saved.
    db.prepare(`INSERT INTO settings (key, value) VALUES ('settings', ?)`).run(JSON.stringify({ filesRatio: 0.2, clipRatio: null }))
    expect(readSettings(db, '/x').clipRatio).toBe(0.18)
  })

  it('ignores the old two-ratio layout (saved before the Files pane existed)', () => {
    const db = openDatabase(tempDir())
    db.prepare(`INSERT INTO settings (key, value) VALUES ('settings', ?)`).run(
      JSON.stringify({ presetId: 'shell', toolRatio: 0.56, clipRatio: 0.2, heightRatio: 0.6, cwd: '/old' })
    )
    expect(readSettings(db, '/x')).toEqual({
      presetId: 'shell',
      customCommand: '',
      cwd: '/old',
      toolRatio: 0.4,
      clipRatio: 0.18,
      filesRatio: 0.2,
      heightRatio: 0.6,
      showTrayIcon: true
    })
  })

  it('keeps the menu-bar icon unless it was explicitly turned off', () => {
    const db = openDatabase(tempDir())
    writeSettings(db, { ...defaults, showTrayIcon: false })
    expect(readSettings(db, '/x').showTrayIcon).toBe(false)
    writeSettings(db, { ...defaults, showTrayIcon: true })
    expect(readSettings(db, '/x').showTrayIcon).toBe(true)
    // Saved before the option existed, or with a value that is not a boolean.
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'settings'`).run(JSON.stringify({ cwd: '/old', filesRatio: 0.2 }))
    expect(readSettings(db, '/x').showTrayIcon).toBe(true)
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'settings'`).run(JSON.stringify({ filesRatio: 0.2, showTrayIcon: 'no' }))
    expect(readSettings(db, '/x').showTrayIcon).toBe(true)
  })

  it('returns the defaults when the saved value is not valid JSON', () => {
    const db = openDatabase(tempDir())
    db.prepare(`INSERT INTO settings (key, value) VALUES ('settings', ?)`).run('{not json')
    expect(readSettings(db, '/home/me')).toEqual(defaults)
  })
})

describe('rebaseClipImagePaths', () => {
  const addClip = (db: ReturnType<typeof openDatabase>, id: string, imagePath: string | null) =>
    db.prepare(`INSERT INTO clips (id, kind, text, image_path, preview, favorite, created_at) VALUES (?, 'image', NULL, ?, 'Image', 0, 1)`).run(id, imagePath)
  const paths = (db: ReturnType<typeof openDatabase>) =>
    (db.prepare('SELECT id, image_path FROM clips ORDER BY id').all() as { id: string; image_path: string | null }[]).map((r) => [r.id, r.image_path])

  it('points image clips at the new folder, leaves other paths alone, and is safe to repeat', () => {
    const db = openDatabase(tempDir())
    addClip(db, 'a', '/Support/Ledge/clips/a.png')
    addClip(db, 'b', '/Support/Ledge/clips/nested/b.png')
    addClip(db, 'c', '/elsewhere/c.png')
    addClip(db, 'd', '/Support/LedgeOther/clips/d.png') // same prefix text, different folder
    addClip(db, 'e', null)
    rebaseClipImagePaths(db, '/Support/Ledge', '/Support/Pullshelf')
    const expected = [
      ['a', '/Support/Pullshelf/clips/a.png'],
      ['b', '/Support/Pullshelf/clips/nested/b.png'],
      ['c', '/elsewhere/c.png'],
      ['d', '/Support/LedgeOther/clips/d.png'],
      ['e', null]
    ]
    expect(paths(db)).toEqual(expected)
    rebaseClipImagePaths(db, '/Support/Ledge', '/Support/Pullshelf')
    expect(paths(db)).toEqual(expected)
  })

  it('accepts folder paths that already end in a slash', () => {
    const db = openDatabase(tempDir())
    addClip(db, 'a', '/Support/Ledge/clips/a.png')
    rebaseClipImagePaths(db, '/Support/Ledge/', '/Support/Pullshelf/')
    expect(paths(db)).toEqual([['a', '/Support/Pullshelf/clips/a.png']])
  })
})
