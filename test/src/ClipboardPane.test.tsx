import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClipboardPane } from '../../src/shelf/ClipboardPane'
import { installPullshelf, makeClip } from '../helpers/pullshelf'

const setup = (clips = [makeClip()], collapsed = false) => {
  const bridge = installPullshelf()
  const onToast = vi.fn()
  const onToggle = vi.fn()
  const view = render(<ClipboardPane clips={clips} onToast={onToast} collapsed={collapsed} onToggle={onToggle} />)
  return { ...bridge, onToast, onToggle, ...view }
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00Z') })
})
afterEach(() => vi.useRealTimers())

describe('ClipboardPane list', () => {
  it('invites you to copy something when empty', () => {
    setup([])
    expect(screen.getByText('Copies land here.')).toBeInTheDocument()
  })

  it('shows text clips, image clips and a fallback for blank ones', () => {
    setup([
      makeClip({ id: 'a', preview: 'plain text' }),
      makeClip({ id: 'b', kind: 'image', preview: 'Image', text: null, thumb: 'data:image/png;base64,AAAA' }),
      makeClip({ id: 'c', preview: '', text: ' ' })
    ])
    expect(screen.getByText('plain text')).toBeInTheDocument()
    expect(document.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    expect(screen.getByText('Empty clip')).toBeInTheDocument()
  })

  it('shows how old each clip is', () => {
    const now = Date.now()
    setup([
      makeClip({ id: '1', createdAt: now - 5_000 }),
      makeClip({ id: '2', createdAt: now - 5 * 60_000 }),
      makeClip({ id: '3', createdAt: now - 3 * 3_600_000 }),
      makeClip({ id: '4', createdAt: now - 2 * 86_400_000 }),
      makeClip({ id: '5', createdAt: now + 60_000 }) // clock skew never shows a negative age
    ])
    expect(screen.getAllByText('now')).toHaveLength(2)
    expect(screen.getByText('5m')).toBeInTheDocument()
    expect(screen.getByText('3h')).toBeInTheDocument()
    expect(screen.getByText('2d')).toBeInTheDocument()
  })

  it('marks favourites and offers send/claude only for text', () => {
    setup([makeClip({ id: 'a', favorite: true }), makeClip({ id: 'b', kind: 'image', text: null, thumb: 'data:x' })])
    expect(screen.getByRole('button', { name: 'Unfavorite' }).className).toContain('on')
    expect(screen.getByRole('button', { name: 'Favorite' }).className).not.toContain('on')
    expect(screen.getAllByRole('button', { name: 'Send' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Claude' })).toHaveLength(1)
  })

  it('shows a rail with a count when collapsed', () => {
    const { onToggle } = setup([makeClip(), makeClip({ id: 'x' })], true)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Clipboard' }))
    expect(onToggle).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Expand Clipboard' })).toHaveTextContent('2')
  })
})

describe('ClipboardPane actions', () => {
  it('copying a clip says "Copied" briefly', async () => {
    const { pullshelf } = setup([makeClip({ id: 'a' })])
    await act(async () => {
      fireEvent.click(screen.getByText('copied text'))
    })
    expect(pullshelf.copyClip).toHaveBeenCalledWith('a')
    expect(screen.getByText('Copied')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1200)
    })
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
  })

  it('a newer copy keeps its label when the older one expires', async () => {
    setup([makeClip({ id: 'a', preview: 'first', text: 'first' }), makeClip({ id: 'b', preview: 'second', text: 'second' })])
    await act(async () => {
      fireEvent.click(screen.getByText('first'))
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    await act(async () => {
      fireEvent.click(screen.getByText('second'))
    })
    act(() => {
      vi.advanceTimersByTime(700) // first copy's timer fires; second is still current
    })
    expect(screen.getByText('Copied')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
  })

  it('send reports success or the reason it failed', async () => {
    const { pullshelf, onToast } = setup([makeClip({ text: 'hello' })])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(pullshelf.sendToTool).toHaveBeenCalledWith('hello')
    expect(onToast).toHaveBeenLastCalledWith('Sent to the tool')
    pullshelf.sendToTool.mockResolvedValueOnce({ ok: false, error: 'Nothing is running in the tool pane.' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(onToast).toHaveBeenLastCalledWith('Nothing is running in the tool pane.')
    pullshelf.sendToTool.mockResolvedValueOnce({ ok: false })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(onToast).toHaveBeenLastCalledWith('Could not send')
  })

  it('opening in Claude stays quiet on success and explains a failure', async () => {
    const { pullshelf, onToast } = setup([makeClip({ text: 'hello' })])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    })
    expect(pullshelf.openInClaude).toHaveBeenCalledWith('hello', 'chat')
    expect(onToast).not.toHaveBeenCalled()
    pullshelf.openInClaude.mockResolvedValueOnce({ ok: false, error: 'No handler' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    })
    expect(onToast).toHaveBeenLastCalledWith('No handler')
    pullshelf.openInClaude.mockResolvedValueOnce({ ok: false })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Claude' }))
    })
    expect(onToast).toHaveBeenLastCalledWith('Could not open Claude Desktop')
  })

  it('favourite, delete and clear go to the main process', () => {
    const { pullshelf } = setup([makeClip({ id: 'z' })])
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(pullshelf.toggleFavorite).toHaveBeenCalledWith('z')
    expect(pullshelf.deleteClip).toHaveBeenCalledWith('z')
    expect(pullshelf.clearHistory).toHaveBeenCalled()
  })
})
