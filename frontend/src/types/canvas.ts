import type { TechName, TechStack } from '../catalog/componentCatalog';
import type { NodeOverlay } from '../sim/overlay';

export type ComponentType =
  | 'shape'
  | 'service'
  | 'database'
  | 'queue'
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
  // For group nodes
  backgroundColor?: string;
  borderColor?: string;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
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
}
