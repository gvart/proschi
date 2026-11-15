import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import type { ParseOptions } from './types';

/**
 * Steps to a system's entry point are checked against the type of the node
 * behind it, where an expanded view reroutes them (docs/design/typed-components.md).
 */

const team = `user [Browser]
gateway [AWS API Gateway]
api [REST API]
db [PostgreSQL]
user -> api
gateway -> api
api -> db
usecase "Place order" {
  gateway -> api : POST /orders
  api -> db : INSERT order
  api --> gateway : 201
}
usecase "Browse" {
  user -> api : GET /items
  api --> user : 200
}
`;

const org = (steps: string) => `web [Browser]
system orders {
  from "orders.proschi"
  expose api -> "Place order"
  expose browse -> "Browse"
}
system stub {
  expose pay
  capacity { 1k rps p99 50ms availability 99.9% }
}
web -> orders.api
web -> orders.browse
web -> stub.pay
usecase "Buy" {
${steps}
}
`;

function run(steps: string, options: ParseOptions = {}) {
  const files: Record<string, string> = { 'org.proschi': org(steps), 'orders.proschi': team };
  return parse(files['org.proschi'], { path: 'org.proschi', resolve: (p) => (files[p] === undefined ? undefined : { path: p, source: files[p] }), ...options });
}
const messages = (steps: string, options?: ParseOptions) => run(steps, options).diagnostics.map((d) => `${d.severity}: ${d.message}`);

describe('steps to a system entry point', () => {
  it('take the type of the node the mapped use case starts at', () => {
    const { diagram } = run('  web -> orders.api : POST /orders header Authorization\n  orders --> web : 201');
    expect(diagram.useCases[0].steps[0]).toMatchObject({ toServiceId: 'orders', toPort: 'api', op: { name: 'POST', access: 'write' }, headers: ['Authorization'] });
    expect(messages('  web -> orders.api : place order\n  orders --> web : 299')).toEqual([
      expect.stringMatching(/^warning: AWS API Gateway has no operation 'place'/),
      expect.stringMatching(/^warning: AWS API Gateway has no status 299/),
    ]);
    expect(messages('  web -> orders.api : place order', { strictOps: true })).toEqual([expect.stringMatching(/^error: AWS API Gateway has no operation 'place'/)]);
  });

  it('take the receiver when the use case starts at a client', () => {
    expect(messages('  web -> orders.browse : browse')).toEqual([expect.stringMatching(/^warning: REST API has no operation 'browse'/)]);
  });

  it('leave a stub system unchecked: it has no node behind it', () => {
    expect(messages('  web -> stub.pay : charge card')).toEqual([]);
    expect(run('  web -> stub.pay : charge card').diagram.useCases[0].steps[0].op).toBeUndefined();
  });
});
