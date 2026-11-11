/**
 * What the raster helper (plugin/hooks/raster.cjs) takes and answers for the
 * mod's rendered UI: panels drawn whole in the canvas's style, then cut on the
 * terminal's cell grid into tiles, each control its own tile
 * (docs/impl/terminal-rendered-ui.md). Types only, so the plugin imports them
 * without pulling in the drawing.
 *
 * A panel is plain data: the words, numbers and states the text UI shows
 * (plugin/src/register.tsx, plugin/src/views), with an `id` per control. The
 * plugin builds the data (render/ui/data.ts has builders for the tabs whose
 * content comes from the simulation) and lays the answer's tiles out:
 *
 *   for each strip (tiles of one `row`, left to right, `columns` adding up to
 *   the panel's): a row Box of `rows` height, each tile a keyed Image. One
 *   overlay Client over the drawing maps the pointer to the tiles with a
 *   `control` (plugin/src/picture.tsx); `hoverFile` and `pressedFile`, when
 *   asked for, are blitted into the control's tile under the pointer and
 *   while its button is down.
 */

/** The theme a panel is drawn in: the canvas's tokens (frontend/src/utils/canvasColors.ts CANVAS_TOKENS). */
export type UiTheme = 'light' | 'dark';

/** A colour by meaning, resolved per theme. */
export type Tone = 'ink' | 'muted' | 'accent' | 'good' | 'warn' | 'bad' | 'info';

/** A run of text in one style. */
export interface Span {
  text: string;
  tone?: Tone;
  bold?: boolean;
  /** JetBrains Mono, as code. */
  mono?: boolean;
  /** Drawn as a chip: a filled pill in this tone (BOTTLENECK, a status code). */
  chip?: Tone;
}

/** Text: plain, or runs in their own style. */
export type Rich = string | Span[];

/** Small glyphs the kit draws as paths (no font has them all). */
export type Icon =
  | 'play'
  | 'pause'
  | 'first'
  | 'prev'
  | 'next'
  | 'last'
  | 'exit'
  | 'back'
  | 'copy'
  | 'open'
  | 'focus'
  | 'explore'
  | 'reset'
  | 'power'
  | 'expand'
  | 'collapse'
  | 'enter'
  | 'leave'
  | 'cycle'
  | 'chevron-down'
  | 'check'
  | 'cross'
  | 'warn'
  | 'bolt';

/**
 * A pressable control. `id` is what the answer's tile names, so the plugin
 * knows which press it is; unique within a panel.
 */
export interface Control {
  id: string;
  label?: string;
  icon?: Icon;
  /** The key that presses it in the pane; drawn as a keycap hint. */
  hotkey?: string;
  /** `primary` is the yellow call to action, `quiet` a borderless secondary control. */
  variant?: 'default' | 'primary' | 'quiet';
  /** Drawn faded; the tile still carries the control, the plugin decides. */
  disabled?: boolean;
  /** A toggle that is on: drawn pressed in. */
  active?: boolean;
  /** Fixed width in columns, so swapping labels (Play/Pause) moves nothing. */
  columns?: number;
}

/** A closed dropdown: the value shown and a chevron; `open` draws its menu under it, each option a control `${id}=${value}`. */
export interface Select {
  id: string;
  value: string;
  options: { value: string; label: string; group?: string; detail?: string }[];
  open?: boolean;
  hotkey?: string;
}

/** A label, a control or a select in a row of controls. */
export type Item = { text: Rich } | { control: Control } | { select: Select } | { spacer: true } | { progress: number; columns?: number };

// ---------- the chrome panels around the diagram ----------

/** The pane's tabs (D3): each with its digit; a badge (Tests' failing count) in its tone. */
export interface TabBarPanel {
  kind: 'tabs';
  tabs: { id: string; label: string; hotkey?: string; badge?: { text: string; tone: Tone } }[];
  active: string;
}

/** The scenario buttons of the explorer and the player header. */
export interface ScenarioChip {
  /** The control id: a press plays it. */
  id: string;
  name: string;
  outcome: 'ok' | 'error';
  /** The status the error path ends with. */
  status?: number;
  current?: boolean;
}

/** Picking a use case (useCaseBar): the picker, Play, the explorer toggle, and the explorer listing every scenario by endpoint. */
export interface UseCaseBarPanel {
  kind: 'useCaseBar';
  picker: Select;
  play: Control;
  explore: Control;
  explorer?: { label?: string; useCases: { name: string; current?: boolean; scenarios: ScenarioChip[] }[] }[];
}

/** Over the diagram while it plays (playerHeader): back to the diagram, the use case, a tab per scenario. */
export interface PlayerHeaderPanel {
  kind: 'playerHeader';
  back: Control;
  title: string;
  note?: string;
  scenarios?: ScenarioChip[];
}

/** A request or response body. */
export interface Body {
  format: 'JSON' | 'XML' | 'Text';
  text: string;
  /** The status a response came with; an error one is drawn red. */
  status?: number;
  error?: boolean;
}

/** One step as the editor's player shows it (UseCasePlayback.tsx). */
export interface StepCard {
  number: number;
  name: string;
  from: string;
  to: string;
  /** `GET /x`, when it is not the name. */
  call?: string;
  description?: string;
  exec: 'sync' | 'async' | 'fire';
  failed?: boolean;
  /** A 4xx/5xx answer. */
  status?: number;
  error?: boolean;
  request?: Body;
  response?: Body;
}

/**
 * The player's step panel (stepPanel): the step at `at` (with its parallel
 * siblings, `steps[at]` holds them all) over the controls. Every step's cards
 * are given so the panel is as tall as the tallest, and stepping moves nothing.
 */
export interface StepPanel {
  kind: 'step';
  condition?: string;
  steps: StepCard[][];
  at: number;
  playing: boolean;
  /** Control ids: `first`, `prev`, `play` (Play or Pause), `next`, `last`, `exit`; their hotkeys. */
  hotkeys?: Partial<Record<'first' | 'prev' | 'play' | 'next' | 'last' | 'exit', string>>;
}

/** The systems row (systemBar): where the view is, which system the keys act on, and what they can do with it. */
export interface SystemBarPanel {
  kind: 'systemBar';
  inside?: string;
  selected?: { name: string; path: string };
  controls: Control[];
}

/** Copy source, copy link, open in Proschi, focus (the row under a drawing). */
export interface ActionBarPanel {
  kind: 'actionBar';
  controls: Control[];
}

/** A warning line: the analysis's, a system note with its hint, a lost import. */
export interface Notice {
  text: string;
  hint?: string;
  tone?: 'warn' | 'muted' | 'bad';
}

/** The lines around a drawing: warnings over it, the load legend and the verdict under it. */
export interface NoticesPanel {
  kind: 'notices';
  notices?: Notice[];
  /** The load legend (LoadLegend.tsx): with the p99 path of the busiest use case. */
  legend?: { critical?: { useCase: string; p99: string } };
  /** `✓ All 3 checks pass` / `✗ 1 of 3 checks fail: <first>`. */
  verdict?: { passed: number; total: number; first?: string };
  /** ⛶ Details beside the verdict (the transcript's drawings). */
  details?: Control;
}

/** The what-if banner over every tab (D8). */
export interface BannerPanel {
  kind: 'banner';
  label: string;
  note?: string;
  reset: Control;
}

// ---------- pages: the tabs other than the diagram ----------

/** A cell of a table: text, a heat bar (utilisation, 0..1 and past it), or a control (a Preview per row). */
export type Cell = Rich | { bar: number; text: string; tone?: Tone } | { control: Control };

export interface Column {
  title: string;
  align?: 'left' | 'right';
  /** Dropped when the table does not fit, the highest first; never without one. */
  drop?: number;
}

/** A row of a table; `sub` draws it as a detail of the row above (indented, smaller). */
export interface Row {
  cells: Cell[];
  sub?: boolean;
  dim?: boolean;
}

/** Where each node saturates over a range of a use case's traffic (WhatIfResults.tsx SweepChart). */
export interface SweepChart {
  from: number;
  to: number;
  today: number;
  maxPassing?: number;
  /** Formatted rates for the axis and markers. */
  labels: { from: string; to: string; today: string; maxPassing?: string };
  bars: { node: string; rps: number; value: string; atStart?: boolean }[];
}

export type Block =
  | { type: 'heading'; text: Rich; level?: 1 | 2 | 3 }
  | { type: 'paragraph'; text: Rich; tone?: Tone; indent?: number; small?: boolean }
  | { type: 'stats'; items: { label: string; value: string; tone?: Tone }[] }
  | { type: 'table'; columns: Column[]; rows: Row[] }
  | { type: 'callout'; tone: 'warn' | 'bad' | 'good' | 'info'; text: Rich; chip?: string }
  | { type: 'controls'; items: Item[] }
  | { type: 'code'; text: string; language?: string; maxLines?: number }
  | { type: 'list'; items: Rich[]; ordered?: boolean; indent?: number }
  | { type: 'check'; passed: boolean; title: Rich; where?: string; message?: string; hint?: string; indent?: number }
  | { type: 'chart'; chart: SweepChart }
  | { type: 'quote'; text: Rich }
  | { type: 'rule' }
  | { type: 'space'; rows?: number };

/** A tab's body as blocks top to bottom: Analysis, What-if, Tests, HLD (data.ts builds them). */
export interface PagePanel {
  kind: 'page';
  blocks: Block[];
}

/** The Sequence tab: the scenario picker, the step keys, and the scenario as `proschi render` draws it, its current steps lit. */
export interface SequencePanel {
  kind: 'sequence';
  source: { source: string; path?: string; imports?: Record<string, string> };
  useCase: string;
  scenario?: string;
  /** The 1-based step numbers lit (the current step and its par siblings). */
  current?: number[];
  /** The controls over the drawing (a picker and the step keys), as a page's controls row. */
  controls?: Item[];
}

export type Panel = TabBarPanel | UseCaseBarPanel | PlayerHeaderPanel | StepPanel | SystemBarPanel | ActionBarPanel | NoticesPanel | BannerPanel | PagePanel | SequencePanel;

// ---------- the request and the answer ----------

/** One panel to draw, `columns` cells wide. */
export interface PanelRequest {
  /** Echoed in the answer. */
  id?: string;
  panel: Panel;
  columns: number;
  /** Extra pictures per control tile: under the pointer, pressed. Default `['hover']`. */
  variants?: ('hover' | 'pressed')[];
}

/** stdin of `raster.cjs` for panels; `diagram` is the diagram request (RasterInput less outDir and prune) drawn in the same run. */
export interface PanelsInput {
  kind: 'panels';
  outDir: string;
  prune?: boolean;
  theme?: UiTheme;
  panels: PanelRequest[];
  diagram?: Record<string, unknown>;
}

/** What a control tile presses. */
export interface TileControl {
  id: string;
  hotkey?: string;
  kind: 'button' | 'tab' | 'select' | 'option' | 'toggle';
  disabled?: boolean;
}

/**
 * A picture covering whole cells of the panel: `columns` × `rows` from (`col`,
 * `row`), 0-based. The tiles of a panel cover it exactly, no gaps or overlaps,
 * in strips: every tile of a strip has the same `row` and `rows`, and they are
 * listed left to right, strips top to bottom.
 */
export interface Tile {
  col: number;
  row: number;
  columns: number;
  rows: number;
  /** Absolute path of the PNG (`{ file, format: 'png' }`). */
  file: string;
  control?: TileControl;
  hoverFile?: string;
  pressedFile?: string;
}

export interface PanelOutput {
  id?: string;
  kind: Panel['kind'];
  columns: number;
  rows: number;
  /** PNG px per cell. */
  cellPx: { width: number; height: number };
  tiles: Tile[];
}

/** stdout for a PanelsInput. */
export interface PanelsOutput {
  panels: (PanelOutput | { id?: string; error: string })[];
  diagram?: Record<string, unknown> | { error: string };
}
