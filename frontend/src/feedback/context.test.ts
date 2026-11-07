import { describe, expect, it } from 'vitest';
import { collectContext, describeBrowser, formatSize, MAX_FILE, screenshotProblem } from './context';

describe('feedback context', () => {
  it('takes the page without its query, the user agent and the window size', () => {
    const win = { location: { pathname: '/app/', hash: '#/x', search: '?token=secret' }, innerWidth: 1280, innerHeight: 800, navigator: { userAgent: 'UA' } } as unknown as Window;
    expect(collectContext(win)).toEqual({ path: '/app/#/x', userAgent: 'UA', viewport: '1280×800' });
  });

  it('names the browser and system', () => {
    expect(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe('Chrome 130 on macOS');
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toBe('Edge 130 on Windows');
    expect(describeBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari 18 on iOS');
    expect(describeBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe('Firefox 132 on Linux');
    expect(describeBrowser('curl/8')).toBe('Unknown browser');
  });

  it('accepts up to 3 PNG, JPEG or WebP screenshots of 5 MB', () => {
    expect(screenshotProblem({ type: 'image/png', size: 100 }, 0)).toBeUndefined();
    expect(screenshotProblem({ type: 'image/webp', size: MAX_FILE }, 2)).toBeUndefined();
    expect(screenshotProblem({ type: 'image/png', size: 100 }, 3)).toMatch(/At most 3/);
    expect(screenshotProblem({ type: 'image/gif', size: 100 }, 0)).toMatch(/PNG, JPEG or WebP/);
    expect(screenshotProblem({ type: 'image/svg+xml', size: 100 }, 0)).toMatch(/PNG, JPEG or WebP/);
    expect(screenshotProblem({ type: 'image/jpeg', size: MAX_FILE + 1 }, 0)).toMatch(/5 MB/);
  });

  it('formats sizes', () => {
    expect(formatSize(300)).toBe('1 KB');
    expect(formatSize(200 * 1024)).toBe('200 KB');
    expect(formatSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});
