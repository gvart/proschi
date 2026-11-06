import { describe, expect, it } from 'vitest';
import { approxTokens, followUps, gradeDesign, h2Section, problemContext } from '../../src/ai/context';
import { problemIds } from '../../src/verify';

describe('problem context', () => {
  it('holds the hidden facts, questions, estimates, given tests, guidance and reference of a problem', () => {
    const ctx = problemContext('url-shortener')!;
    expect(ctx.text).toContain('<hidden_facts>');
    expect(ctx.text).toContain('10k rps');
    expect(ctx.text).toContain('test "Misses fill the cache"');
    expect(ctx.text).toContain('301 or 302?');
    expect(ctx.text).toMatch(/Components: .*Code Cache \[Redis\] x2/);
    expect(ctx.text).toMatch(/It passes 10 of 10 tests, costs about \$[\d,.]+ a month/);
    // The shown statement leaves out what the candidate has to ask for.
    expect(ctx.shownStatement).not.toContain('10k rps');
    expect(ctx.shownStatement).toContain('Functional requirements');
    expect(ctx.topics.map((t) => t.kind)).toEqual(expect.arrayContaining(['clarify', 'estimate', 'followup']));
    expect(new Set(ctx.topics.map((t) => t.id)).size).toBe(ctx.topics.length);
    expect(problemContext('nope')).toBeUndefined();
    expect(problemContext('__proto__')).toBeUndefined();
  });

  it('is the same text every time, so the cache prefix holds', () => {
    expect(problemContext('chat')!.text).toBe(problemContext('chat')!.text);
  });

  it('fits every problem, and is large enough to cache', () => {
    const sizes = problemIds().map((id) => {
      const ctx = problemContext(id);
      expect(ctx, id).toBeDefined();
      expect(ctx!.topics.filter((t) => t.kind === 'followup').length, `${id} follow-ups`).toBeGreaterThan(0);
      return { id, chars: ctx!.text.length, tokens: approxTokens(ctx!.text) };
    });
    sizes.sort((a, b) => b.tokens - a.tokens);
    const total = sizes.reduce((s, x) => s + x.tokens, 0);
    console.log(`AI context: largest ${sizes[0].id} ~${sizes[0].tokens} tokens (${sizes[0].chars} chars), smallest ${sizes.at(-1)!.id} ~${sizes.at(-1)!.tokens}, mean ~${Math.round(total / sizes.length)}`);
    // The minimum cacheable prefix on Sonnet 5.5 and Haiku 5.5 is 512 tokens; keep the context well under 16k.
    for (const s of sizes) {
      expect(s.tokens, s.id).toBeGreaterThan(1_000);
      expect(s.tokens, s.id).toBeLessThan(16_000);
    }
  });

  it('reads sections and follow-ups', () => {
    const md = '## A\none\n```\n## not a heading\n```\n## B\ntwo\n';
    expect(h2Section(md, 'A')).toBe('one\n```\n## not a heading\n```');
    expect(h2Section(md, 'C')).toBe('');
    expect(followUps('- **"301 or 302?"** Browsers cache.\n- plain\n- **“Why?”** Because.\n- *Duplicates?* Dedupe.')).toEqual(['301 or 302?', 'Why?', 'Duplicates?']);
  });

  it('grades a design on the server', () => {
    const problem = problemContext('url-shortener')!.problem;
    expect(gradeDesign(problem, problem.solution)).toMatchObject({ solved: true, passed: 10, total: 10, errors: [] });
    expect(gradeDesign(problem, problem.starter).solved).toBe(false);
    const broken = gradeDesign(problem, 'import "problem.proschi"\napi "API" [REST API\n');
    expect(broken).toMatchObject({ solved: false, blocked: 'errors' });
    expect(broken.errors.length).toBeGreaterThan(0);
  });
});
