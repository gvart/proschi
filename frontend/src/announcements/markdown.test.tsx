import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

const html = (source: string, name = 'Ada') => renderToStaticMarkup(<Markdown source={source} values={{ name, credits: '150' }} />);

describe('announcement Markdown', () => {
  it('renders the subset', () => {
    expect(html('## New\n\n- **{{credits}} credits**\n- *it* and `code`\n\nHi {{name}}\nnext line')).toBe(
      '<p class="ann-md-heading">New</p><ul><li><strong>150 credits</strong></li><li><em>it</em> and <code>code</code></li></ul><p>Hi Ada<br/>next line</p>',
    );
    expect(html('[Plans](https://proschi.app/pricing/)')).toBe('<p><a href="https://proschi.app/pricing/" target="_blank" rel="noreferrer">Plans</a></p>');
  });

  it('never renders HTML, unsafe links, or Markdown from a placeholder', () => {
    expect(html('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(html('[x](javascript:alert(1))')).not.toContain('href');
    expect(html('Hi {{name}}', '[x](https://evil.example) <b>')).toBe('<p>Hi [x](https://evil.example) &lt;b&gt;</p>');
  });
});
