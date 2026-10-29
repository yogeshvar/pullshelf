import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotesPane } from '../../src/shelf/NotesPane'
import type { Note } from '../../src/shared/types'
import { installPullshelf, makeNote } from '../helpers/pullshelf'

const NOW = new Date('2026-01-01T12:00:00Z').getTime()

const alpha = makeNote({ id: 'a', title: 'Alpha', body: 'alpha body', updatedAt: NOW - 10_000 })
const beta = makeNote({ id: 'b', title: 'Beta', body: 'beta body', updatedAt: NOW - 10 * 60_000 })
const gamma = makeNote({ id: 'g', title: 'Gamma', body: 'gamma text', updatedAt: NOW - 5 * 3_600_000 })
const delta = makeNote({ id: 'd', title: 'Delta', body: 'delta', updatedAt: NOW - 3 * 86_400_000 })

function setup(notes: Note[] = [alpha, beta], overrides: Record<string, unknown> = {}) {
  const bridge = installPullshelf(undefined, overrides)
  const onToast = vi.fn()
  const onToggle = vi.fn()
  const view = render(<NotesPane notes={notes} onToast={onToast} collapsed={false} onToggle={onToggle} />)
  const rerender = (next: Note[], collapsed = false) =>
    view.rerender(<NotesPane notes={next} onToast={onToast} collapsed={collapsed} onToggle={onToggle} />)
  return { ...bridge, onToast, onToggle, ...view, rerender }
}

const editor = () => screen.getByPlaceholderText('Start typing') as HTMLTextAreaElement
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
const flushPromises = () => act(async () => undefined)

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
})
afterEach(() => vi.useRealTimers())

describe('the editor', () => {
  it('shows the first note and saves edits 350 ms after you stop typing', async () => {
    const { pullshelf } = setup()
    expect(editor().value).toBe('alpha body')
    fireEvent.change(editor(), { target: { value: 'alpha body!' } })
    await advance(349)
    expect(pullshelf.updateNote).not.toHaveBeenCalled()
    await advance(2)
    expect(pullshelf.updateNote).toHaveBeenCalledWith('a', 'alpha body!')
  })

  it('only saves the last keystroke of a burst', async () => {
    const { pullshelf } = setup()
    fireEvent.change(editor(), { target: { value: 'one' } })
    await advance(200)
    fireEvent.change(editor(), { target: { value: 'one two' } })
    await advance(400)
    expect(pullshelf.updateNote.mock.calls).toEqual([['a', 'one two']])
  })

  it('does not save when the text is unchanged', async () => {
    const { pullshelf } = setup()
    fireEvent.change(editor(), { target: { value: 'alpha body' } })
    await advance(1000)
    expect(pullshelf.updateNote).not.toHaveBeenCalled()
  })

  it('saves pending text immediately when you switch to another note, to the right note', async () => {
    const { pullshelf } = setup()
    fireEvent.change(editor(), { target: { value: 'unsaved alpha' } })
    click('Notes list')
    fireEvent.click(screen.getByText('Beta'))
    await advance(300)
    expect(editor().value).toBe('beta body')
    expect(pullshelf.updateNote.mock.calls).toEqual([['a', 'unsaved alpha']])
    await advance(1000)
    expect(pullshelf.updateNote.mock.calls).toEqual([['a', 'unsaved alpha']]) // nothing written to Beta
  })

  it('does not re-save text that was already saved when you switch', async () => {
    const { pullshelf } = setup()
    click('Notes list')
    fireEvent.click(screen.getByText('Beta'))
    await advance(300)
    expect(pullshelf.updateNote).not.toHaveBeenCalled()
  })

  it('invites you to create a note when there are none', async () => {
    const { pullshelf } = setup([])
    expect(screen.queryByPlaceholderText('Start typing')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New note', hidden: false, description: '' }).closest('button') as HTMLElement)
    await flushPromises()
    expect(pullshelf.createNote).toHaveBeenCalled()
  })

  it('follows the selected note when the notes list is replaced', () => {
    const { rerender } = setup([alpha])
    rerender([{ ...alpha, body: 'changed elsewhere' }])
    expect(editor().value).toBe('alpha body') // the open draft is kept while you are on this note
    rerender([beta])
    expect(editor().value).toBe('beta body')
  })
})

describe('creating notes', () => {
  it('+ creates a note, closes menus and focuses the editor', async () => {
    const { pullshelf, rerender } = setup()
    click('Notes list')
    click('New note')
    await flushPromises()
    expect(pullshelf.createNote).toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    const fresh = makeNote({ id: 'new', title: 'New note', body: '' })
    rerender([fresh, alpha, beta])
    await advance(10)
    expect(editor().value).toBe('')
    expect(document.activeElement).toBe(editor())
  })
})

describe('the notes list', () => {
  it('opens and closes with the list button, showing titles and ages', () => {
    setup([alpha, beta, gamma, delta])
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    click('Notes list')
    const list = screen.getByRole('listbox')
    expect(list).toHaveTextContent('Alpha')
    for (const age of ['now', '10m', '5h', '3d']) expect(list).toHaveTextContent(age)
    click('Notes list')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('says so when there is nothing to list', () => {
    setup([])
    click('Notes list')
    expect(screen.getByText('Jot something down.')).toBeInTheDocument()
  })

  it('picking a note switches to it and closes the list', async () => {
    setup()
    click('Notes list')
    fireEvent.click(screen.getByText('Beta'))
    await advance(300)
    expect(editor().value).toBe('beta body')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await advance(10)
    expect(document.activeElement).toBe(editor())
  })

  it('two quick picks only act on the last one', async () => {
    setup([alpha, beta, gamma])
    click('Notes list')
    fireEvent.click(screen.getByText('Beta'))
    await advance(100)
    fireEvent.click(screen.getByText('Gamma'))
    await advance(300)
    expect(editor().value).toBe('gamma text')
  })

  it('closes on Escape and on a click outside, but not on a click inside', () => {
    setup()
    click('Notes list')
    fireEvent.pointerDown(screen.getByRole('listbox'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    click('Notes list')
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    click('Notes list')
    window.dispatchEvent(new Event('pointerdown')) // target is the window itself, not an element: ignored
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('stops listening for outside clicks once closed', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    setup()
    click('Notes list')
    click('Notes list')
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true)
  })
})

describe('search', () => {
  it('filters by title or body, case-insensitively, and lists matches while typing', () => {
    setup([alpha, beta, gamma])
    click('Search notes')
    const box = screen.getByPlaceholderText('Search notes')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'BETA' } })
    expect(screen.getByRole('listbox')).toHaveTextContent('Beta')
    expect(screen.getByRole('listbox')).not.toHaveTextContent('Alpha')
    fireEvent.change(box, { target: { value: 'gamma text' } }) // matches the body
    expect(screen.getByRole('listbox')).toHaveTextContent('Gamma')
    fireEvent.change(box, { target: { value: '   ' } }) // blank query shows nothing special
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('says when nothing matches', () => {
    setup()
    click('Search notes')
    fireEvent.change(screen.getByPlaceholderText('Search notes'), { target: { value: 'zzz' } })
    expect(screen.getByText('No matches.')).toBeInTheDocument()
  })

  it('closing search clears the query; opening the list closes search and vice versa', () => {
    setup()
    click('Search notes')
    fireEvent.change(screen.getByPlaceholderText('Search notes'), { target: { value: 'beta' } })
    click('Search notes')
    expect(screen.queryByPlaceholderText('Search notes')).not.toBeInTheDocument()
    click('Search notes')
    expect((screen.getByPlaceholderText('Search notes') as HTMLInputElement).value).toBe('')
    click('Notes list')
    expect(screen.queryByPlaceholderText('Search notes')).not.toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    click('Search notes')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does not close when you click in the search box', () => {
    setup()
    click('Search notes')
    fireEvent.pointerDown(screen.getByPlaceholderText('Search notes'))
    expect(screen.getByPlaceholderText('Search notes')).toBeInTheDocument()
  })
})

describe('renaming', () => {
  const startRename = () => {
    click('Notes list')
    fireEvent.doubleClick(screen.getByText('Beta'))
    return screen.getByPlaceholderText('Untitled') as HTMLInputElement
  }

  it('double-clicking a title edits it in place, and Enter saves the new name', async () => {
    const { pullshelf } = setup()
    const input = startRename()
    expect(input.value).toBe('Beta')
    fireEvent.change(input, { target: { value: '  Beta two  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(pullshelf.renameNote).toHaveBeenCalledWith('b', 'Beta two')
    expect(screen.queryByPlaceholderText('Untitled')).not.toBeInTheDocument()
  })

  it('the pencil button starts a rename too', () => {
    setup()
    click('Notes list')
    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[1])
    expect((screen.getByPlaceholderText('Untitled') as HTMLInputElement).value).toBe('Beta')
  })

  it('does not save when the name is unchanged', () => {
    const { pullshelf } = setup()
    const input = startRename()
    fireEvent.blur(input)
    expect(pullshelf.renameNote).not.toHaveBeenCalled()
  })

  it('an emptied name is sent so the title goes back to following the note', () => {
    const { pullshelf } = setup()
    const input = startRename()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(pullshelf.renameNote).toHaveBeenCalledWith('b', '')
  })

  it('Escape cancels without saving', () => {
    const { pullshelf } = setup()
    const input = startRename()
    fireEvent.change(input, { target: { value: 'Something else' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('Untitled')).not.toBeInTheDocument()
    expect(pullshelf.renameNote).not.toHaveBeenCalled()
    expect(screen.getByRole('listbox')).toBeInTheDocument() // Escape was consumed by the field
  })

  it('other keys while renaming do nothing special', () => {
    const { pullshelf } = setup()
    const input = startRename()
    fireEvent.keyDown(input, { key: 'a' })
    expect(screen.getByPlaceholderText('Untitled')).toBeInTheDocument()
    expect(pullshelf.renameNote).not.toHaveBeenCalled()
  })

  it('a rename of a note that has since been deleted is ignored', () => {
    const { pullshelf, rerender } = setup()
    const input = startRename()
    fireEvent.change(input, { target: { value: 'Ghost' } })
    rerender([alpha])
    fireEvent.blur(input)
    expect(pullshelf.renameNote).not.toHaveBeenCalled()
  })

  it('starting a rename cancels a pending pick from the first click of the double-click', async () => {
    setup()
    click('Notes list')
    fireEvent.click(screen.getByText('Beta'))
    fireEvent.doubleClick(screen.getByText('Beta'))
    await advance(400)
    expect(editor().value).toBe('alpha body') // still on Alpha
    expect(screen.getByPlaceholderText('Untitled')).toBeInTheDocument()
  })

  it('renaming works when no pick was pending', () => {
    setup()
    click('Notes list')
    fireEvent.doubleClick(screen.getByText('Alpha'))
    expect(screen.getByPlaceholderText('Untitled')).toBeInTheDocument()
  })
})

describe('deleting', () => {
  it('asks twice before deleting, and selects what is left if the open note was deleted', async () => {
    const { pullshelf, rerender } = setup([alpha, beta], { deleteNote: vi.fn(async () => [beta]) })
    click('Notes list')
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    expect(pullshelf.deleteNote).not.toHaveBeenCalled()
    expect(screen.getByText('Sure?')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('Sure?'))
    })
    expect(pullshelf.deleteNote).toHaveBeenCalledWith('a')
    rerender([beta])
    expect(editor().value).toBe('beta body')
  })

  it('deleting another note keeps the open one, and the last note leaves an empty pane', async () => {
    const { pullshelf, rerender } = setup([alpha, beta], { deleteNote: vi.fn(async () => [alpha]) })
    click('Notes list')
    const deletes = () => screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(deletes()[1])
    await act(async () => {
      fireEvent.click(screen.getByText('Sure?'))
    })
    expect(pullshelf.deleteNote).toHaveBeenCalledWith('b')
    rerender([alpha])
    expect(editor().value).toBe('alpha body')

    pullshelf.deleteNote.mockResolvedValueOnce([])
    fireEvent.click(deletes()[0])
    await act(async () => {
      fireEvent.click(screen.getByText('Sure?'))
    })
    rerender([])
    expect(screen.queryByPlaceholderText('Start typing')).not.toBeInTheDocument()
  })

  it('closing the menu forgets a half-finished delete confirmation', () => {
    setup()
    click('Notes list')
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    expect(screen.getByText('Sure?')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    click('Notes list')
    expect(screen.queryByText('Sure?')).not.toBeInTheDocument()
  })
})

describe('deleting the note you picked', () => {
  const pickBeta = async () => {
    click('Notes list')
    fireEvent.click(screen.getByText('Beta'))
    await advance(300)
  }

  it('moves to the first remaining note', async () => {
    const { pullshelf, rerender } = setup([alpha, beta], { deleteNote: vi.fn(async () => [alpha]) })
    await pickBeta()
    click('Notes list')
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    await act(async () => {
      fireEvent.click(screen.getByText('Sure?'))
    })
    expect(pullshelf.deleteNote).toHaveBeenCalledWith('b')
    rerender([alpha])
    expect(editor().value).toBe('alpha body')
  })

  it('leaves nothing selected when it was the last note', async () => {
    const { rerender } = setup([alpha, beta], { deleteNote: vi.fn(async () => []) })
    await pickBeta()
    click('Notes list')
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    await act(async () => {
      fireEvent.click(screen.getByText('Sure?'))
    })
    rerender([])
    expect(screen.queryByPlaceholderText('Start typing')).not.toBeInTheDocument()
  })
})

describe('actions', () => {
  it('sends the note to the tool and reports the outcome', async () => {
    const { pullshelf, onToast } = setup()
    await act(async () => {
      click('Send')
    })
    expect(pullshelf.sendToTool).toHaveBeenCalledWith('alpha body')
    expect(onToast).toHaveBeenLastCalledWith('Sent to the tool')
    pullshelf.sendToTool.mockResolvedValueOnce({ ok: false, error: 'Not running' })
    await act(async () => {
      click('Send')
    })
    expect(onToast).toHaveBeenLastCalledWith('Not running')
    pullshelf.sendToTool.mockResolvedValueOnce({ ok: false })
    await act(async () => {
      click('Send')
    })
    expect(onToast).toHaveBeenLastCalledWith('Could not send')
  })

  it('does not send an empty note', async () => {
    const { pullshelf } = setup([makeNote({ id: 'e', body: '   ' })])
    await act(async () => {
      click('Send')
    })
    expect(pullshelf.sendToTool).not.toHaveBeenCalled()
  })

  it('opens the note in Claude chat or Claude Code, reporting only failures', async () => {
    const { pullshelf, onToast } = setup()
    await act(async () => {
      click('Claude')
    })
    await act(async () => {
      click('Code')
    })
    expect(pullshelf.openInClaude.mock.calls).toEqual([['alpha body', 'chat'], ['alpha body', 'code']])
    expect(onToast).not.toHaveBeenCalled()
    pullshelf.openInClaude.mockResolvedValueOnce({ ok: false, error: 'No handler' })
    await act(async () => {
      click('Claude')
    })
    expect(onToast).toHaveBeenLastCalledWith('No handler')
    pullshelf.openInClaude.mockResolvedValueOnce({ ok: false })
    await act(async () => {
      click('Code')
    })
    expect(onToast).toHaveBeenLastCalledWith('Could not open Claude Desktop')
  })

  it('sends what is on screen, including unsaved edits', async () => {
    const { pullshelf } = setup()
    fireEvent.change(editor(), { target: { value: 'fresh edit' } })
    await act(async () => {
      click('Send')
    })
    expect(pullshelf.sendToTool).toHaveBeenCalledWith('fresh edit')
  })
})

describe('collapsed', () => {
  it('becomes a rail with the note count', () => {
    const { rerender, onToggle } = setup()
    rerender([alpha, beta], true)
    const rail = screen.getByRole('button', { name: 'Expand Notes' })
    expect(rail).toHaveTextContent('2')
    fireEvent.click(rail)
    expect(onToggle).toHaveBeenCalled()
  })
})
