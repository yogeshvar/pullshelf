import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Note } from '../shared/types'
import { PaneHead } from './PaneHead'

export function NotesPane({
  notes,
  onToast,
  collapsed,
  onToggle
}: {
  notes: Note[]
  onToast: (message: string) => void
  collapsed: boolean
  onToggle: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [draftNoteId, setDraftNoteId] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const draftRef = useRef(draft)
  const savedBody = useRef('')
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const paneRef = useRef<HTMLElement>(null)
  const pickTimer = useRef<number | null>(null)
  draftRef.current = draft

  const needle = query.trim().toLowerCase()
  const filtered = notes.filter(
    (note) => !needle || note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle)
  )
  const selected = notes.find((note) => note.id === selectedId) ?? notes[0] ?? null

  useEffect(() => {
    const body = selected?.body ?? ''
    savedBody.current = body
    setDraft(body)
    setDraftNoteId(selected?.id ?? null)
  }, [selected?.id])

  useEffect(() => {
    const id = selected?.id
    if (!id) return
    return () => {
      const latest = draftRef.current
      if (latest !== savedBody.current) void window.pullshelf.updateNote(id, latest)
    }
  }, [selected?.id])

  useEffect(() => {
    if (!selected || selected.id !== draftNoteId || draft === selected.body) return
    const id = selected.id
    const body = draft
    const timer = window.setTimeout(() => {
      void window.pullshelf.updateNote(id, body)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [draft, draftNoteId, selected])

  // Close the dropdown on an outside click or Escape.
  useEffect(() => {
    if (!listOpen && !searchOpen) return
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('.note-menu, .note-search, .note-tools')) return
      closeMenus()
    }
    const esc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // While renaming, Escape only cancels the rename (handled by the field itself).
      if (event.target instanceof Element && event.target.closest('.note-rename')) return
      event.preventDefault() // used up: the shelf itself stays open
      closeMenus()
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', esc, true) // capture, so it runs before the shelf's own Escape
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', esc, true)
    }
  }, [listOpen, searchOpen])

  function closeMenus() {
    setListOpen(false)
    setSearchOpen(false)
    setQuery('')
    setRenamingId(null)
    setConfirmingId(null)
  }

  async function create() {
    const note = await window.pullshelf.createNote()
    setSelectedId(note.id)
    closeMenus()
    window.setTimeout(() => editorRef.current?.focus(), 0)
  }

  // Selecting waits a beat so a double-click (rename) can cancel it.
  function pick(id: string) {
    if (pickTimer.current) window.clearTimeout(pickTimer.current)
    pickTimer.current = window.setTimeout(() => {
      pickTimer.current = null
      setSelectedId(id)
      closeMenus()
      window.setTimeout(() => editorRef.current?.focus(), 0)
    }, 220)
  }

  function startRename(note: Note) {
    if (pickTimer.current) {
      window.clearTimeout(pickTimer.current)
      pickTimer.current = null
    }
    setRenamingId(note.id)
    setRenameDraft(note.title)
  }

  function commitRename() {
    const id = renamingId as string // only the rename field calls this, and it exists only while renaming
    setRenamingId(null)
    const note = notes.find((item) => item.id === id)
    // Clearing the field hands the title back to the note's first line.
    if (note && renameDraft.trim() !== note.title) void window.pullshelf.renameNote(id, renameDraft.trim())
  }

  async function remove(id: string) {
    if (confirmingId !== id) {
      setConfirmingId(id)
      return
    }
    const remaining = await window.pullshelf.deleteNote(id)
    if (id === selectedId) setSelectedId(remaining[0]?.id ?? null)
    setConfirmingId(null)
  }

  async function send() {
    if (!draft.trim()) return
    const result = await window.pullshelf.sendToTool(draft)
    onToast(result.ok ? 'Sent to the tool' : result.error ?? 'Could not send')
  }

  async function openClaude(mode: 'chat' | 'code') {
    const result = await window.pullshelf.openInClaude(draft, mode)
    if (!result.ok) onToast(result.error ?? 'Could not open Claude Desktop')
  }

  return (
    <section ref={paneRef} className={collapsed ? 'pane notes-pane collapsed' : 'pane notes-pane'}>
      <PaneHead title="Notes" collapsed={collapsed} onToggle={onToggle} count={notes.length}>
        <span className="note-tools">
          <IconButton label="New note" onClick={() => void create()}>
            <path d="M8 3v10M3 8h10" />
          </IconButton>
          <IconButton
            label="Notes list"
            active={listOpen}
            onClick={() => {
              setListOpen((open) => !open)
              setSearchOpen(false)
              setQuery('')
            }}
          >
            <path d="M3 4.5h10M3 8h10M3 11.5h10" />
          </IconButton>
          <IconButton
            label="Search notes"
            active={searchOpen}
            onClick={() => {
              setSearchOpen((open) => !open)
              setListOpen(false)
              setQuery('')
            }}
          >
            <circle cx="7" cy="7" r="3.6" />
            <path d="m9.8 9.8 3 3" />
          </IconButton>
        </span>
      </PaneHead>

      {searchOpen ? (
        <input
          className="note-search"
          autoFocus
          value={query}
          placeholder="Search notes"
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}

      {listOpen || (searchOpen && needle) ? (
        <ul className="note-menu" role="listbox">
          {filtered.length === 0 ? (
            <li className="empty">{needle ? 'No matches.' : 'Jot something down.'}</li>
          ) : (
            filtered.map((note) => (
              <li key={note.id} className={note.id === selected?.id ? 'note-item active' : 'note-item'}>
                {renamingId === note.id ? (
                  <input
                    className="note-rename"
                    autoFocus
                    value={renameDraft}
                    maxLength={80}
                    placeholder="Untitled"
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') {
                        event.stopPropagation()
                        setRenamingId(null)
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="note-pick"
                    onClick={() => pick(note.id)}
                    onDoubleClick={() => startRename(note)}
                    title="Double-click to rename"
                  >
                    <strong>{note.title}</strong>
                    <span>{age(note.updatedAt)}</span>
                  </button>
                )}
                <span className="note-item-actions">
                  <button
                    type="button"
                    aria-label="Rename"
                    title="Rename"
                    onClick={() => startRename(note)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={confirmingId === note.id ? 'danger' : ''}
                    aria-label="Delete"
                    title={confirmingId === note.id ? 'Click again to delete' : 'Delete'}
                    onClick={() => void remove(note.id)}
                  >
                    {confirmingId === note.id ? 'Sure?' : '✕'}
                  </button>
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {selected ? (
        <>
          <textarea
            ref={editorRef}
            className="note-editor"
            value={draft}
            placeholder="Start typing"
            spellCheck
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="note-actions">
            <button type="button" onClick={() => void send()}>
              Send
            </button>
            <button type="button" onClick={() => void openClaude('chat')}>
              Claude
            </button>
            <button type="button" onClick={() => void openClaude('code')}>
              Code
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="empty-action" onClick={() => void create()}>
          New note
        </button>
      )}
    </section>
  )
}

function IconButton({
  label,
  active,
  onClick,
  children
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={active ? 'icon-btn active' : 'icon-btn'}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {children}
      </svg>
    </button>
  )
}

function age(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}
