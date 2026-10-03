import type { ComponentType, TechStack } from '../types/canvas';
import type { FlowStep } from '../services/api';

/** 1-based source position of a construct, used for diagnostics and editor links. */
export interface SourceLoc {
  line: number;
  col: number;
  length: number;
  /** Path of the imported file the construct is in; left out for the root document. */
  file?: string;
}

export type Severity = 'error' | 'warning';

export interface Diagnostic extends SourceLoc {
  severity: Severity;
  message: string;
}

export type DiagramNodeKind = 'component' | 'group' | 'text';

export interface DiagramNode {
  id: string;
  kind: DiagramNodeKind;
  name: string;
  type: ComponentType;
  techStack: TechStack;
  ownerTeam?: string;
  description?: string;
  /** Id of the enclosing `group`, if any. */
  parent?: string;
  /** Explicit `pos x,y`; nodes without one are placed by auto-layout. */
  position?: { x: number; y: number };
  /** Created because an edge or step referenced an undeclared id. */
  implicit?: boolean;
  loc: SourceLoc;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  loc: SourceLoc;
}

/**
 * One path through a use case. A use case without `alt` blocks has a single
 * scenario; each combination of `alt` branches is a scenario of its own.
 */
export interface DiagramScenario {
  /** Slug of the branch names, or `main` when the use case has no branches. */
  id: string;
  /** Branch names joined with ' › ', or the use case name when there are none. */
  name: string;
  /** `error` when the entry request is answered with a 4xx/5xx or fails. */
  outcome: 'success' | 'error';
  steps: FlowStep[];
  /** The innermost `alt` name of the scenario, or the use case name when it has no branches. */
  loc: SourceLoc;
}

export interface DiagramUseCase {
  id: string;
  name: string;
  description?: string;
  entryServiceId?: string;
  /** `METHOD /path` of the first step, if it is an HTTP call; used to group use cases. */
  endpoint?: string;
  /** The steps of the first scenario. */
  steps: FlowStep[];
  scenarios: DiagramScenario[];
  loc: SourceLoc;
}

export interface Diagram {
  title?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  useCases: DiagramUseCase[];
}

/** One `import "path"` statement, in the root document or in an imported file. */
export interface DiagramImport {
  /** The path as written. */
  path: string;
  /** Path the resolver returned, or undefined when the file could not be loaded. */
  resolved?: string;
  loc: SourceLoc;
}

export interface ParseResult {
  diagram: Diagram;
  diagnostics: Diagnostic[];
  /** Every import statement that was read; left out when the document has none. */
  imports?: DiagramImport[];
}

/** A file an import resolved to. */
export interface ResolvedImport {
  /** Identifies the file: shown in messages, used for `file` and to resolve its own imports. */
  path: string;
  source: string;
}

/** Finds the file `importPath` refers to, relative to the importing file (undefined for an unnamed root). */
export type ImportResolver = (importPath: string, fromPath: string | undefined) => ResolvedImport | undefined;

export interface ParseOptions {
  /** Path of the root document, so its imports resolve relative to it and import cycles back to it are found. */
  path?: string;
  /** Loads imported files; without it, `import` statements only produce a warning. */
  resolve?: ImportResolver;
}
