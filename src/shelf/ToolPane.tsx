import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import type { ToolStatus } from '../shared/types'
import { currentTheme, onTheme, type Theme } from '../shared/theme'
import { PaneHead } from './PaneHead'
import '@xterm/xterm/css/xterm.css'

const XTERM_THEMES: Record<Theme, ITheme> = {
  dark: {
    background: '#121110',
    foreground: '#e9e5dc',
    cursor: '#e8785f',
    cursorAccent: '#121110',
    selectionBackground: '#3d332c',
    black: '#1c1a16',
    red: '#e07a6a',
    green: '#8fbf7f',
    yellow: '#e3c07a',
    blue: '#7aa2d6',
    magenta: '#c58ad4',
    cyan: '#7ec8c3',
    white: '#ece7df',
    brightBlack: '#7a7268',
    brightRed: '#ef8d7e',
    brightGreen: '#a8d49a',
    brightYellow: '#f0d392',
    brightBlue: '#96b8e4',
    brightMagenta: '#d7a4e2',
    brightCyan: '#9adad5',
    brightWhite: '#ffffff'
  },
  light: {
    background: '#f7f4ee',
    foreground: '#1e1b17',
    cursor: '#c8442f',
    cursorAccent: '#f7f4ee',
    selectionBackground: '#e6dccb',
    black: '#2b2620',
    red: '#b8412f',
    green: '#3f7f36',
    yellow: '#9a6a12',
    blue: '#2f64a8',
    magenta: '#8a4aa0',
    cyan: '#217a76',
    white: '#cfc6b8',
    brightBlack: '#7a7166',
    brightRed: '#c8503e',
    brightGreen: '#4f9a45',
    brightYellow: '#b07a1c',
    brightBlue: '#4079c0',
    brightMagenta: '#a060b8',
    brightCyan: '#2f9490',
    brightWhite: '#ffffff'
  }
}

export function ToolPane({
  status,
  collapsed,
  onToggle
}: {
  status: ToolStatus
  collapsed: boolean
  onToggle: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current as HTMLDivElement // effects run after mount, so the ref is set
    let disposed = false
    let ready = false
    let seen = 0
    const pending: { rev: number; chunk: string }[] = []
    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 4000,
      theme: XTERM_THEMES[currentTheme()]
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    window.pullshelf.resizePty(term.cols, term.rows)
    term.onData((data) => window.pullshelf.writePty(data))

    const flush = (rev: number, chunk: string) => {
      if (rev <= seen) return
      term.write(chunk)
      seen = rev
    }
    const offData = window.pullshelf.onPtyData((message) => {
      if (!ready) pending.push(message)
      else flush(message.rev, message.chunk)
    })
    const offReset = window.pullshelf.onPtyReset(() => {
      term.reset()
      seen = 0
      pending.length = 0
    })
    void window.pullshelf.ptySnapshot().then((snap) => {
      if (disposed) return
      if (snap.buffer) term.write(snap.buffer)
      seen = snap.rev
      ready = true
      for (const message of pending) flush(message.rev, message.chunk)
      pending.length = 0
    })

    const refit = () => {
      // Collapsed (hidden) pane measures 0 wide; don't shrink the PTY to nothing.
      if (host.clientWidth < 80 || host.clientHeight < 40) return
      fit.fit()
      window.pullshelf.resizePty(term.cols, term.rows)
    }
    // Swap colours in place so the running session survives a theme change.
    const offTheme = onTheme((theme) => {
      term.options.theme = XTERM_THEMES[theme]
    })
    const offShown = window.pullshelf.onShown(() => {
      requestAnimationFrame(() => {
        refit()
        term.focus()
      })
    })
    const observer = new ResizeObserver(() => refit())
    observer.observe(host)

    return () => {
      disposed = true
      offData()
      offReset()
      offShown()
      offTheme()
      observer.disconnect()
      term.dispose()
    }
  }, [])

  return (
    <section className={collapsed ? 'pane tool-pane collapsed' : 'pane tool-pane'}>
      <PaneHead title="Terminal" collapsed={collapsed} onToggle={onToggle}>
        <span className="tool-label">
          <span className={status.running ? 'dot on' : 'dot'} />
          {status.label}
        </span>
      </PaneHead>
      <div className="term-host" ref={hostRef} />
      {!status.running ? (
        <div className="exit-bar">
          <span>{status.error ?? (status.exitCode == null ? 'Waiting to start' : `Exited (${status.exitCode})`)}</span>
          <button type="button" onClick={() => void window.pullshelf.restartTool()}>
            Start
          </button>
        </div>
      ) : null}
    </section>
  )
}
