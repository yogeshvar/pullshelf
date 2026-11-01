// Generates the static site in docs/ (home, features, download, support, changelog, privacy, press, 404,
// sitemap.xml, robots.txt, vercel.json). Plain files out, no runtime framework. Run: node build/site.mjs
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const docs = resolve(dirname(fileURLToPath(import.meta.url)), '../docs')
// The live address. Change this one line when a custom domain is attached.
const SITE = 'https://pullshelf.vercel.app'
const REPO = 'https://github.com/yogeshvar/pullshelf'
const ZIP = `${REPO}/releases/download/v0.1.1/Pullshelf-0.1.1-arm64.zip`
const BREW = 'brew install --cask yogeshvar/pullshelf/pullshelf'

const NAV = [['features.html', 'Features'], ['download.html', 'Download'], ['support.html', 'Support'], ['changelog.html', 'Changelog']]

const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'

function shelf({ hero = false } = {}) {
  return `<div class="desk" ${hero ? 'data-hero' : ''} role="img" aria-label="The Pullshelf shelf open: terminal, clipboard history, files and notes side by side">
    <div class="menubar" aria-hidden="true"><b></b><span>Pullshelf</span><span class="sp"><span>⌘⇧L</span></span></div>
    <div class="shelf" aria-hidden="true">
      <div class="pane tool"><div class="ph">Terminal</div><div class="term"><span class="ln"><span class="p">~/app</span> git status</span>
<span class="ln"><span class="d">3 files changed</span></span>
<span class="ln"><span class="p">~/app</span> claude</span>
<span class="ln"><span class="d">✻ How can I help?</span></span>
<span class="ln"><span class="p">›</span> <span class="caret"></span></span></div></div>
      <div class="pane clips"><div class="ph">Clipboard</div>
        <div class="clip">npm run build<small>just now</small></div>
        <div class="clip">https://example.com/docs<small>2m</small></div>
        <div class="clip">Meeting notes, Friday<small>9m</small></div></div>
      <div class="pane files"><div class="ph">Files</div><div class="tiles">
        <div class="tile"><i>PDF</i>invoice</div><div class="tile"><i>PNG</i>mock</div><div class="tile"><i>ZIP</i>assets</div><div class="tile"><i>TXT</i>todo</div></div></div>
      <div class="pane notes"><div class="ph">Notes</div><div class="note" data-note="Ship the build.&#10;Reply to Sam.&#10;Rename the branch.">Ship the build.
Reply to Sam.
Rename the branch.</div></div>
      <div class="handle">⚙</div>
    </div></div>`
}

function head({ title, desc, path, extra = '' }) {
  const url = `${SITE}/${path}`
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#121110">
<meta property="og:type" content="website"><meta property="og:site_name" content="Pullshelf">
<meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/assets/og.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${SITE}/assets/og.png">
<link rel="icon" href="assets/favicon.png" type="image/png">
<link rel="preload" href="assets/vendor/fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/site.css">
<script>document.documentElement.classList.add('js');try{var t=localStorage.getItem('pullshelf-site-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
${extra}
</head>`
}

function nav(current) {
  return `<a class="skip" href="#main">Skip to content</a>
<header class="nav"><a class="brand" href="index.html" aria-label="Pullshelf home"><i></i>Pullshelf</a>
<nav aria-label="Main"><ul>${NAV.map(([h, l]) => `<li><a href="${h}"${h === current ? ' aria-current="page"' : ''}>${l}</a></li>`).join('')}</ul></nav>
<div class="nav-r"><button class="iconbtn" data-theme-toggle aria-label="Switch light or dark theme">${sun}</button><a class="btn primary small" href="download.html">Download</a></div></header>`
}

const foot = `<footer><div class="wrap foot"><div><a class="brand" href="index.html"><i></i>Pullshelf</a><p>A pull-down shelf for the Mac.<br>MIT licensed. No telemetry.</p>
<p>Not affiliated with Anthropic or OpenAI.</p></div>
<ul><li><a href="features.html">Features</a></li><li><a href="download.html">Download</a></li><li><a href="support.html">Support</a></li><li><a href="changelog.html">Changelog</a></li><li><a href="privacy.html">Privacy</a></li><li><a href="press.html">Press</a></li><li><a href="${REPO}">GitHub</a></li></ul></div></footer>
<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};window.si=window.si||function(){(window.siq=window.siq||[]).push(arguments)}</script>
<script defer src="/_vercel/insights/script.js"></script><script defer src="/_vercel/speed-insights/script.js"></script>
<script src="assets/vendor/gsap.min.js" defer></script><script src="assets/vendor/ScrollTrigger.min.js" defer></script><script src="assets/vendor/lenis.min.js" defer></script><script src="assets/site.js" defer></script>
</body></html>`

const install = `<div class="install"><code>${BREW}</code><button type="button" data-copy="${BREW}">Copy</button></div>`

function page({ file, title, desc, current, body, extra = '' }) {
  writeFileSync(resolve(docs, file), `${head({ title, desc, extra, path: file === 'index.html' ? '' : file })}
<body>
${nav(current)}
<main id="main">
${body}
</main>
${foot}
`)
}

const faq = [
  ['Is Pullshelf free?', 'Yes. Pullshelf is open source under the MIT license. You can build it yourself, install it with Homebrew, or download the zip, at no cost. There are no paid tiers, locked features or accounts.'],
  ['Which Macs does it run on?', 'Apple Silicon Macs running macOS 13 or newer. An Intel build is not available yet.'],
  ['How is this different from Unclutter or Ghostty\'s quick terminal?', 'Unclutter is a pull-down panel for your clipboard, files and notes. Ghostty\'s quick terminal (like iTerm2\'s hotkey window) is a drop-down terminal. Pullshelf puts all four panes in a single pull-down, so a real terminal sits beside your clipboard, file references and notes, and you can send a clip or note into it. It is free, open source and MIT licensed.'],
  ['Why does macOS warn me on first launch?', 'Pullshelf is ad-hoc signed but not yet notarized by Apple. On first launch, open it once, then go to System Settings, Privacy &amp; Security, and choose Open Anyway. Notarization is planned.'],
  ['What does it send over the network?', 'Nothing. There is no telemetry, no account and no cloud sync. Your clips, notes and file references stay in a local database on your Mac.'],
  ['Why does it ask for Accessibility permission?', 'Only the pull-down gesture needs it, to read two-finger scrolls at the top screen edge. You can skip it and open Pullshelf with ⌘⇧L or from the menu bar icon.'],
  ['Does it work with Claude Code or Codex?', 'Yes. The terminal pane can start your shell, Claude Code or Codex, and you can send a clip or note straight into it.']
]

// Real proof only. Leave this empty until there is something true to show.
// quotes: [{ text, name, handle, url }] — url and handle are optional.
// stars: set to the GitHub star count when you update the site after launch.
const PROOF = { stars: null, quotes: [] }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function proof() {
  const { stars, quotes } = PROOF
  if (!quotes.length && !stars) return ''
  const starLabel = stars === 1 ? '1 star on GitHub' : `${stars} stars on GitHub`
  return `<section class="sec"><div class="wrap">
  <div class="proof-head">
    <h2 class="eyebrow">What people say</h2>
    ${stars ? `<p class="proof-stars"><a href="${REPO}/stargazers">${starLabel}</a></p>` : ''}
  </div>
  <div class="quotes">${quotes.map(({ text, name, handle, url }) => `<figure class="quote"><blockquote>${esc(text)}</blockquote><figcaption>${url ? `<a href="${esc(url)}">${esc(name)}</a>` : esc(name)}${handle ? ` <span>${esc(handle)}</span>` : ''}</figcaption></figure>`).join('')}</div>
</div></section>

`
}

page({
  file: 'index.html',
  title: 'Pullshelf: a pull-down terminal for your Mac',
  desc: 'Pull down a real terminal from the top of your screen, with clipboard history, file references and notes beside it. Free and open source for macOS.',
  current: '',
  extra: `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Pullshelf', operatingSystem: 'macOS 13+', applicationCategory: 'ProductivityApplication', description: 'A pull-down terminal for the Mac, with clipboard history, files and notes.', url: SITE, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, license: 'https://opensource.org/license/mit' })}</script>`,
  body: `<section class="hero"><div class="wrap">
  <div class="hero-copy">
    <p class="eyebrow">For macOS · Free · Open source</p>
    <h1>Your Mac's missing <em>shelf.</em></h1>
    <p class="lede">Pull down a real terminal from the top of your screen, with your clipboard, files and notes beside it. Run Claude Code or Codex without a dedicated window. Let go and it slides back.</p>
    <div class="cta"><a class="btn primary" href="download.html">Download for Mac</a><a class="btn" href="${REPO}">View on GitHub</a></div>
    ${install}
    <p class="fine">Apple Silicon · macOS 13+ · v0.1.1</p>
  </div>
  ${shelf({ hero: true })}
</div></section>

<section class="panes-scene" data-panes><div class="wrap panes-grid">
  <div class="caps">
    <div class="cap on"><p class="eyebrow">01 · Terminal</p><h2>Your shell, <em>right there.</em></h2><p>Start a shell, Claude Code or Codex without switching windows. Send a clip or a note straight into it.</p></div>
    <div class="cap"><p class="eyebrow">02 · Clipboard</p><h2>Everything you <em>copied.</em></h2><p>Text and images, newest first. Search, favourite, copy it back, or send it to the terminal.</p></div>
    <div class="cap"><p class="eyebrow">03 · Files</p><h2>Park it, <em>drag it back out.</em></h2><p>Drop files and folders on the shelf as references. Drag them into any app when you need them.</p></div>
    <div class="cap"><p class="eyebrow">04 · Notes</p><h2>Notes that <em>start typing.</em></h2><p>A quick scratchpad with rename and search. Notes are saved as you type, and mirrored as Markdown files.</p></div>
    <div class="steps" aria-hidden="true"><span><i></i></span><span><i></i></span><span><i></i></span><span><i></i></span></div>
  </div>
  ${shelf()}
</div></section>

<section class="sec"><div class="wrap gesture" data-gesture>
  <div>
    <p class="eyebrow">The gesture</p>
    <h2 data-rise>Pull. <em>It follows your fingers.</em></h2>
    <p class="lede" data-rise>Two fingers at the top edge of the screen. The shelf tracks you one to one, and settles open or closed when you let go. Prefer the keyboard? <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>L</kbd>.</p>
  </div>
  <div>
    <div class="pad" aria-hidden="true"><span class="finger"></span><span class="finger b"></span></div>
    <div class="mini" aria-hidden="true" style="margin-top:20px"><div class="mb"></div><div class="lip"></div></div>
  </div>
</div></section>

<hr class="rule">
<section class="sec"><div class="wrap">
  <p class="eyebrow">Built to stay out of the way</p>
  <h2 data-rise>Small, local, <em>yours.</em></h2>
  <div class="facts">
    <div class="fact" data-rise><b>4</b><span>panes in one pull</span></div>
    <div class="fact" data-rise><b>0</b><span>telemetry or accounts</span></div>
    <div class="fact" data-rise><b>MIT</b><span>open source license</span></div>
    <div class="fact" data-rise><b>⌘⇧L</b><span>or pull from the top edge</span></div>
  </div>
  <div class="grid3">
    <div class="card" data-rise><h3>Private by design</h3><p>No network calls. Clips, notes and file references live in a local database on your Mac.</p></div>
    <div class="card" data-rise><h3>Menu bar, your way</h3><p>Launch at login, hide the menu bar icon, quit from the menu. The shortcut and gesture still work.</p></div>
    <div class="card" data-rise><h3>Light or dark</h3><p>Follows your Mac, or pick one. Panes collapse to slim rails and resize by dragging the dividers.</p></div>
  </div>
</div></section>

<section class="sec" style="background:var(--bg2)"><div class="wrap themes">
  <div><p class="eyebrow">Themes</p><h2 data-rise>Dark or light. <em>Your call.</em></h2><p class="lede" data-rise>Try it: the toggle in the top bar switches this whole page and the shelf with it.</p></div>
  ${shelf()}
</div></section>

${proof()}<section class="sec support"><div class="wrap">
  <p class="eyebrow">Price</p>
  <h2 data-rise>Free. <em>Open source.</em></h2>
  <p class="lede" data-rise>Pullshelf is free and open source. No accounts, no locked features, no nagging. If you like it, a star on GitHub or a word to a friend helps more than you'd think.</p>
  <div class="cta"><a class="btn primary" href="download.html">Download for Mac</a><a class="btn" href="${REPO}">Star on GitHub</a></div>
</div></section>

<section class="sec faq"><div class="wrap prose" style="max-width:820px">
  <h2>Questions</h2>
  <div style="margin-top:36px">${faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
</div></section>`
})

page({
  file: 'features.html', current: 'features.html',
  title: 'Features | Pullshelf', desc: 'Everything in the Pullshelf shelf: terminal, clipboard history, files, notes, themes and menu bar settings.',
  body: `<div class="page"><div class="wrap prose"><p class="eyebrow">Features</p><h1>What's on the shelf</h1>
<h2>Terminal</h2><p>A real terminal in the shelf. Start your shell, Claude Code or Codex. Send a clip or a note into it. Your session keeps running while the shelf is hidden.</p>
<h2>Clipboard</h2><p>History of text and images, newest first. Search, favourite, copy back, or send to the terminal. Clear it any time.</p>
<h2>Files</h2><p>Drop files and folders as references (nothing is copied or moved). Open, reveal in Finder, or drag them back out.</p>
<h2>Notes</h2><p>A distraction-free scratchpad with a list, search and renaming. Saved as you type and mirrored as Markdown files.</p>
<h2>The shelf itself</h2><p>Pull from the top edge or press <kbd>⌘⇧L</kbd>. Drag the bottom edge to set its height, drag dividers to resize panes, collapse any pane to a rail. Light and dark themes.</p>
<h2>Menu bar and settings</h2><p>Launch at login, hide or show the menu bar icon, scroll gesture status, quit.</p></div></div>`
})

page({
  file: 'download.html', current: 'download.html',
  title: 'Download Pullshelf for Mac', desc: 'Install Pullshelf with Homebrew or download the zip. Apple Silicon, macOS 13 or newer.',
  body: `<div class="page"><div class="wrap prose"><p class="eyebrow">Download</p><h1>Get Pullshelf</h1>
<p>Version 0.1.1 · Apple Silicon · macOS 13 or newer · free.</p>
<h2>Homebrew</h2><pre><code>${BREW}</code></pre>
<h2>Direct download</h2><p><a class="btn primary" href="${ZIP}">Download Pullshelf-0.1.1-arm64.zip</a></p>
<p>Unzip and drag Pullshelf to Applications.</p>
<h2>First launch</h2><p><strong>Pullshelf is not notarized yet.</strong> Open it once, then go to System Settings, Privacy &amp; Security, and choose <strong>Open Anyway</strong> (older macOS: right-click, Open). For the pull gesture, allow Pullshelf under Privacy &amp; Security, Accessibility. You can skip that and use <kbd>⌘⇧L</kbd> instead.</p>
<h2>Source</h2><p>Pullshelf is MIT licensed. Build it yourself from <a href="${REPO}">GitHub</a>.</p></div></div>`
})

page({
  file: 'support.html', current: 'support.html',
  title: 'Support Pullshelf | Free and open source', desc: 'Pullshelf is free and open source. Ways to help: star the repo, share it, report bugs.',
  body: `<div class="page"><div class="wrap prose"><p class="eyebrow">Support</p><h1>Free, and staying that way.</h1>
<p>Pullshelf is MIT licensed and costs nothing. There are no paid tiers and nothing is locked.</p>
<h2>Ways to help</h2>
<ul><li>Star the project on <a href="${REPO}">GitHub</a>.</li><li>Tell a friend who lives in the terminal.</li><li>Report a bug or suggest a feature in <a href="${REPO}/issues">GitHub issues</a>.</li></ul>
</div></div>`
})

page({
  file: 'changelog.html', current: 'changelog.html',
  title: 'Changelog | Pullshelf', desc: 'What changed in each Pullshelf release.',
  body: `<div class="page"><div class="wrap prose"><p class="eyebrow">Changelog</p><h1>Releases</h1>
<div class="release"><time>v0.1.1</time><h2 style="margin-top:8px">Renamed to Pullshelf</h2>
<ul><li>The app, Homebrew cask and website are now called Pullshelf (it was Perch).</li><li>Your notes, clips and settings move over automatically on first launch.</li></ul></div>
<div class="release"><time>v0.1.0 (as Perch)</time><h2 style="margin-top:8px">First public release</h2>
<ul><li>Pull-down shelf with terminal, clipboard history, files and notes.</li><li>Two-finger pull at the top edge, or <kbd>⌘⇧L</kbd>.</li><li>Light and dark themes, collapsible and resizable panes.</li><li>Menu bar settings: launch at login, hide the icon, quit.</li><li>Homebrew cask and direct download.</li></ul></div></div></div>`
})

page({
  file: 'privacy.html', current: 'privacy.html',
  title: 'Privacy | Pullshelf', desc: 'Pullshelf has no telemetry, no accounts and no network calls. Your data stays on your Mac.',
  body: `<div class="page"><div class="wrap prose"><p class="eyebrow">Privacy</p><h1>Your data stays yours</h1>
<p>Pullshelf has <strong>no telemetry, no accounts and no cloud sync</strong>. It makes no network calls of its own.</p>
<h2>What is stored, and where</h2><p>Clipboard history, notes and file references are kept in a local database under <code>~/Library/Application Support/Pullshelf</code>. Notes are also mirrored as Markdown files in that folder. Delete the folder to remove everything.</p>
<h2>Permissions</h2><p>Accessibility is used only to detect the two-finger pull at the top screen edge. Pullshelf reads scroll events for that and nothing else.</p>
<h2>This website</h2><p>It sets no cookies and loads no third-party fonts or trackers. It uses Vercel Web Analytics and Speed Insights, served from this same site, to count page views and measure load speed in aggregate; they do not use cookies or track you across sites. Your theme choice is kept in your browser's local storage. The app itself has no analytics.</p></div></div>`
})

page({
  file: 'press.html', current: 'press.html',
  title: 'Press kit | Pullshelf', desc: 'Pullshelf in one line, screenshots and the app icon for writers and reviewers.',
  body: `<div class="page"><div class="wrap prose"><p class="eyebrow">Press</p><h1>Press kit</h1>
<p><strong>One line:</strong> Pullshelf is a free, open-source pull-down shelf for the Mac with a terminal, clipboard history, files and notes.</p>
<p><strong>Facts:</strong> macOS 13+, Apple Silicon, MIT license, no telemetry, v0.1.1. Contact: open an issue on <a href="${REPO}">GitHub</a>.</p>
<h2>Screenshots</h2><p><a href="assets/pullshelf-dark.png">Dark</a> · <a href="assets/pullshelf-light.png">Light</a> · <a href="assets/pullshelf-demo.mp4">Demo video</a> · <a href="assets/pullshelf-promo-vertical.mp4">Vertical clip (1080x1920)</a></p>
<video controls muted playsinline preload="metadata" poster="assets/pullshelf-demo-poster.png" style="max-width:320px;border-radius:14px;border:1px solid var(--rule)"><source src="assets/pullshelf-promo-vertical.mp4" type="video/mp4"></video><p>A scripted demo of the real interface, not a screen recording.</p>
<img src="assets/pullshelf-dark.png" alt="Pullshelf shelf in dark mode" width="1200" height="600" style="border-radius:14px;border:1px solid var(--rule)"></div></div>`
})

page({
  file: '404.html', current: '',
  title: 'Not found | Pullshelf', desc: 'That page is not here.',
  body: `<div class="page"><div class="wrap"><p class="eyebrow">404</p><h1>Nothing on <em>this</em> shelf.</h1><p class="lede">That page doesn't exist. <a href="index.html">Back to Pullshelf</a>.</p></div></div>`
})

const urls = ['', 'features.html', 'download.html', 'support.html', 'changelog.html', 'privacy.html', 'press.html']
writeFileSync(resolve(docs, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}/${u}</loc></url>`).join('\n')}\n</urlset>\n`)
writeFileSync(resolve(docs, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`)
writeFileSync(resolve(docs, 'vercel.json'), JSON.stringify({
  headers: [
    { source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
    ] },
    { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }
  ]
}, null, 2) + '\n')
console.log('site: wrote', urls.length + 1, 'pages')
