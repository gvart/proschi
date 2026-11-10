import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { kindOf } from '../kinds';
import { builtinTypes, parse, parseTypeDecls } from '../parser';
import { format } from '../format';
import { mapResolver } from '../index';
import { toMermaidArchitecture } from '../mermaid';
import { diffDiagrams } from '../diff';
import { profileOf, KIND_PROFILES, TECH_PROFILES } from '../../sim/profiles';
import { matches } from '../../sim/flow';
import { findTech } from '../../catalog/componentCatalog';
import { STDLIB_SOURCES } from '../stdlib/sources.gen';
import { loadStdlib } from './stdlib';
import { lookupType, techNamed } from './resolve';

const messages = (source: string) => parse(source).diagnostics.map((d) => `${d.severity} ${d.line}: ${d.message}`);
const nodeOf = (source: string, id: string) => parse(source).diagram.nodes.find((n) => n.id === id)!;

describe('stdlib', () => {
  it('is generated from the .proschi files (npm run gen:stdlib)', () => {
    const dir = fileURLToPath(new URL('../stdlib/', import.meta.url));
    const names = readdirSync(dir).filter((n) => n.endsWith('.proschi'));
    expect(STDLIB_SOURCES.map((s) => s.path).sort()).toEqual(names.map((n) => `stdlib/${n}`).sort());
    expect(STDLIB_SOURCES[0].path).toBe('stdlib/core.proschi');
    for (const { path, source } of STDLIB_SOURCES) expect(source, path).toBe(readFileSync(dir + path.slice('stdlib/'.length), 'utf8'));
  });

  it('reads without problems and holds only types', () => {
    expect(loadStdlib(parseTypeDecls).diagnostics).toEqual([]);
    for (const { source, path } of STDLIB_SOURCES) {
      const { diagram } = parse(source);
      expect(diagram.nodes, path).toEqual([]);
      expect(diagram.edges, path).toEqual([]);
    }
  });

  it('has the seed types, rooted at Component', () => {
    const table = builtinTypes();
    const names = [...table.values()].map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['Component', 'Service', 'DataStore', 'Database', 'SqlDatabase', 'PostgreSQL', 'Cache', 'Redis', 'REST API']));
    for (const t of table.values()) {
      expect(t.builtin).toBe(true);
      if (t.name !== 'Component') expect(t.parents[t.parents.length - 1], t.name).toBe('Component');
    }
    expect(lookupType(table, 'PostgreSQL')).toMatchObject({ parents: ['SqlDatabase', 'Database', 'DataStore', 'Component'], kind: 'database', protocol: 'SQL', icon: 'PostgreSQL' });
    expect(lookupType(table, 'Component')).toMatchObject({ abstract: true, parents: [] });
  });

  it('gives a type named after a catalog tech that tech icon and kind', () => {
    for (const t of builtinTypes().values()) {
      const name = techNamed(t.name);
      if (!name) continue;
      const tech = findTech(name)!;
      expect(t.icon, t.name).toBe(tech.techStack);
      expect(t.kind, t.name).toBe(kindOf({ kind: 'component', type: tech.type, techStack: tech.techStack }));
    }
  });

  it('never changes what a catalog name means', () => {
    // `SQL Database` is an alias of Database and `Datastore` of GCP Firestore, though SqlDatabase and DataStore are built-in types.
    expect(nodeOf('db [SQL Database]', 'db')).toMatchObject({ techStack: 'Database', resolvedType: { name: 'Database' } });
    expect(nodeOf('db [Datastore]', 'db').techStack).toBe('GCP Firestore');
    expect(nodeOf('db [Datastore]', 'db').resolvedType).toBeUndefined();
    expect(messages('db [SQL Database]\nf [Datastore]')).toEqual([]);
    for (const t of builtinTypes().values()) {
      const tech = findTech(t.name);
      if (tech) expect(lookupType(builtinTypes(), t.name)?.name ?? tech.techStack, t.name).toBe(techNamed(t.name) ? t.name : (lookupType(builtinTypes(), tech.techStack)?.name ?? tech.techStack));
    }
  });

  it('leaves the simulation of catalog techs as it was', () => {
    for (const t of builtinTypes().values()) expect(t.props, t.name).toEqual({});
  });
});

describe('type blocks', () => {
  const ledger = `type LedgerDb extends PostgreSQL {
  latencyMs 8
  availability 99.99%
  durable true
  op write APPEND latency 2 cost 3
  op read SELECT latency 0.5
  status 200, 409
  header Authorization, Content-Type, X-Idempotency-Key
  doc "Append-only ledger"
}
ledger "Ledger" [LedgerDb]
`;

  it('parses a type and attaches it to the nodes that use it', () => {
    const { diagram, diagnostics } = parse(ledger);
    expect(diagnostics).toEqual([]);
    expect(diagram.types?.map((t) => t.name)).toEqual(['LedgerDb']);
    const node = diagram.nodes[0];
    expect(node.resolvedType).toMatchObject({
      name: 'LedgerDb',
      abstract: false,
      builtin: false,
      parents: ['PostgreSQL', 'SqlDatabase', 'Database', 'DataStore', 'Component'],
      kind: 'database',
      protocol: 'SQL',
      props: { latencyMs: 8, availability: 0.9999, durable: true },
      statuses: [200, 409],
      headers: ['Authorization', 'Content-Type', 'X-Idempotency-Key'],
      doc: 'Append-only ledger',
      loc: { line: 1, col: 6, length: 8 },
    });
  });

  it('merges ops with the inherited ones, own ops replacing inherited ones of the same name', () => {
    const ops = nodeOf(ledger, 'ledger').resolvedType!.ops;
    expect(ops).toEqual([
      { name: 'INSERT', access: 'write' },
      { name: 'UPDATE', access: 'write' },
      { name: 'DELETE', access: 'write' },
      { name: 'APPEND', access: 'write', latency: 2, cost: 3 },
      { name: 'SELECT', access: 'read', latency: 0.5 },
    ]);
  });

  it('draws a node of a declared type with its nearest built-in icon', () => {
    const node = nodeOf(ledger, 'ledger');
    expect(node).toMatchObject({ kind: 'component', type: 'database', techStack: 'PostgreSQL' });
    expect(node.inferredKind).toBeUndefined();
    expect(kindOf(node)).toBe('database');
    const iconned = nodeOf('type Audit extends LedgerDb { icon [DynamoDB] }\n' + ledger + 'a [Audit]', 'a');
    expect(iconned).toMatchObject({ techStack: 'DynamoDB', resolvedType: { icon: 'DynamoDB', parents: ['LedgerDb', 'PostgreSQL', 'SqlDatabase', 'Database', 'DataStore', 'Component'] } });
    // No built-in icon on the way up: the generic tech of the kind.
    expect(nodeOf('type Bag extends DataStore {\n  kind storage\n}\nb [Bag]', 'b')).toMatchObject({ techStack: 'Object Storage', type: 'storage' });
  });

  it('overrides scalars down the chain and lets a child change the kind', () => {
    const source = `type A extends Service {
  latencyMs 20
  protocol gRPC
}
type B extends A {
  latencyMs 30
}
type C extends B {
  kind function
}
b [B]
c [C]
`;
    expect(messages(source)).toEqual([]);
    expect(nodeOf(source, 'b').resolvedType).toMatchObject({ props: { latencyMs: 30 }, protocol: 'gRPC', kind: 'service' });
    expect(nodeOf(source, 'c').resolvedType).toMatchObject({ props: { latencyMs: 30 }, kind: 'function', icon: 'Service' });
    expect(kindOf(nodeOf(source, 'c'))).toBe('function');
  });

  it('takes a one-line body and a bracketed name with spaces', () => {
    const source = 'type [Ledger Store] extends [REST API] { op write APPEND }\ntype Empty extends Service {}\nl [Ledger Store]\ne [Empty]';
    const { diagram, diagnostics } = parse(source);
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes[0].resolvedType).toMatchObject({ name: 'Ledger Store', parents: ['REST API', 'Service', 'Component'], statuses: expect.arrayContaining([200, 404]) });
    expect(diagram.nodes[0].resolvedType!.ops.at(-1)).toEqual({ name: 'APPEND', access: 'write' });
    expect(diagram.nodes[1].resolvedType).toMatchObject({ name: 'Empty', kind: 'service' });
  });

  it('finds a type declared below its use, case and spacing aside', () => {
    expect(nodeOf('l [ledger db]\ntype LedgerDb extends PostgreSQL {}', 'l').resolvedType?.name).toBe('LedgerDb');
  });

  it('gives catalog techs their built-in type, aliases included', () => {
    expect(nodeOf('db [Postgres]', 'db')).toMatchObject({ techStack: 'PostgreSQL', resolvedType: { name: 'PostgreSQL', builtin: true } });
    expect(nodeOf('c [Redis]', 'c').resolvedType?.name).toBe('Redis');
    expect(nodeOf('k [Kafka]', 'k').resolvedType).toBeUndefined();
  });

  it('reports cycles, unknown parents, duplicates and redeclared built-ins', () => {
    expect(messages('type A extends B {}\ntype B extends A {}\na [A]')).toEqual(['error 2: Type cycle: A → B → A']);
    expect(messages('type A extends A {}')).toEqual(['error 1: Type cycle: A → A']);
    expect(messages('type A extends PostgreSQLL {}')).toEqual(["error 1: Unknown parent type 'PostgreSQLL'. Did you mean 'PostgreSQL'?"]);
    expect(messages('type A extends Service {}\ntype A extends Cache {}')).toEqual(["error 2: Duplicate type 'A' (first declared on line 1)"]);
    expect(messages('type Redis extends Cache {}')).toEqual(["error 1: Type 'Redis' is built in; extend it under another name"]);
    expect(messages('type Kafka extends Service {}')).toEqual(["warning 1: Type 'Kafka' has the name of the catalog tech 'Kafka'; [Kafka] now means this type"]);
    expect(messages('type NoKind {}')).toEqual(["error 1: Type 'NoKind' needs a kind: declare one (kind database) or extend a type that has one"]);
  });

  it('warns about a node of an abstract type, and suggests a concrete one', () => {
    const source = 'abstract type Store extends Database {}\ntype Ledger extends Store {}\ndb [Store]';
    expect(messages(source)).toEqual(["warning 3: 'Store' is an abstract type; use a type that extends it, like [Ledger]"]);
    const node = nodeOf(source, 'db');
    expect(node).toMatchObject({ techStack: 'Database', resolvedType: { name: 'Store' } });
    expect(kindOf(node)).toBe('database');
    // Without a kind on the way up, the name decides, as for an unknown tech.
    expect(nodeOf('abstract type [Blob Thing] {}\ns [Blob Thing]', 's')).toMatchObject({ inferredKind: 'storage', techStack: 'Object Storage' });
  });

  it('reports malformed lines', () => {
    expect(messages(`type A extends Service {
  kind blob
  latencyMs 4s
  latencyMs 5 rps
  availability 0.5
  op fetch X
  op read X latency
  status 99
  colour red
  header
}`)).toEqual([
      "error 2: Unknown kind 'blob'; use one of client, edge, cdn, loadbalancer, gateway, dns, service, function, cache, database, search, analytics, queue, broker, storage, external, other",
      'error 4: Expected a number after latencyMs, e.g. latencyMs 4, not a rate',
      'error 5: Expected a percentage after availability, e.g. availability 99.95%',
      'error 6: Expected read or write after op, e.g. op read SELECT',
      'error 7: Expected a multiplier after latency, e.g. latency 2 or latency 0.5',
      "error 8: '99' is not an HTTP status code (100 to 599)",
      expect.stringMatching(/^error 9: Unknown type property 'colour'; use kind, protocol, op/),
      'error 10: Expected header names, e.g. header Authorization, Content-Type',
    ]);
    expect(messages('group g {\n  type A extends Service {\n    kind cache\n  }\n}')).toEqual(['error 2: Declare types at the top level, not inside a block']);
    expect(messages('type A extends Service {\n  kind cache')).toEqual(["error 1: Missing } to close type 'A'"]);
  });

  it('still reads nodes called type and abstract', () => {
    expect(parse('type pos 10,20').diagram.nodes[0]).toMatchObject({ id: 'type', position: { x: 10, y: 20 } });
    expect(parse('type x3').diagram.nodes[0]).toMatchObject({ id: 'type', replicas: 3 });
    const { diagram, diagnostics } = parse('type "Type" [Service]\nabstract [Cache] x2\ntype -> abstract : reads');
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(diagram.nodes.map((n) => n.id)).toEqual(['type', 'abstract']);
    expect(diagram.types).toBeUndefined();
  });

  it('keeps the unknown-tech warning for names that are no type', () => {
    expect(messages('db [TigerBeetle DB]')).toEqual(["warning 1: Unknown tech stack 'TigerBeetle DB'; simulated as a generic database, like [Database]"]);
    expect(nodeOf('db [TigerBeetle DB]', 'db')).toMatchObject({ techStack: 'TigerBeetle DB', inferredKind: 'database' });
    expect(nodeOf('db [TigerBeetle DB]', 'db').resolvedType).toBeUndefined();
  });

  it('warns about an icon that is not a catalog tech', () => {
    expect(messages('type A extends Service { icon Nope }\na [A]')).toEqual(["warning 1: Unknown icon 'Nope' (did you mean 'Node.js'?); the type keeps its inherited icon"]);
    expect(nodeOf('type A extends Service { icon Nope }\na [A]', 'a').techStack).toBe('Service');
  });

  it('lets a test select nodes by their declared type', () => {
    const source = `type LedgerDb extends PostgreSQL {}
db [LedgerDb]
usecase "Pay" {
  db -> db : SELECT x
}
test "t" {
  "Pay" calls [LedgerDb]
}`;
    expect(messages(source)).toEqual([]);
    const node = nodeOf(source, 'db');
    expect(matches(node, { tech: 'LedgerDb' })).toBe(true);
    expect(matches(node, { tech: 'PostgreSQL' })).toBe(true);
    expect(messages('test "t" {\n  "Pay" calls [LedgrDb]\n}').some((m) => m.includes("Unknown tech stack 'LedgrDb'"))).toBe(true);
  });
});

describe('imports', () => {
  it('makes types of an imported file visible to the importer', () => {
    const files = {
      'types.proschi': 'type LedgerDb extends PostgreSQL {\n  latencyMs 8\n}\n',
      'root.proschi': 'import "types.proschi"\nledger [LedgerDb]\n',
    };
    const { diagram, diagnostics } = parse(files['root.proschi'], { path: 'root.proschi', resolve: mapResolver(files) });
    expect(diagnostics).toEqual([]);
    expect(diagram.types).toMatchObject([{ name: 'LedgerDb', loc: { file: 'types.proschi', line: 1 } }]);
    expect(diagram.nodes[0]).toMatchObject({ techStack: 'PostgreSQL', resolvedType: { name: 'LedgerDb', props: { latencyMs: 8 } } });
  });

  it('reports a duplicate across files with the first file', () => {
    const files = { 'a.proschi': 'type T extends Service {}\n', 'root.proschi': 'import "a.proschi"\ntype T extends Cache {}\n' };
    const { diagnostics } = parse(files['root.proschi'], { path: 'root.proschi', resolve: mapResolver(files) });
    expect(diagnostics.map((d) => d.message)).toEqual(["Duplicate type 'T' (first declared in a.proschi on line 1)"]);
  });
});

describe('profileOf', () => {
  it('takes the numbers a type sets over the tech row', () => {
    const source = 'type LedgerDb extends PostgreSQL {\n  latencyMs 8\n  rps 10k\n  availability 99.99%\n}\nl [LedgerDb]\np [PostgreSQL]';
    const ledger = profileOf(nodeOf(source, 'l'));
    const plain = profileOf(nodeOf(source, 'p'));
    expect(ledger).toEqual({ ...plain, latencyMs: 8, rps: 10_000, readRps: 10_000, writeRps: 10_000, availability: 0.9999 });
    // A capacity override still wins.
    expect(profileOf(nodeOf(source, 'l'), { node: 'l', latencyMs: 3, loc: { line: 1, col: 1, length: 1 } }).latencyMs).toBe(3);
  });

  it('keeps the tech row while the type keeps its kind, and the kind row when it changes it', () => {
    const source = 'type Docs extends [DynamoDB] {}\ntype Hot extends [DynamoDB] {\n  kind cache\n}\nd [Docs]\nh [Hot]';
    expect(profileOf(nodeOf(source, 'd')).rps).toBe(TECH_PROFILES['DynamoDB'].rps);
    expect(profileOf(nodeOf(source, 'h'))).toMatchObject({ kind: 'cache', latencyMs: KIND_PROFILES.cache.latencyMs });
  });

  it('is unchanged for catalog techs with a built-in type', () => {
    for (const tech of ['PostgreSQL', 'Redis', 'Service', 'REST API', 'Database', 'Cache']) {
      const node = nodeOf(`n [${tech}]`, 'n');
      expect(node.resolvedType, tech).toBeDefined();
      expect(profileOf(node), tech).toEqual(profileOf({ ...node, resolvedType: undefined }));
    }
  });
});

describe('format, diff and Mermaid', () => {
  const source = `abstract   type Store extends DataStore {
    kind database
  op read   SELECT,Scan latency 8
    op write INSERT
  header Authorization,   Content-Type   # names
     doc   "A store"
}
type LedgerDb extends Store {   op write APPEND   }
db [LedgerDb]
`;

  it('formats a type block and keeps its meaning', () => {
    const formatted = format(source);
    expect(formatted).toBe(`abstract type Store extends DataStore {
  kind database
  op read  SELECT, Scan latency 8
  op write INSERT
  header Authorization,   Content-Type   # names
  doc "A store"
}
type LedgerDb extends Store { op write APPEND }
db [LedgerDb]
`);
    expect(format(formatted)).toBe(formatted);
    const strip = (s: string) => JSON.stringify(parse(s).diagram, (k, v) => (k === 'loc' || k === 'parentLoc' ? undefined : v));
    expect(strip(formatted)).toBe(strip(source));
    expect(parse(formatted).diagnostics).toEqual([]);
  });

  it('shows a change of declared type in a diff, and the type name in Mermaid', () => {
    const before = 'type A extends PostgreSQL {}\ntype B extends PostgreSQL {}\ndb [A]';
    const after = 'type A extends PostgreSQL {}\ntype B extends PostgreSQL {}\ndb [B]';
    const diff = diffDiagrams(parse(before).diagram, parse(after).diagram);
    expect(diff.nodes.changed[0].changes).toEqual([{ field: 'typeName', before: 'A', after: 'B' }]);
    expect(toMermaidArchitecture(parse(after).diagram)).toContain('[B]');
    expect(toMermaidArchitecture(parse('db [PostgreSQL]').diagram)).toContain('[PostgreSQL]');
  });
});
