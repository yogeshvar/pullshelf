import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { AppState, Clip, Note, PresetId, Prefs, ShelfFile, ToolStatus } from '../shared/types'
import { PRESETS } from '../shared/types'
import { ClipboardPane } from './ClipboardPane'
import { FilesPane } from './FilesPane'
import { NotesPane } from './NotesPane'
import { ToolPane } from './ToolPane'
import { adoptLegacyKey } from '../shared/legacy'
import { currentTheme, onTheme, setTheme, type Theme } from '../shared/theme'

const EMPTY: AppState = {
  settings: {
    presetId: 'claude',
    customCommand: '',
    cwd: '',
    toolRatio: 0.4,
    clipRatio: 0.18,
    filesRatio: 0.2,
    heightRatio: 0.52,
    showTrayIcon: true
  },
  clips: [],
  notes: [],
  files: [],
  tool: {
    running: false,
    presetId: 'claude',
    label: 'Claude Code',
    cwd: '',
    error: null,
    exitCode: null
  },
  gestureTrusted: true,
  shortcut: '⌘⇧L',
  canAutoLaunch: false,
  launchAtLogin: false
}

export function Shelf() {
  const [state, setState] = useState<AppState>(EMPTY)
  const [toast, setToast] = useState<string | null>(null)
  const [customDraft, setCustomDraft] = useState('')
  const [weights, setWeights] = useState<number[]>(() => weightsFrom(EMPTY.settings))
  const weightsRef = useRef(weights)
  const gridRef = useRef<HTMLDivElement>(null)
  const [theme, setThemeState] = useState<Theme>(currentTheme)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => onTheme(setThemeState), [])

  // Without this, a file dropped outside the Files pane would navigate the window to it.
  useEffect(() => {
    const stop = (event: DragEvent) => event.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])

  const [collapsed, setCollapsed] = useState<Collapsed>(loadCollapsed)

  function toggle(which: keyof Collapsed) {
    setCollapsed((current) => {
      const next = { ...current, [which]: !current[which] }
      // Always keep one pane open.
      if (next.tool && next.clips && next.files && next.notes) return current
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      } catch {
        // not persisted
      }
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    void window.pullshelf.getState().then((next) => {
      if (cancelled) return
      setState(next)
      const loaded = weightsFrom(next.settings)
      weightsRef.current = loaded
      setWeights(loaded)
      setCustomDraft(next.settings.customCommand)
    })
    const offClips = window.pullshelf.onClips((clips: Clip[]) => {
      setState((current) => ({ ...current, clips }))
    })
    const offNotes = window.pullshelf.onNotes((notes: Note[]) => {
      setState((current) => ({ ...current, notes }))
    })
    const offFiles = window.pullshelf.onFiles((files: ShelfFile[]) => {
      setState((current) => ({ ...current, files }))
    })
    const offTool = window.pullshelf.onToolStatus((tool: ToolStatus) => {
      setState((current) => ({ ...current, tool }))
    })
    const offTrust = window.pullshelf.onGestureTrust((gestureTrusted: boolean) => {
      setState((current) => ({ ...current, gestureTrusted }))
    })
    const offPrefs = window.pullshelf.onPrefs((prefs: Prefs) => {
      setState((current) => ({
        ...current,
        settings: { ...current.settings, showTrayIcon: prefs.showTrayIcon },
        launchAtLogin: prefs.launchAtLogin
      }))
    })
    return () => {
      cancelled = true
      offClips()
      offNotes()
      offFiles()
      offTool()
      offTrust()
      offPrefs()
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  // Open panes share the shelf by weight (normalised so they always fill it);
  // collapsed panes shrink to a 40px rail. Divider i sits between pane i and i+1 and
  // exists when pane i+1 is open and some open pane lies to its left.
  const closed = [collapsed.tool, collapsed.clips, collapsed.files, collapsed.notes]
  const openWeight = weights.reduce((sum, w, i) => sum + (closed[i] ? 0 : w), 0)
  const showDivider = [0, 1, 2].map((i) => !closed[i + 1] && closed.slice(0, i + 1).some((c) => !c))
  const columns = [0, 1, 2, 3]
    .flatMap((i) => {
      const pane = closed[i] ? '40px' : `minmax(${MIN_PANE_PX[i]}px, ${Math.max(1, Math.round((weights[i] / openWeight) * 1000))}fr)`
      return i < 3 ? [pane, showDivider[i] ? '9px' : '0px'] : [pane]
    })
    .join(' ')

  function flash(message: string) {
    setToast(message)
  }

  async function configure(patch: { presetId?: PresetId; customCommand?: string; cwd?: string }) {
    const next = {
      ...state.settings,
      ...patch
    }
    setState((current) => ({ ...current, settings: next }))
    await window.pullshelf.configureTool(patch)
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    window.pullshelf.keepOpen()
    const startY = event.screenY
    const startHeight = window.innerHeight
    let frame = 0
    let latest = startHeight
    const move = (ev: PointerEvent) => {
      latest = startHeight + (ev.screenY - startY)
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        window.pullshelf.resizeShelf(latest)
      })
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      if (frame) cancelAnimationFrame(frame)
      window.pullshelf.resizeShelf(latest)
      window.pullshelf.resizeShelfEnd()
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  function drag(index: number, event: ReactPointerEvent) {
    const grid = gridRef.current as HTMLDivElement // always mounted while the shelf is rendered
    let left = index
    while (left >= 0 && closed[left]) left -= 1
    const right = index + 1
    if (left < 0 || closed[right]) return
    event.preventDefault()
    // Work in the pixel widths actually on screen (minimum widths may be in effect),
    // then convert back to weights so the saved layout matches what you see.
    const panes = Array.from(grid.querySelectorAll<HTMLElement>(':scope > .pane'))
    const px = panes.map((pane) => pane.getBoundingClientRect().width)
    const startX = event.clientX
    const start = [...weightsRef.current]
    const openIdx = [0, 1, 2, 3].filter((i) => !closed[i])
    const openPx = openIdx.reduce((sum, i) => sum + px[i], 0) || 1
    const openWeight = openIdx.reduce((sum, i) => sum + start[i], 0)
    document.body.classList.add('resizing')
    const leftSide = openIdx.filter((i) => i <= left).reverse() // nearest first
    const rightSide = openIdx.filter((i) => i >= right)
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const next = [...start]
      const widths = [...px]
      // Growing one side takes space from the other side's panes, nearest first, down to their minimums.
      const grow = (amount: number, grower: number, donors: number[]) => {
        let remaining = amount
        for (const i of donors) {
          if (remaining <= 0) break
          const give = Math.min(remaining, Math.max(0, px[i] - MIN_PANE_PX[i]))
          widths[i] = px[i] - give
          remaining -= give
        }
        widths[grower] = px[grower] + (amount - remaining)
      }
      if (dx >= 0) grow(dx, left, rightSide)
      else grow(-dx, right, leftSide)
      for (const i of openIdx) next[i] = (widths[i] / openPx) * openWeight
      weightsRef.current = next
      setWeights(next)
    }
    const up = () => {
      document.body.classList.remove('resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const [tool, clips, files] = weightsRef.current
      void window.pullshelf.saveLayout(tool, clips, files)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.handle-wrap')) setMenuOpen(false)
    }
    const esc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault() // used up: the shelf itself stays open
      setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc, true) // capture, so it runs before the shelf's own Escape
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc, true)
    }
  }, [menuOpen])

  return (
    <div className="shelf">
      {!state.gestureTrusted ? (
        <div className="banner">
          <span>Allow Accessibility to enable the pull gesture from the top of the screen.</span>
          <button type="button" onClick={() => window.pullshelf.promptGesture()}>
            Allow
          </button>
        </div>
      ) : null}
      <div className="columns" ref={gridRef} style={{ gridTemplateColumns: columns }}>
        <ToolPane status={state.tool} collapsed={collapsed.tool} onToggle={() => toggle('tool')} />
        <div className={showDivider[0] ? 'divider' : 'divider off'} onPointerDown={(event) => drag(0, event)} />
        <ClipboardPane clips={state.clips} onToast={flash} collapsed={collapsed.clips} onToggle={() => toggle('clips')} />
        <div className={showDivider[1] ? 'divider' : 'divider off'} onPointerDown={(event) => drag(1, event)} />
        <FilesPane files={state.files} onToast={flash} collapsed={collapsed.files} onToggle={() => toggle('files')} />
        <div className={showDivider[2] ? 'divider' : 'divider off'} onPointerDown={(event) => drag(2, event)} />
        <NotesPane notes={state.notes} onToast={flash} collapsed={collapsed.notes} onToggle={() => toggle('notes')} />
      </div>
      <div className="handle-wrap">
        {menuOpen ? (
          <div className="menu" role="menu">
            <label className="menu-row">
              <span>Tool</span>
              <select
                value={state.settings.presetId}
                onChange={(event) => void configure({ presetId: event.target.value as PresetId })}
              >
                {PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            {state.settings.presetId === 'custom' ? (
              <form
                className="menu-row"
                onSubmit={(event) => {
                  event.preventDefault()
                  void configure({ customCommand: customDraft })
                }}
              >
                <span>Command</span>
                <input
                  value={customDraft}
                  spellCheck={false}
                  placeholder="command to run"
                  onChange={(event) => setCustomDraft(event.target.value)}
                />
              </form>
            ) : null}
            <button type="button" className="menu-row" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <span>Theme</span>
              <em>{theme === 'dark' ? 'Dark' : 'Light'}</em>
            </button>
            <div className="menu-sep" role="separator" />
            {state.canAutoLaunch ? (
              <button
                type="button"
                className="menu-row"
                role="menuitemcheckbox"
                aria-checked={state.launchAtLogin}
                onClick={() => window.pullshelf.setLaunchAtLogin(!state.launchAtLogin)}
              >
                <span>Launch at login</span>
                <em>{state.launchAtLogin ? '✓' : ''}</em>
              </button>
            ) : null}
            <button type="button" className="menu-row" onClick={() => window.pullshelf.setTrayVisible(!state.settings.showTrayIcon)}>
              <span>{state.settings.showTrayIcon ? 'Hide menu bar icon' : 'Show menu bar icon'}</span>
            </button>
            <button type="button" className="menu-row" disabled={state.gestureTrusted} onClick={() => window.pullshelf.promptGesture()}>
              <span>Scroll gesture</span>
              <em>{state.gestureTrusted ? 'On' : 'Enable…'}</em>
            </button>
            <div className="menu-sep" role="separator" />
            <button type="button" className="menu-row" onClick={() => window.pullshelf.hide()}>
              <span>Hide shelf</span>
              <em>{state.shortcut}</em>
            </button>
            <button type="button" className="menu-row" onClick={() => window.pullshelf.quit()}>
              <span>Quit Pullshelf</span>
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="handle"
          aria-label="Settings"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M9.4 1.5 9.8 3a5 5 0 0 1 1.2.7l1.5-.5 1.4 2.4-1.1 1a5 5 0 0 1 0 1.4l1.1 1-1.4 2.4-1.5-.5a5 5 0 0 1-1.2.7l-.4 1.5H6.6L6.2 13a5 5 0 0 1-1.2-.7l-1.5.5-1.4-2.4 1.1-1a5 5 0 0 1 0-1.4l-1.1-1 1.4-2.4 1.5.5A5 5 0 0 1 6.2 3l.4-1.5h2.8ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
            />
          </svg>
        </button>
      </div>
      <div className="resize-grip" onPointerDown={startResize} title="Drag to resize" />
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}

// Narrowest an open pane may get (Terminal, Clipboard, Files, Notes).
const MIN_PANE_PX = [260, 200, 200, 220]

// Saved ratios cover the first three panes; Notes takes the remainder.
function weightsFrom(settings: AppState['settings']): number[] {
  const raw = [
    settings.toolRatio,
    settings.clipRatio,
    settings.filesRatio,
    Math.max(0.1, 1 - settings.toolRatio - settings.clipRatio - settings.filesRatio)
  ]
  // Older layouts could squash a pane to a sliver; never load a weight below 10%.
  const floored = raw.map((w) => Math.max(0.1, w))
  const total = floored.reduce((sum, w) => sum + w, 0)
  return floored.map((w) => w / total)
}

type Collapsed = { tool: boolean; clips: boolean; files: boolean; notes: boolean }
const COLLAPSE_KEY = 'pullshelf-collapsed'

function loadCollapsed(): Collapsed {
  adoptLegacyKey('perch-collapsed', COLLAPSE_KEY)
  adoptLegacyKey('ledge-collapsed', COLLAPSE_KEY)
  const open = { tool: false, clips: false, files: false, notes: false }
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    if (!raw) return open
    const parsed = JSON.parse(raw) as Partial<Collapsed>
    const next = { tool: !!parsed.tool, clips: !!parsed.clips, files: !!parsed.files, notes: !!parsed.notes }
    return next.tool && next.clips && next.files && next.notes ? open : next
  } catch {
    return open
  }
}
