// Renders docs/assets/og.png (1200x630) from the running site. Usage: electron build/og.cjs http://localhost:4173/
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 630, show: false, useContentSize: true, webPreferences: { offscreen: false } })
  await win.loadURL(process.argv[2] || 'http://localhost:4173/')
  await win.webContents.executeJavaScript("document.documentElement.setAttribute('data-theme','dark');document.querySelector('.nav').style.display='none';document.querySelector('.fine').style.display='none';document.querySelector('.install').style.display='none';document.querySelector('.hero').style.minHeight='630px';document.querySelector('.hero').style.padding='36px 0 0'")
  await new Promise((r) => setTimeout(r, 6500))
  const image = await win.webContents.capturePage()
  writeFileSync(resolve(__dirname, '../docs/assets/og.png'), image.toPNG())
  app.quit()
})
