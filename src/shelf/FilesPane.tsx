import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { FileInfo, ShelfFile } from '../shared/types'
import { PaneHead } from './PaneHead'

export function FilesPane({
  files,
  onToast,
  collapsed,
  onToggle
}: {
  files: ShelfFile[]
  onToast: (message: string) => void
  collapsed: boolean
  onToggle: () => void
}) {
  const [infos, setInfos] = useState<Record<string, FileInfo>>({})
  const [over, setOver] = useState(false)
  const requested = useRef(new Set<string>())

  useEffect(() => {
    // Ask once per file; ids already requested are never re-requested.
    for (const file of files) {
      if (requested.current.has(file.id)) continue
      requested.current.add(file.id)
      void window.pullshelf
        .fileInfo(file.id)
        .then((info) => setInfos((current) => ({ ...current, [file.id]: info })))
        .catch(() => undefined)
    }
  }, [files])

  function hasFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer.types).includes('Files')
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setOver(false)
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.pullshelf.pathForFile(file))
      .filter(Boolean)
    if (paths.length) void window.pullshelf.addFiles(paths)
  }

  async function open(file: ShelfFile) {
    const result = await window.pullshelf.openFile(file.id)
    if (!result.ok) onToast(result.error ?? 'Could not open the file')
  }

  return (
    <section
      className={[collapsed ? 'pane files-pane collapsed' : 'pane files-pane', over ? 'over' : ''].join(' ').trim()}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return
        window.pullshelf.keepOpen()
        setOver(true)
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setOver(false)
      }}
      onDrop={onDrop}
    >
      <PaneHead title="Files" collapsed={collapsed} onToggle={onToggle} count={files.length}>
        {files.length ? (
          <button type="button" className="text-btn" onClick={() => void window.pullshelf.clearFiles()}>
            Clear
          </button>
        ) : null}
      </PaneHead>
      {files.length === 0 ? (
        <p className="empty drop-hint">Drop files here to keep them close.</p>
      ) : (
        <ul className="file-grid">
          {files.map((file) => (
            <li key={file.id} className="file">
              <button
                type="button"
                className="file-tile"
                draggable
                title={file.path}
                onClick={() => void open(file)}
                onDragStart={(event) => {
                  event.preventDefault()
                  window.pullshelf.dragFile(file.id)
                }}
              >
                <FileGlyph info={infos[file.id]} />
                <span className="file-name">{file.name}</span>
              </button>
              <div className="file-actions">
                <button type="button" onClick={() => window.pullshelf.revealFile(file.id)} aria-label="Show in Finder" title="Show in Finder">
                  ⌕
                </button>
                <button type="button" onClick={() => void window.pullshelf.removeFile(file.id)} aria-label="Remove" title="Remove from shelf">
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

function FileGlyph({ info }: { info: FileInfo | undefined }) {
  if (info?.thumb) return <img className="file-thumb" src={info.thumb} alt="" draggable={false} />
  if (info?.kind === 'folder') {
    return (
      <svg className="file-glyph" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M4 12a3 3 0 0 1 3-3h10l4 4h20a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z" fill="#5aaef0" />
        <path d="M4 18h40v19a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z" fill="#79c0f6" />
      </svg>
    )
  }
  return (
    <span className={info?.kind === 'missing' ? 'file-doc missing' : 'file-doc'}>
      <span>{info?.ext ?? ''}</span>
    </span>
  )
}
