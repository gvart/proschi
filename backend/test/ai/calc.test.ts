import { describe, expect, it } from 'vitest';
import { calculate, calculateTool, CALCULATE_TOOL } from '../../src/ai/calc';
import { AiError, createClient, HAIKU, SONNET, type ContentBlock, type ToolResultBlock } from '../../src/ai/client';
import { problemContext } from '../../src/ai/context';
import { start, turn } from '../../src/ai/interviewer';
import { messageResponse, mockFetch, sseResponse, streamEvents, usage, type Recorded } from './mockClaude';

const context = problemContext('url-shortener')!;
const T0 = 1_800_000_000_000;
const MIN = 60_000;

/** A streamed answer that asks the calculator: a progress note (thinking), then tool calls. */
function toolCallEvents(expressions: string[]): unknown[] {
  const u = usage({ cache_read_input_tokens: 3000 });
  return [
    { type: 'message_start', message: { id: 'msg_t', model: 'claude-sonnet-5-5', usage: { ...u, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Checking their numbers.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-1' } },
    { type: 'content_block_stop', index: 0 },
    ...expressions.flatMap((expression, i) => {
      const json = JSON.stringify({ expression });
      return [
        { type: 'content_block_start', index: i + 1, content_block: { type: 'tool_use', id: `tu_${i}`, name: 'calculate', input: {} } },
        { type: 'content_block_delta', index: i + 1, delta: { type: 'input_json_delta', partial_json: json.slice(0, 9) } },
        { type: 'content_block_delta', index: i + 1, delta: { type: 'input_json_delta', partial_json: json.slice(9) } },
        { type: 'content_block_stop', index: i + 1 },
      ];
    }),
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 80 } },
    { type: 'message_stop' },
  ];
}

describe('calculator (P38)', () => {
  it('computes back-of-the-envelope arithmetic with suffixes, percentages and units', () => {
    expect(calculate('100 * 86400 * 365').value).toBe(3_153_600_000);
    expect(calculate('100M / day').value).toBeCloseTo(1157.41, 2);
    expect(calculate('10k * 5%').value).toBe(500);
    expect(calculate('3.2B * 500 bytes in TB')).toEqual({ value: 1.6, unit: 'tb' });
    expect(calculate('1,000,000 × 2 ÷ 4').value).toBe(500_000);
    expect(calculate('2^10 + (1 + 2) * 3').value).toBe(1033);
    expect(calculate('-5 + 1e3').value).toBe(995);
    expect(calculate('1 TB / 10MB').value).toBe(100_000);
    expect(calculate('1 year in day')).toEqual({ value: 365, unit: 'day' });
  });

  it('answers a bad expression as an error result, never by running it', () => {
    expect(calculateTool({ expression: 'process.exit()' })).toMatchObject({ isError: true, content: expect.stringContaining('Could not evaluate') });
    expect(calculateTool({ expression: '1 / 0' })).toMatchObject({ isError: true });
    expect(calculateTool({ expression: '(1 + 2' })).toMatchObject({ isError: true });
    expect(calculateTool({})).toMatchObject({ isError: true });
    expect(calculateTool({ expression: '100/s * 86,400 s * 365' }).content).toBe('100/s * 86,400 s * 365 = 3,153,600,000 (3.154B)');
    expect(calculateTool({ expression: '100 * 86,400 * 365' })).toEqual({ content: '100 * 86,400 * 365 = 3,153,600,000 (3.154B)', isError: false });
  });

  it('lets the interviewer check a calculation before judging it, then answers with the results', async () => {
    let n = 0;
    const { fetch, calls } = mockFetch((req) => {
      if (req.body.model === HAIKU) return messageResponse(JSON.stringify({ kind: 'improve', text: 'Show the per-day step.', covered: ['e1'], revealed: [] }), { model: HAIKU });
      return sseResponse(n++ === 0 ? toolCallEvents(['100 * 86400 * 365', '3.2B']) : streamEvents('Right: about 3.2 billion a year, in the accepted range.'));
    });
    const client = createClient({ ANTHROPIC_API_KEY: 'k' }, { fetch, retryDelayMs: 1 });
    const { state } = start(context, 45, T0);
    const pieces: string[] = [];
    const r = await turn({ client, context, now: T0 + 6 * MIN }, { ...state, phase: 'estimate' }, { message: '100/s × 86,400 × 365 ≈ 3.2B codes a year', onText: (t) => pieces.push(t) });
    const sonnet = calls.filter((c: Recorded) => c.body.model === SONNET);
    expect(sonnet).toHaveLength(2);
    expect(sonnet[0].body.tools).toEqual([CALCULATE_TOOL]);
    expect(sonnet[0].body.system[0].text).toContain('check the candidate\'s arithmetic and the reference answer with the calculate tool first');
    expect(sonnet[0].body.system[0].text).toContain('within 10x of the reference answer');
    expect(sonnet[0].body.system[1].text).toContain('the right order of magnitude 320,000,000 to 32,000,000,000');
    // The follow-up passes the answer back unchanged (thinking with its signature, the tool calls) and the server's results.
    const [assistant, results] = sonnet[1].body.messages.slice(-2);
    expect(assistant.role).toBe('assistant');
    expect((assistant.content as ContentBlock[])[0]).toEqual({ type: 'thinking', thinking: 'Checking their numbers.', signature: 'sig-1' });
    expect((assistant.content as ContentBlock[])[1]).toEqual({ type: 'tool_use', id: 'tu_0', name: 'calculate', input: { expression: '100 * 86400 * 365' } });
    expect(results.content as ToolResultBlock[]).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_0', content: '100 * 86400 * 365 = 3,153,600,000 (3.154B)' },
      { type: 'tool_result', tool_use_id: 'tu_1', content: '3.2B = 3,200,000,000 (3.2B)' },
    ]);
    expect(r.reply).toBe('Right: about 3.2 billion a year, in the accepted range.');
    expect(pieces.join('')).toBe(r.reply);
    // The stored transcript keeps only the reply's text; both calls are billed.
    expect(r.state.transcript.at(-1)!.text).toBe(r.reply);
    expect(r.billed.filter((b) => b.model === SONNET)).toHaveLength(2);
    expect(r.state.usage[SONNET].cache_read_input_tokens).toBe(3000 + 0);
    expect(r.state.covered).toEqual(['e1']);
  });

  it('charges the first call when the follow-up fails', async () => {
    let n = 0;
    const { fetch } = mockFetch(() => (n++ === 0 ? sseResponse(toolCallEvents(['1 + 1'])) : sseResponse(streamEvents('cut', { stop: 'max_tokens' }))));
    const client = createClient({ ANTHROPIC_API_KEY: 'k' }, { fetch, retryDelayMs: 1 });
    const err = await turn({ client, context, now: T0 + MIN }, start(context, 45, T0).state, { message: 'Is 1 + 1 two?' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).kind).toBe('truncated');
    expect((err as AiError).charge).toHaveLength(2);
    expect((err as AiError).usage?.cache_read_input_tokens).toBe(3000);
  });
});
