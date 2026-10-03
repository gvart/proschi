import { describe, expect, it } from 'vitest';
import { ecommerceExample, parse, parseStepLabel, toCanvas } from './index';

const errors = (src: string) => parse(src).diagnostics.filter((d) => d.severity === 'error');
const warnings = (src: string) => parse(src).diagnostics.filter((d) => d.severity === 'warning');

describe('example document', () => {
  const { diagram, diagnostics } = parse(ecommerceExample);

  it('parses without diagnostics', () => {
    expect(diagnostics).toEqual([]);
  });

  it('reads title, nodes, groups and edges', () => {
    expect(diagram.title).toBe('E-Commerce Platform');
    expect(diagram.nodes.map((n) => n.id)).toEqual(['vpc', 'gateway', 'orders', 'users', 'ordersDb', 'usersDb', 'events']);
    expect(diagram.edges).toHaveLength(5);

    const orders = diagram.nodes.find((n) => n.id === 'orders')!;
    expect(orders).toMatchObject({
      name: 'Order Service',
      type: 'service',
      techStack: 'REST API',
      ownerTeam: 'Orders',
      description: 'Handles order processing',
      parent: 'vpc',
    });
    expect(diagram.nodes.find((n) => n.id === 'vpc')).toMatchObject({ kind: 'group', techStack: 'Logical Group' });
    expect(diagram.nodes.find((n) => n.id === 'events')).toMatchObject({ type: 'queue', parent: undefined });
  });

  it('builds use case steps with responses and parallel groups', () => {
    const [useCase] = diagram.useCases;
    expect(useCase).toMatchObject({ id: 'create-order', name: 'Create order', entryServiceId: 'gateway' });
    expect(useCase.steps.map((s) => s.stepName)).toEqual(['POST /api/orders', 'GET /api/users/user123', 'INSERT order', 'OrderCreated']);

    const [create, getUser, insert, publish] = useCase.steps;
    expect(create).toMatchObject({ httpMethod: 'POST', endpoint: '/api/orders', protocol: 'REST', statusCode: 201, requestFormat: 'JSON' });
    expect(JSON.parse(create.requestBody!)).toEqual({ userId: 'user123', items: [{ productId: 'prod-1', quantity: 2 }] });
    expect(JSON.parse(create.responseBody!)).toEqual({ orderId: 'order-789', status: 'pending' });

    expect(getUser).toMatchObject({ protocol: 'GRAPHQL', statusCode: 200, responseBody: '{"verified": true}' });
    expect(insert).toMatchObject({ protocol: 'OTHER', isParallel: true, parallelGroup: 1, executionType: 'SYNC_REQUEST_RESPONSE' });
    expect(publish).toMatchObject({ protocol: 'MESSAGING', isParallel: true, parallelGroup: 1, executionType: 'ASYNC_FIRE_AND_FORGET' });
    expect(useCase.steps.map((s) => s.stepOrder)).toEqual([0, 1, 2, 3]);
  });

  it('converts to canvas nodes', () => {
    const { nodes, edges } = toCanvas(diagram);
    expect(nodes.find((n) => n.id === 'vpc')?.type).toBe('groupNode');
    expect(nodes.find((n) => n.id === 'gateway')).toMatchObject({ type: 'componentNode', data: { name: 'API Gateway' } });
    expect(new Set(nodes.map((n) => `${n.position.x},${n.position.y}`)).size).toBe(nodes.length);
    expect(edges[0]).toEqual({ id: 'gateway->orders', source: 'gateway', target: 'orders', label: 'HTTP' });
  });
});

describe('nodes', () => {
  it('matches tech stacks case-insensitively', () => {
    const [node] = parse('db [postgresql]').diagram.nodes;
    expect(node.techStack).toBe('PostgreSQL');
    expect(node.type).toBe('database');
  });

  it('warns on unknown tech and falls back to a rectangle', () => {
    const { diagram, diagnostics } = parse('x [Cobol Mainframe]');
    expect(diagram.nodes[0].techStack).toBe('Rectangle');
    expect(diagnostics).toEqual([expect.objectContaining({ severity: 'warning', line: 1, col: 3, message: expect.stringContaining('Cobol') })]);
  });

  it('reads explicit positions, including negative ones', () => {
    expect(parse('a pos 10,-20').diagram.nodes[0].position).toEqual({ x: 10, y: -20 });
    expect(errors('a pos 10')).toHaveLength(1);
  });

  it('makes text nodes from annotation tech stacks', () => {
    const { diagram } = parse('note "Heads up" [Sticky Note] "Rate limited to 100 rps"');
    expect(diagram.nodes[0].kind).toBe('text');
    expect(toCanvas(diagram).nodes[0]).toMatchObject({ type: 'textNode', data: { textContent: 'Rate limited to 100 rps' } });
  });

  it('reports duplicate ids with the original line', () => {
    expect(errors('a\nb\na')).toEqual([expect.objectContaining({ line: 3, message: expect.stringContaining('line 1') })]);
  });

  it('treats keywords at the start of a line as statements', () => {
    expect(errors('title')[0].message).toMatch(/Expected a title/);
    expect(errors('par')[0].message).toMatch(/only allowed inside a usecase/);
  });

  it('creates implicit nodes for undeclared references', () => {
    const { diagram, diagnostics } = parse('a -> b\nb "Bee"');
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.map((n) => [n.id, n.name, n.implicit])).toEqual([
      ['b', 'Bee', undefined],
      ['a', 'a', true],
    ]);
  });

  it('nests groups', () => {
    const { diagram } = parse('group outer {\n  group inner [Security Zone] {\n    svc\n  }\n}');
    expect(diagram.nodes.map((n) => [n.id, n.parent])).toEqual([
      ['outer', undefined],
      ['inner', 'outer'],
      ['svc', 'inner'],
    ]);
    expect(diagram.nodes[1].techStack).toBe('Security Zone');
  });

  it('warns when a group uses a non-group style', () => {
    const { diagram, diagnostics } = parse('group g [Kafka] {\n}');
    expect(diagram.nodes[0].techStack).toBe('Logical Group');
    expect(diagnostics[0].severity).toBe('warning');
  });
});

describe('edges', () => {
  it('unquotes labels and de-duplicates ids', () => {
    const { diagram } = parse('a -> b : "routes /orders"\na -> b\na --> b');
    expect(diagram.edges.map((e) => [e.id, e.label])).toEqual([
      ['a->b', 'routes /orders'],
      ['a->b#2', undefined],
      ['a->b#3', undefined],
    ]);
  });

  it('needs a target', () => {
    expect(errors('a ->')[0].message).toMatch(/target/);
  });

  it('needs a colon before the label', () => {
    expect(errors('a -> b "label"')[0].message).toMatch(/:/);
  });
});

describe('comments', () => {
  it('ignores full-line and trailing comments', () => {
    const { diagram, diagnostics } = parse('# header\na [Redis] # cache\na -> b : Publish # async');
    expect(diagnostics).toEqual([]);
    expect(diagram.edges[0].label).toBe('Publish');
  });

  it('keeps # inside payloads and quoted labels', () => {
    const src = 'usecase U {\n  a -> b : POST /tags {"tag": "#1"}\n}\na -> b : "issue #42"';
    const { diagram } = parse(src);
    expect(diagram.useCases[0].steps[0].requestBody).toBe('{"tag": "#1"}');
    expect(diagram.edges[0].label).toBe('issue #42');
  });
});

describe('use cases', () => {
  it('upgrades async calls that get a response', () => {
    const { diagram } = parse('usecase U {\n  a ->> q : Job\n  q --> a : done\n}');
    expect(diagram.useCases[0].steps[0]).toMatchObject({ executionType: 'ASYNC_REQUEST_RESPONSE', responseBody: 'done', responseFormat: 'FREE_TEXT' });
  });

  it('matches a response to the latest unanswered request', () => {
    const { diagram } = parse('usecase U {\n  a -> b : GET /1\n  a -> b : GET /2\n  b --> a : 200\n  b --> a : 404\n}');
    expect(diagram.useCases[0].steps.map((s) => s.statusCode)).toEqual([404, 200]);
  });

  it('warns on a response without a request', () => {
    expect(warnings('usecase U {\n  b --> a : 200\n}')[0].message).toMatch(/no matching request/);
  });

  it('infers messaging for queue targets', () => {
    const { diagram } = parse('q [SQS]\nusecase U {\n  a -> q : Enqueue\n}');
    expect(diagram.useCases[0].steps[0].protocol).toBe('MESSAGING');
  });

  it('gives use cases unique slug ids', () => {
    const { diagram } = parse('usecase "Place Order!" {\n}\nusecase "place order" {\n}');
    expect(diagram.useCases.map((u) => u.id)).toEqual(['place-order', 'place-order-2']);
  });

  it('numbers par blocks separately', () => {
    const { diagram } = parse('usecase U {\n  par {\n    a -> b\n  }\n  par {\n    a -> c\n  }\n  a -> d\n}');
    expect(diagram.useCases[0].steps.map((s) => s.parallelGroup)).toEqual([1, 2, undefined]);
  });

  it('rejects declarations that do not belong in a use case', () => {
    expect(errors('usecase U {\n  svc [REST API]\n}')[0]).toMatchObject({ line: 2, message: expect.stringMatching(/outside usecase/) });
    expect(errors('usecase U {\n  group g {\n  }\n}')[0].message).toMatch(/Groups cannot/);
    expect(errors('usecase U {\n  par {\n    par {\n    }\n  }\n}')[0].message).toMatch(/nested/);
    expect(errors('par {\n}')[0].message).toMatch(/only allowed inside a usecase/);
    expect(errors('group g {\n  usecase U {\n  }\n}')[0].message).toMatch(/top level/);
  });

  it('reports an unclosed multi-line payload', () => {
    expect(errors('usecase U {\n  a -> b : POST /x {\n    "a": 1\n')).toContainEqual(expect.objectContaining({ line: 2, message: 'Unclosed { or [ in payload' }));
  });
});

describe('step labels', () => {
  it.each([
    ['POST /orders', { name: 'POST /orders', method: 'POST', endpoint: '/orders' }],
    ['POST /orders json {"a":1}', { method: 'POST', format: 'JSON', body: '{"a":1}' }],
    ['PUT /doc xml <doc/>', { method: 'PUT', format: 'XML', body: '<doc/>' }],
    ['GET /health checks liveness', { name: 'GET /health', description: 'checks liveness' }],
    ['text hello world', { name: '', format: 'FREE_TEXT', body: 'hello world' }],
    ['Send text message', { name: 'Send text message', body: undefined }],
    ['OrderPlaced {"id": 1}', { name: 'OrderPlaced', format: 'JSON', body: '{"id": 1}' }],
    ['"Quoted name"', { name: 'Quoted name' }],
  ])('%s', (label, expected) => {
    expect(parseStepLabel(label)).toMatchObject(expected);
  });

  it('only treats known HTTP verbs as methods', () => {
    expect(parseStepLabel('FETCH /x')).toEqual({ name: 'FETCH /x', format: undefined, body: undefined });
  });
});

describe('error recovery', () => {
  it('keeps parsing after a bad line', () => {
    const { diagram, diagnostics } = parse('a [REST API]\n%%% oops\nb [Redis]\na -> b');
    expect(diagnostics.map((d) => d.line)).toEqual([2, 2, 2]);
    expect(diagram.nodes.map((n) => n.id)).not.toContain('oops');
    expect(diagram.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(diagram.edges).toHaveLength(1);
  });

  it('reports unterminated strings and tech stacks', () => {
    expect(errors('a "API')[0].message).toMatch(/Unterminated string/);
    expect(errors('a [REST')[0].message).toMatch(/Missing \]/);
  });

  it('reports unmatched and missing braces', () => {
    expect(errors('}')[0].message).toBe('Unmatched }');
    expect(errors('group g {\n  a')[0]).toMatchObject({ line: 1, message: "Missing } to close group 'g'" });
  });

  it('sorts diagnostics by position', () => {
    const lines = parse('x [Nope]\n}\na "b').diagnostics.map((d) => d.line);
    expect(lines).toEqual([...lines].sort());
  });

  it('handles empty input', () => {
    expect(parse('')).toEqual({ diagram: { title: undefined, nodes: [], edges: [], useCases: [] }, diagnostics: [] });
  });
});
