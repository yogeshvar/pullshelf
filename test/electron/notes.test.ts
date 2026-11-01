import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachWebContents } from '../../electron/bus'
import { openDatabase } from '../../electron/db'
import { createNote, deleteNote, isNoteId, listNotes, noteBody, renameNote, startNotes, updateNote } from '../../electron/notes'
import { tempDir } from '../helpers/tmp'

let dir: string
let sent: [string, unknown][]

beforeEach(() => {
  dir = tempDir()
  sent = []
  attachWebContents({ isDestroyed: () => false, send: (channel: string, payload: unknown) => sent.push([channel, payload]) } as never)
  startNotes(openDatabase(dir), dir)
})

const mirror = (id: string) => join(dir, 'notes', `${id}.md`)

describe('createNote', () => {
  it('stores an empty "New note", mirrors it to markdown and announces the list', () => {
    const note = createNote()
    expect(note).toMatchObject({ title: 'New note', body: '' })
    expect(listNotes()).toHaveLength(1)
    expect(readFileSync(mirror(note.id), 'utf8')).toBe('')
    expect(sent.at(-1)).toEqual(['notes:changed', listNotes()])
  })
})

describe('updateNote', () => {
  it('returns null for an unknown note and changes nothing', () => {
    expect(updateNote('missing', 'x')).toBeNull()
    expect(sent).toEqual([])
  })

  it('derives the title from the first non-empty line, without markdown heading marks', () => {
    const { id } = createNote()
    expect(updateNote(id, '\n\n## Shopping list\nmilk')?.title).toBe('Shopping list')
    expect(readFileSync(mirror(id), 'utf8')).toBe('\n\n## Shopping list\nmilk')
    expect(noteBody(id)).toBe('\n\n## Shopping list\nmilk')
  })

  it('caps long titles at 80 characters', () => {
    const { id } = createNote()
    expect(updateNote(id, 'x'.repeat(200))?.title).toHaveLength(80)
  })

  it('falls back to "New note" for an empty body or one with only heading marks', () => {
    const { id } = createNote()
    expect(updateNote(id, '   \n  ')?.title).toBe('New note')
    expect(updateNote(id, '###')?.title).toBe('New note')
  })

  it('truncates absurdly large bodies to 200,000 characters', () => {
    const { id } = createNote()
    expect(updateNote(id, 'a'.repeat(250_000))?.body).toHaveLength(200_000)
  })

  it('keeps a title you chose when the body changes', () => {
    const { id } = createNote()
    renameNote(id, 'My title')
    expect(updateNote(id, 'first line changed')?.title).toBe('My title')
  })

  it('bumps updatedAt and lists the most recently edited note first', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const first = createNote()
    vi.setSystemTime(2_000)
    const second = createNote()
    expect(listNotes().map((n) => n.id)).toEqual([second.id, first.id])
    vi.setSystemTime(3_000)
    updateNote(first.id, 'edited')
    expect(listNotes().map((n) => n.id)).toEqual([first.id, second.id])
    expect(listNotes()[0].updatedAt).toBe(3_000)
  })
})

describe('when the markdown mirror cannot be written', () => {
  it('still saves the note in the database and logs the failure', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { id } = createNote()
    rmSync(mirror(id))
    mkdirSync(mirror(id)) // writing a file over a directory fails with EISDIR
    expect(updateNote(id, 'kept in the db')?.body).toBe('kept in the db')
    expect(noteBody(id)).toBe('kept in the db')
    expect(sent.at(-1)?.[0]).toBe('notes:changed')
    expect(error).toHaveBeenCalledWith('[pullshelf] could not write the markdown copy of a note:', expect.stringContaining('EISDIR'))
  })

  it('still creates a note when the notes folder has gone missing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    rmSync(join(dir, 'notes'), { recursive: true })
    writeFileSync(join(dir, 'notes'), 'not a folder')
    expect(() => createNote()).not.toThrow()
    expect(listNotes()).toHaveLength(1)
  })
})

describe('renameNote', () => {
  it('returns null for an unknown note', () => {
    expect(renameNote('missing', 'x')).toBeNull()
  })

  it('sets and locks a trimmed, single-spaced title', () => {
    const { id } = createNote()
    expect(renameNote(id, '  Weekly   plan \n ')?.title).toBe('Weekly plan')
    expect(sent.at(-1)?.[0]).toBe('notes:changed')
  })

  it('caps the title at 80 characters', () => {
    const { id } = createNote()
    expect(renameNote(id, 'y'.repeat(120))?.title).toHaveLength(80)
  })

  it('clearing the title unlocks it and follows the first line of the body again', () => {
    const { id } = createNote()
    updateNote(id, 'Original first line')
    renameNote(id, 'Custom')
    expect(renameNote(id, '   ')?.title).toBe('Original first line')
    expect(updateNote(id, 'Changed first line')?.title).toBe('Changed first line')
  })
})

describe('deleteNote', () => {
  it('removes the note and its markdown mirror, and returns the remaining list', () => {
    const keep = createNote()
    const gone = createNote()
    const remaining = deleteNote(gone.id)
    expect(remaining.map((n) => n.id)).toEqual([keep.id])
    expect(existsSync(mirror(gone.id))).toBe(false)
    expect(sent.at(-1)).toEqual(['notes:changed', remaining])
  })

  it('still deletes the row when the markdown mirror cannot be removed', () => {
    const { id } = createNote()
    // rmSync refuses to remove a directory without `recursive`, so it throws.
    rmSync(mirror(id))
    mkdirSync(mirror(id))
    expect(() => deleteNote(id)).not.toThrow()
    expect(listNotes()).toEqual([])
    expect(existsSync(mirror(id))).toBe(true)
  })
})

describe('note ids from the renderer', () => {
  const db = () => openDatabase(dir)
  const insert = (id: string) =>
    db().prepare('INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, 1, 1)').run(id, 't', 'b')

  it('never deletes a file outside the notes folder', () => {
    const outside = join(dir, 'secret.md')
    writeFileSync(outside, 'keep')
    for (const id of ['../secret', '..%2fsecret', '/etc/passwd', `${dir}/secret`]) deleteNote(id)
    expect(readFileSync(outside, 'utf8')).toBe('keep')
  })

  it('leaves a markdown file alone when no such note exists', () => {
    const id = '0d6c3c2e-2b6b-4c1a-9d1e-0123456789ab'
    writeFileSync(mirror(id), 'stray')
    deleteNote(id)
    expect(readFileSync(mirror(id), 'utf8')).toBe('stray')
  })

  it('only accepts a bare UUID, with nothing before or after it', () => {
    const id = '0d6c3c2e-2b6b-4c1a-9d1e-0123456789ab'
    expect(isNoteId(id)).toBe(true)
    for (const bad of [`${id}/../../secret`, `${id}\n`, `\n${id}`, `${id}\0`, `${id}.md`, ` ${id}`, `${id}x`, '', '..']) {
      expect(isNoteId(bad)).toBe(false)
    }
  })

  it('refuses ids that are not UUIDs, even when such a row exists', () => {
    insert('../evil')
    expect(updateNote('../evil', 'x')).toBeNull()
    expect(renameNote('../evil', 'x')).toBeNull()
    expect(noteBody('../evil')).toBeNull()
    expect(existsSync(join(dir, 'evil.md'))).toBe(false)
    deleteNote('../evil')
    expect(listNotes().map((n) => n.id)).toEqual(['../evil'])
  })
})

describe('deleted notes leave no trace in the database', () => {
  it('removes the body from the database file and its WAL', () => {
    const marker = 'NOTE-SECRET-41be7'
    const { id } = createNote()
    updateNote(id, marker)
    const onDisk = () =>
      ['pullshelf.db', 'pullshelf.db-wal']
        .map((name) => join(dir, name))
        .filter((path) => existsSync(path))
        .some((path) => readFileSync(path).includes(marker))
    expect(onDisk()).toBe(true)
    deleteNote(id)
    expect(onDisk()).toBe(false)
  })
})

describe('noteBody', () => {
  it('returns the body, or null when the note does not exist', () => {
    const { id } = createNote()
    updateNote(id, 'hello')
    expect(noteBody(id)).toBe('hello')
    expect(noteBody('nope')).toBeNull()
  })
})

describe('before startNotes is called', () => {
  it('is inert instead of throwing', async () => {
    vi.resetModules()
    const fresh = await import('../../electron/notes')
    expect(fresh.listNotes()).toEqual([])
    expect(fresh.updateNote('x', 'y')).toBeNull()
    expect(fresh.renameNote('x', 'y')).toBeNull()
    expect(fresh.noteBody('x')).toBeNull()
    expect(fresh.deleteNote('x')).toEqual([])
    const uuid = '0d6c3c2e-2b6b-4c1a-9d1e-0123456789ab'
    expect(fresh.updateNote(uuid, 'y')).toBeNull()
    expect(fresh.renameNote(uuid, 'y')).toBeNull()
    expect(fresh.noteBody(uuid)).toBeNull()
    expect(fresh.deleteNote(uuid)).toEqual([])
    // Creating still returns a note; nothing can be stored or mirrored without a database.
    expect(fresh.createNote().title).toBe('New note')
  })
})
