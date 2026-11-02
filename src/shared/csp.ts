// The shelf's Content Security Policy. Only the bundled scripts may run, so text that ends up in the page
// (a clip, a note, a file name) can never execute. xterm.js injects <style> tags, hence 'unsafe-inline' for styles.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

export function withCsp(html: string): string {
  if (!html.includes('<head>')) throw new Error('index.html has no <head> to hold the Content Security Policy')
  return html.replace(
    '<head>',
    `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`
  )
}

// Added at build time only: the dev server's React Refresh preamble is an inline script.
export function cspPlugin() {
  return {
    name: 'pullshelf-csp',
    apply: 'build' as const,
    transformIndexHtml: (html: string) => withCsp(html)
  }
}
