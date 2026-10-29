import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/App'
import { installPullshelf, makeNote, makeState } from '../helpers/pullshelf'

describe('App', () => {
  it('renders the shelf', async () => {
    installPullshelf()
    render(<App />)
    await act(async () => undefined)
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it('hides the shelf when Escape is pressed', async () => {
    const { pullshelf } = installPullshelf()
    render(<App />)
    await act(async () => undefined)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(pullshelf.hide).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' }) // from the window itself, not an element
    expect(pullshelf.hide).toHaveBeenCalledTimes(2)
  })

  it('ignores other keys, and Escape typed into the terminal', async () => {
    const { pullshelf } = installPullshelf()
    render(<App />)
    await act(async () => undefined)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    const terminalInput = document.createElement('textarea')
    terminalInput.className = 'xterm-helper-textarea'
    document.body.appendChild(terminalInput)
    fireEvent.keyDown(terminalInput, { key: 'Escape' })
    expect(pullshelf.hide).not.toHaveBeenCalled()
    const other = document.createElement('input')
    document.body.appendChild(other)
    fireEvent.keyDown(other, { key: 'Escape' })
    expect(pullshelf.hide).toHaveBeenCalledTimes(1)
  })

  it('stops listening for Escape once unmounted', async () => {
    const { pullshelf } = installPullshelf()
    const { unmount } = render(<App />)
    await act(async () => undefined)
    unmount()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(pullshelf.hide).not.toHaveBeenCalled()
  })

  describe('Escape closes the innermost thing first', () => {
    it('closes the notes list before the shelf, then hides the shelf', async () => {
      const { pullshelf } = installPullshelf(makeState({ notes: [makeNote()] }))
      render(<App />)
      await act(async () => undefined)
      fireEvent.click(screen.getByRole('button', { name: 'Notes list' }))
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(pullshelf.hide).not.toHaveBeenCalled()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(pullshelf.hide).toHaveBeenCalledTimes(1)
    })

    it('closes notes search before the shelf', async () => {
      const { pullshelf } = installPullshelf(makeState({ notes: [makeNote()] }))
      render(<App />)
      await act(async () => undefined)
      fireEvent.click(screen.getByRole('button', { name: 'Search notes' }))
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.queryByPlaceholderText('Search notes')).not.toBeInTheDocument()
      expect(pullshelf.hide).not.toHaveBeenCalled()
    })

    it('closes the settings menu before the shelf', async () => {
      const { pullshelf } = installPullshelf()
      render(<App />)
      await act(async () => undefined)
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(pullshelf.hide).not.toHaveBeenCalled()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(pullshelf.hide).toHaveBeenCalledTimes(1)
    })

    it('ignores an Escape that something else already handled', async () => {
      const { pullshelf } = installPullshelf()
      render(<App />)
      await act(async () => undefined)
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
      event.preventDefault()
      document.body.dispatchEvent(event)
      expect(pullshelf.hide).not.toHaveBeenCalled()
    })
  })
})
