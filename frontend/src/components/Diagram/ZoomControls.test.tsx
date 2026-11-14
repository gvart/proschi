// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasControls, ZoomControls } from './ZoomControls';

afterEach(cleanup);

const handlers = () => ({ onZoomIn: vi.fn(), onZoomOut: vi.fn(), onFit: vi.fn(), onReset: vi.fn() });

describe('ZoomControls', () => {
  it('shows the zoom level, which resets to 100%', () => {
    const on = handlers();
    render(<ZoomControls zoom={1.234} min={0.25} max={2} fitted={false} {...on} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 123%, reset to 100%' }));
    expect(on.onReset).toHaveBeenCalled();
  });

  it('presses fit while fitted and disables zooming past the limits', () => {
    render(<ZoomControls zoom={2} min={0.25} max={2} fitted {...handlers()} />);
    expect(screen.getByRole('button', { name: 'fit view' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'zoom in' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'zoom out' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps extra buttons below its own', () => {
    render(
      <ZoomControls zoom={1} min={0.25} max={2} fitted={false} {...handlers()}>
        <button type="button">Minimap</button>
      </ZoomControls>,
    );
    expect(screen.getAllByRole('button').at(-1)!.textContent).toBe('Minimap');
  });
});

describe('CanvasControls', () => {
  it('shows the canvas zoom', () => {
    render(
      <ReactFlowProvider>
        <CanvasControls />
      </ReactFlowProvider>,
    );
    expect(screen.getByRole('button', { name: /^Zoom 100%/ })).toBeDefined();
    expect(screen.getByRole('button', { name: 'fit view' }).getAttribute('aria-pressed')).toBe('false');
  });
});
