// Stands in for electron/preload.ts so the built UI can run without the app's main process.
const now = Date.now()
const calls = []
const noop = () => () => {}
const state = {
  settings: { presetId: 'claude', customCommand: '', cwd: '/Users/me/project', toolRatio: 0.4, clipRatio: 0.18, filesRatio: 0.2, heightRatio: 0.52, showTrayIcon: true },
  clips: [{ id: 'c1', kind: 'text', preview: 'npm run build', text: 'npm run build', thumb: null, favorite: false, createdAt: now - 60000 }],
  notes: [{ id: 'n1', title: 'First note', body: 'Hello', createdAt: now, updatedAt: now - 60000 }],
  files: [{ id: 'f1', path: '/Users/me/Readme.txt', name: 'Readme.txt', addedAt: now }],
  tool: { running: true, presetId: 'claude', label: 'Claude Code', cwd: '/', error: null, exitCode: null },
  gestureTrusted: true,
  shortcut: '⌘⇧L',
  canAutoLaunch: true,
  launchAtLogin: false
}
const base = {
  getState: async () => state,
  ptySnapshot: async () => ({ buffer: 'ready\r\n', rev: 1 }),
  fileInfo: async () => ({ kind: 'file', ext: 'TXT', thumb: null })
}
window.__calls = calls
window.pullshelf = new Proxy(base, {
  get(target, key) {
    if (key in target) return target[key]
    if (typeof key === 'string' && key.startsWith('on')) return noop
    return async (...args) => {
      calls.push([String(key), ...args])
      return { ok: true }
    }
  }
})
