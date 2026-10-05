import { afterEach, describe, expect, it, vi } from 'vitest'
import { issueHref } from './ErrorBoundary'

describe('issueHref', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('files a GitHub issue with the error, the page and the browser, and nothing else', () => {
    vi.stubGlobal('location', { pathname: '/app/' })
    vi.stubGlobal('navigator', { userAgent: 'TestBrowser/1.0' })
    const error = new Error('Cannot read properties of undefined')
    error.stack = 'Error: Cannot read properties of undefined\n    at Canvas (canvas.tsx:1:1)'
    const url = new URL(issueHref('the editor', error))
    expect(url.origin + url.pathname).toBe('https://github.com/gvart/proschi/issues/new')
    expect(url.searchParams.get('title')).toBe('Crash in the editor: Cannot read properties of undefined')
    const body = url.searchParams.get('body')!
    expect(body).toContain('at Canvas (canvas.tsx:1:1)')
    expect(body).toContain('Page: /app/')
    expect(body).toContain('Browser: TestBrowser/1.0')
  })

  it('keeps the URL short for a huge stack', () => {
    vi.stubGlobal('location', { pathname: '/practice/' })
    vi.stubGlobal('navigator', { userAgent: 'x' })
    const error = new Error('x'.repeat(500))
    error.stack = 'y'.repeat(100_000)
    expect(issueHref('practice', error).length).toBeLessThan(6000)
  })
})
