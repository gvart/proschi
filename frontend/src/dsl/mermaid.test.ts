import { describe, expect, it } from 'vitest';
import { examples, parse } from './index';
import { escapeMermaid, toMermaidArchitecture, toMermaidSequence } from './mermaid';
import { buildSequence, sequenceMessages, shorten } from './sequence';

const lines = (text: string) => text.trimEnd().split('\n').map((l) => l.trim());
const diagramOf = (source: string) => parse(source).diagram;

const shop = diagramOf(`title "Shop"
group vpc "AWS VPC" {
  gateway "API Gateway" [AWS API Gateway]
  group inner "Core" {
    orders "Order Service" [REST API] @orders
  }
}
db "Orders DB" [PostgreSQL]
events "Events" [Kafka]
gateway -> orders : HTTP
orders -> db : SQL

usecase "Create order" {
  gateway -> orders : POST /orders json {"sku": "A1"}
  alt "Created" {
    par {
      orders -> db : INSERT order
      orders ->> events : OrderCreated
    }
    orders --> gateway : 201 {"id": 1}
  } alt "DB down" {
    orders -x db : INSERT order
    orders --> gateway : 503
  }
}
`);

describe('escapeMermaid', () => {
  it('turns Mermaid-special characters into entity codes', () => {
    expect(escapeMermaid('a;b#c%d<e>f')).toBe('a#59;b#35;c#37;d#60;e#62;f');
    expect(escapeMermaid('say "hi"')).toBe('say "hi"');
    expect(escapeMermaid('say "hi"', true)).toBe('say #34;hi#34;');
  });

  it('joins lines', () => {
    expect(escapeMermaid('one\n  two\r\nthree')).toBe('one two three');
  });
});

describe('shorten', () => {
  it('collapses whitespace and truncates with an ellipsis', () => {
    expect(shorten('{\n  "a": 1\n}')).toBe('{ "a": 1 }');
    const long = shorten(`{"items": [${'1, '.repeat(40)}1]}`);
    expect(long.length).toBe(40);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('buildSequence', () => {
  it('puts responses back after the calls they wait for', () => {
    const d = diagramOf(`usecase "Login" {
  browser -> web : POST /login
  web -> auth : POST /authenticate
  auth -> users : SELECT user
  users --> auth : 1 row
  auth -> sessions : SET session
  auth --> web : 200
  web --> browser : 302
}`);
    const uc = d.useCases[0];
    const order = sequenceMessages(buildSequence(uc, uc.scenarios[0], d.nodes).items).map((m) => `${m.from}>${m.to}`);
    expect(order).toEqual(['browser>web', 'web>auth', 'auth>users', 'users>auth', 'auth>sessions', 'auth>web', 'web>browser']);
  });

  it('answers open calls before a step from an earlier participant', () => {
    const d = diagramOf(`usecase "Upload" {
  client -> gateway : POST /images
  gateway -> upload : invoke
  upload --> gateway : 202
  gateway --> client : 202
  jobs -> resize : ResizeRequested
}`);
    const uc = d.useCases[0];
    const order = sequenceMessages(buildSequence(uc, uc.scenarios[0], d.nodes).items).map((m) => `${m.kind[0]}:${m.from}>${m.to}`);
    expect(order).toEqual(['r:client>gateway', 'r:gateway>upload', 'r:upload>gateway', 'r:gateway>client', 'r:jobs>resize']);
  });

  it('lists participants in order of first appearance with display names', () => {
    const uc = shop.useCases[0];
    const seq = buildSequence(uc, uc.scenarios[0], shop.nodes);
    expect(seq.participants.map((p) => p.name)).toEqual(['API Gateway', 'Order Service', 'Orders DB', 'Events']);
    expect(seq.participants[0].tech).toBe('AWS API Gateway');
  });
});

describe('toMermaidSequence', () => {
  it('writes participants, requests, responses and par blocks', () => {
    const out = lines(toMermaidSequence(shop, 'create-order', 'created'));
    expect(out[0]).toBe('sequenceDiagram');
    expect(out).toContain('title Create order');
    expect(out).toContain('participant gateway as API Gateway');
    expect(out).toContain('participant orders as Order Service');
    expect(out).toContain('Note over gateway,events: Created');
    expect(out).toContain('gateway->>orders: POST /orders {"sku": "A1"}');
    const par = out.indexOf('par');
    expect(out.slice(par, par + 5)).toEqual(['par', 'orders->>db: INSERT order', 'and', 'orders-)events: OrderCreated', 'end']);
    expect(out.at(-1)).toBe('orders-->>gateway: 201 {"id": 1}');
  });

  it('marks failed calls and error scenarios', () => {
    const out = lines(toMermaidSequence(shop, 'create-order', 'db-down'));
    expect(out).toContain('Note over gateway,db: DB down (error)');
    expect(out).toContain('orders-xdb: INSERT order');
    expect(out).toContain('orders-->>gateway: 503');
    expect(out.join('\n')).not.toContain('db-->>orders');
  });

  it('uses the first scenario by default and omits the note without alternatives', () => {
    const d = diagramOf('usecase "Ping" {\n  a -> b : GET /ping\n  b --> a : 200 pong\n}');
    const out = lines(toMermaidSequence(d, 'ping'));
    expect(out).toEqual(['sequenceDiagram', 'title Ping', 'participant a as a', 'participant b as b', 'a->>b: GET /ping', 'b-->>a: 200 pong']);
    expect(toMermaidSequence(d, 'missing')).toBe('');
    expect(toMermaidSequence(shop, 'create-order', 'missing')).toBe('');
  });

  it('escapes labels and names, keeps payloads short, and renames reserved ids', () => {
    const d = diagramOf(`client "A;B #1" [Actor]
end "The <End>" [REST API]
usecase "U" {
  client ->> end : notify <b>channel</b>; now
  client -> end : POST /x json {"items": [${'"aaaa", '.repeat(20)}"z"]}
  end --> client : 200 text 100% done
}`);
    const out = lines(toMermaidSequence(d, 'u'));
    expect(out).toContain('actor client as A#59;B #35;1');
    expect(out).toContain('participant end_ as The #60;End#62;');
    expect(out).toContain('client-)end_: notify #60;b#62;channel#60;/b#62;#59; now');
    const post = out.find((l) => l.startsWith('client->>end_: POST /x'))!;
    expect(post.endsWith('…')).toBe(true);
    expect(post.length).toBeLessThan(70);
    expect(out).toContain('end_-->>client: 200 100#37; done');
  });

  it('writes async request/response pairs', () => {
    const d = diagramOf('usecase "U" {\n  a ->> q : Job\n  q --> a : 202 queued\n}');
    expect(lines(toMermaidSequence(d, 'u')).slice(-2)).toEqual(['a-)q: Job', 'q-->>a: 202 queued']);
  });

  it('shows a scenario condition when the parser provides one', () => {
    const d = structuredClone(shop);
    Object.assign(d.useCases[0].scenarios[1], { condition: 'the database is down' });
    expect(lines(toMermaidSequence(d, 'create-order', 'db-down'))).toContain('Note over gateway,db: DB down (error) when the database is down');
  });
});

describe('toMermaidArchitecture', () => {
  it('writes nested subgraphs, labelled nodes and edges', () => {
    const out = lines(toMermaidArchitecture(shop));
    expect(out.slice(0, 4)).toEqual(['---', 'title: "Shop"', '---', 'flowchart LR']);
    const vpc = out.indexOf('subgraph vpc["AWS VPC"]');
    expect(out.slice(vpc, vpc + 6)).toEqual([
      'subgraph vpc["AWS VPC"]',
      'gateway["API Gateway<br/>[AWS API Gateway]"]',
      'subgraph inner["Core"]',
      'orders["Order Service<br/>[REST API]"]',
      'end',
      'end',
    ]);
    expect(out).toContain('db[("Orders DB<br/>[PostgreSQL]")]');
    expect(out).toContain('events[["Events<br/>[Kafka]"]]');
    expect(out).toContain('gateway -->|"HTTP"| orders');
    expect(out).toContain('orders -->|"SQL"| db');
  });

  it('escapes quotes and reserved ids, and leaves implicit nodes without a tech', () => {
    const d = diagramOf('end "Say \\"hi\\"" [REST API]\nend -> x1 : a;b\n');
    const out = lines(toMermaidArchitecture(d));
    expect(out[0]).toBe('flowchart LR');
    expect(out).toContain('end_["Say #34;hi#34;<br/>[REST API]"]');
    expect(out).toContain('x1["x1"]');
    expect(out).toContain('end_ -->|"a#59;b"| x1');
  });

  it('draws text nodes as notes', () => {
    const out = lines(toMermaidArchitecture(diagramOf('note "N" [Sticky Note] "Remember"\n')));
    expect(out).toContain('note_>"Remember"]');
  });
});

describe('every example', () => {
  it.each(examples.map((e) => [e.name, e.source]))('%s exports without throwing', (_name, source) => {
    const d = diagramOf(source);
    expect(toMermaidArchitecture(d)).toContain('flowchart LR');
    for (const uc of d.useCases) {
      for (const s of uc.scenarios) {
        const out = toMermaidSequence(d, uc.id, s.id);
        expect(out.startsWith('sequenceDiagram\n')).toBe(true);
        // Every request is drawn exactly once.
        const requests = out.split('\n').filter((l) => /^\s+\w+(->>|-\)|-x)\w+:/.test(l));
        expect(requests).toHaveLength(s.steps.length);
      }
    }
  });
});
