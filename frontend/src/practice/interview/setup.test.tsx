// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Setup from './Setup';
import { currentStep, nextStep, prevStep, setupSteps } from './setupSteps';

describe('the set-up wizard’s screens', () => {
  it('asks who interviews you only where the interviewer exists, and voice or text only for it', () => {
    expect(setupSteps({ who: true, kind: 'mock' })).toEqual(['who', 'problem', 'length', 'talk', 'review']);
    expect(setupSteps({ who: true, kind: 'solo' })).toEqual(['who', 'problem', 'length', 'review']);
    expect(setupSteps({ who: false, kind: 'solo' })).toEqual(['problem', 'length', 'review']);
  });

  it('steps forward and back, and a screen that is gone falls back to the first', () => {
    const steps = setupSteps({ who: true, kind: 'solo' });
    expect(nextStep(steps, 'length')).toBe('review');
    expect(nextStep(steps, 'review')).toBe('review');
    expect(prevStep(steps, 'problem')).toBe('who');
    expect(prevStep(steps, 'who')).toBeUndefined();
    expect(currentStep(steps, 'talk')).toBe('who');
    expect(currentStep(setupSteps({ who: false, kind: 'solo' }), 'who')).toBe('problem');
  });
});

describe('the set-up wizard on your own', () => {
  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = vi.fn();
  });
  afterEach(cleanup);

  const heading = () => screen.getByRole('heading', { level: 2 });

  it('runs straight through on the defaults: Continue, Enter, then Start on a surprise', () => {
    const onStarted = vi.fn();
    render(<Setup onStarted={onStarted} />);
    expect(heading()).toHaveProperty('textContent', 'Which problem?');
    expect(screen.getByTestId('setup-progress').textContent).toBe('Step 1 of 3');
    expect(screen.getByRole('radio', { name: 'Surprise me' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: /^Back/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    expect(heading().textContent).toBe('How long?');
    expect(document.activeElement).toBe(heading());
    expect(screen.getByRole('radio', { name: '45 min' }).getAttribute('aria-checked')).toBe('true');

    // Enter on the question continues.
    fireEvent.keyDown(heading(), { key: 'Enter' });
    expect(heading().textContent).toBe('Ready when you are');
    expect(screen.getByTestId('solo-free').textContent).toMatch(/^Free\./);
    expect(screen.queryByTestId('consent-line')).toBeNull();
    // Enter never starts: Start needs a click.
    fireEvent.keyDown(heading(), { key: 'Enter' });
    expect(onStarted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start the interview' }));
    expect(onStarted).toHaveBeenCalledOnce();
    expect(onStarted.mock.calls[0][0]).not.toBe('hello-proschi');
  });

  it('arrow keys choose a card; a row of the review opens its screen and Continue comes back', () => {
    render(<Setup onStarted={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    const minutes45 = screen.getByRole('radio', { name: '45 min' });
    fireEvent.keyDown(minutes45, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: '60 min' }).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '60 min' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(screen.getByRole('list', { name: 'Your interview' }).textContent).toContain('60 min');

    fireEvent.click(screen.getByRole('button', { name: 'Change the length' }));
    expect(heading().textContent).toBe('How long?');
    fireEvent.click(screen.getByRole('radio', { name: '30 min' }));
    fireEvent.click(screen.getByRole('button', { name: /^Back to review/ }));
    expect(heading().textContent).toBe('Ready when you are');
    expect(screen.getByRole('list', { name: 'Your interview' }).textContent).toContain('30 min');
  });

  it('browser Back steps back through the screens', () => {
    render(<Setup onStarted={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    expect(heading().textContent).toBe('Ready when you are');
    act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: { psSetup: 'length' } })));
    expect(heading().textContent).toBe('How long?');
    act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: null })));
    expect(heading().textContent).toBe('Which problem?');
  });

  it('the filters fold under Surprise me, and an empty pool cannot continue', () => {
    render(<Setup onStarted={() => {}} />);
    const filters = screen.getByRole('button', { name: /^Filters/ });
    expect(filters.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('radiogroup', { name: 'Difficulty' })).toBeNull();
    fireEvent.click(filters);
    fireEvent.click(screen.getByRole('radio', { name: 'Hard' }));
    expect(screen.getByTestId('pool-size').textContent).toMatch(/^\d+ problems? to draw from/);
    // A topic no hard problem has.
    fireEvent.click(screen.getByRole('button', { name: /^All \d+ topics/ }));
    const topics = screen.getByRole('radiogroup', { name: 'Topic' });
    for (const radio of topics.querySelectorAll('[role="radio"]')) {
      fireEvent.click(radio);
      if (screen.getByTestId('pool-size').textContent === 'No problem matches these filters.') break;
    }
    expect(screen.getByTestId('pool-size').textContent).toBe('No problem matches these filters.');
    expect(screen.getByRole('button', { name: /^Continue/ })).toHaveProperty('disabled', true);
  });
});
