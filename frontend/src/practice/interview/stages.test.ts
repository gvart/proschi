// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdownReader';
import { calc, countWords, loadStage, loadWorksheet, nextStage, plainText, revealBlocks, saveStage, saveWorksheet, shortNumber, splitByStage, STARTER_ROWS, worksheetPayload } from './stages';

describe('the brief revealed word by word', () => {
  const blocks = parseMarkdown('# Chat\n\nBuild a **chat service** for teams.\n\n- Send messages\n- Load history');

  it('counts every word once and ends with the whole brief', () => {
    expect(countWords(blocks)).toBe(1 + 6 + 2 + 2);
    expect(revealBlocks(blocks, countWords(blocks))).toEqual(blocks);
    expect(revealBlocks(blocks, 0)).toEqual([]);
  });

  it('cuts the block being typed, inside bold text and lists', () => {
    const three = revealBlocks(blocks, 4);
    expect(three).toHaveLength(2);
    expect(plainText(three)).toBe('Chat. Build a chat ');
    const list = revealBlocks(blocks, 8);
    expect(list.at(-1)).toMatchObject({ kind: 'list', items: [{ children: [{ kind: 'text', text: 'Send ' }] }] });
  });

  it('reads aloud as plain text', () => {
    expect(plainText(blocks)).toBe('Chat. Build a chat service for teams.. Send messages. Load history'.replace(/\.\.+/g, '.'));
  });
});

describe('the worksheet calculator', () => {
  it('evaluates arithmetic with suffixes, percentages and powers', () => {
    expect(calc('10k * 70%')).toBe(7000);
    expect(calc('100M / 30 / 86400')).toBeCloseTo(38.58, 2);
    expect(calc('(1 + 2) * 3')).toBe(9);
    expect(calc('2^10')).toBe(1024);
    expect(calc('1,000 × 2')).toBe(2000);
    expect(calc('-3 + 5')).toBe(2);
    expect(calc('3.2B * 500')).toBe(1.6e12);
  });

  it('refuses anything else', () => {
    expect(calc('')).toBeUndefined();
    expect(calc('lots')).toBeUndefined();
    expect(calc('1 +')).toBeUndefined();
    expect(calc('alert(1)')).toBeUndefined();
    expect(calc('1/0')).toBeUndefined();
  });

  it('shows values short', () => {
    expect(shortNumber(7000)).toBe('7k');
    expect(shortNumber(38.5802)).toBe('38.6');
    expect(shortNumber(1.6e12)).toBe('1.6T');
  });
});

describe('worksheet rows and stages', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the rows per interview and sends only the filled ones', () => {
    const rows = STARTER_ROWS.map((r, i) => (i === 0 ? { ...r, expression: ' 10k ' } : r));
    saveWorksheet('chat', rows);
    expect(loadWorksheet('chat')).toEqual(rows);
    expect(worksheetPayload(rows)).toEqual([{ label: 'Writes per second', expression: '10k', unit: '/s' }]);
    saveWorksheet('chat', undefined);
    expect(loadWorksheet('chat')).toBeUndefined();
  });

  it('remembers the stage and knows the next one', () => {
    expect(loadStage('x')).toBeUndefined();
    saveStage('x', 'estimate');
    expect(loadStage('x')).toBe('estimate');
    expect(nextStage('design')).toBe('wrapup');
    expect(nextStage('wrapup')).toBeUndefined();
  });

  it('splits the transcript by stage, untagged messages counting as Clarify', () => {
    const m = [{ text: 'hi' }, { text: 'q', stage: 'clarify' as const }, { text: 'n', stage: 'estimate' as const }, { text: 'd', stage: 'design' as const }];
    expect(splitByStage(m, 'estimate')).toEqual({ earlier: m.slice(0, 2), here: [m[2]] });
    expect(splitByStage(m, 'clarify').here).toHaveLength(2);
  });
});
