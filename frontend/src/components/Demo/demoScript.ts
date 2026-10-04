/**
 * The landing page's live demo as a timeline: Proschi text typed in chunks
 * (the diagram grows after each one), then a use case played through it, the
 * happy path first and then the way it fails, then the editor is handed over.
 * Plain data, so tests can check every chunk boundary parses cleanly.
 */

export type DemoStep =
  /** Types `text` at the end of the document; `say` is the caption while it does. */
  | { kind: 'type'; text: string; say: string }
  /** Holds still (e.g. while the diagram settles). */
  | { kind: 'wait'; ms: number }
  /** Plays one scenario of the use case on the diagram, until the player says it finished. */
  | { kind: 'play'; scenario: string; say: string }
  /** The tour is over: the visitor gets the editor. */
  | { kind: 'handoff'; say: string };

export const DEMO_FILE = 'checkout.proschi';
export const DEMO_USE_CASE = { id: 'place-order', name: 'Place order' };

export const DEMO_SCRIPT: DemoStep[] = [
  { kind: 'wait', ms: 500 },
  { kind: 'type', say: 'Write a service…', text: 'title "Checkout"\n\nweb "Web Shop" [Actor]\n' },
  { kind: 'wait', ms: 700 },
  {
    kind: 'type',
    say: '…and what sits behind it.',
    text: '\ngroup vpc "AWS VPC" {\n  api "Order API" [REST API]   @orders\n  db  "Orders DB" [PostgreSQL] @orders\n}\nevents "OrderEvents" [Kafka] @platform\n',
  },
  { kind: 'wait', ms: 900 },
  {
    kind: 'type',
    say: 'Connect them. The diagram lays itself out.',
    text: '\nweb -> api    : HTTPS\napi -> db     : SQL\napi -> events : publish\n',
  },
  { kind: 'wait', ms: 900 },
  {
    kind: 'type',
    say: 'Now a use case: one request, two endings.',
    text: [
      '',
      'usecase "Place order" {',
      '  web -> api : POST /orders json {"sku": "A1"}',
      '',
      '  alt "Placed" {',
      '    api  -> db     : INSERT order',
      '    api ->> events : OrderPlaced {"orderId": "o-1"}',
      '    api --> web    : 201 {"orderId": "o-1"}',
      '  } alt "DB down" {',
      '    api  -x db  : INSERT order',
      '    api --> web : 503 {"error": "retry_later"}',
      '  }',
      '}',
    ].join('\n'),
  },
  { kind: 'wait', ms: 700 },
  { kind: 'play', scenario: 'placed', say: 'Press play: the happy path, step by step.' },
  { kind: 'wait', ms: 400 },
  { kind: 'play', scenario: 'db-down', say: 'Now the database is down. The request dies there, not in production.' },
  { kind: 'wait', ms: 400 },
  { kind: 'handoff', say: 'Your turn — edit anything.' },
];

/** The whole document, as it stands once the tour has typed everything. */
export const DEMO_SOURCE = DEMO_SCRIPT.map((s) => (s.kind === 'type' ? s.text : '')).join('');

/** Where the tour is: the step it is on, and how much of a `type` step's text is typed. */
export interface TourFrame {
  index: number;
  typed: number;
}

export const TOUR_START: TourFrame = { index: 0, typed: 0 };
export const TOUR_END: TourFrame = { index: DEMO_SCRIPT.length - 1, typed: 0 };

/** The document at a point of the tour. */
export function sourceAt(frame: TourFrame, script: DemoStep[] = DEMO_SCRIPT): string {
  let out = '';
  for (let i = 0; i < frame.index && i < script.length; i++) {
    const step = script[i];
    if (step.kind === 'type') out += step.text;
  }
  const current = script[frame.index];
  if (current?.kind === 'type') out += current.text.slice(0, frame.typed);
  return out;
}

/** The caption at a point of the tour: the last thing said up to here. */
export function captionAt(frame: TourFrame, script: DemoStep[] = DEMO_SCRIPT): string {
  for (let i = Math.min(frame.index, script.length - 1); i >= 0; i--) {
    const step = script[i];
    if (step.kind !== 'wait') return step.say;
  }
  return '';
}

/** Chapter of the tour for the status line: Write it, See it, Play it, then the hand-off. */
export function chapterAt(frame: TourFrame, script: DemoStep[] = DEMO_SCRIPT): 1 | 2 | 3 | 4 {
  const step = script[frame.index];
  if (step?.kind === 'handoff') return 4;
  if (script.slice(0, frame.index + 1).some((s) => s.kind === 'play')) return 3;
  // Once something is on the canvas, the diagram is the story.
  const typedSteps = script.slice(0, frame.index).filter((s) => s.kind === 'type').length;
  return typedSteps >= 2 ? 2 : 1;
}

/** One tick of typing: how many characters, and how long until the next tick. */
export function typingTick(text: string, typed: number): { chars: number; delay: number } {
  // Leading indentation goes in one go; words go two characters a tick; a line end pauses.
  const rest = text.slice(typed);
  const indent = /^\n?[ ]+/.exec(rest)?.[0].length ?? 0;
  if (indent > 1) return { chars: indent, delay: 30 };
  const chars = Math.min(2, rest.length);
  const delay = rest.slice(0, chars).includes('\n') ? 110 : 28;
  return { chars, delay };
}

export interface TourCallbacks {
  onFrame: (frame: TourFrame) => void;
}

/**
 * Runs the timeline: types, waits, and stops at a `play` step until `played()`
 * says the player finished. `pause()`/`resume()` hold and continue it (offscreen,
 * or the visitor's Pause button). Uses only timers: no storage, no history.
 */
export class Tour {
  private frame: TourFrame = TOUR_START;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private readonly script: DemoStep[];
  private readonly onFrame: (frame: TourFrame) => void;

  constructor({ onFrame }: TourCallbacks, script: DemoStep[] = DEMO_SCRIPT) {
    this.onFrame = onFrame;
    this.script = script;
  }

  get current(): TourFrame {
    return this.frame;
  }

  get step(): DemoStep | undefined {
    return this.script[this.frame.index];
  }

  get done(): boolean {
    return this.step?.kind === 'handoff';
  }

  start(): void {
    this.stop();
    this.set(TOUR_START);
    this.resume();
  }

  resume(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  pause(): void {
    this.running = false;
    this.stop();
  }

  /** The player finished the scenario of the current `play` step. */
  played(): void {
    if (this.step?.kind === 'play') this.advance();
  }

  /** Jumps to the hand-off. */
  finish(): void {
    this.pause();
    this.set(TOUR_END);
  }

  private stop() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private set(frame: TourFrame) {
    this.frame = frame;
    this.onFrame(frame);
  }

  private advance() {
    this.stop();
    this.set({ index: Math.min(this.frame.index + 1, this.script.length - 1), typed: 0 });
    this.schedule();
  }

  private schedule() {
    if (!this.running || this.timer !== undefined) return;
    const step = this.step;
    if (!step) return;
    if (step.kind === 'type') {
      if (this.frame.typed >= step.text.length) return this.advance();
      const { chars, delay } = typingTick(step.text, this.frame.typed);
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.set({ index: this.frame.index, typed: this.frame.typed + chars });
        this.schedule();
      }, delay);
    } else if (step.kind === 'wait') {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.advance();
      }, step.ms);
    }
    // 'play' waits for played(); 'handoff' is the end.
  }
}
