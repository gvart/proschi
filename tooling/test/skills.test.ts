import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';

/**
 * The agent skills in plugin/skills/ (Agent Skills format) and the Claude Code
 * plugin marketplace that ships them (.claude-plugin/). Agents copy the
 * skills' examples, so every full ```proschi example must be clean,
 * canonical and pass its own tests.
 */
const root = new URL('../../', import.meta.url).pathname;
const skillsDir = join(root, 'plugin', 'skills');
const skills = readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory());

async function cli(argv: string[]) {
  const out: string[] = [];
  const code = await run(argv, (s) => out.push(s), (s) => out.push(s));
  return { code, out: out.join('\n') };
}

function frontMatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return {};
  return Object.fromEntries(m[1].split('\n').map((l) => /^([a-z-]+):\s*(.*)$/.exec(l)).filter((x) => x !== null).map((x) => [x[1], x[2]]));
}

describe('agent skills', () => {
  it('are all listed in skills/README.md', () => {
    expect(skills.length).toBeGreaterThanOrEqual(5);
    const readme = readFileSync(join(skillsDir, 'README.md'), 'utf8');
    for (const s of skills) expect(readme).toContain(`(${s}/SKILL.md)`);
  });

  it.each(skills)('%s has valid front matter', (s) => {
    const text = readFileSync(join(skillsDir, s, 'SKILL.md'), 'utf8');
    const fm = frontMatter(text);
    expect(fm.name).toBe(s);
    expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(s.length).toBeLessThanOrEqual(64);
    expect(fm.description.length).toBeGreaterThan(50);
    expect(fm.description.length).toBeLessThanOrEqual(1024);
    expect(fm.description).toMatch(/Use when/);
    expect(text.split('\n').length).toBeLessThanOrEqual(260);
    // Every skill validates its output and ends with a share link.
    expect(text).toContain('proschi@latest check');
    expect(text).toContain('proschi@latest share-link');
  });

  it.each(skills)('%s carries the same cheat-sheet as the others', (s) => {
    const sheet = (d: string) => readFileSync(join(skillsDir, d, 'references', 'proschi-cheatsheet.md'), 'utf8');
    expect(sheet(s)).toBe(sheet('infra-to-proschi'));
    expect(readFileSync(join(skillsDir, s, 'SKILL.md'), 'utf8')).toContain('](references/proschi-cheatsheet.md)');
  });

  const dir = mkdtempSync(join(tmpdir(), 'proschi-skills-'));
  const files = [...skills.map((s) => join(s, 'SKILL.md')), join('infra-to-proschi', 'references', 'proschi-cheatsheet.md')];
  const examples = files.flatMap((f) =>
    [...readFileSync(join(skillsDir, f), 'utf8').matchAll(/```proschi\n([\s\S]*?)```/g)].map((m, i) => [`${f} #${i + 1}`, m[1]] as const),
  );

  it('have examples', () => {
    expect(examples.length).toBeGreaterThanOrEqual(skills.length);
  });

  it.each(examples)('%s is clean, formatted and passes its tests', async (name, source) => {
    const file = join(dir, `${name.replace(/\W+/g, '-')}.proschi`);
    writeFileSync(file, source);
    expect(await cli(['check', '--strict', file])).toMatchObject({ code: 0 });
    expect(await cli(['fmt', '--check', file])).toMatchObject({ code: 0 });
    expect(await cli(['test', file])).toMatchObject({ code: 0 });
  });
});

describe('Claude Code plugin marketplace', () => {
  const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const plugin = JSON.parse(readFileSync(join(root, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));

  it('lists the proschi plugin in plugin/, whose skills are plugin/skills/', () => {
    expect(marketplace).toMatchObject({ name: 'proschi', owner: { name: expect.any(String) } });
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: plugin.name, source: './plugin' })]);
    expect(plugin.name).toBe('proschi');
  });
});
