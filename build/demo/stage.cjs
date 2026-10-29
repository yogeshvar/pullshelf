// Renders the website demo: drives the real, built Pullshelf interface in a hidden Electron window
// on a fixed timeline and writes one PNG per frame. Not a screen recording of a live session.
// Usage: electron stage.cjs <renderer-dir> <frames-dir>
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const [rendererDir, framesDir] = process.argv.slice(-2)
const W = 1440
const H = 720
const FPS = 30
const BAR = 28
const PACE = 0.72 // scales every pause and move; lower is faster
const SHELF_H = 560
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const STAGE_CSS = `
  html { background: linear-gradient(160deg, #f3d9c4 0%, #e9b7a0 38%, #c98aa5 70%, #8a82bd 100%) !important; }
  body { margin: 0; overflow: hidden; background: transparent !important; }
  #root { position: fixed !important; left: 0; right: 0; top: ${BAR}px; height: ${SHELF_H}px !important;
    overflow: hidden; box-shadow: 0 24px 60px rgba(40, 20, 30, .38); z-index: 10; }
  #stage-bar { position: fixed; top: 0; left: 0; right: 0; height: ${BAR}px; z-index: 50; display: flex;
    align-items: center; justify-content: flex-end; gap: 16px; padding: 0 18px; box-sizing: border-box;
    background: rgba(255,255,255,.34); backdrop-filter: blur(18px); color: #2a2320;
    font: 500 13px -apple-system, BlinkMacSystemFont, sans-serif; }
  #stage-bar svg { display: block; }
  #stage-cap { position: fixed; left: 50%; bottom: 30px; transform: translateX(-50%); z-index: 60; padding: 11px 20px;
    border-radius: 999px; background: rgba(24,20,18,.82); color: #fff; opacity: 0; white-space: nowrap;
    font: 500 19px -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: .005em; }
  #stage-cur { position: fixed; left: 0; top: 0; z-index: 100; width: 24px; height: 24px; pointer-events: none; }
  #stage-ghost { position: fixed; left: 0; top: 0; z-index: 90; width: 78px; pointer-events: none; opacity: 0;
    text-align: center; font: 500 12px -apple-system, sans-serif; color: #2a2320; }
  #stage-ghost .doc { width: 38px; height: 48px; margin: 0 auto 4px; border-radius: 4px 10px 4px 4px; background: #fff;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,.18), 0 6px 14px rgba(0,0,0,.25); display: grid; place-items: end center;
    padding-bottom: 7px; box-sizing: border-box; font-size: 9.5px; font-weight: 600; color: #7a7166; }
`

const STAGE_JS = `
  const style = document.createElement('style'); style.textContent = ${JSON.stringify(STAGE_CSS)}; document.head.appendChild(style)
  const bar = document.createElement('div'); bar.id = 'stage-bar'
  bar.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="2.4" rx="1.2" fill="#2a2320"/><circle cx="8" cy="9.2" r="2.3" fill="#c8442f"/></svg><span>Sun 9:41</span>'
  document.body.appendChild(bar)
  const cap = document.createElement('div'); cap.id = 'stage-cap'; document.body.appendChild(cap)
  const cur = document.createElement('div'); cur.id = 'stage-cur'
  cur.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.2 1.6 3.4 6.4-2.8 1.5-3.4-6.5L5 19.6z" fill="#fff" stroke="#1e1b17" stroke-width="1.5" stroke-linejoin="round"/></svg>'
  document.body.appendChild(cur)
  const ghost = document.createElement('div'); ghost.id = 'stage-ghost'
  ghost.innerHTML = '<div class="doc">PDF</div>Report.pdf'; document.body.appendChild(ghost)
  window.__setShelf = (y) => { document.getElementById('root').style.transform = 'translateY(' + y + 'px)' }
  window.__setCursor = (x, y, press) => { cur.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + (press ? 0.86 : 1) + ')' }
  window.__setGhost = (x, y, on) => { ghost.style.opacity = on ? 1 : 0; ghost.style.transform = 'translate(' + x + 'px,' + y + 'px)' }
  window.__caption = (text) => { cap.textContent = text; cap.style.opacity = text ? 1 : 0 }
  window.__setShelf(-${SHELF_H + BAR})
`

const ease = (t) => 1 - Math.pow(1 - t, 3)
const smooth = (t) => t * t * (3 - 2 * t)

app.whenReady().then(async () => {
  fs.rmSync(framesDir, { recursive: true, force: true })
  fs.mkdirSync(framesDir, { recursive: true })
  const win = new BrowserWindow({
    width: W, height: H, show: false, frame: false, useContentSize: true,
    webPreferences: { contextIsolation: false, sandbox: false, backgroundThrottling: false, preload: path.join(__dirname, 'demo-preload.cjs') }
  })
  await win.loadFile(path.join(rendererDir, 'index.html'))
  const run = (js) => win.webContents.executeJavaScript(js)
  await run(`localStorage.setItem('pullshelf-theme', 'light'); localStorage.removeItem('pullshelf-collapsed'); location.reload()`)
  await wait(1500)
  await run(STAGE_JS)
  await wait(300)

  let frame = 0
  // Start where the clip ends (empty desktop, cursor at the top edge) so the loop has no jump.
  let cx = 700
  let cy = 8
  let pressed = false
  let shelfY = -(SHELF_H + BAR)
  const send = (type, extra = {}) => win.webContents.sendInputEvent({ type, x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1, ...extra })

  const shoot = async () => {
    await run(`window.__setShelf(${shelfY}); window.__setCursor(${cx}, ${cy}, ${pressed})`)
    send('mouseMove')
    await wait(24)
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(framesDir, String(frame).padStart(4, '0') + '.png'), image.toPNG())
    frame += 1
  }
  const hold = async (sec) => { for (let i = 0; i < Math.round(sec * PACE * FPS); i += 1) await shoot() }
  const moveTo = async (x, y, sec) => {
    const x0 = cx, y0 = cy, n = Math.max(1, Math.round(sec * PACE * FPS))
    for (let i = 1; i <= n; i += 1) { const k = smooth(i / n); cx = x0 + (x - x0) * k; cy = y0 + (y - y0) * k; await shoot() }
  }
  const slideTo = async (y, sec) => {
    const y0 = shelfY, n = Math.max(1, Math.round(sec * PACE * FPS))
    for (let i = 1; i <= n; i += 1) { shelfY = y0 + (y - y0) * ease(i / n); await shoot() }
  }
  const caption = (text) => run(`window.__caption(${JSON.stringify(text)})`)
  const center = async (selector) => JSON.parse(await run(`JSON.stringify((() => { const e = document.querySelector(${JSON.stringify(selector)}); const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] })())`))
  const click = async () => {
    pressed = true; send('mouseDown'); await shoot(); await shoot()
    send('mouseUp'); pressed = false; await shoot()
  }
  const typeInto = async (text, framesPerChar) => {
    for (const ch of text) { win.webContents.insertText(ch); for (let i = 0; i < framesPerChar; i += 1) await shoot() }
  }
  const ptyType = async (text, framesPerChar) => {
    for (const ch of text) { await run(`window.__demo.pty(${JSON.stringify(ch)})`); for (let i = 0; i < framesPerChar; i += 1) await shoot() }
  }
  const esc = String.fromCharCode(27)
  const green = (s) => `${esc}[32m${s}${esc}[0m`
  const dim = (s) => `${esc}[2m${s}${esc}[0m`
  const prompt = `${esc}[1;35m~/Projects/notes-app${esc}[0m ${esc}[36mgit:(main)${esc}[0m\r\n${green('❯')} `

  // 1. The empty desktop, then the pull from the top edge.
  await hold(0.5)
  await caption('Pull down at the top edge, or press ⌘⇧L')
  await hold(1.1)
  await slideTo(0, 0.9)

  // 2. A real terminal.
  await run(`window.__demo.pty(${JSON.stringify(prompt)})`)
  await caption('A real terminal for the tools you already run')
  await hold(0.7)
  await moveTo(900, 330, 0.5)
  await ptyType('npm test', 2)
  await hold(0.3)
  const lines = ['\r\n', '\r\n> notes-app@1.2.0 test\r\n', '> vitest run\r\n', '\r\n', ` ${green('✓')} src/notes.test.ts ${dim('(12 tests)')}\r\n`, ` ${green('✓')} src/search.test.ts ${dim('(8 tests)')}\r\n`, '\r\n', ` Test Files  ${green('2 passed')} (2)\r\n`, `      Tests  ${green('20 passed')} (20)\r\n`, '\r\n', prompt]
  for (const line of lines) { await run(`window.__demo.pty(${JSON.stringify(line)})`); await hold(0.12) }

  // 3. Clipboard history.
  await caption('Clipboard history, one click to copy')
  await run(`window.__demo.pushClip({ id: 'c0', kind: 'text', preview: 'git commit -m "Add release notes"', text: 'x', thumb: null, favorite: false, createdAt: Date.now() })`)
  await hold(0.6)
  const [clipX, clipY] = await center('.clip-body')
  await moveTo(clipX, clipY, 0.8)
  await click()
  await hold(1.0)

  // 4. Drop a file into Files.
  await caption('Drop files in to keep them close')
  const [filesX, filesY] = await center('.files-pane .file-grid')
  await moveTo(filesX - 360, filesY + 150, 0.5)
  cx = filesX - 360; cy = filesY + 150
  for (let i = 1; i <= 30; i += 1) {
    const k = smooth(i / 30)
    cx = filesX - 360 + (filesX - 20 - (filesX - 360)) * k; cy = filesY + 150 + (filesY + 60 - (filesY + 150)) * k
    await run(`window.__setGhost(${cx - 39}, ${cy - 20}, true)`); await shoot()
  }
  await run(`window.__setGhost(0, 0, false); window.__demo.pushFile({ id: 'f3', path: '/Users/demo/Report.pdf', name: 'Report.pdf', addedAt: Date.now() }, { kind: 'file', ext: 'PDF', thumb: null })`)
  await hold(1.0)

  // 5. Quick notes, typed with real key input.
  await caption('Quick notes, always there')
  const [noteX, noteY] = await center('.note-editor')
  await moveTo(noteX, noteY + 90, 0.7)
  await click()
  win.webContents.insertText('- ')
  await typeInto('Write the changelog', 2)
  await hold(0.8)

  // 6. Collapse a pane and drag a divider.
  await caption('Collapse and resize panes')
  const [foldX, foldY] = await center('button[aria-label="Collapse Clipboard"]')
  await moveTo(foldX, foldY, 0.7)
  await click()
  await hold(0.7)
  const [divX, divY] = await center('.divider:not(.off)')
  await moveTo(divX, divY + 120, 0.5)
  pressed = true; send('mouseDown'); await shoot()
  for (let i = 1; i <= 24; i += 1) { cx = divX - (140 * smooth(i / 24)); send('mouseMove', { modifiers: ['leftButtonDown'] }); await shoot() }
  send('mouseUp'); pressed = false; await shoot()
  await hold(0.6)
  const [railX, railY] = await center('button[aria-label="Expand Clipboard"]')
  await moveTo(railX, railY, 0.6)
  await click()
  await hold(0.6)

  // 7. Light and dark, then put it away.
  await caption('Light and dark, hide it when you are done')
  const [gearX, gearY] = await center('.handle')
  await moveTo(gearX, gearY, 0.7)
  await click()
  await hold(0.5)
  const themeRow = JSON.parse(await run(`JSON.stringify((() => { const row = [...document.querySelectorAll('.menu-row')].find((r) => r.textContent.startsWith('Theme')); const b = row.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] })())`))
  await moveTo(themeRow[0], themeRow[1], 0.6)
  await click()
  await hold(1.3)
  await moveTo(gearX, gearY, 0.5)
  await click()
  await hold(0.3)
  await moveTo(700, 8, 0.5)
  await caption('')
  await slideTo(-(SHELF_H + BAR), 0.8)
  await hold(0.6)

  console.log('frames', frame)
  app.exit(0)
})
