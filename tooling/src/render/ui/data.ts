import type { Diagram, DiagramScenario, FlowStep } from '../../../../frontend/src/dsl/types';
import { HOT, availabilityRow, costBreakdown, costRow, headlineOf, p99Row, runWhatIfs, type CostShare, type DeltaRow, type NodeAnalysis, type WhatIfResult } from '../../../../frontend/src/sim';
import { formatAvailability, formatCount, formatDuration, formatMs, formatPercent, formatRps, formatTraffic, formatUsd } from '../../../../frontend/src/sim/format';
import { BOTTLENECK_FROM, busiestOf } from '../../../../frontend/src/sim/overlay';
import { currentStepsOf, isErrorStep } from '../../terminal/playback';
import type { Document } from '../../terminal/document';
import type { Block, Body, PagePanel, Rich, Row, Span, StepCard, TabBarPanel, Tone } from './contract';
import * as H from '../../../../frontend/src/hld/hld';

/**
 * Panel data from a Document, the words and numbers the text UI shows
 * (plugin/src/views/lines.ts, whatif.ts, register.tsx) as the UI kit's
 * blocks, from the same simulation functions. The plugin may build panels
 * itself; these cover the ones made of the simulation's results.
 */

const usd = (x: number) => formatUsd(x).replace('/month', '');

/** The pane's tabs (views/tabs.tsx TABS), HLD with its failing check count, and the way to the same view in the editor (control `open`). */
export function tabBarPanel(active: string, failing: number): TabBarPanel {
  const tabs = [
    ['diagram', 'Diagram'],
    ['analysis', 'Analysis'],
    ['hld', 'HLD'],
  ] as const;
  return {
    kind: 'tabs',
    active,
    tabs: tabs.map(([id, label], i) => ({ id, label, hotkey: String(i + 1), ...(id === 'hld' && failing > 0 ? { badge: { text: `✗ ${failing}`, tone: 'bad' as const } } : {}) })),
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

/** A use case of the design's own to show syntax with (its first), so an example reads as this design's. */
const exampleUseCase = (d: Diagram) => JSON.stringify(d.useCases[0]?.name ?? 'Checkout');

/** A traffic block for the design's first use case, its first two scenarios mixed where it branches once. */
export function trafficExample(d: Diagram): string {
  const s = d.useCases[0]?.scenarios ?? [];
  const mix = s.length > 1 && !s.some((x) => x.name.includes(' › ')) ? `  mix ${JSON.stringify(s[0].name)} 90%, ${JSON.stringify(s[1].name)} 10%` : '';
  return `traffic {\n  ${exampleUseCase(d)} 1k rps${mix}\n}`;
}

/** A whatif block tripling the design's first use case. */
export const whatIfExample = (d: Diagram) => `whatif "Launch day" {\n  traffic ${exampleUseCase(d)} x3\n}`;

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
        { type: 'code', text: trafficExample(doc.diagram) },
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
    blocks.push({ type: 'code', text: whatIfExample(doc.diagram) });
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
  blocks.push({ type: 'controls', items: [{ control: { id: 'explore-whatifs', icon: 'open', label: 'Explore what-ifs in Proschi' } }] });
  return blocks;
}

// ---------- HLD ----------

const STATUS: Record<H.CheckStatus, Span[]> = {
  pass: [{ text: 'pass', chip: 'good' }],
  fail: [{ text: 'fail', chip: 'bad' }],
  unchecked: [{ text: 'not checked', tone: 'muted' }],
};

/** `Fix: …` under a measured value, as the editor's HLD view (HldView.tsx Measured). */
const measured = (text?: string, hint?: string): Span[] => [...(text ? [{ text }] : [{ text: '—', tone: 'muted' as const }]), ...(hint ? [{ text: `  Fix: ${hint}`, tone: 'warn' as const }] : [])];

const dash = (text: string | number | undefined): Span[] => (text === undefined || text === '' ? [{ text: '—', tone: 'muted' }] : [{ text: String(text) }]);

const RISK_TONE: Record<H.Risk['severity'], 'bad' | 'warn' | 'info'> = { high: 'bad', medium: 'warn', low: 'info' };

/** What a scenario's sequence says the Diagram tab does with it, in both modes: its player plays it (and the use case's `others`). */
export const playsCaption = (others = 0) => `The Diagram tab's player plays it${others > 0 ? ` and the other ${others === 1 ? 'scenario' : `${others} scenarios`}` : ''}.`;

/** The HLD's subtitle, under its title in both modes. */
export const HLD_SUBTITLE = 'High-level design, generated from the model and its simulation';

/**
 * How the HLD's checks stand, at its top as the editor puts it (both modes):
 * how many fail and where they are, or that all pass; and that they were not
 * checked where the simulation did not run.
 */
export function hldVerdict(doc: H.HldDocument): { tone: 'bad' | 'good' | 'warn'; text: Span[] }[] {
  const out: { tone: 'bad' | 'good' | 'warn'; text: Span[] }[] = [];
  const checks = doc.sections.flatMap((s) => (s.kind === 'requirements' ? [...s.nonFunctional, ...s.flowTests] : []));
  const failing = checks.filter((r) => r.status === 'fail').length;
  const checked = checks.filter((r) => r.status !== 'unchecked').length;
  if (checked) out.push(failing ? { tone: 'bad', text: [{ text: `${failing} of ${checked} checks fail`, bold: true }, { text: `: section ${doc.sections.findIndex((s) => s.kind === 'requirements') + 1}, Requirements, has the measured values and their fixes.` }] } : { tone: 'good', text: [{ text: `All ${checked} checks pass`, bold: true }, { text: ' against the simulation.' }] });
  if (!doc.checked && doc.sections.some((s) => s.kind === 'requirements' && (s.nonFunctional.length || s.flowTests.length))) out.push({ tone: 'warn', text: [{ text: 'The simulation did not run, so requirements and tests are listed but not checked.' }] });
  return out;
}

/** The id of a section's anchor, which the table of contents scrolls to. */
export const hldAnchor = (kind: H.HldSectionKind) => `hld-${kind}`;

function hldSection(doc: H.HldDocument, s: H.HldSection): Block[] {
  const out: Block[] = [];
  const h3 = (text: Rich): Block => ({ type: 'heading', level: 3, text });
  switch (s.kind) {
    case 'overview':
      if (s.summary) out.push({ type: 'paragraph', text: s.summary });
      if (s.teams.length > 1) out.push({ type: 'paragraph', small: true, text: [{ text: 'Teams  ', tone: 'muted' }, { text: s.teams.join(', ') }] });
      out.push({
        type: 'stats',
        items: [
          { label: 'Components', value: String(s.components) },
          { label: 'Use cases', value: String(s.useCases) },
          ...(s.teams.length ? [{ label: s.teams.length === 1 ? 'Team' : 'Teams', value: s.teams.length === 1 ? s.teams[0]! : String(s.teams.length) }] : []),
          ...doc.sections.flatMap((c) => (c.kind === 'capacity' && c.totalCostUsd !== undefined ? [{ label: 'Cost / month', value: H.formatUsd(c.totalCostUsd) }] : [])),
        ],
      });
      if (s.components) out.push({ type: 'figure', of: { architecture: true }, maxRows: 22 });
      break;
    case 'requirements': {
      if (s.functional.length) {
        out.push(h3('Functional'));
        out.push({ type: 'list', items: s.functional.map((f): Rich => [{ text: f.name, bold: true }, ...(f.description ? [{ text: ` — ${f.description}`, tone: 'muted' as const }] : [])]) });
        const alts = s.functional.filter((f) => f.scenarios.length > 1 || f.scenarios[0]?.condition);
        if (alts.length) {
          out.push({
            type: 'table',
            columns: [{ title: 'Use case' }, { title: 'Scenario' }, { title: 'When', drop: 1 }],
            rows: alts.flatMap((f) => f.scenarios.map((sc, i): Row => ({ cells: [i === 0 ? [{ text: f.name, bold: true }] : '', [{ text: sc.name, ...(sc.outcome === 'error' ? { tone: 'bad' as const } : {}) }], dash(sc.condition)] }))),
          });
        }
      }
      if (s.nonFunctional.length) {
        out.push(h3('Non-functional'));
        out.push({ type: 'table', columns: [{ title: 'Requirement' }, { title: 'Status' }, { title: 'Measured' }], rows: s.nonFunctional.map((r): Row => ({ cells: [r.label, STATUS[r.status], measured(r.measured, r.hint)] })) });
      }
      if (s.flowTests.length) {
        out.push(h3('Flow tests'));
        out.push({
          type: 'table',
          columns: [{ title: 'Test' }, { title: 'Status' }, { title: 'Asserts', drop: 1 }, { title: 'Result' }],
          rows: s.flowTests.map((t): Row => ({ cells: [[{ text: t.name, bold: true }], STATUS[t.status], [{ text: t.assertions.join('; '), mono: true }], measured(t.measured, t.hint)] })),
        });
      }
      break;
    }
    case 'capacity':
      if (s.traffic.length) {
        out.push(h3('Traffic'));
        out.push({ type: 'table', columns: [{ title: 'Use case' }, { title: 'Rate', align: 'right' }, { title: 'Mix', drop: 1 }], rows: s.traffic.map((t): Row => ({ cells: [[{ text: t.useCase, bold: true }], H.formatTraffic(t.rps, t.avgRps), [{ text: t.mix.map((m) => `${m.scenario} ${H.formatPercent(m.share)}`).join(', ') || '—', tone: 'muted' }]] })) });
      }
      if (s.load.length) {
        out.push(h3('Load per component'));
        out.push({
          type: 'table',
          columns: [{ title: H.LOAD_HEADINGS[0] }, { title: H.LOAD_HEADINGS[1], drop: 2 }, { title: H.LOAD_HEADINGS[2], drop: 3 }, { title: H.LOAD_HEADINGS[3] }, { title: H.LOAD_HEADINGS[4], align: 'right', drop: 4 }, { title: H.LOAD_HEADINGS[5], align: 'right', drop: 1 }, { title: H.LOAD_HEADINGS[6], align: 'right' }],
          rows: s.load.map((n): Row => ({ cells: [[{ text: n.name, bold: true }], H.accessText(n, 'read'), H.accessText(n, 'write'), { bar: n.utilization, text: H.formatPercent(n.utilization), ...(n.saturated ? { tone: 'bad' as const } : {}) }, H.replicasText(n), dash(H.egressText(n) === '—' ? undefined : H.egressText(n)), H.formatUsd(n.costUsd)] })),
        });
      }
      if (s.totalCostUsd !== undefined) out.push({ type: 'paragraph', text: [{ text: 'Total cost  ', tone: 'muted' }, { text: H.totalCostText(s.totalCostUsd, s.totalEgressUsd), bold: true }] });
      break;
    case 'components':
      out.push({
        type: 'table',
        columns: [{ title: 'Component' }, { title: 'Tech' }, { title: 'Kind', drop: 3 }, { title: 'Team', drop: 4 }, { title: 'Replicas', align: 'right', drop: 2 }, { title: 'Responsibility', drop: 1 }, { title: 'Stores', drop: 5 }],
        rows: s.components.map((c): Row => ({
          cells: [
            [{ text: c.name, bold: true }, ...(c.group ? [{ text: `  in ${c.group}`, tone: 'muted' as const }] : [])],
            dash(c.tech),
            dash(c.kind),
            dash(c.team),
            String(c.replicas),
            dash(c.responsibility),
            dash(c.entities.join(', ')),
          ],
        })),
      });
      break;
    case 'dataModel':
      for (const e of s.entities) {
        out.push(h3([{ text: e.name }, ...(e.storeName ? [{ text: `  in ${e.storeName}`, tone: 'muted' as const }] : [])]));
        if (e.description) out.push({ type: 'paragraph', small: true, text: e.description });
        out.push({ type: 'table', columns: [{ title: 'Field' }, { title: 'Type' }, { title: 'Flags' }], rows: e.fields.map((f): Row => ({ cells: [[{ text: f.name, mono: true }], f.type, dash(f.flags.join(', '))] })) });
      }
      break;
    case 'apis':
      for (const ep of s.endpoints) {
        out.push(h3([{ text: ep.endpoint, mono: true }, ...(ep.service ? [{ text: `  served by ${ep.service}`, tone: 'muted' as const }] : [])]));
        for (const op of ep.operations) {
          out.push({ type: 'paragraph', text: [{ text: op.useCase, bold: true }, ...(op.endpoint !== ep.endpoint ? [{ text: `  ${op.endpoint}`, mono: true, tone: 'muted' as const }] : [])] });
          if (op.request) out.push({ type: 'code', text: op.request, language: 'json', maxLines: 12 });
          out.push({ type: 'table', columns: [{ title: 'Scenario' }, { title: 'Response' }], rows: op.responses.map((r): Row => ({ cells: [[{ text: r.scenario, ...(r.outcome === 'error' ? { tone: 'bad' as const } : {}) }], [{ text: H.responseText(r), mono: true }]] })) });
        }
      }
      break;
    case 'scenarios':
      for (const u of s.useCases) {
        out.push(h3(u.name));
        const about = [u.endpoint, u.rps !== undefined ? H.formatRps(u.rps) : '', u.description].filter(Boolean).join(' · ');
        if (about) out.push({ type: 'paragraph', small: true, text: about });
        out.push({
          type: 'table',
          columns: [{ title: 'Scenario' }, { title: 'When', drop: 2 }, { title: 'Share', align: 'right', drop: 1 }, { title: 'p50', align: 'right', drop: 3 }, { title: 'p99', align: 'right' }],
          rows: u.scenarios.map((sc): Row => ({
            cells: [[{ text: sc.outcome === 'error' ? '✗ ' : '✓ ', tone: sc.outcome === 'error' ? 'bad' : 'good', bold: true }, { text: sc.name, bold: true }], dash(sc.condition), dash(sc.share !== undefined ? H.formatPercent(sc.share) : undefined), dash(sc.latency ? H.formatMs(sc.latency.p50) : undefined), dash(sc.latency ? H.formatMs(sc.latency.p99) : undefined)],
          })),
        });
        // The use case's sequence: its first scenario with steps.
        const first = u.scenarios.find((sc) => sc.steps > 0);
        if (first) out.push({ type: 'figure', of: { useCase: u.useCaseId, scenario: first.id }, caption: playsCaption(u.scenarios.length - 1), maxRows: 24 });
      }
      break;
    case 'decisions':
      for (const d of s.decisions) {
        out.push(h3(d.title));
        if (d.because) out.push({ type: 'paragraph', text: [{ text: 'Because ', bold: true }, { text: d.because }] });
        if (d.rejected.length) out.push({ type: 'list', items: d.rejected.map((r): Rich => [{ text: 'Rejected ', tone: 'muted' }, { text: r.option, bold: true }, { text: ` — ${r.reason}`, tone: 'muted' }]) });
      }
      break;
    case 'risks':
      for (const r of s.risks) out.push({ type: 'callout', tone: RISK_TONE[r.severity], chip: r.severity.toUpperCase(), text: [{ text: r.title, bold: true }, ...(r.detail ? [{ text: ` — ${r.detail}` }] : []), ...(r.hint ? [{ text: `  Fix: ${r.hint}`, tone: 'muted' as const }] : [])] });
      break;
  }
  return out;
}

/**
 * The HLD tab as the editor's HLD view (components/Hld/HldView.tsx): the
 * title, how the checks stand, ⧉ Copy HLD markdown (control `hld-copy`), a
 * table of contents (control `toc=<kind>` per section, which scrolls to its
 * anchor `hld-<kind>`), then each section numbered, its tables, callouts and
 * key figures, the architecture and each use case's sequence drawn as
 * pictures from `source`.
 */
export function hldPage(doc: H.HldDocument, source: { source: string; path?: string; imports?: Record<string, string> }): PagePanel {
  const blocks: Block[] = [{ type: 'heading', level: 1, text: doc.title }, { type: 'paragraph', small: true, text: HLD_SUBTITLE }];
  // How the checks stand, at the top as the editor puts it.
  for (const v of hldVerdict(doc)) blocks.push({ type: 'callout', tone: v.tone, text: v.text });
  blocks.push({ type: 'controls', items: [{ control: { id: 'hld-copy', icon: 'copy', label: 'Copy HLD markdown', hotkey: 'c', variant: 'primary' } }, { text: [{ text: 'with Mermaid diagrams, for a README or a wiki', tone: 'muted' }] }] });
  if (doc.sections.length === 0) return { kind: 'page', blocks: [...blocks, { type: 'paragraph', text: 'Add components and use cases to generate a design document.' }] };
  blocks.push({ type: 'heading', level: 3, text: [{ text: 'CONTENTS', tone: 'muted' }] });
  blocks.push({ type: 'controls', items: doc.sections.map((s, i) => ({ control: { id: `toc=${s.kind}`, label: `${i + 1}  ${s.title}`, variant: 'quiet' as const } })) });
  doc.sections.forEach((s, i) => {
    blocks.push({ type: 'heading', level: 2, anchor: hldAnchor(s.kind), text: [{ text: `${i + 1}`, tone: 'accent' }, { text: `  ${s.title}` }] });
    blocks.push(...hldSection(doc, s));
  });
  return { kind: 'page', source, blocks };
}
