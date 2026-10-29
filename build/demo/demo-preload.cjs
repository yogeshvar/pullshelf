// Demo data for the website video. Everything here is generic: no personal paths, names or content.
// Stands in for electron/preload.ts and lets the stage script push events as if the app were running.
const now = Date.now()
const min = (n) => now - n * 60000
const state = {
  settings: { presetId: 'shell', customCommand: '', cwd: '/Users/demo', toolRatio: 0.4, clipRatio: 0.2, filesRatio: 0.18, heightRatio: 0.52, showTrayIcon: true },
  clips: [
    { id: 'c1', kind: 'text', preview: 'https://example.com/docs/getting-started', text: 'x', thumb: null, favorite: false, createdAt: min(41) },
    { id: 'c2', kind: 'text', preview: 'Remember to book the dentist on Thursday.', text: 'x', thumb: null, favorite: false, createdAt: min(75) }
  ],
  notes: [
    { id: 'n1', title: 'Launch checklist', body: 'Launch checklist\n\n- Tag the release\n- Update the cask\n', createdAt: now, updatedAt: min(3) }
  ],
  files: [
    { id: 'f1', path: '/Users/demo/Projects', name: 'Projects', addedAt: now },
    { id: 'f2', path: '/Users/demo/Notes.md', name: 'Notes.md', addedAt: now - 1 }
  ],
  tool: { running: true, presetId: 'shell', label: 'Shell', cwd: '/Users/demo', error: null, exitCode: null },
  gestureTrusted: true, shortcut: '⌘⇧L', canAutoLaunch: true, launchAtLogin: false
}
const fileInfo = {
  f1: { kind: 'folder', ext: '', thumb: null },
  f2: { kind: 'file', ext: 'MD', thumb: null },
  f3: { kind: 'file', ext: 'PDF', thumb: null }
}
const callbacks = {}
const on = (name) => (cb) => {
  ;(callbacks[name] = callbacks[name] || []).push(cb)
  return () => {}
}
const base = {
  getState: async () => state,
  ptySnapshot: async () => ({ buffer: '', rev: 0 }),
  fileInfo: async (id) => fileInfo[id] || { kind: 'file', ext: '', thumb: null },
  onPtyData: on('pty'), onPtyReset: on('reset'), onPtyExit: on('exit'), onToolStatus: on('tool'),
  onClips: on('clips'), onNotes: on('notes'), onFiles: on('files'), onShown: on('shown'),
  onGestureTrust: on('trust'), onPrefs: on('prefs')
}
let rev = 0
// The stage script calls these to make things "happen" in the UI.
window.__demo = {
  state,
  fire: (name, payload) => (callbacks[name] || []).forEach((cb) => cb(payload)),
  pty: (chunk) => (callbacks.pty || []).forEach((cb) => cb({ rev: ++rev, chunk })),
  pushClip: (clip) => {
    state.clips.unshift(clip)
    window.__demo.fire('clips', [...state.clips])
  },
  pushFile: (file, info) => {
    fileInfo[file.id] = info
    state.files.unshift(file)
    window.__demo.fire('files', [...state.files])
  }
}
window.pullshelf = new Proxy(base, {
  get(target, key) {
    if (key in target) return target[key]
    if (typeof key === 'string' && key.startsWith('on')) return () => () => {}
    return async () => ({ ok: true })
  }
})
