// Runs inside real Electron: loads the built renderer and drives it with real mouse input.
const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const WIDTH = 1250
const MINS = [260, 200, 200, 220] // Terminal, Clipboard, Files, Notes
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []

async function main() {
  const win = new BrowserWindow({
    width: WIDTH, height: 520, show: false, frame: false,
    webPreferences: { contextIsolation: false, sandbox: false, preload: path.join(__dirname, 'stub-preload.cjs') }
  })
  await win.loadFile(path.join(__dirname, '../../out/renderer/index.html'))
  const run = (js) => win.webContents.executeJavaScript(js)
  const send = (type, x, y, extra = {}) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, ...extra })

  const reload = async (collapsed) => {
    await run(`localStorage.setItem('pullshelf-collapsed', ${JSON.stringify(JSON.stringify(collapsed))}); location.reload()`)
    await wait(900)
  }
  const widths = async () => JSON.parse(await run(`JSON.stringify([...document.querySelectorAll('.columns > .pane')].map(e => Math.round(e.getBoundingClientRect().width)))`))
  const dividers = async () => JSON.parse(await run(`JSON.stringify([...document.querySelectorAll('.columns > .divider')].map(d => { const b = d.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.width)] }))`))
  const dragFrom = async (x, y, dx, steps = 8) => {
    send('mouseMove', x, y); await wait(20)
    send('mouseDown', x, y); await wait(20)
    for (let i = 1; i <= steps; i += 1) {
      send('mouseMove', x + Math.round((dx * i) / steps), y, { modifiers: ['leftButtonDown'] })
      await wait(12)
    }
    send('mouseUp', x + dx, y)
    await wait(80)
  }
  const test = async (name, fn) => {
    try {
      await fn()
      results.push({ name, ok: true })
    } catch (error) {
      results.push({ name, ok: false, error })
    }
  }

  await test('panes fill the shelf and respect minimum widths when everything is open', async () => {
    await reload({})
    const w = await widths()
    const d = await dividers()
    assert.equal(w.length, 4)
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) + d.reduce((a, b) => a + b[1], 0) - WIDTH) <= 3, `widths ${w} do not fill ${WIDTH}`)
    w.forEach((value, i) => assert.ok(value >= MINS[i] - 1, `pane ${i} is ${value}px, below ${MINS[i]}`))
  })

  const combos = [
    { tool: false, clips: false, files: false, notes: false },
    { tool: false, clips: true, files: false, notes: false },
    { tool: true, clips: false, files: false, notes: false },
    { tool: false, clips: false, files: true, notes: false },
    { tool: false, clips: false, files: false, notes: true },
    { tool: true, clips: true, files: false, notes: false },
    { tool: false, clips: true, files: true, notes: false },
    { tool: false, clips: true, files: false, notes: true },
    { tool: true, clips: false, files: false, notes: true }
  ]
  for (const state of combos) {
    const label = Object.entries(state).filter(([, v]) => v).map(([k]) => k).join('+') || 'none'
    await test(`every visible divider drags both ways without breaking the layout (collapsed: ${label})`, async () => {
      const closed = [state.tool, state.clips, state.files, state.notes]
      for (const dx of [-140, 140]) {
        await reload(state)
        const dv = await dividers()
        const visible = dv.map((v, i) => [i, v]).filter(([, v]) => v[1] > 0)
        assert.ok(visible.length > 0 || closed.filter((c) => !c).length === 1, 'expected at least one divider')
        for (const [, v] of visible) {
          await reload(state)
          await dragFrom(v[0] + 4, 200, dx)
          const after = await widths()
          const total = after.reduce((a, b) => a + b, 0) + dv.reduce((a, b) => a + b[1], 0)
          assert.ok(Math.abs(total - WIDTH) <= 3, `shelf no longer full width: ${after}`)
          after.forEach((value, i) => {
            if (!closed[i]) assert.ok(value >= MINS[i] - 1, `pane ${i} shrank to ${value}px (min ${MINS[i]})`)
            else assert.equal(value, 40, `collapsed pane ${i} changed width`)
          })
        }
      }
    })
  }

  await test('dragging a divider saves the layout through the bridge', async () => {
    await reload({})
    await run('window.__calls.length = 0')
    const d = await dividers()
    await dragFrom(d[0][0] + 4, 200, -80)
    const calls = await run('JSON.stringify(window.__calls.filter(c => c[0] === "saveLayout"))')
    const saved = JSON.parse(calls)
    assert.equal(saved.length, 1, 'saveLayout should be called once on release')
    assert.equal(saved[0].length, 4)
    assert.ok(saved[0].slice(1).every((n) => n > 0 && n < 1))
  })

  await test('a divider stops at a neighbour minimum instead of crushing it', async () => {
    await reload({})
    const d = await dividers()
    await dragFrom(d[0][0] + 4, 200, 4000, 20)
    const w = await widths()
    assert.equal(w[1], MINS[1])
    assert.equal(w[2], MINS[2])
    assert.equal(w[3], MINS[3])
  })

  await test('the bottom grip resizes the shelf height via real pointer input', async () => {
    await reload({})
    await run('window.__calls.length = 0')
    const grip = JSON.parse(await run(`JSON.stringify((() => { const b = document.querySelector('.resize-grip').getBoundingClientRect(); return [Math.round(b.x + 100), Math.round(b.y + 4)] })())`))
    send('mouseMove', grip[0], grip[1]); await wait(20)
    send('mouseDown', grip[0], grip[1]); await wait(20)
    send('mouseMove', grip[0], grip[1] - 30, { modifiers: ['leftButtonDown'] }); await wait(60)
    send('mouseUp', grip[0], grip[1] - 30); await wait(60)
    const names = JSON.parse(await run('JSON.stringify(window.__calls.map(c => c[0]))'))
    assert.ok(names.includes('keepOpen'), 'expected keepOpen on press')
    assert.ok(names.includes('resizeShelf'), 'expected resizeShelf while dragging')
    assert.ok(names.includes('resizeShelfEnd'), 'expected resizeShelfEnd on release')
  })

  await test('clicking a pane\'s fold button collapses it to a 40px rail and clicking the rail restores it', async () => {
    await reload({})
    const point = async (selector) => JSON.parse(await run(`JSON.stringify((() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)] })())`))
    const [x, y] = await point('button[aria-label="Collapse Clipboard"]')
    send('mouseDown', x, y); send('mouseUp', x, y); await wait(300)
    assert.equal((await widths())[1], 40)
    const [rx, ry] = await point('button[aria-label="Expand Clipboard"]')
    send('mouseDown', rx, ry); send('mouseUp', rx, ry); await wait(300)
    assert.ok((await widths())[1] >= MINS[1])
  })

  await test('the settings handle opens the menu and an outside click closes it', async () => {
    await reload({})
    const handle = JSON.parse(await run(`JSON.stringify((() => { const b = document.querySelector('.handle').getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)] })())`))
    send('mouseDown', handle[0], handle[1]); send('mouseUp', handle[0], handle[1]); await wait(150)
    assert.equal(await run(`!!document.querySelector('.menu')`), true)
    send('mouseDown', 40, 100); send('mouseUp', 40, 100); await wait(150)
    assert.equal(await run(`!!document.querySelector('.menu')`), false)
  })

  await test('the settings menu offers menu-bar controls and quit, without Folder or Restart', async () => {
    await reload({})
    await run('window.__calls.length = 0')
    const handle = JSON.parse(await run(`JSON.stringify((() => { const b = document.querySelector('.handle').getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)] })())`))
    send('mouseDown', handle[0], handle[1]); send('mouseUp', handle[0], handle[1]); await wait(150)
    const rows = JSON.parse(await run(`JSON.stringify([...document.querySelectorAll('.menu .menu-row > span')].map(e => e.textContent))`))
    for (const label of ['Launch at login', 'Hide menu bar icon', 'Scroll gesture', 'Hide shelf', 'Quit Pullshelf']) assert.ok(rows.includes(label), `missing "${label}" in ${rows}`)
    for (const label of ['Folder', 'Restart tool']) assert.ok(!rows.includes(label), `"${label}" should be gone`)
    const quit = JSON.parse(await run(`JSON.stringify((() => { const b = [...document.querySelectorAll('.menu .menu-row')].find(e => e.textContent.includes('Quit Pullshelf')).getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)] })())`))
    send('mouseDown', quit[0], quit[1]); send('mouseUp', quit[0], quit[1]); await wait(150)
    const names = JSON.parse(await run('JSON.stringify(window.__calls.map(c => c[0]))'))
    assert.ok(names.includes('quit'), 'clicking Quit Pullshelf should call the bridge')
  })
}

app.whenReady().then(async () => {
  try {
    await main()
  } catch (error) {
    results.push({ name: 'harness', ok: false, error })
  }
  let failed = 0
  for (const r of results) {
    if (r.ok) console.log(`  ok   ${r.name}`)
    else {
      failed += 1
      console.log(`  FAIL ${r.name}\n       ${String(r.error && r.error.message).split('\n').join('\n       ')}`)
    }
  }
  console.log(`\n${results.length - failed}/${results.length} e2e checks passed`)
  app.exit(failed ? 1 : 0)
})
