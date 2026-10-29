import { mkdirSync } from 'node:fs'
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

export function openDatabase(userData: string): Database.Database {
  mkdirSync(userData, { recursive: true })
  const db = new Database(join(userData, 'pullshelf.db'))
  db.pragma('journal_mode = WAL')
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
  try {
    db.exec('ALTER TABLE notes ADD COLUMN title_locked INTEGER NOT NULL DEFAULT 0')
  } catch {
    // Column already exists.
  }
  return db
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
