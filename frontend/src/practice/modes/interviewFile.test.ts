import { describe, expect, it } from 'vitest';
import { problems } from '../catalog';
import { hiddenText, interviewIssues, parseInterview, redactedStatement } from './interviewFile';

const STATEMENT = `Design a thing.

## Functional requirements

- **Do it**: it is done.

## Scale

- **10k rps** at peak, 95% of them cached.

## Constraints

- p99 under **50 ms**.
- At most **$3,000 / month**.

## What is given

The visitor.`;

const good = (q: string, fact: string, answer = 'The answer.') => `### ${q}\n- kind: good\n- fact: ${fact}\n\n${answer}\n`;
const weak = (q: string, why = 'Why it is weak.') => `### ${q}\n- kind: weak\n\n${why}\n`;
const FILE = `## Questions

${good('How much traffic?', '10k rps at peak')}
${good('How fast?', 'p99 under 50 ms')}
${good('Budget?', 'At most $3,000 / month')}
${weak('Which language?')}
${weak('Which cloud?')}
## Estimates

### Requests a day?
- answer: 864M
- unit: requests
- range: 500M to 1.5B

10k × 86,400 ≈ **864 million**.

### Requests an hour?
- answer: 36M
- unit: requests

10k × 3,600.
`;

describe('interview.md', () => {
  it('reads questions and estimates', () => {
    const { interview, issues } = parseInterview(FILE);
    expect(issues).toEqual([]);
    expect(interview.questions.map((q) => [q.question, q.good])).toEqual([
      ['How much traffic?', true],
      ['How fast?', true],
      ['Budget?', true],
      ['Which language?', false],
      ['Which cloud?', false],
    ]);
    expect(interview.questions[0]).toMatchObject({ fact: '10k rps at peak', answer: 'The answer.' });
    expect(interview.questions[3].fact).toBeUndefined();
    expect(interview.estimates[0]).toMatchObject({ answer: 864e6, unit: 'requests', low: 500e6, high: 1.5e9 });
    expect(interview.estimates[0].solution).toContain('864 million');
    // No range: within a factor of 2.
    expect(interview.estimates[1]).toMatchObject({ answer: 36e6, low: 18e6, high: 72e6, tolerance: 2 });
  });

  it('accepts a tolerance factor instead of a range', () => {
    const { interview, issues } = parseInterview(FILE.replace('- unit: requests\n\n10k × 3,600', '- unit: requests\n- tolerance: 3\n\n10k × 3,600'));
    expect(issues).toEqual([]);
    expect(interview.estimates[1]).toMatchObject({ low: 12e6, high: 108e6, tolerance: 3 });
  });

  it.each([
    ['an empty file', '', /empty/],
    ['an unknown section', FILE + '\n## Notes\n\nx', /Unknown section "## Notes"/],
    ['a missing kind', FILE.replace('- kind: weak\n\nWhy it is weak.\n\n### Which cloud', '\nWhy it is weak.\n\n### Which cloud'), /start with "- kind: good" or "- kind: weak"/],
    ['a good question without a fact', FILE.replace('- fact: 10k rps at peak\n', ''), /needs "- fact: …"/],
    ['a weak question with a fact', FILE.replace('### Which language?\n- kind: weak\n', '### Which language?\n- kind: weak\n- fact: 10k rps\n'), /reveals nothing/],
    ['a question without an answer', FILE.replace('\nWhy it is weak.\n\n### Which cloud', '\n### Which cloud'), /why it is a weak question/],
    ['too few good questions', FILE.replace(good('Budget?', 'At most $3,000 / month'), ''), /At least 3 good questions/],
    ['too few weak questions', FILE.replace(weak('Which cloud?'), ''), /At least 2 weak questions/],
    ['an unknown setting', FILE.replace('- kind: good\n- fact: 10k', '- kind: good\n- hint: x\n- fact: 10k'), /unknown setting "hint"/],
    ['a non-numeric answer', FILE.replace('- answer: 864M', '- answer: lots'), /"- answer: <number>"/],
    ['a range that misses the answer', FILE.replace('- range: 500M to 1.5B', '- range: 1B to 2B'), /two numbers above 0 around the answer/],
    ['both range and tolerance', FILE.replace('- range: 500M to 1.5B', '- range: 500M to 1.5B\n- tolerance: 2'), /not both/],
    ['a tolerance out of bounds', FILE.replace('- unit: requests\n\n10k × 3,600', '- unit: requests\n- tolerance: 50\n\n10k × 3,600'), /factor from 1.1 to 10/],
    ['no estimates', FILE.slice(0, FILE.indexOf('## Estimates')) + '## Estimates\n', /At least one estimate/],
    ['a missing unit', FILE.replace('- unit: requests\n- range', '- range'), /"- unit: …" is required/],
  ])('reports %s', (_, text, message) => {
    expect(parseInterview(text).issues.map((i) => i.message).join('\n')).toMatch(message);
  });

  it('hides Scale and Constraints, and finds facts only there', () => {
    const redacted = redactedStatement(STATEMENT);
    expect(redacted).toContain('## Functional requirements');
    expect(redacted).toContain('## What is given');
    expect(redacted).not.toMatch(/## Scale|## Constraints|10k rps|50 ms/);
    expect(hiddenText(STATEMENT)).toContain('at most $3,000 / month');
    expect(interviewIssues(STATEMENT, FILE)).toEqual([]);
    // A fact that is only in a visible section, or not in the statement at all.
    const issues = interviewIssues(STATEMENT, FILE.replace('- fact: 10k rps at peak', '- fact: it is done'));
    expect(issues).toEqual([expect.objectContaining({ message: expect.stringMatching(/the fact "it is done" is not in problem\.md's Scale or Constraints/), line: 5 })]);
  });

  it('every problem has a valid interview.md', () => {
    for (const p of problems) {
      expect(p.interview, p.id).toBeDefined();
      expect(interviewIssues(p.statement, p.interview!), p.id).toEqual([]);
    }
  });
});
