import type { TechName, TechStack } from '../catalog/componentCatalog';
import type { NodeOverlay } from '../sim/overlay';

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
