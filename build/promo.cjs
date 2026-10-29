// Renders the 1080x1920 card (headline above, caption below) that the vertical promo clip is built on.
// Usage: electron build/promo.cjs <out.png>   then see build/promo.sh for the ffmpeg step.
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const fonts = resolve(__dirname, '../docs/assets/vendor/fonts')
const html = `<!doctype html><meta charset=utf-8><style>
@font-face{font-family:IS;src:url(file://${fonts}/instrument-serif-latin-400-normal.woff2)}
@font-face{font-family:IS;font-style:italic;src:url(file://${fonts}/instrument-serif-latin-400-italic.woff2)}
@font-face{font-family:IN;font-weight:500;src:url(file://${fonts}/inter-latin-500-normal.woff2)}
body{margin:0;width:1080px;height:1920px;background:radial-gradient(700px 700px at 50% 38%,rgba(232,120,95,.16),transparent),#121110;color:#ece8df;font-family:IN;position:relative;overflow:hidden}
.top{position:absolute;top:250px;left:0;right:0;text-align:center;font:400 128px/0.98 IS;letter-spacing:-2px;padding:0 70px}
.top em{color:#e8785f}
.sub{position:absolute;top:610px;left:0;right:0;text-align:center;font:500 34px/1.4 IN;color:#a39d91;padding:0 120px}
.bot{position:absolute;bottom:250px;left:0;right:0;text-align:center}
.pill{display:inline-block;background:#e8785f;color:#1a0d09;font:500 40px/1 IN;padding:26px 46px;border-radius:999px}
.url{margin-top:34px;font:500 32px/1 IN;color:#ece8df}
.cap{margin-top:26px;font:500 24px/1.4 IN;color:#a39d91}
</style><div class=top>Your Mac's missing <em>shelf.</em></div>
<div class=sub>Terminal, clipboard history, files and notes. One pull from the top of the screen.</div>
<div class=bot><span class=pill>Free · Open source · macOS</span><div class=url>pullshelf.vercel.app</div><div class=cap>A scripted demo of the real interface, not a screen recording.</div></div>`
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1080, height: 1920, show: false, useContentSize: true, webPreferences: { webSecurity: false } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 800))
  writeFileSync(process.argv[2], (await win.webContents.capturePage()).toPNG())
  app.quit()
})
