import { useState } from 'react'
import type { Clip } from '../shared/types'
import { PaneHead } from './PaneHead'

export function ClipboardPane({
  clips,
  onToast,
  collapsed,
  onToggle
}: {
  clips: Clip[]
  onToast: (message: string) => void
  collapsed: boolean
  onToggle: () => void
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function copy(clip: Clip) {
    await window.pullshelf.copyClip(clip.id)
    setCopiedId(clip.id)
    window.setTimeout(() => setCopiedId((current) => (current === clip.id ? null : current)), 1200)
  }

  async function send(text: string) {
    const result = await window.pullshelf.sendToTool(text)
    onToast(result.ok ? 'Sent to the tool' : result.error ?? 'Could not send')
  }

  async function claude(text: string) {
    const result = await window.pullshelf.openInClaude(text, 'chat')
    if (!result.ok) onToast(result.error ?? 'Could not open Claude Desktop')
  }

  return (
    <section className={collapsed ? 'pane collapsed' : 'pane'}>
      <PaneHead title="Clipboard" collapsed={collapsed} onToggle={onToggle} count={clips.length}>
        <button type="button" className="text-btn" onClick={() => void window.pullshelf.clearHistory()}>
          Clear
        </button>
      </PaneHead>
      {clips.length === 0 ? (
        <p className="empty">Copies land here.</p>
      ) : (
        <ul className="clip-list">
          {clips.map((clip) => (
            <li key={clip.id} className={clip.favorite ? 'clip favorite' : 'clip'}>
              <button type="button" className="clip-body" onClick={() => void copy(clip)}>
                {clip.thumb ? <img src={clip.thumb} alt="" /> : <span>{clip.preview || 'Empty clip'}</span>}
              </button>
              <div className="clip-meta">
                <span>{copiedId === clip.id ? 'Copied' : age(clip.createdAt)}</span>
                {clip.text ? (
                  <>
                    <button type="button" onClick={() => void send(clip.text as string)}>
                      Send
                    </button>
                    <button type="button" onClick={() => void claude(clip.text as string)}>
                      Claude
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className={clip.favorite ? 'star on' : 'star'}
                  onClick={() => void window.pullshelf.toggleFavorite(clip.id)}
                  aria-label={clip.favorite ? 'Unfavorite' : 'Favorite'}
                >
                  ★
                </button>
                <button type="button" onClick={() => void window.pullshelf.deleteClip(clip.id)} aria-label="Delete">
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function age(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}
