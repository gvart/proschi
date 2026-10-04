import { describe, expect, it } from 'vitest';
import { EXPORT_CSP, parse } from '../src/proschi';
import { renderHtml, renderSvgs } from '../src/render';
import { renderHldHtml } from '../src/render/hld';
import { renderPreviewContent } from '../src/render/preview';

/** Names, labels and payloads come from the document; none of them may become markup. */
const HOSTILE = `title "<script>alert(1)</script>"
evil "<tspan onload=alert(1)>x</tspan>" [REST API] @t "<img src=x onerror=alert(2)>"
<tspan "x" [REST API]
db "<tspan>DB" [PostgreSQL]
evil -> db : <svg onload=alert(3)>
usecase "<b>Use</b>" {
  evil -> db : GET /x?<script>
  db --> evil : 200 <tspan font-weight="700">injected</tspan>
}
`;

describe('rendering hostile documents', () => {
  it('escapes every name and label in the SVGs, including ones starting with <tspan', async () => {
    const { diagram } = parse(HOSTILE);
    const { architecture, scenarios } = await renderSvgs(diagram);
    for (const svg of [architecture, ...scenarios.map((s) => s.svg)]) {
      expect(svg).not.toMatch(/<(script|img|b)\b/i);
      expect(svg).not.toMatch(/<svg onload/i);
      expect(svg).not.toMatch(/<tspan (onload|font-weight="700">injected)/);
      expect(svg).not.toContain('<tspan>DB');
    }
    expect(architecture).toContain('&lt;tspan');
  });

  it('gives the HTML pages a CSP that blocks scripts', async () => {
    const { diagram } = parse(HOSTILE);
    const rendered = await renderSvgs(diagram, true);
    for (const html of [renderHtml(diagram, rendered), renderHldHtml(diagram, rendered)]) {
      expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<img/i);
    }
    expect(EXPORT_CSP).toContain("default-src 'none'");
    expect(EXPORT_CSP).not.toContain('script-src');
  });

  it('escapes the preview panel, including error messages', async () => {
    const ok = await renderPreviewContent(HOSTILE);
    expect(ok.html).not.toMatch(/<(script|img|b)\b/i);
    const broken = await renderPreviewContent('a "<img src=x onerror=alert(1)>\n');
    expect(broken.html).not.toMatch(/<img/i);
  });
});
