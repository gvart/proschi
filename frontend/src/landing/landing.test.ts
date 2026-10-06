import { describe, expect, it } from 'vitest';
import landingHtml from '../../index.html?raw';
import mainSource from './main.ts?raw';
import legacyRedirect from '../../public/legacy-redirect.js?raw';
import { examples, parse } from '../dsl';
import { urlShortenerExample } from '../dsl/examples';
import { defaultEngine } from '../hld/engine';
import { problems } from '../practice/catalog';
import { decodeShareLink } from '../playground/share';
import { exampleFromSearch } from '../playground/exampleLink';
import { highlightLine, highlightLines } from './highlight';
import { format } from '../dsl/format';
import { APP_PATH, editorLink, exampleLink } from './links';
import { fillPracticePlaceholders, listingsFrom, practiceListHtml } from './practiceList';
import { fillPrepPlaceholders, prepStagesHtml } from './prep';
import { ROADMAP, roadmapFor } from '../practice/roadmap';
import prebuiltListings from 'virtual:practice-listings';
import { DEMO_SCRIPT, DEMO_SOURCE, DEMO_USE_CASE, sourceAt } from '../components/Demo/demoScript';

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** The Proschi text the hero's static poster shows before the live demo loads. */
function posterSource(): string {
  const m = landingHtml.match(/<pre[^>]*id="demo-source"[^>]*><code>([\s\S]*?)<\/code><\/pre>/);
  if (!m) throw new Error('demo poster source not found in index.html');
  expect(m[1]).not.toMatch(/<[a-z]/i); // plain text only, so what you see is what parses
  return decodeEntities(m[1]);
}

/** Every highlighted snippet on the page, apart from the poster. */
function snippets(): string[] {
  return [...landingHtml.matchAll(/<pre[^>]*data-proschi[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)]
    .filter((m) => !m[0].includes('id="demo-source"'))
    .map((m) => decodeEntities(m[1]));
}

/** The architecture part of the demo: everything typed before the use case. */
const DEMO_ARCHITECTURE = sourceAt({ index: DEMO_SCRIPT.findIndex((s) => s.kind === 'type' && s.text.includes('usecase')), typed: 0 });

describe('landing page hero', () => {
  it('the poster shows exactly the document the live demo ends with', () => {
    expect(posterSource()).toBe(DEMO_SOURCE);
  });

  it('the demo document is valid Proschi with the use case and both scenarios', () => {
    const { diagram, diagnostics } = parse(DEMO_SOURCE);
    expect(diagnostics).toEqual([]);
    expect(diagram.useCases.map((u) => [u.id, u.name])).toEqual([[DEMO_USE_CASE.id, DEMO_USE_CASE.name]]);
    expect(diagram.useCases[0].scenarios.map((s) => [s.name, s.outcome])).toEqual([
      ['Placed', 'success'],
      ['DB down', 'error'],
    ]);
  });

  it('"Open in the editor" links decode back to the demo', () => {
    const link = editorLink(DEMO_SOURCE);
    expect(link.startsWith(`${APP_PATH}#code=`)).toBe(true);
    expect(decodeShareLink(link.slice(APP_PATH.length))).toEqual({ source: DEMO_SOURCE });
  });

  it('offers two equally weighted paths: design a system, prepare for interviews', () => {
    const built = fillPrepPlaceholders(landingHtml, roadmapFor(ROADMAP, prebuiltListings.map((p) => p.id)));
    const hero = built.slice(built.indexOf('<section class="hero"'), built.indexOf('</section>'));
    const paths = [...hero.matchAll(/<a class="ps-card ps-card--\w+ ps-card--interactive path" href="([^"]+)">[\s\S]*?<span class="path__title">([^<]+)<\/span>/g)].map((m) => [m[2], m[1]]);
    expect(paths).toEqual([
      ['Design a system', './app/'],
      ['Prepare for interviews', './practice/#/roadmap'],
    ]);
    expect(hero).not.toContain('<!--roadmap:');
    // The live demo stays.
    expect(hero).toContain('id="live-demo"');
  });

  it('has no "How it works" section repeating the demo', () => {
    expect(landingHtml).not.toMatch(/How it works|class="hop/);
  });

  it('links the Arcade', () => {
    expect(landingHtml).toMatch(/<section class="story story--arcade"[\s\S]*href="\.\/practice\/#\/arcade"/);
  });

  it('loads the demo island lazily, after a static first paint', () => {
    expect(mainSource).toMatch(/import\('\.\/LandingDemo'\)/);
    // Nothing React in the page's own bundle.
    expect(mainSource).not.toMatch(/from '\.\/LandingDemo'|from 'react|Demo\/LiveDemo/);
    expect(landingHtml).toMatch(/<div id="live-demo" class="demo-host">\s*<div class="demo" data-mode="poster">/);
  });
});

describe('test results on the page', () => {
  // The rows are what the simulation really says about the URL shortener example.
  const diagram = parse(urlShortenerExample).diagram;
  const results = defaultEngine.runTests(diagram, defaultEngine.analyze(diagram));

  it('match the engine', () => {
    const rows = [...landingHtml.matchAll(/<li data-result="([^"]+)"><b>([^<]+)<\/b><span>([^<]+)<\/span><\/li>/g)];
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const [, id, name, message] of rows) {
      const result = results.find((r) => r.id === decodeEntities(id));
      expect(result, id).toBeDefined();
      expect([decodeEntities(name), decodeEntities(message), result!.passed]).toEqual([result!.name, result!.message, true]);
    }
    expect(landingHtml).toContain(`${rows.length} / ${rows.length} pass`);
  });

  it('the snippet is taken from the example', () => {
    const snippet = snippets().find((s) => s.startsWith('traffic {'))!;
    const example = urlShortenerExample.split('\n').map((l) => l.trim().replace(/\s+/g, ' '));
    for (const line of snippet.split('\n').filter((l) => l.trim() && l.trim() !== '}')) {
      expect(example.some((l) => l.startsWith(line.trim().replace(/\s+/g, ' '))), line).toBe(true);
    }
  });
});

describe('landing page snippets', () => {
  it('only use syntax the parser accepts', () => {
    const all = snippets();
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const source of all) {
      if (source.startsWith('traffic {')) continue; // checked against the example above
      // Use cases are written against the demo's architecture.
      const document = source.startsWith('usecase') ? `${DEMO_ARCHITECTURE}\n${source}` : source;
      expect(parse(document).diagnostics, source).toEqual([]);
    }
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

  it('highlights section blocks: their words as keywords, quantities as numbers', () => {
    const lines = highlightLines(['traffic {', '  "Redirect" 100k rps mix "Hit" 90%, "Miss" 10%', '}', 'mix -> any', 'decision "D" because "r"', 'test "T" {', '  no path from client to any database', '}']);
    const cls = (i: number) => lines[i].filter((seg) => seg.cls).map((seg) => [seg.text.trim(), seg.cls]);
    expect(cls(0)).toEqual([['traffic', 'keyword']]);
    expect(cls(1)).toEqual([
      ['"Redirect"', 'string'],
      ['100k rps', 'number'],
      ['mix', 'keyword'],
      ['"Hit"', 'string'],
      ['90%', 'number'],
      ['"Miss"', 'string'],
      ['10%', 'number'],
    ]);
    expect(cls(3)).toEqual([['->', 'arrow']]);
    expect(cls(4)).toEqual([['decision', 'keyword'], ['"D"', 'string'], ['because', 'keyword'], ['"r"', 'string']]);
    expect(cls(6).map(([t]) => t)).toEqual(['no', 'path', 'from', 'to', 'any']);
  });

  it('highlights the v2 words and label prefixes', () => {
    const cls = (line: string, inSection = false) => highlightLine(line, inSection).filter((seg) => seg.cls).map((seg) => [seg.text.trim(), seg.cls]);
    expect(cls('  worker -> feeds : x200 ~2MB LPUSH feed:{f}')).toEqual([['->', 'arrow'], ['x200', 'number'], ['~2MB', 'number']]);
    expect(cls('  a -> b : xml x200')).toEqual([['->', 'arrow']]);
    expect(cls('  "U" never waits for any queue or any strong store', true).map(([t]) => t)).toEqual(['"U"', 'never', 'waits', 'for', 'any', 'or', 'any', 'strong', 'store']);
    expect(cls('  blobs bandwidth 500 MB/s egress 0.05 usd/GB', true)).toEqual([['bandwidth', 'keyword'], ['500 MB/s', 'number'], ['egress', 'keyword'], ['0.05 usd/GB', 'number']]);
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
  it.each(examples.map((e) => [e.id, e.source]))('%s opens the editor on the example (?example=)', (id, source) => {
    const link = exampleLink(id);
    expect(link).toBe(`${APP_PATH}?example=${id}`);
    expect(exampleFromSearch(link!.slice(APP_PATH.length))?.example?.source).toBe(source);
  });

  it('the page shows four of the examples, linked in the HTML itself', () => {
    const tiles = [...landingHtml.matchAll(/data-example="([^"]+)" href="([^"]+)"/g)];
    expect(tiles).toHaveLength(4);
    for (const [, id, href] of tiles) expect(href).toBe(exampleLink(id));
    expect(exampleLink('nope')).toBeNull();
    // Nothing rewrites them at runtime, so the page bundle carries no example sources.
    expect(mainSource).not.toMatch(/from '\.\/links'|dsl\/examples/);
  });
});

describe('old share links', () => {
  it('are forwarded to the editor before anything else runs', () => {
    const head = landingHtml.slice(0, landingHtml.indexOf('</head>'));
    const firstScript = head.indexOf('<script');
    expect(firstScript).toBeGreaterThan(-1);
    expect(firstScript).toBeLessThan(head.indexOf('<link'));
    // An external file, so the CSP can forbid inline scripts.
    expect(head.slice(firstScript)).toMatch(/^<script src="\.\/legacy-redirect\.js"><\/script>/);
    expect(legacyRedirect).toContain("location.hash.indexOf('#code=') === 0");
    expect(legacyRedirect).toContain("location.replace('./app/' + location.hash)");
  });
});

describe('practice section', () => {
  const files = import.meta.glob<string>('../practice/problems/*/problem.md', { query: '?raw', import: 'default', eager: true });
  const listings = listingsFrom(Object.fromEntries(Object.entries(files).map(([path, text]) => [path.replace('../practice/problems/', ''), text])));

  const built = fillPracticePlaceholders(landingHtml, prebuiltListings);
  const section = built.slice(built.indexOf('<section class="story story--practice"'), built.indexOf('</section>', built.indexOf('<section class="story story--practice"')));

  it('is rendered at build time: every problem and their count, with no placeholder left', () => {
    expect(landingHtml).toMatch(/<ul class="tiles tiles--practice" id="practice-list">\s*<!--practice:list-->\s*<\/ul>/);
    const ids = [...section.matchAll(/href="\.\/practice\/([^"/]+)\/"/g)].map((m) => m[1]);
    expect(ids).toEqual(problems.map((p) => p.id));
    expect(section).toContain(`<p class="story__lede">${problems.length} system design problems. Tests, not opinions.</p>`);
    expect(section).toMatch(/href="\.\/practice\/"/);
    expect(built).not.toContain('<!--practice:');
    expect(() => fillPracticePlaceholders('<!--practice:nope-->', [])).toThrow(/unknown placeholder/);
    // No hard-coded count.
    expect(landingHtml).not.toMatch(/\b\d+ system design problems/);
    // Problems link to their static pages (practice/<id>/); only the roadmap and the arcade are hash routes.
    expect(landingHtml).not.toMatch(/href="\.\/practice\/#\/(?!roadmap"|arcade")/);
  });

  it('lists every practice problem from its folder, in catalog order', () => {
    expect(listings.map((p) => [p.id, p.title, p.summary, p.difficulty])).toEqual(problems.map((p) => [p.id, p.title, p.summary, p.difficulty]));
    expect(listings.map((p) => p.company)).toEqual(problems.map((p) => p.company));
    const html = practiceListHtml(listings);
    const ids = [...html.matchAll(/href="\.\/practice\/([^"/]+)\/"/g)].map((m) => m[1]);
    expect(ids).toEqual(problems.map((p) => p.id));
  });

  it('prebuilds the same list for the landing and practice pages (virtual:practice-listings)', () => {
    expect(prebuiltListings).toEqual(listings);
    expect(prebuiltListings.map((p) => [p.id, p.tags, p.order])).toEqual(problems.map((p) => [p.id, p.tags, p.order]));
  });

  it('renders title, difficulty and summary, escaped', () => {
    const html = practiceListHtml([
      { id: 'a', title: 'A <b>&', summary: 'Say "hi"', difficulty: 'hard' },
      { id: 'b', title: 'B', summary: 'S', difficulty: 'easy' },
    ]);
    expect(html).toContain('<span class="tile__name">A &lt;b&gt;&amp;</span>');
    expect(html).toContain('<span class="ps-badge ps-badge--pink">hard</span>');
    expect(html).toContain('<span class="tile__desc">Say &quot;hi&quot;</span>');
    expect(html).toContain('<span class="ps-badge ps-badge--pass">easy</span>');
  });

  it('leaves out folders whose problem.md cannot be read', () => {
    expect(listingsFrom({ 'bad/problem.md': 'no front matter', ...Object.fromEntries(Object.entries(files).slice(0, 1).map(([k, v]) => [k.replace('../practice/problems/', ''), v])) })).toHaveLength(1);
  });
});

describe('interview prep section', () => {
  const stages = roadmapFor(ROADMAP, prebuiltListings.map((p) => p.id));
  const built = fillPrepPlaceholders(landingHtml, stages);
  const section = built.slice(built.indexOf('<section class="prep"'), built.indexOf('</section>', built.indexOf('<section class="prep"')));

  it('comes after the examples, with the hero linking to it', () => {
    expect(landingHtml.indexOf('<section class="prep"')).toBeGreaterThan(landingHtml.indexOf('<section class="story story--examples"'));
    expect(landingHtml).toMatch(/<a href="#interview-prep">/);
    expect(landingHtml).toContain('id="interview-prep"');
  });

  it('lists every roadmap stage from src/practice/roadmap.ts, in order, with its problem count', () => {
    const titles = [...section.matchAll(/<span class="prep__stage-title">([^<]+)<\/span>/g)].map((m) => decodeEntities(m[1]));
    expect(titles).toEqual(ROADMAP.map((s) => s.title));
    const counts = [...section.matchAll(/<span class="prep__stage-count">(\d+) problems?<\/span>/g)].map((m) => Number(m[1]));
    expect(counts).toEqual(stages.map((s) => s.problems.length));
  });

  it('states the counts of the roadmap, and leaves no placeholder behind', () => {
    const total = stages.reduce((n, s) => n + s.problems.length, 0);
    expect(section).toContain(`${total} system design problems in ${stages.length} stages`);
    expect(built).not.toContain('<!--roadmap:');
    expect(() => fillPrepPlaceholders('<!--roadmap:nope-->', stages)).toThrow(/unknown placeholder/);
  });

  it('starts the roadmap without an account, offers sign-in as optional, and promises no price', () => {
    expect(section).toMatch(/<a class="ps-btn ps-btn--primary ps-btn--lg"[^>]* href="\.\/practice\/#\/roadmap">Start interview prep/);
    expect(section).toContain('No account needed to start');
    expect(section).toContain('Sign in if you want to keep your progress');
    expect(section).not.toMatch(/Sign in to start/);
    expect(section).not.toMatch(/\bfree\b/i);
  });

  it('escapes stage titles', () => {
    expect(prepStagesHtml([{ id: 'a', title: 'A <b> & "c"', problems: ['x'] }])).toContain('<span class="prep__stage-title">A &lt;b&gt; &amp; &quot;c&quot;</span>');
    expect(prepStagesHtml([{ id: 'a', title: 'A', problems: ['x'] }])).toContain('1 problem<');
  });
});
