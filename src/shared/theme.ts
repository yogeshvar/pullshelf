import { adoptLegacyKey } from './legacy'

export type Theme = 'dark' | 'light'

const KEY = 'pullshelf-theme'
const listeners = new Set<(theme: Theme) => void>()

export function currentTheme(): Theme {
  adoptLegacyKey('perch-theme', KEY)
  adoptLegacyKey('ledge-theme', KEY)
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    // storage unavailable; fall through to the system setting
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  for (const listener of listeners) listener(theme)
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // not persisted
  }
  applyTheme(theme)
}

export function onTheme(listener: (theme: Theme) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
