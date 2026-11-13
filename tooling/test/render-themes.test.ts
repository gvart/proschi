import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';
import { parse } from '../src/proschi';
import { getTheme, renderArchitectureSvg, renderSequenceSvg, renderSvgs, THEME_NAMES } from '../src/render';
import { typeColor } from '../src/render/icons';
import { CLASSIC, SKETCH, SKETCH_DARK, SKETCH_LIGHT } from '../src/render/theme';

async function capture(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const SOURCE = `title "Shop"
web "Web" [React]
api "Order API" [REST API]
db "Orders DB" [PostgreSQL]
group g "Backend" {
  w "Worker" [Go]
}
n "Remember" [Text Note] "Retries are idempotent."
web -> api : HTTPS
api -> db : SQL
api -> w
usecase "Place order" {
  web -> api : POST /orders
  api -> db : INSERT order
  db --> api : ok
  api --> web : 201 created
}
`;

const background = (svg: string) => svg.match(/<rect width="100%" height="100%" fill="([^"]+)"\/>/)?.[1];

/** A folder with `main.proschi` and, when given, a proschi.json. */
function project(config?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'proschi-theme-'));
  writeFileSync(join(dir, 'main.proschi'), SOURCE);
  if (config !== undefined) writeFileSync(join(dir, 'proschi.json'), typeof config === 'string' ? config : JSON.stringify(config));
  return dir;
}

async function renderIn(dir: string, flags: string[] = []) {
  const out = join(dir, `out-${Math.random().toString(36).slice(2)}`);
  const r = await capture(['render', join(dir, 'main.proschi'), '--out', out, ...flags]);
  const read = (name: string) => readFileSync(join(out, name), 'utf8');
  return { ...r, out, read };
}

describe('render themes', () => {
  const { diagram } = parse(SOURCE);
  const useCase = diagram.useCases[0];

  it('names three themes, sketch-light by default, and takes sketch for it', () => {
    expect(THEME_NAMES).toEqual(['sketch-light', 'sketch-dark', 'classic']);
    expect(getTheme()).toBe(SKETCH);
    expect(SKETCH).toBe(SKETCH_LIGHT);
    expect(getTheme('sketch')).toBe(SKETCH_LIGHT);
    expect(getTheme('sketch-dark')).toBe(SKETCH_DARK);
    expect(getTheme('classic')).toBe(CLASSIC);
    expect(() => getTheme('neon')).toThrow("Unknown theme 'neon'; use sketch-light, sketch-dark, classic, sketch");
  });

  it("draws sketch-light and sketch-dark as upstream's light and dark canvas themes", async () => {
    expect(await renderArchitectureSvg(diagram, { theme: SKETCH_LIGHT })).toBe(await renderArchitectureSvg(diagram, { theme: 'light' }));
    const dark = await renderArchitectureSvg(diagram, { theme: SKETCH_DARK });
    expect(dark).toBe(await renderArchitectureSvg(diagram, { theme: 'dark' }));
    expect(XMLValidator.validate(dark)).toBe(true);
    expect(background(dark)).toBe('#141318');
    expect(dark).not.toContain('#FFF8E7');
    // Dark cards, light ink, the purple hard shadow, handles and caps group titles as in sketch-light.
    expect(dark).toContain('fill="#1E1D24" stroke="#F4EFE3" stroke-width="2"');
    expect(dark).toContain('fill="#605496"');
    expect(dark).toContain('width="9" height="9"');
    expect(dark).toContain('>BACKEND<');
    // Drawing in a theme leaves the default as it was.
    expect(background(await renderArchitectureSvg(diagram))).toBe('#FFF8E7');
  });

  it('renders the architecture in both themes', async () => {
    const sketch = await renderArchitectureSvg(diagram);
    const classic = await renderArchitectureSvg(diagram, { theme: CLASSIC });
    for (const svg of [sketch, classic]) {
      expect(XMLValidator.validate(svg)).toBe(true);
      for (const name of ['Web', 'Order API', 'Orders DB', 'Worker', 'Remember']) expect(svg).toContain(`>${name}<`);
    }
    expect(sketch).toBe(await renderArchitectureSvg(diagram, { theme: SKETCH }));

    // sketch: cream paper, ink outlines, hard shadows, outlined tiles with ink glyphs, square handles.
    expect(background(sketch)).toBe('#FFF8E7');
    expect(sketch).toMatch(/width="18" height="18" color="#111111"/);
    expect(sketch).toContain('width="9" height="9"');
    expect(sketch).toContain('>BACKEND<');
    expect(sketch).not.toContain('filter=');

    // classic: white, rounded grey cards with a soft shadow, tiles in the type's colour with white glyphs, no handles.
    expect(background(classic)).toBe('#ffffff');
    expect(classic).not.toContain('#FFF8E7');
    expect(classic).toContain('<filter id="proschi-arch-shadow"');
    expect(classic).toMatch(/rx="8" fill="#ffffff" stroke="#d1d5db" stroke-width="2" filter="url\(#proschi-arch-shadow\)"/);
    expect(classic).toContain(`width="36" height="36" rx="4" fill="${typeColor('service')}"`);
    expect(classic.match(/width="20" height="20" color="#ffffff"/g)).toHaveLength(4);
    expect(classic).not.toContain('width="9" height="9"');
    expect(classic).toContain('stroke="#3b82f6" stroke-width="2" stroke-dasharray="7 5"');
    expect(classic).toContain('>Backend<');
    expect(classic).toContain('stroke="#b1b1b7" stroke-width="1.5"');
    expect(classic).not.toContain('JetBrains Mono');
  });

  it('renders the sequence diagrams in both themes', () => {
    const sketch = renderSequenceSvg(diagram, useCase, useCase.scenarios[0]);
    const classic = renderSequenceSvg(diagram, useCase, useCase.scenarios[0], '', CLASSIC);
    for (const svg of [sketch, classic]) {
      expect(XMLValidator.validate(svg)).toBe(true);
      expect(svg).toContain('POST /orders');
    }
    // sketch: ink requests, pink outlined step numbers.
    expect(background(sketch)).toBe('#FFF8E7');
    expect(sketch).toContain('fill="#FF5DA2" stroke="#111111" stroke-width="1.5"');
    expect(sketch).toMatch(/<line [^>]*stroke="#111111" stroke-width="2"/);
    // classic: blue requests and step numbers with white digits, grey dashed lifelines, type-coloured tiles.
    expect(background(classic)).toBe('#ffffff');
    expect(classic).toContain('<circle cx="');
    expect(classic).toMatch(/r="8" fill="#3b82f6"\/>/);
    expect(classic).toMatch(/font-weight="700" fill="#ffffff" text-anchor="middle">1</);
    expect(classic).toMatch(/<line [^>]*stroke="#3b82f6" stroke-width="1.5"/);
    expect(classic).toContain('stroke="#d1d5db" stroke-width="1.5" stroke-dasharray="5 4"');
    expect(classic).toContain(`rx="4" fill="${typeColor('database')}"`);
    expect(classic).not.toContain('#FF5DA2');
  });

  it('renders the sequence diagrams in sketch-dark', () => {
    const dark = renderSequenceSvg(diagram, useCase, useCase.scenarios[0], '', SKETCH_DARK);
    expect(XMLValidator.validate(dark)).toBe(true);
    expect(background(dark)).toBe('#141318');
    // Light ink requests and the dark colourway's pink step numbers, outlined in light ink.
    expect(dark).toContain('fill="#FF7AB4" stroke="#F4EFE3" stroke-width="1.5"');
    expect(dark).toMatch(/<line [^>]*stroke="#F4EFE3" stroke-width="2"/);
    expect(dark).toContain('fill="#1E1D24" stroke="#F4EFE3" stroke-width="2"');
    expect(dark).not.toContain('#FFF8E7');
  });

  it('draws a moment of playback: the step lit in the accent, its participants outlined, the later steps faded', () => {
    const scenario = useCase.scenarios[0];
    const plain = renderSequenceSvg(diagram, useCase, scenario);
    const at = renderSequenceSvg(diagram, useCase, scenario, '', SKETCH, { step: 0 });
    expect(XMLValidator.validate(at)).toBe(true);
    expect(plain).not.toContain('data-play');
    // Step 1 (POST /orders, and its 201) lit, step 2 (INSERT order, with its reply) still to come.
    expect(at).toMatch(/<g data-step="1" data-kind="request" data-play="lit">\n<line [^>]*stroke="#FF5DA2" stroke-width="3.5"[^>]*marker-end="url\(#solid-lit\)"/);
    expect(at).toMatch(/<g data-step="1" data-kind="response" data-play="lit">\n<line [^>]*stroke="#FF5DA2" stroke-width="3.5" stroke-dasharray="6 4" marker-end="url\(#open-lit\)"/);
    expect(at).toContain('<g data-step="2" data-kind="request" data-play="future" opacity="0.35">');
    expect(at).toContain('<marker id="solid-lit"');
    // The browser and the order API outlined in the accent.
    expect(at.match(/stroke="#FF5DA2" stroke-width="3"\/>/g)).toHaveLength(2);
  });

  it('styles the HTML export with the theme', async () => {
    const dir = project();
    const classic = await renderIn(dir, ['--format', 'html', '--theme', 'classic']);
    expect(classic.code).toBe(0);
    const html = classic.read('main.html');
    expect(html).toContain('--card: #ffffff');
    expect(html).not.toContain('#FFF8E7');
    const sketch = await renderIn(dir, ['--format', 'html']);
    expect(sketch.read('main.html')).toContain('--card: #fff8e7');
    const dark = await renderIn(dir, ['--format', 'html', '--theme', 'sketch-dark']);
    expect(dark.code).toBe(0);
    const page = dark.read('main.html');
    expect(page).toContain('--card: #141318');
    expect(page).not.toContain('--card: #fff8e7');
    expect(page).toContain('<rect width="100%" height="100%" fill="#141318"/>');
  });

  it('styles the preview page with the theme', async () => {
    const dir = project();
    const classic = await renderIn(dir, ['--format', 'preview-html', '--theme', 'classic']);
    expect(classic.code).toBe(0);
    const html = classic.read('main.preview.html');
    expect(html).toContain('--card: #ffffff');
    expect(html).toMatch(/r="8" fill="#3b82f6"\/>/);
  });

  it('uses sketch without a flag or proschi.json', async () => {
    const r = await renderIn(project());
    expect(r.code).toBe(0);
    expect(background(r.read('architecture.svg'))).toBe('#FFF8E7');
  });

  it('selects the theme with --theme', async () => {
    const dir = project();
    const r = await renderIn(dir, ['--theme', 'classic']);
    expect(r.code).toBe(0);
    expect(background(r.read('architecture.svg'))).toBe('#ffffff');
    expect(background(r.read('place-order--main.svg'))).toBe('#ffffff');
    const eq = await renderIn(dir, ['--theme=classic']);
    expect(background(eq.read('architecture.svg'))).toBe('#ffffff');
    const dark = await renderIn(dir, ['--theme', 'sketch-dark']);
    expect(dark.code).toBe(0);
    expect(background(dark.read('architecture.svg'))).toBe('#141318');
    expect(background(dark.read('place-order--main.svg'))).toBe('#141318');
  });

  it('draws sketch-light and its alias sketch exactly as without a theme', async () => {
    const dir = project();
    const plain = await renderIn(dir);
    for (const name of ['sketch-light', 'sketch']) {
      const themed = await renderIn(dir, ['--theme', name]);
      expect(themed.code).toBe(0);
      for (const file of ['architecture.svg', 'place-order--main.svg']) expect(themed.read(file)).toBe(plain.read(file));
    }
  });

  it('styles the HLD page and the preview page in sketch-dark', async () => {
    const dir = project();
    const hld = await renderIn(dir, ['--format', 'hld-html', '--theme', 'sketch-dark']);
    expect(hld.code).toBe(0);
    expect(hld.read('main.hld.html')).toContain('<rect width="100%" height="100%" fill="#141318"/>');
    const preview = await renderIn(dir, ['--format', 'preview-html', '--theme=sketch-dark']);
    expect(preview.code).toBe(0);
    expect(preview.read('main.preview.html')).toContain('--card: #141318');
  });

  it('selects the theme with "theme" in the nearest proschi.json', async () => {
    const dir = project({ theme: 'classic' });
    const r = await renderIn(dir);
    expect(r.code).toBe(0);
    expect(background(r.read('architecture.svg'))).toBe('#ffffff');
    expect(background(r.read('place-order--main.svg'))).toBe('#ffffff');

    // A file in a subfolder finds the proschi.json above it.
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'main.proschi'), SOURCE);
    const nested = await renderIn(join(dir, 'sub'));
    expect(nested.code).toBe(0);
    expect(background(nested.read('architecture.svg'))).toBe('#ffffff');
  });

  it('takes sketch-dark and the sketch alias in proschi.json', async () => {
    expect(background((await renderIn(project({ theme: 'sketch-dark' }))).read('architecture.svg'))).toBe('#141318');
    expect(background((await renderIn(project({ theme: 'sketch' }))).read('architecture.svg'))).toBe('#FFF8E7');
  });

  it('lets --theme override proschi.json', async () => {
    const r = await renderIn(project({ theme: 'classic', openapi: {} }), ['--theme', 'sketch']);
    expect(r.code).toBe(0);
    expect(background(r.read('architecture.svg'))).toBe('#FFF8E7');
  });

  it('refuses an unknown theme, listing the valid ones', async () => {
    const flag = await renderIn(project(), ['--theme', 'neon']);
    expect(flag.code).toBe(2);
    expect(flag.err).toBe("Unknown theme 'neon'; use sketch-light, sketch-dark, classic, sketch");

    const missing = await renderIn(project(), ['--theme']);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('use sketch-light, sketch-dark, classic, sketch');

    const dir = project({ theme: 'neon' });
    const config = await renderIn(dir);
    expect(config.code).toBe(2);
    expect(config.err).toBe(`Unknown theme 'neon' in ${join(dir, 'proschi.json')}; use sketch-light, sketch-dark, classic, sketch`);

    // A valid flag still wins over a bad name in the config.
    expect((await renderIn(dir, ['--theme', 'classic'])).code).toBe(0);

    const wrongType = await renderIn(project({ theme: 3 }));
    expect(wrongType.code).toBe(2);
    expect(wrongType.err).toContain('"theme" must be a theme name');
  });

  it('gives each inline SVG its own ids in classic too', async () => {
    const { architecture, scenarios } = await renderSvgs(diagram, true, { theme: CLASSIC });
    const ids = [architecture, ...scenarios.map((s) => s.svg)].flatMap((svg) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
