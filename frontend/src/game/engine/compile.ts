import { parse } from '../../dsl/parser';
import type { Diagram } from '../../dsl/types';
import type { Board, BoardNode, ComponentDef, ExternalDef, Role, ScenarioDef, UseCaseDef, UseCaseStep } from './types';
import { parseSize } from '../../dsl/parser';

/**
 * Board → Proschi (docs/GAME.md, "How the game uses the simulation"). The
 * board says which components exist and who may call whom; the scenario's
 * use cases say what each request does (`read db`, `write db async`, …). The
 * compiler routes every use case through the player's wiring and writes the
 * result as Proschi source, which the ordinary parser reads and the ordinary
 * simulation analyses. The same source is what "Open in editor" shows.
 *
 * What it writes per use case:
 * - the entry chain: users → edge components → the first app server that
 *   handles the use case (shortest path over the wires);
 * - with a CDN on the chain and an `edge` hit ratio: an "Edge hit" scenario
 *   that ends at the CDN;
 * - with a cache wired to the handler and a `cache` hit ratio: cache-aside,
 *   "Cache hit" / "Cache miss" (which fills the cache) and "Cache down" (a
 *   §7.6 fallback, share 0, so availability credits the cache's fallback);
 * - with far users (`global`): the same paths behind an ocean crossing;
 * - steps marked async, when the handler is wired to a queue whose worker
 *   reaches the targets: one publish, and a separate "(background)" use case
 *   for the worker, so a slow worker builds a backlog instead of slowing the
 *   request.
 */

/** The parts of the board's situation that change the compiled source (the rest is numbers, applied per tick). */
/** Use case keys of migration backfill jobs (modes/migrations.ts `backfillKey`). */
export const BACKFILL_PREFIX = 'backfill_';

export interface Situation {
  /** Nodes with no instance up. */
  down: readonly string[];
  /** Single-primary stores whose writes fail (a failover in progress). */
  writesDown: readonly string[];
  /** Some users are far away. */
  global: boolean;
  /** Bot traffic hits the entry. */
  bots: boolean;
}

export const CALM: Situation = { down: [], writesDown: [], global: false, bots: false };

export interface CompileOptions {
  /** Payload size multiplier (compression). */
  payload: number;
  /** Uploads go from the user straight to object storage (a presigned URL). */
  presigned?: boolean;
  /** Share of background messages that write to a store (1 = every message; batching writes less often). */
  writeShare: number;
}

export type CacheState = 'none' | 'hit' | 'miss' | 'down';

export interface ScenarioPlan {
  name: string;
  far: boolean;
  edge: 'none' | 'hit' | 'miss';
  cache: CacheState;
}

export interface BackgroundRoute {
  name: string;
  queue: string;
  worker: string;
  /** `Write` writes the batch, `Buffer` only collects (write batching). */
  scenarios: { name: string; writes: boolean }[];
  /** The worker cannot finish its jobs (it is down, or a store it writes is failing over): the backlog grows. */
  stalled: boolean;
}

export interface Route {
  key: string;
  name: string;
  chain: string[];
  handler: string;
  scenarios: ScenarioPlan[];
  cache?: string;
  cdn?: string;
  background?: BackgroundRoute;
  /** Stores each step reaches, by step index. */
  targets: string[];
}

export interface Compiled {
  source: string;
  diagram: Diagram;
  /** Use cases that have a route, by key. */
  routes: Record<string, Route>;
  /** Use cases without one, by key: why. */
  broken: Record<string, string>;
  /** Bots' route, when bots are on: where they stop. */
  bots?: { stoppedBy?: string; chain: string[] };
}

export const USERS = 'users';
export const WAN = 'wan';
export const BOTS = 'Bots';
/**
 * The ocean crossing is a fixed delay, not a queue: the first node on a far
 * user's path makes a failed call (`-x`) to the `wan` node, whose timeout is
 * `WAN_MS`. A failed call costs exactly its timeout, carries no load and does
 * not count against availability, which is what a long cable does.
 */
export const WAN_MS = 120;
const STORE_VERB: Record<string, [string, string]> = {
  db: ['SELECT', 'INSERT'],
  blob: ['GET', 'PUT'],
  search: ['QUERY', 'UPSERT'],
  warehouse: ['SELECT', 'INSERT'],
};

/** What a board node is: the component, an external, or the users. */
export interface NodeInfo {
  node: BoardNode;
  role: Role | 'users' | 'external';
  name: string;
  tech: string;
}

export function nodeInfo(node: BoardNode, components: ReadonlyMap<string, ComponentDef>, externals: readonly ExternalDef[]): NodeInfo | undefined {
  if (node.component === USERS) return { node, role: 'users', name: 'Users', tech: 'Actor' };
  const external = externals.find((e) => e.id === node.component);
  if (external) return { node, role: 'external', name: external.name, tech: external.tech };
  const c = components.get(node.component);
  return c ? { node, role: c.role, name: c.name, tech: c.tech } : undefined;
}

const EDGE_ROLES: ReadonlySet<string> = new Set(['lb', 'waf', 'cdn', 'gateway']);
const quote = (s: string) => `"${s.replace(/"/g, "'")}"`;

export function compile(
  scenario: ScenarioDef,
  board: Board,
  components: ReadonlyMap<string, ComponentDef>,
  useCases: readonly string[],
  situation: Situation = CALM,
  options: CompileOptions = { payload: 1, writeShare: 1 },
): Compiled {
  const info = new Map<string, NodeInfo>();
  for (const n of board.nodes) {
    const i = nodeInfo(n, components, scenario.externals);
    if (i) info.set(n.id, i);
  }
  const down = new Set(situation.down);
  const writesDown = new Set(situation.writesDown);
  const out = new Map<string, string[]>();
  for (const [from, to] of board.edges) {
    if (!info.has(from) || !info.has(to)) continue;
    out.set(from, [...(out.get(from) ?? []), to]);
  }
  const roleOf = (id: string) => info.get(id)?.role;
  const up = (id: string) => !down.has(id);
  /** The first node of `role` wired from `from` that is up, in wire order. */
  const wired = (from: string, role: string, allowDown = false) => (out.get(from) ?? []).find((to) => roleOf(to) === role && (allowDown || up(to)));
  const wiredTo = (from: string, id: string) => (out.get(from) ?? []).includes(id) && up(id);

  /** Shortest chain users → edge nodes → an app server accepted by `accept`, over live wires. */
  const chainTo = (accept: (id: string) => boolean): string[] | undefined => {
    const users = board.nodes.find((n) => n.component === USERS)?.id;
    if (!users) return undefined;
    const prev = new Map<string, string>();
    const queue = [users];
    const seen = new Set(queue);
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of out.get(id) ?? []) {
        if (seen.has(next) || !up(next)) continue;
        const role = roleOf(next);
        if (role === 'app' && accept(next)) {
          const chain = [next, id];
          for (let at = id; prev.has(at); ) chain.push((at = prev.get(at)!));
          return chain.reverse();
        }
        if (role && EDGE_ROLES.has(role)) {
          seen.add(next);
          prev.set(next, id);
          queue.push(next);
        }
      }
    }
    return undefined;
  };

  // A migration's backfill is a job, not a route: any app server runs it.
  const handles = (id: string, key: string) => {
    const h = info.get(id)?.node.handles;
    return !h || h.length === 0 || h.includes(key) || key.startsWith(BACKFILL_PREFIX);
  };

  const lines: string[] = [`title ${quote(scenario.title)} ${quote(scenario.summary)}`, ''];
  for (const n of board.nodes) {
    const i = info.get(n.id);
    if (!i) continue;
    const replicas = i.role === 'users' || i.role === 'external' ? '' : ` x${Math.max(1, Math.floor(n.replicas))}`;
    lines.push(`${n.id} ${quote(i.name)} [${i.tech}]${replicas}`);
  }
  if (situation.global) lines.push(`${WAN} "Ocean crossing" [Third Party API]`);
  lines.push('');
  for (const [from, to] of board.edges) if (info.has(from) && info.has(to)) lines.push(`${from} -> ${to}`);

  const routes: Record<string, Route> = {};
  const broken: Record<string, string> = {};
  const bodies: string[] = [];

  for (const key of useCases) {
    const uc = scenario.useCases[key];
    if (!uc) continue;
    const chain = chainTo((id) => handles(id, key));
    if (!chain) {
      broken[key] = chainTo(() => true)
        ? `No app server handles "${uc.name}": tick it in an app server's use cases.`
        : `"${uc.name}" has no way in: wire Users to an app server (through a load balancer or other edge components), and keep one of them up.`;
      continue;
    }
    const handler = chain[chain.length - 1];
    const route = routeUseCase(key, uc, chain, handler);
    if (typeof route === 'string') broken[key] = route;
    else {
      routes[key] = route.route;
      bodies.push(...route.text);
    }
  }

  let bots: Compiled['bots'];
  if (situation.bots) {
    const chain = chainTo(() => true) ?? [board.nodes.find((n) => n.component === USERS)?.id ?? USERS];
    const stop = chain.findIndex((id) => roleOf(id) === 'waf' || roleOf(id) === 'gateway');
    const steps: string[] = [];
    const path = stop >= 0 ? chain.slice(0, stop + 1) : chain;
    for (let i = 0; i + 1 < path.length; i++) steps.push(`  ${path[i]} -> ${path[i + 1]} : GET /random-${i}`);
    const last = path[path.length - 1];
    if (stop < 0 && roleOf(last) === 'app') {
      const db = wired(last, 'db');
      if (db) steps.push(`  ${last} -> ${db} : SELECT random key`, `  ${db} --> ${last} : nothing`);
    }
    const status = stop >= 0 ? (roleOf(path[stop]) === 'waf' ? 403 : 429) : 404;
    for (let i = path.length - 1; i > 0; i--) steps.push(`  ${path[i]} --> ${path[i - 1]} : ${status}`);
    if (steps.length) bodies.push(`usecase ${quote(BOTS)} "Scrapers and credential stuffers" {`, ...steps, '}', '');
    bots = { stoppedBy: stop >= 0 ? path[stop] : undefined, chain: path };
  }

  function routeUseCase(key: string, uc: UseCaseDef, chain: string[], handler: string): { route: Route; text: string[] } | string {
    const steps = uc.steps;
    // Where each step goes: sync from the handler, or async through queue → worker.
    const queue = wired(handler, 'queue');
    const worker = queue ? wired(queue, 'worker', true) : undefined;
    const viaWorker = (s: UseCaseStep) => !!(s.async && queue && worker);
    const targets: string[] = [];
    for (const s of steps) {
      const from = viaWorker(s) ? worker! : handler;
      const target = s.op === 'call' ? (wiredTo(from, s.to) ? s.to : undefined) : wired(from, s.to);
      if (!target) {
        const what = s.op === 'call' ? (info.get(s.to)?.name ?? s.to) : STORE_NAME[s.to] ?? s.to;
        const who = info.get(from)?.name ?? from;
        const isDown = s.op === 'call' ? down.has(s.to) : !!wired(from, s.to, true);
        return isDown ? `"${uc.name}" needs ${what}, which is down.` : `"${uc.name}" needs ${article(what)} wired to ${who} (${from}).`;
      }
      targets.push(target);
      if (!viaWorker(s) && s.op === 'write' && writesDown.has(target)) return `"${uc.name}" writes to ${target}, whose primary is failing over.`;
    }

    const cdn = uc.edge !== undefined ? chain.find((id) => roleOf(id) === 'cdn') : undefined;
    const cacheNode = uc.cache !== undefined && !uc.strong ? wired(handler, 'cache', true) : undefined;
    // The cache holds records, not files: object storage reads are never cache-aside.
    const cacheable = (s: UseCaseStep) => s.op === 'read' && s.to !== 'blob' && !viaWorker(s);
    // With a presigned URL, the user sends the file to storage; the app only signs.
    const direct = (s: UseCaseStep) => !!options.presigned && s.op === 'write' && s.to === 'blob' && !viaWorker(s);
    const directUpload = steps.some(direct);
    const chainSize = directUpload ? '' : sizeLabel(uc.size, options.payload);
    const usesCache = cacheNode !== undefined && steps.some(cacheable);
    const cacheStates: CacheState[] = !usesCache ? ['none'] : down.has(cacheNode!) ? ['down'] : ['hit', 'miss', 'down'];
    const regions = situation.global ? [false, true] : [false];
    const plans: ScenarioPlan[] = [];
    if (cdn) plans.push({ name: 'Edge hit', far: false, edge: 'hit', cache: 'none' });
    for (const far of regions) {
      for (const cache of cacheStates) {
        const base = cache === 'none' ? (cdn ? 'Origin' : 'Direct') : `Cache ${cache}`;
        plans.push({ name: far ? `Far ${base.toLowerCase()}` : base, far, edge: cdn ? 'miss' : 'none', cache });
      }
    }

    const label = (s: UseCaseStep, write: boolean) => {
      const prefix = [s.x && s.x > 1 ? `x${Math.round(s.x)}` : '', sizeLabel(s.size, options.payload)].filter(Boolean).join(' ');
      const verb = s.op === 'call' ? 'SEND' : STORE_VERB[s.to]?.[write ? 1 : 0] ?? (write ? 'WRITE' : 'GET');
      return `${prefix ? `${prefix} ` : ''}${verb} ${s.entity ?? (s.op === 'call' ? 'message' : 'data')}`;
    };
    const cacheKey = steps.find(cacheable)?.entity ?? 'item';
    const hasBackground = steps.some(viaWorker);

    const scenarioText = (p: ScenarioPlan): string[] => {
      const t: string[] = [];
      const path = p.edge === 'hit' ? chain.slice(0, chain.indexOf(cdn!) + 1) : chain;
      const hops = path;
      const request = `${uc.method} ${uc.path}`;
      for (let i = 0; i + 1 < hops.length; i++) {
        t.push(`${hops[i]} -> ${hops[i + 1]} : ${chainSize ? `${chainSize} ` : ''}${request}`);
        if (i === 0 && p.far) t.push(`${hops[1]} -x ${WAN} : ocean crossing`);
      }
      if (p.edge !== 'hit') {
        if (p.cache === 'hit') t.push(`${handler} -> ${cacheNode} : GET ${cacheKey}`, `${cacheNode} --> ${handler} : hit`);
        else if (p.cache === 'miss') t.push(`${handler} -> ${cacheNode} : GET ${cacheKey}`, `${cacheNode} --> ${handler} : miss`);
        else if (p.cache === 'down') t.push(`${handler} -x ${cacheNode} : GET ${cacheKey}`);
        steps.forEach((s, i) => {
          if (viaWorker(s)) return;
          if (p.cache === 'hit' && cacheable(s)) return;
          const write = s.op !== 'read';
          // Signing is local: the app needs storage's credentials, not a call to it.
          if (!direct(s)) t.push(`${handler} -> ${targets[i]} : ${label(s, write)}`, `${targets[i]} --> ${handler} : ${write ? 'ok' : 'rows'}`);
        });
        if (p.cache === 'miss') t.push(`${handler} ->> ${cacheNode} : SET ${cacheKey}`);
        if (hasBackground) t.push(`${handler} ->> ${queue} : ENQUEUE ${uc.name.replace(/[^A-Za-z0-9 ]/g, '')}`);
      }
      for (let i = hops.length - 1; i > 0; i--) t.push(`${hops[i]} --> ${hops[i - 1]} : ${uc.status}`);
      if (p.edge !== 'hit') steps.forEach((s, i) => {
        if (direct(s)) t.push(`${hops[0]} -> ${targets[i]} : ${sizeLabel(s.size ?? uc.size, options.payload)} PUT ${s.entity ?? 'file'}`, `${targets[i]} --> ${hops[0]} : 200`);
      });
      return t;
    };

    const text: string[] = [`usecase ${quote(uc.name)} {`];
    if (plans.length === 1) text.push(...scenarioText(plans[0]).map((l) => `  ${l}`));
    else {
      plans.forEach((p, i) => {
        text.push(`  ${i === 0 ? '' : '} '}alt ${quote(p.name)} {`);
        text.push(...scenarioText(p).map((l) => `    ${l}`));
      });
      text.push('  }');
    }
    text.push('}', '');

    let background: BackgroundRoute | undefined;
    if (hasBackground) {
      const stalled = down.has(worker!) || steps.some((s, i) => viaWorker(s) && (down.has(targets[i]) || (s.op === 'write' && writesDown.has(targets[i]))));
      const batching = options.writeShare < 1;
      const bgName = `${uc.name} (background)`;
      const bgScenarios = batching ? [{ name: 'Write', writes: true }, { name: 'Buffer', writes: false }] : [{ name: 'Write', writes: true }];
      const bgText = (writes: boolean) => {
        const t = [`${queue} -> ${worker} : job`];
        steps.forEach((s, i) => {
          if (!viaWorker(s)) return;
          if (!writes && s.op === 'write') return;
          const write = s.op !== 'read';
          t.push(`${worker} -> ${targets[i]} : ${label(s, write)}`, `${targets[i]} --> ${worker} : ok`);
        });
        t.push(`${worker} --> ${queue} : ack`);
        return t;
      };
      text.push(`usecase ${quote(bgName)} {`);
      if (bgScenarios.length === 1) text.push(...bgText(true).map((l) => `  ${l}`));
      else {
        bgScenarios.forEach((s, i) => {
          text.push(`  ${i === 0 ? '' : '} '}alt ${quote(s.name)} {`);
          text.push(...bgText(s.writes).map((l) => `    ${l}`));
        });
        text.push('  }');
      }
      text.push('}', '');
      background = { name: bgName, queue: queue!, worker: worker!, scenarios: bgScenarios, stalled };
    }

    return {
      route: { key, name: uc.name, chain, handler, scenarios: plans, ...(cacheNode && usesCache ? { cache: cacheNode } : {}), ...(cdn ? { cdn } : {}), ...(background ? { background } : {}), targets },
      text,
    };
  }

  if (bodies.length) lines.push('', ...bodies);
  const source = lines.join('\n').trimEnd() + '\n';
  const { diagram, diagnostics } = parse(source);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) throw new Error(`Compiled board does not parse: ${errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}\n${source}`);
  return { source, diagram, routes, broken, ...(bots ? { bots } : {}) };
}

const STORE_NAME: Record<string, string> = { db: 'database', blob: 'object storage', search: 'search index', warehouse: 'data warehouse', cache: 'cache', queue: 'queue' };
const article = (s: string) => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`);

function sizeLabel(size: string | undefined, multiplier: number): string {
  if (!size) return '';
  const parsed = parseSize(size);
  if ('error' in parsed) return '';
  return `~${Math.max(1, Math.round(parsed.value * multiplier))}B`;
}
