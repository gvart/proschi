// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeaturesContext, type FeatureLookup } from '../../../components/featureState';
import type { FeatureId } from '../../../services/featureContract';
import { getReport, startInterview, type Verdict } from './api';
import { VerdictView } from './AiInterviewPanel';
import InterviewReport from './InterviewReport';

const verdict: Verdict = {
  passed: true,
  scores: { requirements: 4, estimation: 2, design: 4, tradeoffs: 3, communication: 5 },
  wentWell: [{ skill: 'requirements', text: 'Asked about the read to write ratio first.' }],
  wentWrong: [{ skill: 'estimation', text: 'Skipped the storage estimate.' }],
  nextSteps: ['Practise storage estimates'],
};
const report = { id: 's1', problem: 'url-shortener', minutes: 45, status: 'finished', startedAt: Date.UTC(2026, 10, 6, 10), endedAt: Date.UTC(2026, 10, 6, 10, 41), deep: true, verdict };

/** The features as GET /api/me/plan would answer: `on` are ok, the rest need a plan. */
const features =
  (...on: FeatureId[]): FeatureLookup =>
  (id) =>
    on.includes(id) ? { ok: true, loading: false } : { ok: false, reason: 'needs_pro', loading: false };

let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetch = vi.fn(async (url: string) => {
    if (String(url).endsWith('/report')) return Response.json({ report });
    return Response.json({ next: null });
  });
  vi.stubGlobal('fetch', fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the interview client, Max extras', () => {
  it('asks for a Deep verdict only when chosen, and reads the report by id', async () => {
    fetch.mockImplementation(async () => Response.json({ interview: { id: 's1' }, report }));
    await startInterview('url-shortener', 45);
    await startInterview('url-shortener', 30, false, true);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({ problem: 'url-shortener', minutes: 45 });
    expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toEqual({ problem: 'url-shortener', minutes: 30, deep: true });
    await getReport('s 1');
    expect(fetch.mock.calls[2][0]).toBe('/api/interviews/s%201/report');
  });
});

describe('<VerdictView>, Max extras', () => {
  it('says when the verdict was Deep, and offers the report only with interview_report', async () => {
    const { rerender } = render(
      <FeaturesContext.Provider value={features()}>
        <VerdictView picksFor="s1" deep verdict={verdict} />
      </FeaturesContext.Provider>,
    );
    expect(screen.getByTestId('verdict-deep').textContent).toContain('Deep verdict');
    expect(screen.queryByRole('button', { name: /Print report/ })).toBeNull();

    rerender(
      <FeaturesContext.Provider value={features('interview_report')}>
        <VerdictView picksFor="s1" verdict={verdict} />
      </FeaturesContext.Provider>,
    );
    expect(screen.queryByTestId('verdict-deep')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Print report/ })));
    expect(await screen.findByRole('dialog', { name: 'Interview report' })).toBeTruthy();
  });
});

describe('<InterviewReport>', () => {
  it('lays out the verdict for print, and prints with the browser', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const onClose = vi.fn();
    render(<InterviewReport id="s1" onClose={onClose} />);
    expect(document.body.classList.contains('printing-report')).toBe(true);
    const dialog = await screen.findByRole('dialog', { name: 'Interview report' });
    await screen.findByTestId('report-result');
    expect(dialog.classList.contains('ps-light')).toBe(true);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('URL Shortener');
    expect(screen.getByTestId('report-result').textContent).toBe('Pass');
    expect(screen.getByTestId('report-deep').textContent).toBe('Deep verdict');
    expect(dialog.textContent).toContain('45 min planned, 41 min used');
    expect(dialog.textContent).toContain('2/5');
    expect(dialog.textContent).toContain('Skipped the storage estimate.');
    expect(dialog.textContent).toContain('No design to show');

    fireEvent.click(screen.getByRole('button', { name: /Print or save as PDF/ }));
    expect(print).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    cleanup();
    expect(document.body.classList.contains('printing-report')).toBe(false);
  });
});
