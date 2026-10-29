import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ActionResult,
  AppState,
  Clip,
  FileInfo,
  Note,
  Prefs,
  PtyChunk,
  PtySnapshot,
  ShelfFile,
  ToolConfig,
  ToolStatus
} from '../src/shared/types'

function listen<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const pullshelf = {
  hide: () => ipcRenderer.send('shelf:hide'),
  getState: (): Promise<AppState> => ipcRenderer.invoke('app:get-state'),
  saveLayout: (tool: number, clips: number, files: number): Promise<void> =>
    ipcRenderer.invoke('settings:layout', tool, clips, files),
  configureTool: (config: ToolConfig): Promise<void> => ipcRenderer.invoke('tool:configure', config),
  restartTool: (): Promise<void> => ipcRenderer.invoke('tool:restart'),
  writePty: (data: string) => ipcRenderer.send('pty:write', data),
  resizePty: (cols: number, rows: number) => ipcRenderer.send('pty:resize', cols, rows),
  ptySnapshot: (): Promise<PtySnapshot> => ipcRenderer.invoke('pty:snapshot'),
  sendToTool: (text: string): Promise<ActionResult> => ipcRenderer.invoke('tool:send', text),
  openInClaude: (text: string, mode: 'chat' | 'code'): Promise<ActionResult> =>
    ipcRenderer.invoke('claude:open', text, mode),
  copyClip: (id: string): Promise<void> => ipcRenderer.invoke('clips:copy', id),
  toggleFavorite: (id: string): Promise<Clip[]> => ipcRenderer.invoke('clips:favorite', id),
  deleteClip: (id: string): Promise<Clip[]> => ipcRenderer.invoke('clips:delete', id),
  clearHistory: (): Promise<Clip[]> => ipcRenderer.invoke('clips:clear'),
  createNote: (): Promise<Note> => ipcRenderer.invoke('notes:create'),
  updateNote: (id: string, body: string): Promise<Note | null> =>
    ipcRenderer.invoke('notes:update', id, body),
  renameNote: (id: string, title: string): Promise<Note | null> =>
    ipcRenderer.invoke('notes:rename', id, title),
  resizeShelf: (height: number) => ipcRenderer.send('shelf:resize', height),
  resizeShelfEnd: () => ipcRenderer.send('shelf:resize-end'),
  deleteNote: (id: string): Promise<Note[]> => ipcRenderer.invoke('notes:delete', id),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  addFiles: (paths: string[]): Promise<ShelfFile[]> => ipcRenderer.invoke('files:add', paths),
  removeFile: (id: string): Promise<ShelfFile[]> => ipcRenderer.invoke('files:remove', id),
  clearFiles: (): Promise<ShelfFile[]> => ipcRenderer.invoke('files:clear'),
  openFile: (id: string): Promise<ActionResult> => ipcRenderer.invoke('files:open', id),
  revealFile: (id: string) => ipcRenderer.send('files:reveal', id),
  fileInfo: (id: string): Promise<FileInfo> => ipcRenderer.invoke('files:info', id),
  dragFile: (id: string) => ipcRenderer.send('files:drag', id),
  keepOpen: () => ipcRenderer.send('shelf:keep-open'),
  promptGesture: () => ipcRenderer.send('gesture:prompt'),
  quit: () => ipcRenderer.send('app:quit'),
  setTrayVisible: (visible: boolean) => ipcRenderer.send('app:set-tray-visible', visible),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.send('app:set-launch-at-login', enabled),
  onPtyData: (callback: (chunk: PtyChunk) => void) => listen('pty:data', callback),
  onPtyReset: (callback: () => void) => listen('pty:reset', callback),
  onPtyExit: (callback: (info: { exitCode: number | null }) => void) => listen('pty:exit', callback),
  onToolStatus: (callback: (status: ToolStatus) => void) => listen('tool:status', callback),
  onClips: (callback: (clips: Clip[]) => void) => listen('clips:changed', callback),
  onNotes: (callback: (notes: Note[]) => void) => listen('notes:changed', callback),
  onFiles: (callback: (files: ShelfFile[]) => void) => listen('files:changed', callback),
  onShown: (callback: () => void) => listen('shelf:shown', callback),
  onGestureTrust: (callback: (trusted: boolean) => void) => listen('gesture:trust', callback),
  onPrefs: (callback: (prefs: Prefs) => void) => listen('prefs:changed', callback)
}

contextBridge.exposeInMainWorld('pullshelf', pullshelf)

export type PullshelfApi = typeof pullshelf
