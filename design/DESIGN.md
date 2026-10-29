# Pullshelf site: design direction (draft for review)

Not published (lives in `design/`, outside `docs/`). Once you approve, the build follows this file.

## Idea
The page behaves like the product. A thin menu-bar strip sits at the top of the viewport; the hero **is** the pull-down: the real Pullshelf shelf slides out over a soft desktop and its four panes come alive (terminal typing, a clip landing, a file dropping, a note appearing). Everything below keeps that physical feel: surfaces that slide, settle and fold, never fade-in-from-below confetti.

## Look
- **Dark-first**, warm near-black `#121110`, with a real light theme (`#f7f4ee`) behind a toggle that also re-themes the live shelf mock. Same tokens as the app (`src/styles.css`), so site and product match.
- **One accent**: vermilion `#e8785f` on dark, `#c8442f` on light. Used only for the live dot, the primary button, selected states and one highlighted word per headline.
- **Pane colours** reused from the app (terminal ink, clip grey, files paper, notes cream) as the four section identities.
- **Type** (self-hosted WOFF2, open licenses): display = Instrument Serif (headlines, italic for the one accent word); text = Inter; mono = JetBrains Mono (terminal, commands). Scale 12/14/16/20/28/44/72/112 px, tight tracking and 0.95 line height on display, 1.6 on body.
- **Space**: 8px grid, 1200px max, 120px section rhythm desktop / 72px phone, 16px side gutter minimum.
- **Surfaces**: hairline 1px rules, 14px radius on the shelf mock, 10px on cards, soft long shadows, subtle grain overlay (static, tiny PNG), no gradients except one slow ambient glow behind the hero.

## Motion (all of it has a reduced-motion twin)
1. **Hero pull**: on load the shelf drops with an ease-out + 6px overshoot settle (~900ms); the panes then run a 10s looping script (type, clip, drop, note). Scroll nudges the shelf up/down as if still attached to the top edge.
2. **Four panes**: pinned scroll scene; each pane expands to full width in turn with its own mini-demo and caption, then folds to a rail (same rail the app uses).
3. **Gesture**: two-finger trackpad illustration; scroll position drives finger travel and shelf reveal 1:1.
4. **Theme toggle**: the page and the live mock cross-fade in 250ms.
5. **Micro**: magnetic primary button, copy-to-clipboard with a "Copied" morph, link underlines that draw in, number counters only for real facts (e.g. 4 panes, 0 telemetry).
- Engine: GSAP + ScrollTrigger + Lenis, vendored and pinned. Rules: transform/opacity only, no layout thrash, `will-change` only during a tween, `prefers-reduced-motion` = static final states, no Lenis, no pinning; JS off = fully readable content.

## Page map
Home (hero, four panes, gesture, privacy/MIT, themes, support, install, FAQ) · Features · Download · Support ("Free. Pay what feels right.") · Changelog · Privacy · Press · 404.

## Copy rules
First person plural is avoided; plain, specific, short. No invented proof (no reviews, counts, logos). States macOS 13+, Apple Silicon, current Gatekeeper reality. Headline candidates: "Your Mac's missing shelf." / "Pull down. Everything you keep reaching for." / "A terminal, a clipboard, a drop zone and notes. One pull away."

## Budgets
LCP < 2.0s, CLS ~0, total JS < 120 KB gz (hero < 60), fonts < 180 KB, hero video fallback < 1.5 MB, Lighthouse mobile 95+ in all four categories.

## Open choices for you
1. Dark-first (recommended) or light-first?
2. Display serif (Instrument Serif, editorial) or a grotesk (Geist, more "tool")?
3. Headline pick from the three above, or write your own.
