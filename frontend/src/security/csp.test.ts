import { describe, expect, it } from 'vitest';
import landingHtml from '../../index.html?raw';
import appHtml from '../../app/index.html?raw';
import practiceHtml from '../../practice/index.html?raw';
import envProduction from '../../.env.production?raw';

/** The CSP meta of a page, as directive → sources. */
function csp(html: string): Map<string, string[]> {
  const meta = /<meta\s+http-equiv="%VITE_CSP_HTTP_EQUIV%"\s+content="([^"]+)"/.exec(html);
  if (!meta) throw new Error('no CSP meta');
  return new Map(
    meta[1]
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...sources]) => [name, sources]),
  );
}

const PAGES = { landing: landingHtml, app: appHtml, practice: practiceHtml };

describe('Content-Security-Policy', () => {
  it('is enforced in production builds', () => {
    expect(envProduction).toMatch(/^VITE_CSP_HTTP_EQUIV=Content-Security-Policy$/m);
  });

  for (const [name, html] of Object.entries(PAGES)) {
    it(`${name}: scripts only from the site, no plugins, no inline scripts`, () => {
      const policy = csp(html);
      expect(policy.get('default-src')).toEqual(["'self'"]);
      expect(policy.get('script-src')).toEqual(["'self'"]);
      expect(policy.get('object-src')).toEqual(["'none'"]);
      expect(policy.get('base-uri')).toEqual(["'self'"]);
      expect(policy.get('form-action')).toEqual(["'none'"]);
      expect(policy.get('connect-src')).toEqual(["'self'"]);
      expect(policy.get('worker-src')).toEqual(["'self'", 'blob:']);
      // The meta must come before any script so it applies to all of them.
      const head = html.slice(0, html.indexOf('</head>'));
      const firstScript = head.indexOf('<script');
      if (firstScript >= 0) expect(head.indexOf('%VITE_CSP_HTTP_EQUIV%')).toBeLessThan(firstScript);
      expect(html).not.toMatch(/<script>(?!<\/script>)/);
      expect(html).not.toMatch(/\son[a-z]+="/);
      expect(html).toContain('<meta name="referrer" content="strict-origin-when-cross-origin" />');
    });
  }

  it('loads styles and fonts from the site only', () => {
    // Fonts are self-hosted (src/design/tokens.css); no page talks to a font CDN.
    // The landing page's live demo is the editor (CodeMirror's runtime <style> elements, React Flow's style attributes).
    expect(csp(landingHtml).get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp(landingHtml).get('font-src')).toEqual(["'self'"]);
    for (const html of [appHtml, practiceHtml]) {
      expect(csp(html).get('style-src')).toEqual(["'self'", "'unsafe-inline'"]); // CodeMirror's runtime <style> elements
      expect(csp(html).get('font-src')).toEqual(["'self'", 'data:']);
    }
  });
});
