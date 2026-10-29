import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FilesPane } from '../../src/shelf/FilesPane'
import type { FileInfo, ShelfFile } from '../../src/shared/types'
import { installPullshelf, makeFile } from '../helpers/pullshelf'

const setup = (files: ShelfFile[] = [makeFile()], collapsed = false, overrides: Record<string, unknown> = {}) => {
  const bridge = installPullshelf(undefined, overrides)
  const onToast = vi.fn()
  const onToggle = vi.fn()
  const view = render(<FilesPane files={files} onToast={onToast} collapsed={collapsed} onToggle={onToggle} />)
  return { ...bridge, onToast, onToggle, ...view }
}

const dataTransfer = (over: Partial<{ types: string[]; files: { name: string }[]; dropEffect: string }> = {}) => ({
  types: ['Files'], files: [], dropEffect: 'none', ...over
})

describe('FilesPane contents', () => {
  it('shows a hint when empty and hides the Clear button', () => {
    setup([])
    expect(screen.getByText('Drop files here to keep them close.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('draws a folder, a document with its extension, a thumbnail and a missing file', async () => {
    const infos: Record<string, FileInfo> = {
      d: { kind: 'folder', ext: '', thumb: null },
      t: { kind: 'file', ext: 'TXT', thumb: null },
      i: { kind: 'file', ext: 'PNG', thumb: 'data:image/png;base64,AAAA' },
      m: { kind: 'missing', ext: '', thumb: null }
    }
    const { pullshelf } = setup(
      [makeFile({ id: 'd', name: 'Work' }), makeFile({ id: 't', name: 'a.txt' }), makeFile({ id: 'i', name: 'p.png' }), makeFile({ id: 'm', name: 'gone.txt' })],
      false,
      { fileInfo: vi.fn(async (id: string) => infos[id]) }
    )
    await waitFor(() => expect(document.querySelector('img.file-thumb')).toBeInTheDocument())
    expect(document.querySelector('svg.file-glyph')).toBeInTheDocument()
    expect(screen.getByText('TXT')).toBeInTheDocument()
    expect(document.querySelector('.file-doc.missing')).toBeInTheDocument()
    expect(pullshelf.fileInfo).toHaveBeenCalledTimes(4)
  })

  it('draws an empty document tile until the file details arrive', () => {
    setup([makeFile()], false, { fileInfo: vi.fn(() => new Promise(() => undefined)) })
    expect(document.querySelector('.file-doc')).toBeInTheDocument()
    expect(document.querySelector('.file-doc')).not.toHaveTextContent('TXT')
  })

  it('asks for each file\'s details only once, even when the list changes', async () => {
    const { pullshelf, rerender, onToast, onToggle } = setup([makeFile({ id: 'a' })])
    await waitFor(() => expect(pullshelf.fileInfo).toHaveBeenCalledTimes(1))
    rerender(<FilesPane files={[makeFile({ id: 'a' }), makeFile({ id: 'b', name: 'b.txt' })]} onToast={onToast} collapsed={false} onToggle={onToggle} />)
    await waitFor(() => expect(pullshelf.fileInfo).toHaveBeenCalledTimes(2))
    expect(pullshelf.fileInfo.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })

  it('keeps going when the details request fails', async () => {
    setup([makeFile()], false, { fileInfo: vi.fn(async () => Promise.reject(new Error('ipc'))) })
    await act(async () => undefined)
    expect(screen.getByText('Readme.txt')).toBeInTheDocument()
  })

  it('collapses to a rail with a count', () => {
    const { onToggle } = setup([makeFile(), makeFile({ id: 'b' })], true)
    const rail = screen.getByRole('button', { name: 'Expand Files' })
    expect(rail).toHaveTextContent('2')
    fireEvent.click(rail)
    expect(onToggle).toHaveBeenCalled()
  })
})

describe('FilesPane actions', () => {
  it('opens a file, or explains why it could not', async () => {
    const { pullshelf, onToast } = setup()
    await act(async () => {
      fireEvent.click(screen.getByText('Readme.txt'))
    })
    expect(pullshelf.openFile).toHaveBeenCalledWith('f1')
    expect(onToast).not.toHaveBeenCalled()
    pullshelf.openFile.mockResolvedValueOnce({ ok: false, error: 'No app for this file' })
    await act(async () => {
      fireEvent.click(screen.getByText('Readme.txt'))
    })
    expect(onToast).toHaveBeenLastCalledWith('No app for this file')
    pullshelf.openFile.mockResolvedValueOnce({ ok: false })
    await act(async () => {
      fireEvent.click(screen.getByText('Readme.txt'))
    })
    expect(onToast).toHaveBeenLastCalledWith('Could not open the file')
  })

  it('reveals, removes and clears', () => {
    const { pullshelf } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(pullshelf.revealFile).toHaveBeenCalledWith('f1')
    expect(pullshelf.removeFile).toHaveBeenCalledWith('f1')
    expect(pullshelf.clearFiles).toHaveBeenCalled()
  })

  it('dragging a tile starts a native drag instead of the browser one', () => {
    const { pullshelf } = setup()
    const tile = screen.getByText('Readme.txt').closest('button') as HTMLElement
    const notPrevented = fireEvent.dragStart(tile)
    expect(notPrevented).toBe(false)
    expect(pullshelf.dragFile).toHaveBeenCalledWith('f1')
  })
})

describe('FilesPane drop target', () => {
  it('highlights while files are dragged over, and keeps the shelf open', () => {
    const { pullshelf, container } = setup()
    const pane = container.querySelector('section') as HTMLElement
    fireEvent.dragEnter(pane, { dataTransfer: dataTransfer() })
    expect(pane).toHaveClass('over')
    expect(pullshelf.keepOpen).toHaveBeenCalled()
    fireEvent.dragLeave(screen.getByText('Readme.txt'), { dataTransfer: dataTransfer() }) // from a child: still over
    expect(pane).toHaveClass('over')
    fireEvent.dragLeave(pane, { dataTransfer: dataTransfer() })
    expect(pane).not.toHaveClass('over')
  })

  it('ignores drags that are not files', () => {
    const { pullshelf, container } = setup()
    const pane = container.querySelector('section') as HTMLElement
    fireEvent.dragEnter(pane, { dataTransfer: dataTransfer({ types: ['text/plain'] }) })
    expect(pane).not.toHaveClass('over')
    expect(pullshelf.keepOpen).not.toHaveBeenCalled()
    const accepted = fireEvent.dragOver(pane, { dataTransfer: dataTransfer({ types: ['text/plain'] }) })
    expect(accepted).toBe(true) // not prevented, so the browser keeps its default
  })

  it('accepts a file drag over it as a copy', () => {
    const { container } = setup()
    const pane = container.querySelector('section') as HTMLElement
    const transfer = dataTransfer()
    expect(fireEvent.dragOver(pane, { dataTransfer: transfer })).toBe(false)
    expect(transfer.dropEffect).toBe('copy')
  })

  it('adds dropped files by their real paths', () => {
    const { pullshelf, container } = setup()
    const pane = container.querySelector('section') as HTMLElement
    fireEvent.dragEnter(pane, { dataTransfer: dataTransfer() })
    fireEvent.drop(pane, { dataTransfer: dataTransfer({ files: [{ name: 'a.txt' }, { name: 'b.txt' }] }) })
    expect(pullshelf.addFiles).toHaveBeenCalledWith(['/dropped/a.txt', '/dropped/b.txt'])
    expect(pane).not.toHaveClass('over')
  })

  it('skips files whose path cannot be resolved, and does nothing for an empty drop', () => {
    const { pullshelf, container } = setup(undefined, false, { pathForFile: vi.fn((f: { name: string }) => (f.name === 'x' ? '' : `/p/${f.name}`)) })
    const pane = container.querySelector('section') as HTMLElement
    fireEvent.drop(pane, { dataTransfer: dataTransfer({ files: [{ name: 'x' }, { name: 'ok' }] }) })
    expect(pullshelf.addFiles).toHaveBeenCalledWith(['/p/ok'])
    pullshelf.addFiles.mockClear()
    fireEvent.drop(pane, { dataTransfer: dataTransfer({ files: [{ name: 'x' }] }) })
    fireEvent.drop(pane, { dataTransfer: dataTransfer({ files: [] }) })
    expect(pullshelf.addFiles).not.toHaveBeenCalled()
  })
})
