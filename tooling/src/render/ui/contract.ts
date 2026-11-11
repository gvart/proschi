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
 *   each tile a full-width strip, top to bottom: a keyed Image `rows` tall
 *   (an empty Box where it has no file). One overlay Client over the drawing
 *   maps the pointer to the strips' control areas (plugin/src/picture.tsx);
 *   an area's `hoverFile` and `pressedFile`, when asked for, are blitted into
 *   its strip under the pointer and while its button is down.
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
  /** False: the hotkey presses it but no keycap is drawn (a compact bar). */
  keycap?: boolean;
}

/** One option of a select: its label, a group heading over it, a detail at its right end, a mark before it in a tone (a scenario's ✓ or ✗). */
export interface Option {
  value: string;
  label: string;
  group?: string;
  detail?: string;
  icon?: Icon;
  tone?: Tone;
  /** A hairline above it: an entry apart from the options (Explore all…). */
  divider?: boolean;
}

/**
 * A closed dropdown: the value shown and a chevron; `open` draws its menu
 * under it (or, in the player bar, the plugin floats a MenuPanel over the
 * drawing), each option a control `${id}=${value}`.
 */
export interface Select {
  id: string;
  value: string;
  options: Option[];
  open?: boolean;
  hotkey?: string;
  /** Fixed width in columns: as wide whichever option is shown. */
  columns?: number;
  disabled?: boolean;
  /** With `open`, drawn open but its menu not under the row: the plugin floats it (MenuPanel). */
  floats?: boolean;
}

/** A label, a control or a select in a row of controls. */
export type Item = { text: Rich; columns?: number } | { control: Control } | { select: Select } | { spacer: true } | { progress: number; columns?: number };

// ---------- the chrome panels around the diagram ----------

/** The pane's tabs (D3): each with its digit; a badge (Tests' failing count) in its tone; `open` at the row's right end (↗ Open in Proschi), shortened where the row is narrow. */
export interface TabBarPanel {
  kind: 'tabs';
  tabs: { id: string; label: string; hotkey?: string; badge?: { text: string; tone: Tone } }[];
  active: string;
  open?: Control;
}

/** The scenario buttons of the explorer. */
export interface ScenarioChip {
  /** The control id: a press plays it. */
  id: string;
  name: string;
  outcome: 'ok' | 'error';
  /** The status the error path ends with. */
  status?: number;
  current?: boolean;
}

/**
 * The player on top of a drawing (playerBar), one size whether a scenario
 * plays or not: a row with the use case and scenario pickers, the step
 * controls (dimmed until Play), the step count and a progress bar; under it
 * one line, the current step (or a note before Play) and the bodies toggle.
 * The pickers' menus, the bodies and the explorer float over the drawing
 * (MenuPanel, DrawerPanel, ExplorerPanel), so nothing under the bar moves.
 */
export interface PlayerBarPanel {
  kind: 'playerBar';
  useCase: Select;
  scenario: Select;
  /** Control ids: `first`, `prev`, `play` (Play or Pause), `next`, `last`, `stop`. */
  controls: Control[];
  /** The step shown (1-based; absent before Play) of `total`. */
  step: { at?: number; total: number };
  /** The second line: the step's number in a disc (red where it errs) and what it is, or a dim note. */
  line: { number?: number; error?: boolean; text: Rich };
  /** Body ▾ at the second line's end: the request and response drawer. */
  body?: Control;
}

/** A select's menu floating over the drawing under its select: an option per row, each a control `${id}=${value}`. */
export interface MenuPanel {
  kind: 'menu';
  select: Select;
}

/** The current step's card floating over the drawing under the player bar: what it sends and gets back, bodies highlighted. */
export interface DrawerPanel {
  kind: 'drawer';
  condition?: string;
  cards: StepCard[];
  close?: Control;
}

/** Every use case by endpoint, each scenario a control that plays it: floating over the drawing. */
export interface ExplorerPanel {
  kind: 'explorer';
  groups: { label?: string; useCases: { name: string; current?: boolean; scenarios: ScenarioChip[] }[] }[];
  close?: Control;
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

export type Block =
  /** `anchor`: the row it starts on is in the panel's answer (PanelOutput.anchors), for a table of contents to scroll to. */
  | { type: 'heading'; text: Rich; level?: 1 | 2 | 3; anchor?: string }
  | { type: 'paragraph'; text: Rich; tone?: Tone; indent?: number; small?: boolean }
  | { type: 'stats'; items: { label: string; value: string; tone?: Tone }[] }
  | { type: 'table'; columns: Column[]; rows: Row[] }
  | { type: 'callout'; tone: 'warn' | 'bad' | 'good' | 'info'; text: Rich; chip?: string }
  | { type: 'controls'; items: Item[] }
  | { type: 'code'; text: string; language?: string; maxLines?: number }
  | { type: 'list'; items: Rich[]; ordered?: boolean; indent?: number }
  | { type: 'check'; passed: boolean; title: Rich; where?: string; message?: string; hint?: string; indent?: number }
  | { type: 'quote'; text: Rich }
  | { type: 'rule' }
  | { type: 'space'; rows?: number }
  /**
   * A drawing of the page's `source` (PagePanel.source): the architecture or
   * a use case's sequence, framed, scaled down to the page's width and to at
   * most `maxRows` rows. The raster helper draws it into `svg` before laying
   * the page out; without one it says it was not drawn.
   */
  | { type: 'figure'; of: Figure; caption?: string; maxRows?: number; svg?: string };

/** What a figure draws: the architecture, or a use case's scenario (its first when none is named) as a sequence. */
export type Figure = { architecture: true } | { useCase: string; scenario?: string };

/** A tab's body as blocks top to bottom: Analysis, Tests, HLD (data.ts builds them). */
export interface PagePanel {
  kind: 'page';
  blocks: Block[];
  /** The design its figures draw. */
  source?: { source: string; path?: string; imports?: Record<string, string> };
}

/** The Sequence tab: the scenario picker and the scenario as `proschi render` draws it, a still with the Diagram tab's current steps lit. */
export interface SequencePanel {
  kind: 'sequence';
  source: { source: string; path?: string; imports?: Record<string, string> };
  useCase: string;
  scenario?: string;
  /** The 1-based step numbers lit (the current step and its par siblings). */
  current?: number[];
  /** The controls over the drawing (the scenario picker), as a page's controls row. */
  controls?: Item[];
}

export type Panel = TabBarPanel | PlayerBarPanel | MenuPanel | DrawerPanel | ExplorerPanel | SystemBarPanel | ActionBarPanel | NoticesPanel | PagePanel | SequencePanel;

// ---------- the request and the answer ----------

/** One panel to draw, `columns` cells wide. */
export interface PanelRequest {
  /** Echoed in the answer. */
  id?: string;
  panel: Panel;
  columns: number;
  /** Extra pictures per control tile: under the pointer, pressed. Default `['hover']`. */
  variants?: ('hover' | 'pressed')[];
  /**
   * Where the panel sits in its drawing, which is one continuous surface: its
   * first piece (`top`, rounded corners above) or its last (`bottom`), else a
   * divider along its top and square corners. Default neither.
   */
  edges?: { top?: boolean; bottom?: boolean };
}

/** stdin of `raster.cjs` for panels; `diagram` is the diagram request (RasterInput less outDir and prune) drawn in the same run. */
export interface PanelsInput {
  kind: 'panels';
  outDir: string;
  prune?: boolean;
  theme?: UiTheme;
  panels: PanelRequest[];
  diagram?: Record<string, unknown>;
  /**
   * The terminal's cell, height over width (default CELL_ASPECT, 17 / 8). The
   * layout is on an 8×17 grid whatever it is; the pictures are drawn 16 px a
   * column and round(16 × aspect) px a row, so they fill the terminal's cells.
   */
  cellAspect?: number;
}

/** A cell's height over its width as the panels are laid out (render/ui/kit.ts CELL). */
export const CELL_ASPECT = 17 / 8;

/** What a control tile presses. */
export interface TileControl {
  id: string;
  hotkey?: string;
  kind: 'button' | 'tab' | 'select' | 'option' | 'toggle';
  disabled?: boolean;
}

/** A control's place in its strip: its columns, the strip's rows; the strip drawn with it under the pointer, and pressed. */
export interface TileArea {
  control: TileControl;
  col: number;
  columns: number;
  hoverFile?: string;
  pressedFile?: string;
}

/**
 * A strip: a full-width picture of whole rows of the panel, `columns` ×
 * `rows` from (`col`, `row`), 0-based. The strips of a panel cover it top to
 * bottom with no gap or overlap.
 */
export interface Tile {
  col: number;
  row: number;
  columns: number;
  rows: number;
  /** Absolute path of the PNG (`{ file, format: 'png' }`); absent when the strip draws nothing (an empty Box stands in). */
  file?: string;
  /** The controls drawn in it, left to right. */
  controls?: TileArea[];
}

export interface PanelOutput {
  id?: string;
  kind: Panel['kind'];
  columns: number;
  rows: number;
  /** PNG px per cell. */
  cellPx: { width: number; height: number };
  tiles: Tile[];
  /** The row each anchored heading starts on (a page's sections, by `Block.anchor`): what a table of contents scrolls to. */
  anchors?: Record<string, number>;
}

/** stdout for a PanelsInput. */
export interface PanelsOutput {
  panels: (PanelOutput | { id?: string; error: string })[];
  diagram?: Record<string, unknown> | { error: string };
}
