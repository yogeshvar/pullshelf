import { describe, expect, it } from 'vitest'
import { CONTENT_SECURITY_POLICY, cspPlugin, withCsp } from '../../src/shared/csp'

const directive = (name: string) =>
  CONTENT_SECURITY_POLICY.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `))

describe('content security policy', () => {
  it('only runs the app\'s own bundled scripts: no inline code, no eval', () => {
    expect(directive('script-src')).toBe("script-src 'self'")
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval')
  })

  it('denies everything not listed, and blocks plugins, base rewrites, forms and network calls', () => {
    expect(directive('default-src')).toBe("default-src 'none'")
    expect(directive('object-src')).toBe("object-src 'none'")
    expect(directive('base-uri')).toBe("base-uri 'none'")
    expect(directive('form-action')).toBe("form-action 'none'")
    expect(directive('connect-src')).toBe("connect-src 'none'")
  })

  it('allows the data: thumbnails the clipboard and files panes show', () => {
    expect(directive('img-src')).toBe("img-src 'self' data:")
  })

  it('adds the policy as the first tag in <head>', () => {
    const html = '<!doctype html><html><head>\n<meta charset="UTF-8" /></head><body></body></html>'
    const out = withCsp(html)
    expect(out).toContain(`<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`)
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('charset'))
  })

  it('refuses to build a page it cannot protect', () => {
    expect(() => withCsp('<html><body></body></html>')).toThrow(/no <head>/)
  })

  it('is a build-only Vite plugin, so the dev server keeps hot reload', () => {
    const plugin = cspPlugin()
    expect(plugin).toMatchObject({ name: 'pullshelf-csp', apply: 'build' })
    expect(plugin.transformIndexHtml('<head></head>')).toContain('Content-Security-Policy')
  })
})
