/**
 * The one place the tooling reaches into the editor's source. The parser in
 * frontend/src/dsl is the definition of the language; everything here is a
 * thin adapter around it, so the CLI, the language server and the web editor
 * can never disagree about what is valid.
 */
export { DID_YOU_MEAN, HTTP_METHODS, builtinTypes, kindName, parse } from '../../frontend/src/dsl/parser';
export { lookupType, techNamed, typeKey } from '../../frontend/src/dsl/typesys/resolve';
export type { ResolvedType, TypeTable } from '../../frontend/src/dsl/typesys/types';
export { KINDS } from '../../frontend/src/dsl/kinds';
export { addConnection, setCapacity, setReplicas } from '../../frontend/src/dsl/edit';
export { tokenizeLine } from '../../frontend/src/dsl/lexer';
export { format } from '../../frontend/src/dsl/format';
export { examples } from '../../frontend/src/dsl/examples';
export { componentCatalog } from '../../frontend/src/catalog/componentCatalog';
export type {
  Constant,
  Diagnostic,
  Diagram,
  DiagramImport,
  DiagramNode,
  DiagramStep,
  DiagramUseCase,
  ImportResolver,
  ParseOptions,
  ParseResult,
  SourceLoc,
} from '../../frontend/src/dsl/types';
export type { DiagramScenario } from '../../frontend/src/dsl/types';
export { DIFF_SECTIONS, diffDiagrams, requirementKey, summarizeDiff, type DiagramDiff, type DiffSection, type FieldChange } from '../../frontend/src/dsl/diff';
export { toMermaidArchitecture, toMermaidSequence } from '../../frontend/src/dsl/mermaid';
export { buildSequence, type SequenceMessage } from '../../frontend/src/dsl/sequence';
export { EXPORT_CSP, buildHld, toHtml as hldToHtml, toMarkdown as hldToMarkdown, type HldDocument, type HldFigures } from '../../frontend/src/hld';
// `analyze` is the editor's simulation; tooling's own analysis.ts has an `analyze` for documents.
export {
  analyze as simulate,
  costBreakdown,
  requirementFixes,
  runTests,
  formatAvailability,
  formatCount,
  formatDuration,
  formatQueue,
  formatMs,
  formatPercent,
  formatRps,
  formatTraffic,
  formatUsd,
  HOT,
  type Analysis as SimAnalysis,
  type NodeAnalysis,
  type TestResult,
  findWhatIf,
  headlineOf,
  runWhatIf,
  runWhatIfs,
  sweep,
  type SweepResult,
  type WhatIfResult,
} from '../../frontend/src/sim';
export { deltaRows, designDelta, type DeltaRow, type DesignDelta } from '../../frontend/src/sim/delta';
export { findUseCase } from '../../frontend/src/sim/flow';
export { parseQuantity } from '../../frontend/src/dsl/quantity';

/** Keywords that start a statement, with a one-line hint for completion lists. */
export const KEYWORDS: { label: string; detail: string; snippet: string }[] = [
  { label: 'title', detail: 'Document title', snippet: 'title "$1"' },
  { label: 'import', detail: 'import "file.proschi" (top level)', snippet: 'import "${1:file.proschi}"' },
  { label: 'let', detail: 'A constant, used as $name: let peak = 120k rps (top level)', snippet: 'let ${1:name} = ${2:100 rps}' },
  { label: 'type', detail: 'A component type: type Name extends Parent { … } (top level)', snippet: 'type ${1:Name} extends ${2:Service} {\n\t$0\n}' },
  { label: 'abstract type', detail: 'A type nodes do not use directly, only its children (top level)', snippet: 'abstract type ${1:Name} extends ${2:Service} {\n\t$0\n}' },
  { label: 'group', detail: 'group id "Name" [Style] { … }', snippet: 'group ${1:id} "${2:Name}" {\n\t$0\n}' },
  { label: 'usecase', detail: 'usecase "Name" { steps }', snippet: 'usecase "${1:Name}" {\n\t$0\n}' },
  { label: 'par', detail: 'Steps that run in parallel', snippet: 'par {\n\t$0\n}' },
  { label: 'alt', detail: 'One scenario of a use case', snippet: 'alt "${1:Scenario}" {\n\t$0\n}' },
  { label: 'legend', detail: 'Styles that .tag applies: owned "Owned by us" green', snippet: 'legend {\n\t${1:tag} "${2:What it means}" ${3:blue}$0\n}' },
  // Layout hints (docs/STYLING.md, "Steering the layout").
  { label: 'direction', detail: 'Where edges flow: down, right, up or left (top level or in a group)', snippet: 'direction ${1|down,right,up,left|}' },
  { label: 'layout ordered', detail: 'Lay edges out by declaration order (top level)', snippet: 'layout ordered' },
  // High-level design sections (top level).
  { label: 'traffic', detail: 'Requests per use case: "Use case" 100 rps', snippet: 'traffic {\n\t"${1:Use case}" ${2:100 rps}$0\n}' },
  { label: 'requirements', detail: 'Latency, availability, durability, resilience, cost', snippet: 'requirements {\n\tp99 < ${1:200ms}$0\n}' },
  { label: 'capacity', detail: 'Per-replica overrides: node 1k rps latency 5ms', snippet: 'capacity {\n\t${1:node} ${2:1k rps}$0\n}' },
  { label: 'entity', detail: 'entity Name in store { fields }', snippet: 'entity ${1:Name} in ${2:store} {\n\t${3:id} ${4:uuid} key$0\n}' },
  { label: 'decision', detail: 'A design decision with its reasons', snippet: 'decision "${1:Title}" {\n\tbecause "${2:reason}"$0\n}' },
  { label: 'test', detail: 'Flow assertions: "Use case" calls any cache', snippet: 'test "${1:Name}" {\n\t$0\n}' },
  { label: 'whatif', detail: 'A variant to simulate: traffic "Use case" x3, fail node, node x4', snippet: 'whatif "${1:Name}" {\n\ttraffic "${2:Use case}" ${3:x3}$0\n}' },
];

/** Assertion forms offered at the start of a line inside a `test` block (docs/TESTS.md, "Tests"). */
export const ASSERTIONS: { label: string; detail: string; snippet: string }[] = [
  { label: '"Use case" calls', detail: 'Some scenario calls the node', snippet: '"${1:Use case}" calls ${2:node}' },
  { label: '"Use case" never calls', detail: 'No scenario calls the node', snippet: '"${1:Use case}" never calls ${2:node}' },
  { label: '"Use case" every scenario calls', detail: 'Every scenario calls the node', snippet: '"${1:Use case}" every scenario calls ${2:node}' },
  { label: '"Use case" calls … before …', detail: 'The first call to one node comes before the first call to another', snippet: '"${1:Use case}" calls ${2:node} before ${3:node}' },
  { label: '"Use case" calls … after …', detail: 'The last call to one node comes after the first call to another', snippet: '"${1:Use case}" calls ${2:node} after ${3:node}' },
  { label: '"Use case" never waits for', detail: 'No synchronous call to the node before the response', snippet: '"${1:Use case}" never waits for ${2:node}' },
  { label: '"Use case" writes … before responding', detail: 'A write to the node happens before the response', snippet: '"${1:Use case}" writes ${2:node} before responding' },
  { label: '"Use case" calls … with', detail: 'A request to the node with this method and path ({param} matches any segment)', snippet: '"${1:Use case}" calls ${2:node} with ${3:GET} ${4:/items/:id}' },
  { label: '"Use case" uses … on', detail: "A step to the node names this operation of its type", snippet: '"${1:Use case}" uses ${2:INSERT} on ${3:node}' },
  { label: '"Use case" uses … on … before responding', detail: 'That operation, synchronously, before the response', snippet: '"${1:Use case}" uses ${2:INSERT} on ${3:node} before responding' },
  { label: '"Use case" never uses … on', detail: 'No step to the node names this operation', snippet: '"${1:Use case}" never uses ${2:Scan} on ${3:node}' },
  { label: '"Use case" sends header … to', detail: 'A request to the node names this header', snippet: '"${1:Use case}" sends header ${2:Authorization} to ${3:node}' },
  { label: '"Use case" responds', detail: 'Status code or class of the entry response', snippet: '"${1:Use case}" responds ${2:2xx}' },
  { label: '"Use case" starts at', detail: 'The entry request is sent by the node', snippet: '"${1:Use case}" starts at ${2:node}' },
  { label: '"Use case" has scenario', detail: 'The use case has a scenario of this name', snippet: '"${1:Use case}" has scenario "${2:Scenario}"' },
  { label: '"Use case" handles failure of', detail: 'A scenario fails the node and still answers', snippet: '"${1:Use case}" handles failure of ${2:node}' },
  { label: 'node calls node', detail: 'Some step is sent by one node to the other', snippet: '${1:node} calls ${2:node}' },
  { label: 'node never calls node', detail: 'No step is sent by one node to the other', snippet: '${1:node} never calls ${2:node}' },
  { label: 'in "Use case" node calls node', detail: 'A step of the use case is sent by one node to the other', snippet: 'in "${1:Use case}" ${2:node} calls ${3:node}' },
  { label: 'no path from … to …', detail: 'No chain of connections links the nodes', snippet: 'no path from ${1:node} to ${2:node}' },
  { label: 'node has replicas >=', detail: 'Minimum replica count', snippet: '${1:node} has replicas >= ${2:2}' },
];

/** Parts offered after the node id of a `capacity` line (docs/HLD.md, "Capacity"). */
export const CAPACITY_PARTS: { label: string; detail: string; snippet: string }[] = [
  { label: 'reads', detail: 'Read capacity per replica', snippet: 'reads ${1:10k rps}' },
  { label: 'writes', detail: 'Write capacity per replica', snippet: 'writes ${1:2k rps}' },
  { label: 'shards', detail: 'Number of shards (data stores)', snippet: 'shards ${1:4}' },
  { label: 'size', detail: 'Instance size: S, M or L', snippet: 'size ${1|S,M,L|}' },
  { label: 'latency', detail: 'Latency per call', snippet: 'latency ${1:5ms}' },
  { label: 'availability', detail: 'Availability', snippet: 'availability ${1:99.95%}' },
  { label: 'cost', detail: 'Monthly cost', snippet: 'cost ${1:400} usd/month' },
  { label: 'durable', detail: 'A write there survives a crash', snippet: 'durable' },
  { label: 'volatile', detail: 'A write there is lost in a crash', snippet: 'volatile' },
  { label: 'consistency', detail: 'strong or eventual (data stores)', snippet: 'consistency ${1|strong,eventual|}' },
  { label: 'bandwidth', detail: 'Network bandwidth, for transfer time', snippet: 'bandwidth ${1:500} MB/s' },
  { label: 'egress', detail: 'Price per GB sent out', snippet: 'egress ${1:0.05} usd/GB' },
  { label: 'timeout', detail: 'What a failed call to the node costs', snippet: 'timeout ${1:300ms}' },
  { label: 'hit', detail: 'Cache hit rate: the miss path takes the rest', snippet: 'hit ${1:90%}' },
  { label: 'errors', detail: 'Share of calls that fail (a partial failure)', snippet: 'errors ${1:2%}' },
  { label: 'retries', detail: 'Times a caller tries a failed call again (0 to 5)', snippet: 'retries ${1:3}' },
  { label: 'drain', detail: 'How fast consumers take messages off a queue', snippet: 'drain ${1:5k rps}' },
];

/** Lines of a `type` block body (docs/design/typed-components.md, D2). */
export const TYPE_PROPERTIES: { label: string; detail: string; snippet: string }[] = [
  { label: 'kind', detail: 'What the type is: one of the 17 kinds', snippet: 'kind ${1:service}' },
  { label: 'op', detail: 'Operations: op read|write|forward A, B [latency x] [cost y]', snippet: 'op ${1|read,write,forward|} ${2:NAME}' },
  { label: 'status', detail: 'HTTP status codes it answers with', snippet: 'status ${1:200, 404}' },
  { label: 'header', detail: 'HTTP headers it reads', snippet: 'header ${1:Authorization}' },
  { label: 'protocol', detail: 'How it is called: SQL, HTTP, RESP, …', snippet: 'protocol ${1:HTTP}' },
  { label: 'icon', detail: 'The catalog tech it is drawn as', snippet: 'icon ${1:PostgreSQL}' },
  { label: 'doc', detail: 'A description, shown in hover', snippet: 'doc "${1:What it is}"' },
  { label: 'rps', detail: 'Requests per second per replica (reads and writes)', snippet: 'rps ${1:20k}' },
  { label: 'readRps', detail: 'Reads per second per replica', snippet: 'readRps ${1:20k}' },
  { label: 'writeRps', detail: 'Writes per second per replica', snippet: 'writeRps ${1:5k}' },
  { label: 'writeScaling', detail: 'How writes scale: replicas or shards', snippet: 'writeScaling ${1|replicas,shards|}' },
  { label: 'latencyMs', detail: 'Latency per call, in ms', snippet: 'latencyMs ${1:4}' },
  { label: 'availability', detail: 'Availability of one replica', snippet: 'availability ${1:99.95%}' },
  { label: 'costUsd', detail: 'USD per month per replica', snippet: 'costUsd ${1:400}' },
  { label: 'durable', detail: 'Whether a write survives a crash', snippet: 'durable ${1|true,false|}' },
  { label: 'consistency', detail: 'strong or eventual', snippet: 'consistency ${1|strong,eventual|}' },
  { label: 'bandwidthMBps', detail: 'Network bandwidth, MB/s', snippet: 'bandwidthMBps ${1:500}' },
  { label: 'egressUsdPerGb', detail: 'Price per GB sent out', snippet: 'egressUsdPerGb ${1:0.09}' },
];
