import { describe, expect, it } from 'vitest';
import landingHtml from '../../index.html?raw';
import { examples, parse } from '../dsl';
import { decodeShareLink } from '../playground/share';
import { highlightLine } from './highlight';
import { format } from '../dsl/format';
import { APP_PATH, HERO_USE_CASE, editorLink, exampleLink } from './links';
import { heroScenarios, stepLines } from './player';
import { tallLayout, wideLayout } from './diagramLayout';

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** The Proschi text exactly as the landing page shows it in the hero. */
function heroSource(): string {
  const m = landingHtml.match(/<pre[^>]*id="hero-source"[^>]*><code>([\s\S]*?)<\/code><\/pre>/);
  if (!m) throw new Error('hero source not found in index.html');
  expect(m[1]).not.toMatch(/<[a-z]/i); // plain text only, so what you see is what parses
  return decodeEntities(m[1]);
}

/** Every highlighted snippet on the page. */
function snippets(): string[] {
  return [...landingHtml.matchAll(/<pre[^>]*data-proschi[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => decodeEntities(m[1]));
}

describe('landing page hero', () => {
  it('shows valid Proschi with no diagnostics', () => {
    const { diagram, diagnostics } = parse(heroSource());
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.every((n) => !n.implicit)).toBe(true);
    expect(diagram.nodes.map((n) => n.id).sort()).toEqual(['api', 'db', 'events', 'vpc', 'web']);
    expect(diagram.edges).toHaveLength(3);
  });

  it('names the use case the way the editor does in links', () => {
    const { diagram } = parse(heroSource());
    expect(diagram.useCases.map((u) => [u.id, u.name])).toEqual([[HERO_USE_CASE.id, HERO_USE_CASE.name]]);
  });

  it('animates the same scenarios and steps as the source declares', () => {
    const source = heroSource();
    const { diagram } = parse(source);
    const [useCase] = diagram.useCases;
    expect(useCase.scenarios.map((s) => [s.id, s.name, s.outcome])).toEqual(heroScenarios.map((s) => [s.id, s.name, s.outcome]));

    for (const [i, hero] of heroScenarios.entries()) {
      const parsed = useCase.scenarios[i].steps;
      const requests = hero.steps.filter((s) => s.kind !== 'response');
      expect(parsed.map((s) => [s.fromServiceId, s.toServiceId, !!s.failed])).toEqual(
        requests.map((s) => [s.from, s.to, s.kind === 'failed']),
      );
      const reply = hero.steps.find((s) => s.kind === 'response')!;
      expect(String(parsed[0].statusCode)).toBe(reply.label.slice(0, 3));
      expect(!!reply.error).toBe(parsed[0].statusCode! >= 400);

      const lines = stepLines(source.split('\n'), hero);
      expect(lines.every((l) => l > 0), hero.name).toBe(true);
      expect(new Set(lines).size).toBe(hero.steps.length);
    }
  });

  it('every SVG edge the player uses exists', () => {
    expect(landingHtml).toContain('id="fail-mark"');
    expect(landingHtml).toContain('id="player-scenarios"');
    expect(landingHtml).toContain('id="arrow-error"');
    for (const step of heroScenarios.flatMap((s) => s.steps)) {
      expect(landingHtml).toContain(`id="${step.edge}"`);
      expect(landingHtml).toContain(`id="node-${step.from}"`);
      expect(landingHtml).toContain(`id="node-${step.to}"`);
    }
  });

  it('the wide diagram layout matches the SVG in index.html', () => {
    expect(landingHtml).toContain(`viewBox="${wideLayout.viewBox}"`);
    for (const [id, attrs] of Object.entries(wideLayout.elements)) {
      const tag = landingHtml.match(new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`))?.[0];
      expect(tag, id).toBeTruthy();
      for (const [name, value] of Object.entries(attrs)) {
        if (name === 'text-anchor' && value === 'start') continue;
        expect(tag, `${id} ${name}`).toContain(`${name}="${value}"`);
      }
    }
    expect(Object.keys(tallLayout.elements).sort()).toEqual(Object.keys(wideLayout.elements).sort());
  });

  it('the share sample names a real scenario of the hero use case', () => {
    const sample = landingHtml.match(/&amp;uc=([\w-]+)&amp;alt=([\w-]+)&amp;step=\d+/);
    expect(sample?.[1]).toBe(HERO_USE_CASE.id);
    expect(parse(heroSource()).diagram.useCases[0].scenarios.map((s) => s.id)).toContain(sample?.[2]);
  });

  it('links into playback of the hero use case', () => {
    const link = editorLink(heroSource(), { useCase: HERO_USE_CASE.id, step: 1 });
    expect(link.startsWith(`${APP_PATH}#code=`)).toBe(true);
    expect(decodeShareLink(link.slice(APP_PATH.length))).toEqual({
      source: heroSource(),
      playback: { useCase: HERO_USE_CASE.id, step: 1 },
    });
  });
});

describe('landing page snippets', () => {
  it('only use syntax the parser accepts', () => {
    const all = snippets();
    expect(all.length).toBeGreaterThanOrEqual(3);
    // The "how it works" snippets are parts of one document.
    const [architecture, ...useCases] = all.slice(1);
    const combined = [architecture, 'events "OrderEvents" [Kafka]', ...useCases].join('\n\n');
    expect(parse(combined).diagnostics).toEqual([]);
  });

  it('highlights alt and failed calls', () => {
    const cls = (line: string) => highlightLine(line).filter((seg) => seg.cls).map((seg) => [seg.text.trim(), seg.cls]);
    expect(cls('  } alt "Out of stock" {')).toEqual([['} alt', 'keyword'], ['"Out of stock"', 'string']]);
    expect(cls('  api -x db : INSERT order')).toEqual([['-x', 'arrow']]);
    expect(cls('  api -> xray')).toEqual([['->', 'arrow']]);
    expect(cls('import "infra.proschi"')).toEqual([['import', 'keyword'], ['"infra.proschi"', 'string']]);
    expect(cls('  } alt "Missing" when "no such order" {')).toEqual([['} alt', 'keyword'], ['"Missing"', 'string'], ['when', 'keyword'], ['"no such order"', 'string']]);
    expect(cls('  when -> b')).toEqual([['->', 'arrow']]);
  });

  it('are in canonical format', () => {
    for (const source of snippets()) expect(format(`${source}\n`)).toBe(`${source}\n`);
  });

  it('highlighter keeps the text intact', () => {
    for (const source of snippets()) {
      for (const line of source.split('\n')) {
        expect(highlightLine(line).map((s) => s.text).join('')).toBe(line);
      }
    }
  });
});

describe('example links', () => {
  it.each(examples.map((e) => [e.id, e.source]))('%s decodes back to the example source', (id, source) => {
    const link = exampleLink(id);
    expect(link).not.toBeNull();
    expect(link!.startsWith(`${APP_PATH}#code=`)).toBe(true);
    expect(decodeShareLink(link!.slice(APP_PATH.length))?.source).toBe(source);
  });

  it('the page lists every example, and nothing else', () => {
    const ids = [...landingHtml.matchAll(/data-example="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(examples.map((e) => e.id));
    expect(exampleLink('nope')).toBeNull();
  });
});

describe('old share links', () => {
  it('are forwarded to the editor before anything else runs', () => {
    const head = landingHtml.slice(0, landingHtml.indexOf('</head>'));
    const firstScript = head.indexOf('<script');
    expect(firstScript).toBeGreaterThan(-1);
    expect(firstScript).toBeLessThan(head.indexOf('<link'));
    expect(head).toContain("location.hash.indexOf('#code=') === 0");
    expect(head).toContain("location.replace('./app/' + location.hash)");
  });
});
