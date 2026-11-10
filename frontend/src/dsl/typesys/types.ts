import type { Kind, SourceLoc } from '../types';

/**
 * Component types (docs/design/typed-components.md): `type Name extends
 * Parent { … }` blocks, from the bundled stdlib (src/dsl/stdlib) and from
 * the user's files. The parser reads the blocks into `TypeDecl`s, the
 * resolver merges each with its ancestors into a `ResolvedType`.
 */

/** Simulation numbers a type may set: the per-replica profile row of sim/profiles.ts, in its units. */
export interface TypeProps {
  rps?: number;
  readRps?: number;
  writeRps?: number;
  writeScaling?: 'replicas' | 'shards';
  latencyMs?: number;
  /** 0..1, written as a percentage (`availability 99.95%`). */
  availability?: number;
  costUsd?: number;
  durable?: boolean;
  consistency?: 'strong' | 'eventual';
  bandwidthMBps?: number;
  egressUsdPerGb?: number;
}

export type TypePropName = keyof TypeProps;

/**
 * What an operation does to the node's data: reads it, writes it, or (for an
 * edge that passes a WebSocket frame on) neither, `forward`: the step then
 * reads or writes as the step that handles it downstream does.
 */
export type OpAccess = 'read' | 'write' | 'forward';

/** `op read SELECT latency 8 cost 2`: an operation the type supports. */
export interface TypeOp {
  name: string;
  access: OpAccess;
  /** Multiplier of the node's latency for this operation; absent means 1. */
  latency?: number;
  /** Multiplier of the node's cost (load) for this operation; absent means 1. */
  cost?: number;
}

/** One type block as written. */
export interface TypeDecl {
  name: string;
  abstract: boolean;
  /** `extends X` as written; absent means the root, `Component`. */
  parent?: string;
  kind?: Kind;
  props: TypeProps;
  ops: TypeOp[];
  statuses: number[];
  headers: string[];
  protocol?: string;
  /** A catalog tech stack, the icon key. */
  icon?: string;
  doc?: string;
  /** From the bundled stdlib, not the user's files. */
  builtin: boolean;
  /** The type's name in its header. */
  loc: SourceLoc;
  /** The parent's name in the header, for diagnostics about it. */
  parentLoc?: SourceLoc;
}

/** A type merged with its ancestors: what a node of that type is. */
export interface ResolvedType {
  name: string;
  abstract: boolean;
  builtin: boolean;
  /** Ancestor names, the parent first, ending with `Component` (empty for `Component` itself). */
  parents: string[];
  /** Declared or inherited; every concrete type has one. */
  kind?: Kind;
  /** Own props over inherited ones. */
  props: TypeProps;
  /** Inherited operations, then the type's own (an own op with the same name replaces the inherited one). */
  ops: TypeOp[];
  statuses: number[];
  headers: string[];
  protocol?: string;
  /** Catalog tech stack the node is drawn with: `icon`, the type's own name for a built-in catalog tech, else inherited. */
  icon?: string;
  doc?: string;
  loc: SourceLoc;
}

/** Resolved types by normalized name (`typeKey`). */
export type TypeTable = ReadonlyMap<string, ResolvedType>;

/** The root of every type. */
export const ROOT_TYPE = 'Component';
