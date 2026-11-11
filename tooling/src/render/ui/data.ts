import type { DiagramScenario, FlowStep } from '../../../../frontend/src/dsl/types';
import { HOT, availabilityRow, costBreakdown, costRow, headlineOf, p99Row, runWhatIfs, type CostShare, type DeltaRow, type NodeAnalysis, type TestResult, type WhatIfResult } from '../../../../frontend/src/sim';
import { formatAvailability, formatCount, formatDuration, formatMs, formatPercent, formatRps, formatTraffic, formatUsd } from '../../../../frontend/src/sim/format';
import { BOTTLENECK_FROM, busiestOf } from '../../../../frontend/src/sim/overlay';
import { currentStepsOf, isErrorStep } from '../../terminal/playback';
import type { Document } from '../../terminal/document';
import type { Block, Body, PagePanel, Row, Span, StepCard, TabBarPanel, Tone } from './contract';
import { markdownBlocks } from './markdown';

/**
 * Panel data from a Document, the words and numbers the text UI shows
 * (plugin/src/views/lines.ts, whatif.ts, register.tsx) as the UI kit's
 * blocks, from the same simulation functions. The plugin may build panels
 * itself; these cover the ones made of the simulation's results.
 */

const usd = (x: number) => formatUsd(x).replace('/month', '');

/** The pane's tabs (views/tabs.tsx TABS), Tests with its failing count, and the way to the same view in the editor (control `open`). */
export function tabBarPanel(active: string, failing: number): TabBarPanel {
  const tabs = [
    ['diagram', 'Diagram'],
    ['analysis', 'Analysis'],
    ['sequence', 'Sequence'],
    ['hld', 'HLD'],
    ['tests', 'Tests'],
  ] as const;
  return {
    kind: 'tabs',
    active,
    tabs: tabs.map(([id, label], i) => ({ id, label, hotkey: String(i + 1), ...(id === 'tests' && failing > 0 ? { badge: { text: `✗ ${failing}`, tone: 'bad' as const } } : {}) })),
    open: { id: 'open', icon: 'open', label: 'Open in Proschi', variant: 'quiet' },
  };
}

// ---------- the player ----------

const FORMAT: Record<FlowStep['requestFormat'], Body['format']> = { JSON: 'JSON', XML: 'XML', FREE_TEXT: 'Text' };

function card(s: FlowStep, steps: FlowStep[], name: (id: string) => string): StepCard {
  const call = `${s.httpMethod} ${s.endpoint}`.trim();
  const error = isErrorStep(s);
  const exec: StepCard['exec'] = s.executionType === 'ASYNC_FIRE_AND_FORGET' ? 'fire' : s.executionType === 'ASYNC_REQUEST_RESPONSE' ? 'async' : 'sync';
  return {
    number: steps.indexOf(s) + 1,
    name: s.stepName,
    from: name(s.fromServiceId),
    to: name(s.toServiceId),
    ...(call && call !== s.stepName ? { call } : {}),
    ...(s.description ? { description: s.description } : {}),
    exec,
    ...(s.failed ? { failed: true } : {}),
    ...((s.statusCode ?? 0) >= 400 ? { status: s.statusCode } : {}),
    ...(error ? { error: true } : {}),
    ...(s.requestBody ? { request: { format: FORMAT[s.requestFormat], text: s.requestBody } } : {}),
    ...(s.responseBody && exec !== 'fire' ? { response: { format: FORMAT[s.responseFormat], text: s.responseBody, ...(s.statusCode !== undefined ? { status: s.statusCode } : {}), ...(error ? { error: true } : {}) } } : {}),
  };
}

/** Each step of `scenario` as cards: the step with its parallel siblings, as the player's drawer shows them (DrawerPanel). */
export function stepCardsOf(scenario: DiagramScenario, name: (id: string) => string): StepCard[][] {
  const steps = scenario.steps;
  return steps.map((_, i) => currentStepsOf(steps, i).map((s) => card(s, steps, name)));
}

// ---------- Analysis ----------

const splits = (n: NodeAnalysis) => n.writeLoadRps > 0 && (n.writeScaling === 'shards' || n.readCapacityRps !== n.writeCapacityRps);
const bare = (rps: number) => formatRps(rps).replace(' rps', '');

/**
 * The editor's Analysis panel (AnalysisPanel.tsx; the text UI's
 * analysisLines), then the saved what-ifs (`whatIfs`, else run here) and a
 * way to explore what-ifs live in the editor: control `explore-whatifs`.
 */
export function analysisPage(doc: Document, whatIfs?: WhatIfResult[]): PagePanel {
  const analysis = doc.analysis;
  if (!analysis) {
    return {
      kind: 'page',
      blocks: [
        { type: 'paragraph', text: 'No traffic yet: add a traffic { … } block and Proschi estimates load, latency, availability and cost for every node, e.g.' },
        { type: 'code', text: 'traffic {\n  "Redirect" 10k rps  mix "Cache hit" 90%, "Cache miss" 10%\n}' },
      ],
    };
  }
  const blocks: Block[] = [];
  const nodes = analysis.nodes.filter((n) => n.kind !== 'client' && n.kind !== 'other');
  const saturated = nodes.filter((n) => n.saturated || (n.queue !== undefined && n.queue.utilization >= 1)).length;
  const spofs = analysis.singlePointsOfFailure;
  blocks.push({
    type: 'stats',
    items: [
      { label: analysis.totalEgressUsd > 0 ? `Total cost (incl. ${usd(analysis.totalEgressUsd)} egress)` : 'Total cost', value: formatUsd(analysis.totalCostUsd) },
      { label: 'Saturated nodes', value: String(saturated), tone: saturated ? 'bad' : 'good' },
      { label: 'Single points of failure', value: String(spofs.length), tone: spofs.length ? 'warn' : 'good' },
      { label: 'Use cases with traffic', value: String(analysis.useCases.filter((u) => u.rps > 0).length) },
    ],
  });
  const busiest = busiestOf(analysis);
  if (busiest) {
    const u = busiest.utilization;
    const bottleneck = busiest.saturated || u >= BOTTLENECK_FROM;
    const headroom = u >= 1 ? 'past its capacity: requests are dropped' : `${(Math.floor((1 / u) * 10) / 10).toFixed(1)}× headroom before it saturates`;
    blocks.push({ type: 'callout', tone: bottleneck ? 'bad' : 'info', chip: bottleneck ? 'BOTTLENECK' : 'BUSIEST', text: [{ text: busiest.id, bold: true }, { text: ` at ${formatPercent(u)}: ${headroom}.` }] });
  }
  for (const w of analysis.warnings) blocks.push({ type: 'callout', tone: 'warn', text: w });

  blocks.push({ type: 'heading', text: 'Nodes' });
  const rows: Row[] = [];
  for (const n of nodes) {
    const tone: Tone | undefined = n.saturated ? 'bad' : n.utilization > HOT ? 'warn' : undefined;
    rows.push({
      cells: [
        [{ text: n.id, bold: true }, ...(n.replicas > 1 ? [{ text: ` ×${n.replicas}`, tone: 'muted' as const }] : [])],
        splits(n) ? [{ text: 'R ', tone: 'muted' }, { text: bare(n.readLoadRps) }, { text: ` / ${formatRps(n.readCapacityRps)}`, tone: 'muted' }] : [{ text: bare(n.loadRps) }, { text: ` / ${formatRps(n.capacityRps)}`, tone: 'muted' }],
        { bar: n.utilization, text: formatPercent(n.utilization), ...(tone ? { tone } : {}) },
        formatMs(n.latencyMs),
        formatAvailability(n.availability),
        `${usd(n.costUsd)}${n.egressUsd > 0 ? ` +${usd(n.egressUsd)}` : ''}`,
      ],
    });
    if (splits(n)) {
      rows.push({ sub: true, cells: [n.shards > 1 ? `${n.shards} shards` : '', [{ text: 'W ' }, { text: bare(n.writeLoadRps) }, { text: ` / ${formatRps(n.writeCapacityRps)}` }], `R ${formatPercent(n.readUtilization)} · W ${formatPercent(n.writeUtilization)}`] });
    }
  }
  blocks.push({
    type: 'table',
    columns: [{ title: 'Node' }, { title: 'Load / capacity' }, { title: 'Utilisation', drop: 1 }, { title: 'Latency', align: 'right', drop: 2 }, { title: 'Availability', align: 'right', drop: 3 }, { title: 'Cost', align: 'right', drop: 4 }],
    rows,
  });

  const queues = analysis.nodes.filter((n) => n.queue);
  if (queues.length) {
    blocks.push({ type: 'heading', text: 'Queues' });
    blocks.push({
      type: 'table',
      columns: [{ title: 'Queue' }, { title: 'In / drain' }, { title: 'Consumers', align: 'right', drop: 1 }, { title: 'Backlog or lag', align: 'right' }],
      rows: queues.map((n) => {
        const q = n.queue!;
        return {
          cells: [
            [{ text: n.id, bold: true }],
            `${bare(q.inflowRps)} / ${formatRps(q.drainRps)}`,
            Number.isFinite(q.utilization) ? formatPercent(q.utilization) : '—',
            q.backlogPerHour > 0 ? [{ text: `+${formatCount(q.backlogPerHour)} msgs/h`, tone: 'bad' }] : `lag ${formatDuration(q.lagMs)}`,
          ],
        };
      }),
    });
  }

  if (analysis.useCases.length) {
    blocks.push({ type: 'heading', text: 'Use cases' });
    const rows: Row[] = [];
    for (const u of analysis.useCases) {
      rows.push({ cells: [[{ text: u.name, bold: true }], u.rps > 0 ? formatTraffic(u.rps, u.avgRps) : [{ text: 'no traffic', tone: 'muted' }], ...(['p50', 'p95', 'p99', 'p999'] as const).map((p) => formatMs(u.percentiles[p])), formatAvailability(u.availability)] });
      if (u.scenarios.length > 1) {
        for (const s of u.scenarios) rows.push({ sub: true, dim: !(s.share > 0), cells: [s.name, `${formatPercent(s.share)} · mean ${formatMs(s.meanMs)}`, ...(['p50', 'p95', 'p99', 'p999'] as const).map((p) => formatMs(s.percentiles[p])), ''] });
      }
    }
    blocks.push({
      type: 'table',
      columns: [{ title: 'Use case' }, { title: 'Traffic', drop: 1 }, { title: 'p50', align: 'right', drop: 4 }, { title: 'p95', align: 'right', drop: 5 }, { title: 'p99', align: 'right' }, { title: 'p99.9', align: 'right', drop: 3 }, { title: 'Avail', align: 'right', drop: 2 }],
      rows,
    });
  }

  const b = costBreakdown(doc.root, analysis);
  const sections: [string, CostShare[]][] = [
    ['Team', b.unowned ? [...b.teams, b.unowned] : b.teams],
    ['Group', b.groups],
    ['Tag', b.tags],
  ];
  if (sections.some(([, r]) => r.length > 0)) {
    const budgets = new Map<string, number>();
    for (const r of doc.root.requirements ?? []) {
      if (r.kind !== 'cost' || !r.scope) continue;
      budgets.set('team' in r.scope ? `@${r.scope.team}` : 'tag' in r.scope ? `.${r.scope.tag}` : r.scope.group, r.maxUsdPerMonth);
    }
    blocks.push({ type: 'heading', text: 'Cost breakdown' });
    blocks.push({
      type: 'table',
      columns: [{ title: 'By', drop: 2 }, { title: 'Name' }, { title: 'Cost', align: 'right' }, { title: 'Share', align: 'right', drop: 3 }, { title: 'Budget', align: 'right', drop: 1 }, { title: 'Nodes', drop: 4 }],
      rows: sections.flatMap(([by, shares]) =>
        shares.map((s, i): Row => {
          const budget = budgets.get(s.id);
          const over = budget !== undefined && s.costUsd > budget;
          return {
            cells: [
              [{ text: i === 0 ? by : '', tone: 'muted' }],
              [{ text: s.label, bold: true }],
              usd(s.costUsd),
              b.totalCostUsd > 0 ? formatPercent(s.costUsd / b.totalCostUsd) : '—',
              budget === undefined ? [{ text: '—', tone: 'muted' }] : [{ text: `${usd(budget)}${over ? ' over' : ''}`, tone: over ? 'bad' : 'good' }],
              [{ text: s.nodes.join(', '), tone: 'muted' }],
            ],
          };
        }),
      ),
    });
  }
  if (spofs.length) {
    blocks.push({ type: 'heading', text: 'Single points of failure' });
    blocks.push({ type: 'callout', tone: 'warn', text: [{ text: spofs.join(', '), bold: true }, { text: ': one replica, and a use case cannot do without it. Add x2, or a fallback scenario that calls it with -x and still completes.' }] });
  }
  blocks.push({ type: 'paragraph', small: true, text: 'Teaching numbers from default profiles per technology and a simple queueing model; override them with capacity { … }.' });
  blocks.push(...whatIfBlocks(doc, whatIfs ?? runWhatIfs(doc.root)));
  return { kind: 'page', blocks };
}

const deltaTone = (r: DeltaRow): Tone | undefined => (r.tone === 'better' ? 'good' : r.tone === 'worse' ? 'bad' : undefined);

/**
 * The saved `whatif` blocks (WhatIfResults.tsx WhatIfTable): the verdict and
 * the headline against the design as written, an arrow where it moved; or
 * how to save one. Then the editor, where what-ifs are explored live.
 */
function whatIfBlocks(doc: Document, results: WhatIfResult[]): Block[] {
  const a = headlineOf(doc.analysis!);
  const blocks: Block[] = [{ type: 'heading', text: 'What-ifs' }];
  if (results.length === 0) {
    blocks.push({ type: 'paragraph', small: true, text: 'None saved yet: a whatif block runs the design again with more traffic or nodes down, e.g.' });
    blocks.push({ type: 'code', text: 'whatif "Launch day" {\n  traffic "Redirect" x3\n}' });
  } else {
    const arrow = (r: DeltaRow, up: '↑' | '↓', down: '↑' | '↓'): Span[] => {
      const tone = deltaTone(r);
      const changed = r.change !== 'same' && r.before !== r.after;
      return [{ text: changed && r.tone !== 'same' ? `${r.after} ${r.tone === 'better' ? up : down}` : r.after, ...(tone ? { tone } : changed ? {} : { tone: 'muted' as const }) }];
    };
    blocks.push({
      type: 'table',
      columns: [{ title: 'What-if' }, { title: 'Result' }, { title: 'Worst p99', align: 'right' }, { title: 'Avail', align: 'right', drop: 2 }, { title: 'Cost', align: 'right', drop: 1 }],
      rows: results.map(
        (r): Row => ({
          cells: [
            [{ text: r.name, bold: true }],
            [{ text: r.passed ? 'pass' : 'fail', chip: r.passed ? 'good' : 'bad' }],
            arrow(p99Row('', a.p99Ms, r.headline.p99Ms), '↓', '↑'),
            arrow(availabilityRow('', a.availability, r.headline.availability), '↑', '↓'),
            arrow(costRow(a.costUsd, r.headline.costUsd), '↓', '↑'),
          ],
        }),
      ),
    });
    for (const text of results.flatMap((r) => r.warnings)) blocks.push({ type: 'callout', tone: 'warn', text });
  }
  blocks.push({ type: 'controls', items: [{ control: { id: 'explore-whatifs', icon: 'open', label: 'Explore what-ifs in Proschi' } }, { text: [{ text: 'more traffic, nodes down, a sweep', tone: 'muted' }] }] });
  return blocks;
}

// ---------- Tests ----------

const where = (r: { loc?: { line: number; file?: string } }) => (r.loc ? `${r.loc.file ? `${r.loc.file}:` : 'line '}${r.loc.line}` : undefined);

function checkBlocks(r: TestResult): Block[] {
  const out: Block[] = [{ type: 'check', passed: r.passed, title: r.name, ...(where(r) ? { where: where(r) } : {}), message: r.message, ...(!r.passed && r.hint ? { hint: r.hint } : {}) }];
  if (r.assertions && r.assertions.length > 1) {
    for (const a of r.assertions) out.push({ type: 'check', passed: a.passed, title: [{ text: a.message, bold: false }], ...(where(a) ? { where: where(a) } : {}), ...(!a.passed && a.hint ? { hint: a.hint } : {}), indent: 3 });
  }
  return out;
}

/** The editor's Requirements and tests (ResultsPanel.tsx): the summary, what fails open, what passes under a toggle (`a`). */
export function testsPage(doc: Document, open: boolean): PagePanel {
  if (!doc.analysis) return { kind: 'page', blocks: [{ type: 'paragraph', text: 'Requirements and tests run against the simulation: add a traffic { … } block first.' }] };
  const results = doc.tests;
  if (results.length === 0) {
    return {
      kind: 'page',
      blocks: [
        { type: 'paragraph', text: 'No requirements or tests yet. Requirements are checked against the analysis of the traffic; tests check how the flows work, e.g.' },
        { type: 'code', text: 'requirements {\n  p99 "Redirect" < 100ms\n  availability >= 99.9%\n}\ntest "Redirect is served from the cache" {\n  "Redirect" calls any cache before any database\n}' },
      ],
    };
  }
  const failing = results.filter((r) => !r.passed);
  const passing = results.filter((r) => r.passed);
  const blocks: Block[] = [
    failing.length
      ? { type: 'callout', tone: 'bad', text: [{ text: `${failing.length} of ${results.length} failing`, bold: true }] }
      : { type: 'callout', tone: 'good', text: [{ text: `All ${results.length} passing`, bold: true }] },
  ];
  for (const r of failing) blocks.push(...checkBlocks(r));
  if (passing.length) {
    blocks.push({ type: 'controls', items: [{ control: { id: 'passing', icon: open ? 'chevron-down' : 'next', label: `${passing.length} passing`, hotkey: 'a', variant: 'quiet', active: open } }] });
    if (open) for (const r of passing) blocks.push({ type: 'check', passed: true, title: r.name, ...(where(r) ? { where: where(r) } : {}), message: r.message });
  }
  return { kind: 'page', blocks };
}

// ---------- HLD ----------

/** The HLD tab: the copy button, then the document as blocks, its Mermaid blocks pointing at the tab that draws them (views/hld.tsx). */
export function hldPage(markdown: string): PagePanel {
  return {
    kind: 'page',
    blocks: [
      {
        type: 'controls',
        items: [{ control: { id: 'hld-copy', icon: 'copy', label: 'Copy HLD markdown', hotkey: 'c', variant: 'primary' } }, { text: [{ text: 'with its Mermaid diagrams, for a README or a wiki', tone: 'muted' }] }],
      },
      ...markdownBlocks(markdown),
    ],
  };
}
