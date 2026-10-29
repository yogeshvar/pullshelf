import { afterEach, describe, expect, it, vi } from 'vitest'
import { setSystemPrefersLight } from '../helpers/setup-dom'
import { applyTheme, currentTheme, onTheme, setTheme } from '../../src/shared/theme'

afterEach(() => vi.restoreAllMocks())

describe('currentTheme', () => {
  it('uses the saved choice first', () => {
    localStorage.setItem('pullshelf-theme', 'light')
    expect(currentTheme()).toBe('light')
    localStorage.setItem('pullshelf-theme', 'dark')
    setSystemPrefersLight(true)
    expect(currentTheme()).toBe('dark')
  })

  it('follows the system when nothing valid is saved', () => {
    expect(currentTheme()).toBe('dark')
    setSystemPrefersLight(true)
    expect(currentTheme()).toBe('light')
    localStorage.setItem('pullshelf-theme', 'sepia')
    expect(currentTheme()).toBe('light')
  })

  it('carries over the choice saved when the app was called Ledge', () => {
    localStorage.setItem('ledge-theme', 'light')
    expect(currentTheme()).toBe('light')
    expect(localStorage.getItem('pullshelf-theme')).toBe('light')
    localStorage.setItem('ledge-theme', 'dark') // later changes under the old key are not read again
    expect(currentTheme()).toBe('light')
  })

  it('carries over the choice saved when the app was called Perch, ahead of an older Ledge choice', () => {
    localStorage.setItem('perch-theme', 'light')
    localStorage.setItem('ledge-theme', 'dark')
    expect(currentTheme()).toBe('light')
    expect(localStorage.getItem('pullshelf-theme')).toBe('light')
  })

  it('still works when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(currentTheme()).toBe('dark')
  })
})

describe('applyTheme and setTheme', () => {
  it('puts the theme on <html> and tells listeners', () => {
    const seen = vi.fn()
    const off = onTheme(seen)
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(seen.mock.calls.map((c) => c[0])).toEqual(['light', 'dark'])
    off()
  })

  it('remembers the choice, and still applies it when storage fails', () => {
    setTheme('light')
    expect(localStorage.getItem('pullshelf-theme')).toBe('light')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => setTheme('dark')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('stops notifying after unsubscribe', () => {
    const seen = vi.fn()
    onTheme(seen)()
    applyTheme('light')
    expect(seen).not.toHaveBeenCalled()
  })
})
