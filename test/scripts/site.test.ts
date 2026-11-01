import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const docs = (name: string) => readFileSync(resolve(import.meta.dirname, '../../docs', name), 'utf8')

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
})
