import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { Settings } from '../src/shared/types'

export type ClipRow = {
  id: string
  kind: 'text' | 'image'
  text: string | null
  image_path: string | null
  preview: string
  favorite: number
  created_at: number
}

export type NoteRow = {
  id: string
  title: string
  body: string
  created_at: number
  updated_at: number
  title_locked?: number
}

export type FileRow = {
  id: string
  path: string
  name: string
  added_at: number
}

const DEFAULT_SETTINGS: Settings = {
  presetId: 'claude',
  customCommand: '',
  cwd: '',
  toolRatio: 0.4,
  clipRatio: 0.18,
  filesRatio: 0.2,
  heightRatio: 0.52,
  showTrayIcon: true
}

// Each step moves the schema up one version (PRAGMA user_version). Step 1 is the schema from before
// versioning existed, so it must also accept a database that already has some or all of it.
const MIGRATIONS: ((db: Database.Database) => void)[] = [
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS clips (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        text TEXT,
        image_path TEXT,
        preview TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        added_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    if (!db.prepare(`SELECT 1 FROM pragma_table_info('notes') WHERE name = 'title_locked'`).get()) {
      db.exec('ALTER TABLE notes ADD COLUMN title_locked INTEGER NOT NULL DEFAULT 0')
    }
  },
  // Versions before secure_delete left deleted clips and notes in the file's free pages; rewrite it once.
  (db) => {
    db.exec('VACUUM')
  }
]

export const SCHEMA_VERSION = MIGRATIONS.length

function migrate(db: Database.Database): void {
  const current = Number(db.pragma('user_version', { simple: true }))
  // A database from a newer Pullshelf is left alone rather than downgraded.
  for (let version = current; version < SCHEMA_VERSION; version += 1) {
    MIGRATIONS[version](db)
    db.pragma(`user_version = ${version + 1}`)
  }
}

export function openDatabase(userData: string): Database.Database {
  mkdirSync(userData, { recursive: true })
  const db = new Database(join(userData, 'pullshelf.db'))
  try {
    prepare(db)
  } catch (error) {
    db.close()
    throw error
  }
  return db
}

function prepare(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  // Zero out deleted rows so cleared clips and notes do not linger in the file's free pages.
  db.pragma('secure_delete = ON')
  migrate(db)
}

const DAMAGED = /file is not a database|database disk image is malformed/i

/**
 * Opens the database; if the file is damaged, moves it (and its -wal/-shm files) aside as
 * pullshelf.db.corrupt-<time> and starts a fresh one. Nothing is deleted. Other errors are rethrown.
 */
export function openDatabaseOrRecover(userData: string): { db: Database.Database; backup: string | null } {
  mkdirSync(userData, { recursive: true })
  const file = join(userData, 'pullshelf.db')
  const db = new Database(file)
  try {
    prepare(db)
    return { db, backup: null }
  } catch (error) {
    if (!DAMAGED.test(String((error as Error).message))) {
      db.close()
      throw error
    }
    // Move the files while the handle is still open: closing it would delete the -wal and -shm files.
    const backup = `${file}.corrupt-${Date.now()}`
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(file + suffix)) renameSync(file + suffix, backup + suffix)
    }
    db.close()
    console.error(`[pullshelf] the database could not be read; moved it to ${backup} and started fresh`, error)
    return { db: openDatabase(userData), backup }
  }
}

export function scrub(db: Database.Database): void {
  db.pragma('wal_checkpoint(TRUNCATE)')
}

export function readSettings(db: Database.Database, fallbackCwd: string): Settings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('settings') as
    | { value: string }
    | undefined
  if (!row) {
    return { ...DEFAULT_SETTINGS, cwd: fallbackCwd }
  }
  try {
    const parsed = JSON.parse(row.value) as Partial<Settings>
    // Layouts saved before the Files pane used a three-pane meaning for these ratios.
    if (parsed.filesRatio === undefined) {
      delete parsed.toolRatio
      delete parsed.clipRatio
    }
    return {
      presetId: parsed.presetId ?? DEFAULT_SETTINGS.presetId,
      customCommand: parsed.customCommand ?? '',
      cwd: parsed.cwd || fallbackCwd,
      toolRatio: clampRatio(parsed.toolRatio, DEFAULT_SETTINGS.toolRatio, 0.08, 0.8),
      clipRatio: clampRatio(parsed.clipRatio, DEFAULT_SETTINGS.clipRatio, 0.08, 0.8),
      filesRatio: clampRatio(parsed.filesRatio, DEFAULT_SETTINGS.filesRatio, 0.08, 0.8),
      heightRatio: clampRatio(parsed.heightRatio, DEFAULT_SETTINGS.heightRatio, 0.25, 0.92),
      // Settings saved before this option existed keep the icon.
      showTrayIcon: typeof parsed.showTrayIcon === 'boolean' ? parsed.showTrayIcon : DEFAULT_SETTINGS.showTrayIcon
    }
  } catch {
    return { ...DEFAULT_SETTINGS, cwd: fallbackCwd }
  }
}

export function writeSettings(db: Database.Database, settings: Settings): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('settings', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(settings))
}

function clampRatio(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

// Image clips store absolute file paths. After the data folder moved from Ledge to Pullshelf,
// point them at the new location so previews and copy-again keep working. Safe to repeat.
export function rebaseClipImagePaths(db: Database.Database, from: string, to: string): void {
  const prefix = from.endsWith('/') ? from : `${from}/`
  const next = to.endsWith('/') ? to : `${to}/`
  const rows = db.prepare('SELECT id, image_path FROM clips WHERE image_path IS NOT NULL').all() as {
    id: string
    image_path: string
  }[]
  const update = db.prepare('UPDATE clips SET image_path = ? WHERE id = ?')
  for (const row of rows) {
    if (row.image_path.startsWith(prefix)) update.run(next + row.image_path.slice(prefix.length), row.id)
  }
}
