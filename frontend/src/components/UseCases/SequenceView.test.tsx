// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../../dsl/parser';
import { PlaybackClockContext, type PlaybackClock } from './playbackClock';
import SequenceView from './SequenceView';
import { UseCasePlayback } from './UseCasePlayback';

afterEach(cleanup);

const { diagram } = parse(`user [Actor]
api [REST API]
db [PostgreSQL]
user -> api
api -> db

usecase "Place order" {
  user -> api : POST /orders
  api -> db : INSERT order
  db --> api : 1 row
  api --> user : 201
}
`);
const useCase = diagram.useCases[0];
const scenario = useCase.scenarios[0];
const sequence = { useCase, scenario, nodes: diagram.nodes };
const played = { id: 'uc', name: useCase.name, steps: scenario.steps };

describe('SequenceView', () => {
  it('draws the participants as cards and the step playing in the accent', () => {
    const { container } = render(<SequenceView {...sequence} frame={1} />);
    expect([...container.querySelectorAll('.pc-seq__head .pc-node__name')].map((n) => n.textContent)).toEqual(['user', 'api', 'db']);
    expect(container.querySelector('.pc-seq__head[data-lit="active"]')).not.toBeNull();
    const looks = [...container.querySelectorAll('.pc-seq__msg')].map((g) => g.getAttribute('data-look'));
    expect(looks).toEqual(['past', 'lit', 'lit', 'future']);
  });

  it('rides the packet along the step playing on the playback clock: out, then back', () => {
    const packetAt = (progress: number) => {
      const clock = { subscribe: () => () => {}, get: () => progress } as unknown as PlaybackClock;
      const { container, unmount } = render(
        <PlaybackClockContext.Provider value={clock}>
          <SequenceView {...sequence} frame={1} />
        </PlaybackClockContext.Provider>,
      );
      const packets = [...container.querySelectorAll('.pc-seq__packets > g')].map((g) => g.getAttribute('transform'));
      unmount();
      return packets;
    };
    // Frame 1 is api -> db and its 1 row back: one packet at a time, none once it has arrived.
    const out = packetAt(20);
    const back = packetAt(70);
    expect(out).toHaveLength(1);
    expect(back).toHaveLength(1);
    expect(out[0]).not.toEqual(back[0]);
    expect(packetAt(100)).toEqual([]);
  });

  it('jumps to the step of a message that is clicked', () => {
    const onSelectFrame = vi.fn();
    render(<SequenceView {...sequence} frame={0} onSelectFrame={onSelectFrame} />);
    fireEvent.click(screen.getByRole('button', { name: /Step 2: api calls db/ }));
    expect(onSelectFrame).toHaveBeenCalledWith(1);
  });
});

describe('SequenceView zoom', () => {
  const pct = () => screen.getByRole('button', { name: /^Zoom \d+%/ }).textContent;

  it('zooms in and out with its buttons, and back to 100%', () => {
    render(<SequenceView {...sequence} frame={0} />);
    // A pane with no size (jsdom) fits its width at the floor.
    expect(pct()).toBe('60%');
    fireEvent.click(screen.getByRole('button', { name: 'zoom in' }));
    expect(pct()).toBe('72%');
    fireEvent.click(screen.getByRole('button', { name: 'zoom out' }));
    expect(pct()).toBe('60%');
    fireEvent.click(screen.getByRole('button', { name: /^Zoom 60%/ }));
    expect(pct()).toBe('100%');
  });

  it('fits the whole diagram on request', () => {
    render(<SequenceView {...sequence} frame={0} />);
    const fit = screen.getByRole('button', { name: 'fit view' });
    fireEvent.click(fit);
    expect(fit.getAttribute('aria-pressed')).toBe('true');
    expect(pct()).toBe('25%');
    // Zooming by hand leaves the fit.
    fireEvent.click(screen.getByRole('button', { name: 'zoom in' }));
    expect(fit.getAttribute('aria-pressed')).toBe('false');
  });

  it('zooms with Ctrl + wheel, and leaves a plain wheel to scroll', () => {
    render(<SequenceView {...sequence} frame={0} />);
    const view = screen.getByRole('figure');
    fireEvent.wheel(view, { deltaY: 40 });
    expect(pct()).toBe('60%');
    fireEvent.wheel(view, { deltaY: -40, ctrlKey: true });
    expect(Number(pct()!.replace('%', ''))).toBeGreaterThan(60);
  });
});

describe('UseCasePlayback layout switch', () => {
  const player = (withSequence: boolean) => (
    <ReactFlowProvider>
      <UseCasePlayback useCase={played} nodes={[]} edges={[]} onBack={() => {}} showHeader={false} sequence={withSequence ? sequence : undefined}>
        {() => <div data-testid="canvas" />}
      </UseCasePlayback>
    </ReactFlowProvider>
  );

  it('switches between the architecture and the sequence, keeping the canvas mounted', () => {
    const { container } = render(player(true));
    const architecture = screen.getByRole('button', { name: 'Architecture' });
    const sequenceButton = screen.getByRole('button', { name: 'Sequence' });
    expect(architecture.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.pc-seq')).toBeNull();

    fireEvent.click(sequenceButton);
    expect(sequenceButton.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.pc-seq')).not.toBeNull();
    expect(screen.getByTestId('canvas', { hidden: true })).toBeDefined();

    fireEvent.keyDown(window, { key: 'v' });
    expect(container.querySelector('.pc-seq')).toBeNull();
    expect(architecture.getAttribute('aria-pressed')).toBe('true');
  });

  it('has no switch without a sequence to show', () => {
    render(player(false));
    expect(screen.queryByRole('group', { name: 'Playback view' })).toBeNull();
  });
});
