import type { TechName, TechStack } from '../catalog/componentCatalog';
import type { NodeOverlay } from '../sim/overlay';

export interface Point {
  x: number;
  y: number;
}

/**
 * An edge's orthogonal route, in absolute canvas coordinates: from a point on
 * the source's border, through every bend, to a point on the target's border.
 * `from` and `to` are the absolute top-left corners of the two nodes it was
 * routed for, so a drawing can tell when a node has moved since and the route
 * no longer fits.
 */
export interface EdgeRoute {
  points: Point[];
  /** Centre of the label, placed by ELK in space it kept free. */
  label?: Point;
  from: Point;
  to: Point;
}

export type ComponentType =
  | 'shape'
  | 'service'
  | 'database'
  | 'queue'
  | 'broker'
  | 'external'
  | 'serverless'
  | 'compute'
  | 'container'
  | 'storage'
  | 'cache'
  | 'cdn'
  | 'text'
  | 'group';

/** Tech stacks come from the component catalog, the one list of what `[Tech]` may name. */
export type { TechName, TechStack };

export interface ComponentMetadata {
  id: string;
  name: string;
  type: ComponentType;
  techStack: TechName;
  ownerTeam?: string;
  description?: string;
  /** Load drawn over the node while the diagram is simulated (sim/overlay.ts). */
  overlay?: NodeOverlay;
  /** Routes of the edges leaving this node, by edge id, from the auto layout (Canvas/RoutedEdge.tsx). */
  routes?: Record<string, EdgeRoute>;
  /** Laid out by the page (the Arcade's rows): no resize handles. */
  fixedSize?: boolean;
  // For text nodes
  textContent?: string;
  fontSize?: number;
  // Fill and border (CSS, theme-aware) of components and groups: from `color`, a tag or the category (dsl/palette.ts)
  backgroundColor?: string;
  borderColor?: string;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  /** `.tag`: the legend entry the node is styled by. */
  tag?: string;
  /** `critical`: drawn with a warning badge. */
  critical?: boolean;
}

export interface CanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: ComponentMetadata;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  labelStyle?: React.CSSProperties;
  labelBgStyle?: React.CSSProperties;
  /** Stroke color and dash of a tagged edge. */
  style?: React.CSSProperties;
  data?: { tag: string };
}
