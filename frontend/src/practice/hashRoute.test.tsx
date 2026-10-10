// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHashRoute } from './hashRoute';

function Route() {
  return <p>{useHashRoute()}</p>;
}

afterEach(cleanup);

describe('useHashRoute', () => {
  it('opens a new address at the top and a revisited one where it was left', () => {
    window.history.replaceState(null, '', '#/review');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const { container } = render(<Route />);
    const reviewState = window.history.state as object;

    // Scrolled down on review, then a tab: the new address starts at the top.
    Object.defineProperty(window, 'scrollY', { value: 140, configurable: true });
    act(() => void window.dispatchEvent(new Event('scroll')));
    act(() => {
      window.history.pushState(null, '', '#/challenge');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(container.textContent).toBe('challenge');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    // Back: the review entry, stamped before, comes back to 140.
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    act(() => {
      window.history.pushState(reviewState, '', '#/review');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(container.textContent).toBe('review');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 140);
    scrollTo.mockRestore();
  });
});
