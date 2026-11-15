import { describe, expect, it } from 'vitest';
import { linkedInAddUrl, certificateUrl } from './certificate';
import { csvField, progressCsvFiles, toCsv, type ProgressExport } from './progressExport';

const DATA: ProgressExport = {
  exportedAt: '2026-11-09T10:00:00.000Z',
  displayName: 'Ada, "the first"',
  level: { level: 4, xp: 520 },
  readiness: 0.426,
  streak: { current: 3, longest: 9 },
  problemsSolved: 1,
  problemsTotal: 40,
  mastery: [{ topic: 'caching', title: 'Caching', mastery: 0.71 }],
  problems: [
    { problemId: 'url-shortener', title: 'URL Shortener', difficulty: 'easy', solved: true, solvedAt: '2026-10-01T00:00:00.000Z', runs: 2, firstRunAt: '2026-09-30T00:00:00.000Z', runsToSolve: 2, bestCostUsd: 12.5, bestP99Ms: 80 },
    { problemId: 'pastebin', title: 'Pastebin', difficulty: 'easy', solved: false, solvedAt: null, runs: 0, firstRunAt: null, runsToSolve: null, bestCostUsd: null, bestP99Ms: null },
  ],
  interviews: [{ id: 'i1', problemId: 'url-shortener', minutes: 45, status: 'finished', startedAt: '2026-10-02T00:00:00.000Z', endedAt: null, passed: true, scores: { design: 4, estimation: 3 } }],
  soloInterviews: [{ problemId: 'pastebin', startedAt: '2026-10-03T00:00:00.000Z', minutes: 30, totalMinutes: 28, reachedDesign: true, drew: true, solved: false }],
  cards: [{ cardId: 'cache-aside', reps: 3, lapses: 0, stabilityDays: 30, difficulty: 5, lastReviewAt: null, dueAt: '2026-11-10T00:00:00.000Z' }],
};

describe('progress export as CSV', () => {
  it('quotes commas, quotes and line breaks, and defuses formulas', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField(-3)).toBe('-3');
    expect(csvField(null)).toBe('');
    expect(csvField(true)).toBe('true');
    expect(toCsv(['a', 'b'], [[1, null]])).toBe('a,b\r\n1,\r\n');
  });

  it('makes one file per table, with the interview scores as columns', () => {
    const files = Object.fromEntries(progressCsvFiles(DATA).map((f) => [f.name, f.data]));
    expect(Object.keys(files)).toEqual(['summary.csv', 'mastery.csv', 'problems.csv', 'interviews.csv', 'cards.csv']);
    expect(files['summary.csv'].split('\r\n')[1]).toBe('2026-11-09T10:00:00.000Z,"Ada, ""the first""",4,520,43,3,9,1,40');
    expect(files['mastery.csv']).toBe('topic,title,mastery_percent\r\ncaching,Caching,71\r\n');
    expect(files['problems.csv'].split('\r\n')[2]).toBe('pastebin,Pastebin,easy,false,,0,,,,');
    const interviews = files['interviews.csv'].split('\r\n');
    expect(interviews[0]).toBe('mode,problem_id,started_at,minutes,status,passed,score_design,score_estimation,reached_design,solved');
    expect(interviews[1]).toBe('interviewer,url-shortener,2026-10-02T00:00:00.000Z,45,finished,true,4,3,,');
    expect(interviews[2]).toBe('on your own,pastebin,2026-10-03T00:00:00.000Z,30,finished,,,,true,false');
    expect(files['cards.csv'].split('\r\n')[1]).toBe('cache-aside,3,0,30,5,,2026-11-10T00:00:00.000Z');
  });
});

describe('certificate links', () => {
  it('fills in LinkedIn’s add-certification form', () => {
    const url = certificateUrl('https://proschi.app', 'Ab3_x-9QrT0z');
    expect(url).toBe('https://proschi.app/c/Ab3_x-9QrT0z');
    const link = new URL(linkedInAddUrl({ id: 'Ab3_x-9QrT0z', issuedAt: Date.parse('2026-11-09T00:00:00Z') / 1000 }, url));
    expect(link.origin + link.pathname).toBe('https://www.linkedin.com/profile/add');
    expect(Object.fromEntries(link.searchParams)).toEqual({
      startTask: 'CERTIFICATION_NAME',
      name: 'System Design Mastery',
      organizationName: 'Proschi',
      issueYear: '2026',
      issueMonth: '11',
      certUrl: 'https://proschi.app/c/Ab3_x-9QrT0z',
      certId: 'Ab3_x-9QrT0z',
    });
  });
});
