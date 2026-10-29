# Pullshelf launch kit

Drafts only. Nothing here has been posted. Every claim below is true today; keep it that way when you edit.

Links to use:
- Site: https://pullself.vercel.app (note the spelling Vercel gave us; swap everywhere if you attach a custom domain)
- Repo: https://github.com/yogeshvar/pullshelf
- Install: `brew install --cask yogeshvar/pullshelf/pullshelf`
- Demo video (scripted, not a screen recording): `docs/assets/pullshelf-demo.mp4`, GIF: `docs/assets/pullshelf-demo.gif`
- Screenshots: `docs/assets/pullshelf-dark.png`, `docs/assets/pullshelf-light.png`

## Before you post anything (do these first)

1. **Say the limits yourself, up front.** Apple Silicon only, macOS 13+, not notarized (first launch needs Open Anyway). People forgive this if you say it first and punish it if they find it.
2. **Try the install on a clean account or Mac** (Homebrew and the zip). The first five minutes decide everything.
3. **Check the site on your phone** once, in both themes.
4. **Know the weak spots:** the domain reads `pullself` (typo), there is no auto-update yet, there is no Intel build. If asked, answer plainly.
5. **Be there for 24 hours** after posting. Reply to every comment; fix what people report.
6. Consider notarizing first ($99/yr Apple Developer Program). It removes the biggest friction for a wider audience. Optional for a small first launch.

## One-liners and angles

- **Tagline:** A pull-down shelf for your Mac. Terminal, clipboard history, files and notes, one gesture away.
- **Short pitch (under 160 chars):** Free, open-source Mac shelf: pull down from the top for a terminal, clipboard history, a file drop zone and notes.
- **Angle 1 (terminal people):** a terminal that lives where your mouse already is, with clipboard and notes next to it. Run Claude Code or Codex without a dedicated window.
- **Angle 2 (privacy):** no telemetry, no account, no network calls from the app. MIT licensed.
- **Angle 3 (maker story):** built with Claude Code and subagents; started from wanting the shelf idea of a paid app I could not afford, and rebuilt it open for the terminal era. (Your words, your story: edit freely.)

## Show HN

**Title:** Show HN: Pullshelf, a pull-down Mac shelf with a terminal, clipboard history and notes

**Text:**
> I wanted a shelf that slides down from the top of the screen with the things I keep reaching for: a terminal (I run Claude Code and Codex all day), clipboard history, a place to park files, and quick notes.
>
> Pullshelf is that. Pull down with two fingers at the top edge (or press Cmd+Shift+L), use it, let go. The terminal is a real PTY under your own login shell. Clipboard, notes and file references are stored locally; there is no telemetry, no account and the app makes no network calls.
>
> It is MIT licensed. Built with Electron, a small Swift helper for the gesture, and a lot of tests (100% coverage of the TypeScript, plus a script that drives the real app).
>
> Honest limits: Apple Silicon only, macOS 13+, not notarized yet (first launch needs System Settings > Privacy & Security > Open Anyway), no auto-update yet. `brew install --cask yogeshvar/pullshelf/pullshelf` or the zip from GitHub.
>
> Repo: https://github.com/yogeshvar/pullshelf  Site: https://pullself.vercel.app
>
> I'd love feedback on the gesture feel and on what the terminal pane is missing.

Tips: post Tue-Thu, about 8-10am US Eastern. Do not ask friends to upvote (HN penalizes it). Link the repo or site, not a landing page behind a form.

## Product Hunt

- **Name:** Pullshelf
- **Tagline (60 chars max):** Pull down a shelf of terminal, clipboard and notes
- **Description (260 chars):** A free, open-source pull-down shelf for macOS. Pull from the top of the screen for a real terminal, clipboard history, a file drop zone and notes. No account, no telemetry. Works with Claude Code and Codex.
- **Topics:** Mac, Productivity, Developer Tools, Open Source
- **Gallery:** demo mp4/GIF first, then dark and light screenshots, then the gesture section of the site.
- **First comment (maker):** the Show HN text above, shortened, ending with a question.
- **Pricing field:** Free.
Prepare one day ahead; schedule for 12:01am Pacific. Do not buy upvotes or run vote rings.

## Reddit (read each subreddit's rules and self-promotion limits first; many ban or limit app posts)

**r/macapps** (apps welcome; use their post format):
> **Pullshelf: free, open-source pull-down shelf (terminal + clipboard + files + notes)**
> I built a shelf that slides down from the top of the screen... [2-3 sentences, demo GIF]. MIT, no telemetry, Apple Silicon, macOS 13+. Not notarized yet, so first launch needs Open Anyway. Feedback welcome: what would make you use this daily?

**r/commandline or r/macOS:** only if the rules allow project posts; lead with the terminal angle, not the product.

Do not post the same text in many subreddits on the same day.

## X / Bluesky / Mastodon thread

1. I built a pull-down shelf for my Mac. Pull from the top of the screen: terminal, clipboard history, files, notes. Free and open source. [demo video]
2. The terminal is a real PTY. I run Claude Code in it. Send a clip or note straight into it.
3. No account, no telemetry, no network calls from the app. MIT.
4. Honest limits: Apple Silicon, macOS 13+, not notarized yet.
5. `brew install --cask yogeshvar/pullshelf/pullshelf` or https://pullself.vercel.app

## LinkedIn

> I just open-sourced Pullshelf, a pull-down shelf for the Mac... [3 short paragraphs: why, what, what I learned building it with Claude Code]. Link in comments.

## Blog / dev.to / Hashnode

Update your existing post on yogeshvar.github.io (it still says Perch). Suggested addition: a short "Update: renamed to Pullshelf" note with new links, then crosspost the full post to dev.to with the canonical URL pointing at your blog.
Possible follow-up posts (real material you already have): "Three bugs that taught me about macOS gestures" (natural scrolling inversion, windows can't sit above the screen, a native crash on file drop), "Testing an Electron app to 100% coverage with node:sqlite", "Building with Claude Code subagents: what worked and what I had to check myself".

## Directories and lists (free, slow, durable)

- AlternativeTo (list as an alternative to other shelf and clipboard apps)
- MacUpdate, Softpedia-style app directories
- awesome-mac and similar GitHub lists (open a PR following their format)
- Homebrew: the cask lives in your own tap; the official cask repo requires notarization
- GitHub: add topics (`macos`, `electron`, `clipboard-manager`, `terminal`, `productivity`), a social preview image (use `docs/assets/og.png`), and a short description

## Outreach emails (a few, personal, no mass blast)

> Subject: A small open-source Mac shelf you might find useful
> Hi [name], I read your [specific post/issue] on [topic]. I built Pullshelf, a free pull-down shelf (terminal, clipboard, files, notes) for Mac developers who live in the terminal. No account or telemetry. Here's a 20-second demo: [link]. No ask beyond: if it's useful, I'd value your honest feedback. Thanks, Yogeshvar

Target: indie Mac app newsletters, Mac/dev YouTubers and bloggers who cover utilities, people who wrote about similar shelf apps.

## Timeline suggestion

| When | What |
| --- | --- |
| Day -3 | Clean-machine install test; fix anything; update blog post; GitHub topics/social preview |
| Day -1 | Prepare Product Hunt; write Show HN and Reddit text; schedule nothing else |
| Day 0 (Tue-Thu) | Show HN in the morning US Eastern; Product Hunt at 12:01am PT; X/Bluesky thread; reply to everyone |
| Day 1-3 | Reddit (one subreddit per day), LinkedIn, dev.to crosspost; ship fixes people asked for, note them in the changelog |
| Week 2 | Directories, outreach emails, a follow-up blog post; look at Vercel Analytics and GitHub stars/issues |

## What to measure (no vanity)

GitHub release downloads, brew installs (public analytics), stars, issues opened, Vercel Analytics visitors and the `download_zip` and `copy_brew` events, and replies that say "I use this daily".
