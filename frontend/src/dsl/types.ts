import type { ComponentType, TechStack } from '../types/canvas';
import type { FlowStep } from '../services/api';

/** 1-based source position of a construct, used for diagnostics and editor links. */
export interface SourceLoc {
  line: number;
  col: number;
  length: number;
}

export type Severity = 'error' | 'warning';

export interface Diagnostic extends SourceLoc {
  severity: Severity;
  message: string;
}

/** A use case step with where it is written: the request line, and the `-->` line that answered it. */
export type DiagramStep = FlowStep & { loc: SourceLoc; responseLoc?: SourceLoc };

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
  /** `when "…"` conditions of the branches on the path, joined with ' · '; absent when none has one. */
  condition?: string;
  steps: DiagramStep[];
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
  /**
   * Key for grouping use cases that hit the same endpoint: `endpoint` with
   * concrete ids folded into a `{param}` template (see paths.ts).
   */
  endpointGroup?: string;
  /** The steps of the first scenario. */
  steps: DiagramStep[];
  scenarios: DiagramScenario[];
  loc: SourceLoc;
}

export interface Diagram {
  title?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  useCases: DiagramUseCase[];
}

export interface ParseResult {
  diagram: Diagram;
  diagnostics: Diagnostic[];
}
