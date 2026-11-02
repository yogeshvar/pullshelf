import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const docsDir = resolve(import.meta.dirname, '../../docs')
const docs = (name: string) => readFileSync(resolve(docsDir, name), 'utf8')

function contrastRatio(fg: string, bg: string): number {
  const toLum = (hex: string) => {
    const h = hex.replace('#', '')
    const channels = [0, 2, 4].map((i) => {
      const c = Number.parseInt(h.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  }
  const [a, b] = [toLum(fg), toLum(bg)].sort((x, y) => y - x)
  return (a! + 0.05) / (b! + 0.05)
}

describe('the marketing site', () => {
  it('leads the home page with the terminal', () => {
    const html = docs('index.html')
    const h1 = html.match(/<h1>[\s\S]*?<\/h1>/)?.[0] ?? ''
    expect(h1.toLowerCase()).toMatch(/terminal/)
    expect(h1).not.toMatch(/missing <em>shelf/i)
  })

  it('serves /press without a .html suffix', () => {
    const vercel = JSON.parse(docs('vercel.json')) as { rewrites?: { source: string; destination: string }[] }
    expect(vercel.rewrites).toEqual(
      expect.arrayContaining([{ source: '/press', destination: '/press.html' }])
    )
  })

  it('has a terms page linked from the footer and clean URL rewrite', () => {
    const terms = docs('terms.html')
    expect(terms).toMatch(/Terms/i)
    expect(terms).toMatch(/MIT/i)
    expect(terms).toMatch(/as is/i)
    expect(docs('index.html')).toMatch(/href="terms\.html"/)
    const vercel = JSON.parse(docs('vercel.json')) as { rewrites?: { source: string; destination: string }[] }
    expect(vercel.rewrites).toEqual(
      expect.arrayContaining([{ source: '/terms', destination: '/terms.html' }])
    )
    expect(docs('sitemap.xml')).toContain('terms.html')
  })

  it('keeps light-theme accent text at WCAG AA against the page background', () => {
    const css = docs('assets/site.css')
    const light = css.match(/:root\[data-theme="light"\]\{[^}]+\}/)?.[0] ?? ''
    const accent = light.match(/--accent:(#[0-9a-fA-F]{6})/)?.[1]
    const bg = light.match(/--bg:(#[0-9a-fA-F]{6})/)?.[1]
    expect(accent).toBeTruthy()
    expect(bg).toBeTruthy()
    expect(contrastRatio(accent!, bg!)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the social preview image under 300KB', () => {
    const bytes = statSync(resolve(docsDir, 'assets/og.png')).size
    expect(bytes).toBeLessThan(300 * 1024)
  })

  it('ships privacy, robots, sitemap, favicon meta, and a single primary download CTA', () => {
    expect(docs('privacy.html')).toMatch(/no telemetry/i)
    expect(docs('robots.txt')).toMatch(/Sitemap:/)
    expect(docs('sitemap.xml')).toMatch(/urlset/)
    expect(docs('index.html')).toMatch(/rel="icon"/)
    expect(docs('index.html')).toMatch(/og:image/)
    expect(docs('index.html')).toMatch(/property="og:title"/)
    const ctas = docs('index.html').match(/class="btn primary"[^>]*>Download for Mac/g) ?? []
    expect(ctas.length).toBeGreaterThanOrEqual(1)
  })

  it('gives real images an alt attribute', () => {
    const pages = ['index.html', 'features.html', 'download.html', 'press.html', 'privacy.html', 'terms.html', '404.html']
    for (const page of pages) {
      const html = docs(page)
      const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0])
      for (const img of imgs) {
        expect(img, `${page}: ${img}`).toMatch(/\balt=/)
      }
    }
  })
})
