// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MicButton, { DENIED_TEXT } from './MicButton';

type Handler = ((e: unknown) => void) | null;
class Recognition {
  static last: Recognition;
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: Handler = null;
  onend: (() => void) | null = null;
  onerror: Handler = null;
  onstart: (() => void) | null = null;
  constructor() {
    Recognition.last = this;
  }
  start() {
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
  abort() {}
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('MicButton', () => {
  it('is hidden where there is no way to take voice input', () => {
    render(<MicButton onText={() => {}} server={false} />);
    expect(screen.queryByTestId('mic-button')).toBeNull();
  });

  it('listens on one tap, shows that it records, passes the words on, and stops on the next', () => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = Recognition;
    const onText = vi.fn();
    const onState = vi.fn();
    render(<MicButton onText={onText} onState={onState} />);
    const button = screen.getByTestId('mic-button');
    fireEvent.click(button);
    expect(button.getAttribute('data-state')).toBe('listening');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('Listening');
    act(() => Recognition.last.onresult!({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'how many' } }] }));
    expect(onText).toHaveBeenLastCalledWith('how many', false);
    fireEvent.click(button);
    expect(button.getAttribute('data-state')).toBe('idle');
    expect(onText).toHaveBeenLastCalledWith('how many', true);
    expect(onState.mock.calls.map((c) => c[0])).toEqual(['starting', 'listening', 'idle']);
  });

  it('says how to unblock a denied microphone', () => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = Recognition;
    render(<MicButton onText={() => {}} />);
    fireEvent.click(screen.getByTestId('mic-button'));
    act(() => {
      Recognition.last.onerror!({ error: 'not-allowed' });
      Recognition.last.onend!();
    });
    expect(screen.getByTestId('mic-button').getAttribute('data-state')).toBe('denied');
    expect(screen.getByTestId('mic-note').textContent).toBe(DENIED_TEXT);
  });
});
