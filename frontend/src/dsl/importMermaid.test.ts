import { describe, expect, it } from 'vitest';
import { examples, parse } from './index';
import { fromMermaid } from './importMermaid';
import { toMermaidArchitecture, toMermaidSequence } from './mermaid';
import flowchart from './importFixtures/flowchart.mmd?raw';
import flowchartExpected from './importFixtures/flowchart.proschi?raw';
import sequence from './importFixtures/sequence.mmd?raw';
import sequenceExpected from './importFixtures/sequence.proschi?raw';

const errors = (source: string) => parse(source).diagnostics.filter((d) => d.severity === 'error');
const clean = (source: string) => parse(source).diagnostics;

/** Everything Proschi exports as Mermaid for a document, as Markdown with fences (like `proschi render --format md`). */
function exportAll(source: string): string {
  const { diagram } = parse(source);
  const parts = [toMermaidArchitecture(diagram), ...diagram.useCases.flatMap((u) => u.scenarios.map((s) => toMermaidSequence(diagram, u.id, s.id)))];
  return parts.map((p) => `\`\`\`mermaid\n${p}\`\`\``).join('\n\n');
}

describe('fromMermaid: flowcharts', () => {
  it('converts the fixture: shapes to kinds, subgraphs to groups, link labels to connection labels', () => {
    const { source, warnings } = fromMermaid(flowchart);
    expect(source).toBe(flowchartExpected);
    expect(clean(source)).toEqual([]);
    expect(warnings).toEqual([{ message: 'Ignored 2 styling line(s) (style, classDef, class, linkStyle, click)' }]);
  });

  it('reads every link form', () => {
    const { source } = fromMermaid('graph LR\n  a --> b\n  b --- c\n  c -.-> d\n  d ==> e\n  e -- calls --> f\n  f -. emits .-> g\n  g == pushes ==> h\n  h ---->|"long"| i\n  i --o j\n  j --x k\n  k ~~~ l\n');
    const { diagram } = parse(source);
    expect(diagram.edges.map((e) => `${e.source}>${e.target}${e.label ? `:${e.label}` : ''}`)).toEqual([
      'a>b', 'b>c', 'c>d', 'd>e', 'e>f:calls', 'f>g:emits', 'g>h:pushes', 'h>i:long', 'i>j', 'j>k',
    ]);
    expect(diagram.nodes.map((n) => n.id)).toContain('l');
  });

  it('maps shapes and labels to kinds', () => {
    const { diagram } = parse(fromMermaid('flowchart TD\n  a[(Ledger)]\n  b[[Jobs]]\n  c((Customer))\n  d[Pricing Service]\n  e[Orders DB - Postgres]\n  f[Redis Cache]\n  g>Remember this]\n  h[Kafka Consumer]\n').source);
    expect(Object.fromEntries(diagram.nodes.map((n) => [n.id, n.techStack]))).toEqual({
      a: 'Database', b: 'Message Queue', c: 'Actor', d: 'Service', e: 'PostgreSQL', f: 'Redis', g: 'Text Note', h: 'Worker',
    });
  });

  it('keeps statements after the header and split by semicolons, and decodes entity codes', () => {
    const { source } = fromMermaid('graph TD; a["Say #quot;hi#quot; #35;1"] --> b; b --> c');
    expect(source).toContain('a "Say \\"hi\\" #1" [Service]');
    expect(parse(source).diagram.edges).toHaveLength(2);
  });

  it('makes ids valid and keeps keywords and duplicates apart', () => {
    const { source } = fromMermaid('flowchart LR\n  group --> 1st\n  title --> café\n');
    expect(parse(source).diagram.nodes.map((n) => n.id)).toEqual(['group_', 'n1st', 'title_', 'cafe']);
    expect(clean(source)).toEqual([]);
  });

  it('moves a node mentioned at the top level into the subgraph that lists it', () => {
    const { diagram } = parse(fromMermaid('flowchart LR\n  a --> b\n  subgraph S [Zone]\n    b\n    subgraph T\n      c\n    end\n  end\n').source);
    expect(Object.fromEntries(diagram.nodes.map((n) => [n.id, n.parent ?? null]))).toEqual({ a: null, b: 'S', S: null, T: 'S', c: 'T' });
  });

  it('warns about what it cannot read and never throws', () => {
    for (const text of ['', 'pie title Pets\n  "Dogs" : 386', 'flowchart LR\n  a -->', 'flowchart LR\n  end\n  subgraph x\n', '```mermaid\nflowchart\n  a((b\n```', '%%{init: {}}%%\ngraph\n  a[ --> b']) {
      const result = fromMermaid(text);
      expect(errors(result.source)).toEqual([]);
    }
    expect(fromMermaid('pie title Pets').warnings[0].message).toContain("'pie' diagrams are not supported");
    expect(fromMermaid('').warnings[0].message).toContain('No Mermaid diagram found');
    expect(fromMermaid('flowchart LR\n  a -->').warnings).toEqual([{ line: 2, message: "Could not read ''; left out" }]);
  });
});

describe('fromMermaid: sequence diagrams', () => {
  it('converts the fixture: calls, replies, alt, par and loop', () => {
    const { source, warnings } = fromMermaid(sequence);
    expect(source).toBe(sequenceExpected);
    expect(clean(source)).toEqual([]);
    expect(warnings.map((w) => w.line)).toEqual([22, 26]);
  });

  it('answers the matching call and turns a reply to nothing into a one-way message', () => {
    const { source } = fromMermaid('sequenceDiagram\n  a->>b: GET /x\n  b->>c: SELECT\n  c-->>b: rows\n  b-->>a: 200\n  c-->>a: Late\n  a-xb: Retry\n');
    expect(source).toContain('b --> a : 200');
    expect(source).toContain('c ->> a : Late');
    expect(source).toContain('a  -x b : Retry');
    expect(clean(source)).toEqual([]);
  });

  it('turns opt into a branch and its alternative, and boxes into groups', () => {
    const { source } = fromMermaid('sequenceDiagram\n  box Aqua Backend\n    participant api\n    participant db\n  end\n  user->>api: GET /a\n  opt cached\n    api->>db: GET key\n  end\n  api-->>user: 200\n');
    const { diagram } = parse(source);
    expect(diagram.useCases[0].scenarios.map((s) => s.name)).toEqual(['cached', 'Otherwise']);
    expect(diagram.nodes.filter((n) => n.parent === 'Backend').map((n) => n.id)).toEqual(['api', 'db']);
  });

  it('flattens what Proschi cannot nest, with a warning', () => {
    const { source, warnings } = fromMermaid('sequenceDiagram\n  par\n    a->>b: one\n    par\n      a->>c: two\n    end\n  and\n    alt x\n      a->>d: three\n    else y\n      a->>e: four\n    end\n  end\n');
    expect(errors(source)).toEqual([]);
    expect(warnings.map((w) => w.message)).toEqual(['Nested par is merged into the outer par block', 'A par branch makes several calls; Proschi runs every step of a par block in parallel', 'alt inside par: only its first branch is imported']);
  });
});

describe('fromMermaid: round trips', () => {
  /** What a document plays: per use case and scenario, the requests with their answers. */
  const flows = (source: string) =>
    parse(source).diagram.useCases.map((u) => [
      u.name,
      u.scenarios.map((s) => [s.name, s.steps.map((st) => `${st.fromServiceId}>${st.toServiceId} ${st.stepName} ${st.executionType} ${st.statusCode ?? ''}${st.failed ? ' failed' : ''}`)]),
    ]);

  it('re-imports its own Mermaid export of the flowchart fixture unchanged', () => {
    const first = fromMermaid(flowchart).source;
    expect(fromMermaid(exportAll(first)).source).toBe(first);
  });

  it('re-imports its own Mermaid export of the sequence fixture with the same scenarios and steps', () => {
    const first = fromMermaid(sequence).source;
    const again = fromMermaid(exportAll(first)).source;
    expect(clean(again)).toEqual([]);
    expect(flows(again)).toEqual(flows(first));
  });

  it.each(examples.map((e) => [e.id, e.source]))('reads back the Mermaid export of the %s example without errors', (_id, source) => {
    const { diagram } = parse(source);
    const { source: imported, warnings } = fromMermaid(exportAll(source));
    const back = parse(imported);
    expect(back.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(warnings.filter((w) => !/payload that does not close/.test(w.message))).toEqual([]);
    // Same nodes (group styles and note kinds are not in Mermaid) and connections, and the same use cases and scenarios.
    const nodes = (d: typeof diagram) => d.nodes.map((n) => [n.id, n.kind === 'component' ? n.techStack : n.kind]).sort();
    expect(nodes(back.diagram)).toEqual(nodes(diagram));
    expect(back.diagram.edges.map((e) => `${e.source}>${e.target}`).sort()).toEqual(diagram.edges.map((e) => `${e.source}>${e.target}`).sort());
    expect(back.diagram.useCases.map((u) => [u.name, u.scenarios.map((s) => s.name)])).toEqual(diagram.useCases.map((u) => [u.name, u.scenarios.map((s) => s.name)]));
  });
});
