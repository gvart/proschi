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

export interface ParseResult {
  diagram: Diagram;
  diagnostics: Diagnostic[];
}
