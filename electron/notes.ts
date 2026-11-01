import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { Note } from '../src/shared/types'
import { scrub, type NoteRow } from './db'
import { emit } from './bus'

// Notes are always created with randomUUID(); anything else from the renderer is refused,
// so an id can never steer a file path outside the notes folder.
const NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isNoteId(id: string): boolean {
  return NOTE_ID.test(id)
}

let database: Database.Database | null = null
let notesDir = ''

export function startNotes(db: Database.Database, userData: string): void {
  database = db
  notesDir = join(userData, 'notes')
  mkdirSync(notesDir, { recursive: true })
}

export function listNotes(): Note[] {
  if (!database) return []
  const rows = database
    .prepare('SELECT * FROM notes ORDER BY updated_at DESC')
    .all() as NoteRow[]
  return rows.map(toNote)
}

export function createNote(): Note {
  const now = Date.now()
  const note: Note = {
    id: randomUUID(),
    title: 'New note',
    body: '',
    createdAt: now,
    updatedAt: now
  }
  database
    ?.prepare(
      `INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(note.id, note.title, note.body, note.createdAt, note.updatedAt)
  writeMarkdown(note)
  emit('notes:changed', listNotes())
  return note
}

export function updateNote(id: string, body: string): Note | null {
  if (!isNoteId(id)) return null
  const row = database?.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined
  if (!row || !database) return null
  const nextBody = body.slice(0, 200_000)
  const note: Note = {
    id,
    title: row.title_locked ? row.title : titleFromBody(nextBody),
    body: nextBody,
    createdAt: row.created_at,
    updatedAt: Date.now()
  }
  database
    .prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(note.title, note.body, note.updatedAt, note.id)
  writeMarkdown(note)
  emit('notes:changed', listNotes())
  return note
}

export function renameNote(id: string, title: string): Note | null {
  if (!isNoteId(id)) return null
  const row = database?.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined
  if (!row || !database) return null
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80)
  // An empty title hands the name back to the first line of the note.
  const locked = clean ? 1 : 0
  const next = clean || titleFromBody(row.body)
  database.prepare('UPDATE notes SET title = ?, title_locked = ? WHERE id = ?').run(next, locked, id)
  emit('notes:changed', listNotes())
  return toNote(database.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow)
}

export function deleteNote(id: string): Note[] {
  // Only a note that really exists gets its markdown mirror removed.
  const removed =
    isNoteId(id) && database !== null && Number(database.prepare('DELETE FROM notes WHERE id = ?').run(id).changes) > 0
  if (removed) {
    scrub(database as Database.Database)
    try {
      rmSync(join(notesDir, `${id}.md`), { force: true })
    } catch {
      // The markdown mirror is already gone.
    }
  }
  const notes = listNotes()
  emit('notes:changed', notes)
  return notes
}

export function noteBody(id: string): string | null {
  if (!isNoteId(id)) return null
  const row = database?.prepare('SELECT body FROM notes WHERE id = ?').get(id) as
    | { body: string }
    | undefined
  return row?.body ?? null
}

function writeMarkdown(note: Note): void {
  if (!notesDir) return
  writeFileSync(join(notesDir, `${note.id}.md`), note.body, 'utf8')
}

function titleFromBody(body: string): string {
  const line = body
    .split('\n')
    .map((item) => item.trim())
    .find(Boolean)
  if (!line) return 'New note'
  return line.replace(/^#+\s*/, '').slice(0, 80) || 'New note'
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
