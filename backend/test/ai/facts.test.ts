import { describe, expect, it } from 'vitest';
import { createClient, HAIKU, SONNET } from '../../src/ai/client';
import { problemContext } from '../../src/ai/context';
import { knownFactsBlock, numbersIn, revealedIn } from '../../src/ai/facts';
import { start, turn, verdict, type InterviewState } from '../../src/ai/interviewer';
import { messageResponse, mockFetch, sseResponse, streamEvents, type Recorded } from './mockClaude';

const context = problemContext('url-shortener')!;
const T0 = 1_800_000_000_000;
const MIN = 60_000;
const text = (r: Recorded) => {
  const m = r.body.messages.at(-1)!;
  return typeof m.content === 'string' ? m.content : m.content.map((b) => ('text' in b ? b.text : '')).join('');
};
const section = (t: string, tag: string) => new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`).exec(t)?.[0] ?? '';
const goodVerdict = { passed: false, scores: { requirements: 3, estimation: 3, design: 2, tradeoffs: 2, communication: 3 }, wentWell: [], wentWrong: [], nextSteps: [] };

/** A fake model answering a scripted interview: each Sonnet reply and Haiku hint in turn. */
function scripted(replies: string[], hints: (object | 'fail')[]) {
  const { fetch, calls } = mockFetch((req) => {
    if (req.body.model === HAIKU) {
      const h = hints.shift();
      return h === 'fail' || !h ? new Response('{"error":{"message":"bad"}}', { status: 400 }) : messageResponse(JSON.stringify(h), { model: HAIKU });
    }
    if (req.body.stream) return sseResponse(streamEvents(replies.shift() ?? 'Go on.'));
    return messageResponse(JSON.stringify(goodVerdict));
  });
  return { client: createClient({ ANTHROPIC_API_KEY: 'k' }, { fetch, retryDelayMs: 1, maxRetries: 0 }), calls };
}

describe('known facts (P38)', () => {
  it('reads numbers the way people write them', () => {
    expect(numbersIn('About 10k redirects, 10,000 a second, $3,000 / month, 99.9% and 50 ms')).toEqual([10_000, 10_000, 3000, 99.9, 50]);
    expect(numbersIn('p99 of v2 under 1.6T and 3.2 billion')).toEqual([1.6e12, 3.2e9]);
  });

  it('marks a fact revealed when a reply states its numbers', () => {
    expect(revealedIn(context.topics, 'We can spend at most $3,000 a month.')).toEqual(['q6']);
    expect(revealedIn(context.topics, 'Around 10,000 redirects a second; p99 must be under 50 ms.')).toEqual(['q1', 'q3']);
    expect(revealedIn(context.topics, 'Good question, ask me about the numbers.')).toEqual([]);
  });

  it('gives the interviewer and the hint the statement and the known facts, and tracks what the replies revealed', async () => {
    const { client, calls } = scripted(['At most $3,000 a month for the whole service.'], [{ kind: 'focus', text: 'Ask about latency next.', covered: ['q6'], revealed: ['q6', 'e1', 'zz'] }]);
    const r = await turn({ client, context, now: T0 + MIN }, start(context, 45, T0).state, { message: 'How much can we spend?' });
    expect(r.state.covered).toEqual(['q6']);
    // The numbers check and the hint agree; ids that are not clarify topics are dropped.
    expect(r.state.revealed).toEqual(['q6']);
    const sonnet = calls.find((c) => c.body.model === SONNET)!;
    expect(sonnet.body.system[0].text).toContain('They have read <statement_shown>, and each turn lists in <known_facts>');
    expect(sonnet.body.system[1].text).toContain('<statement_shown>');
    expect(text(sonnet)).toContain('<known_facts>');
    const haiku = calls.find((c) => c.body.model === HAIKU)!;
    expect(haiku.body.system[0].text).toContain('Never suggest asking about one of these');
    expect(haiku.body.system[1].text).toContain('<statement_shown>');
    // The hint is asked after the reply: it already knows the budget was given.
    expect(section(text(haiku), 'known_facts')).toContain('[q6] Is there a budget?');
    expect(text(haiku)).not.toMatch(/\[q6\] \(clarify\)/);
    expect(text(haiku)).toContain('What a hint is about in this phase: the requirement or scale area');
  });

  it('keeps a revealed fact known when the hint call fails', async () => {
    const { client, calls } = scripted(['About 10k redirects a second.', 'Sure.'], ['fail', 'fail']);
    let { state } = start(context, 45, T0);
    ({ state } = await turn({ client, context, now: T0 + MIN }, state, { message: 'What is the traffic?' }));
    expect(state.covered).toEqual([]);
    expect(state.revealed).toEqual(['q1']);
    await turn({ client, context, now: T0 + 2 * MIN }, state, { message: 'And then?' });
    const second = text(calls.filter((c) => c.body.model === SONNET).at(-1)!);
    expect(section(second, 'known_facts')).toContain('[q1]');
    expect(section(second, 'not_asked')).not.toContain('[q1]');
  });

  it('regression: a budget asked at the start is never asked for again, by the interviewer or the hint', async () => {
    // The owner's session: the budget first, then latency and durability, then the estimate phase.
    const { client, calls } = scripted(
      [
        'At most $3,000 a month for the whole service.',
        'The p99 of a redirect must stay under 50 ms; shortening may take up to 200 ms.',
        'Never: once returned, a code is already written to a database.',
        "Let's estimate. How many short codes are created in a year at 100 a second?",
        'Right, about 3.2 billion.',
      ],
      [
        { kind: 'focus', text: 'Ask about latency.', covered: ['q6'], revealed: ['q6'] },
        // The hint model misses the latency question: the reply's numbers still make it known.
        { kind: 'focus', text: 'Ask about durability.', covered: [], revealed: [] },
        { kind: 'focus', text: 'Ask about traffic.', covered: ['q4'], revealed: ['q4'] },
        { kind: 'focus', text: 'Work out the yearly total.', covered: [], revealed: [] },
        { kind: 'improve', text: 'Show the per-day step.', covered: ['e1'], revealed: [] },
      ],
    );
    let state: InterviewState = start(context, 45, T0).state;
    const script: [number, string, boolean?][] = [
      [1, 'Is there a budget?'],
      [2, 'How fast must a redirect be?'],
      [3, 'Can we lose links?'],
      [4, "Let's estimate.", true],
      [6, '100/s × 86,400 × 365 ≈ 3.2B codes a year'],
    ];
    for (const [min, message, advance] of script) ({ state } = await turn({ client, context, now: T0 + min * MIN }, state, { message, ...(advance ? { advance } : {}) }));
    expect([...state.covered].sort()).toEqual(['e1', 'q4', 'q6']);
    expect([...state.revealed!].sort()).toEqual(['q3', 'q4', 'q6']);
    const sonnet = calls.filter((c) => c.body.model === SONNET && c.body.stream).map(text);
    const haiku = calls.filter((c) => c.body.model === HAIKU).map(text);
    for (const t of sonnet.slice(1)) {
      expect(section(t, 'known_facts')).toContain('[q6] Is there a budget?');
      expect(section(t, 'not_asked')).not.toContain('[q6]');
    }
    for (const t of sonnet.slice(3)) for (const id of ['q3', 'q4', 'q6']) expect(section(t, 'not_asked')).not.toContain(`[${id}]`);
    for (const t of haiku) {
      expect(t).not.toMatch(/\[q6\] \(clarify\)/);
      expect(section(t, 'known_facts')).toContain('[q6]');
    }
    expect(haiku[4]).toContain('What a hint is about in this phase: the next number to work out');
    for (const id of ['q3', 'q4', 'q6']) expect(haiku[4]).not.toMatch(new RegExp(`\\[${id}\\] \\(clarify\\)`));
    // Known is not asked: the verdict still scores the questions by what the candidate's words covered.
    await verdict({ client, context, now: T0 + 44 * MIN }, state);
    expect(text(calls.at(-1)!)).toContain('Facts the interviewer gave without the candidate asking (they count as missed):\n- [q3]');
  });

  it('lists nothing but the statement before any fact is known', () => {
    expect(knownFactsBlock(context, { covered: [] })).toContain('- none yet, beyond the statement');
  });
});
