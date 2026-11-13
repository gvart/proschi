import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import { format } from '../dsl/format';
import { diffDiagrams } from '../dsl/diff';
import { analyze } from './analyze';
import { costBreakdown } from './cost';
import { runTests } from './tests';

const shop = (requirements = '') => `
legend {
  edge "At the edge" blue
}
user [Browser]
group checkout "Checkout" .edge {
  api [REST API] @Payments x2
  pay [Go] @Payments
}
db [PostgreSQL] @Data
cache [Redis]
user -> api
api -> pay
pay -> db
api -> cache
usecase "Pay" {
  user -> api : POST /pay
  api -> pay : charge
  pay -> db : INSERT payment
  api -> cache : SET receipt
  api --> user : 201
}
traffic {
  "Pay" 100 rps
}
capacity {
  api cost 100 usd/month
  pay cost 50 usd/month
  db cost 400 usd/month
  cache cost 30 usd/month
}
requirements {
${requirements}
}`;

describe('cost per team, group or tag', () => {
  it('parses a budget for a team, a tag and a group', () => {
    const { diagram, diagnostics } = parse(shop('  cost @Payments <= 500 usd/month\n  cost .edge <= 200 usd/month\n  cost group checkout <= 300 usd/month\n  cost <= 1k usd/month'));
    expect(diagnostics).toEqual([]);
    expect(diagram.requirements!.map((r) => (r.kind === 'cost' ? [r.maxUsdPerMonth, r.scope] : r.kind))).toEqual([
      [500, { team: 'Payments' }],
      [200, { tag: 'edge' }],
      [300, { group: 'checkout' }],
      [1000, undefined],
    ]);
    expect('scope' in diagram.requirements![3]).toBe(false);
  });

  it('reports a quoted team, a missing group id and scopes that cover nothing', () => {
    const messages = (line: string) => parse(shop(`  ${line}`)).diagnostics.map((d) => [d.severity, d.message]);
    expect(messages('cost "@Payments" <= 500 usd/month')).toEqual([['error', 'A budget names a team as @Payments, a tag as .Payments or a group as group Payments, without quotes']]);
    expect(messages('cost group <= 5 usd/month')[0]).toEqual(['error', 'Expected a group id after group, e.g. cost group checkout <= 500 usd/month']);
    expect(messages('cost @Search <= 5 usd/month')).toEqual([['warning', 'No node is owned by @Search; give nodes the team with @Search after their name']]);
    expect(messages('cost .cold <= 5 usd/month')).toEqual([['warning', 'No node or group has the tag .cold']]);
    expect(messages('cost group nope <= 5 usd/month')).toEqual([['warning', "Unknown group 'nope'"]]);
    expect(messages('cost group db <= 5 usd/month')).toEqual([['warning', "'db' is not a group; a budget covers a team (@team), a tag (.tag) or a group (group <id>)"]]);
  });

  it('splits the cost by team, group and tag', () => {
    const { diagram } = parse(shop());
    const b = costBreakdown(diagram, analyze(diagram));
    expect(b.teams.map((t) => [t.id, t.costUsd, t.nodes])).toEqual([
      ['@Data', 400, ['db']],
      ['@Payments', 250, ['api', 'pay']],
    ]);
    expect(b.unowned).toMatchObject({ costUsd: 30, nodes: ['cache'] });
    expect(b.groups.map((g) => [g.id, g.label, g.costUsd])).toEqual([['checkout', 'Checkout', 250]]);
    // A node inside a tagged group counts for the tag.
    expect(b.tags.map((t) => [t.id, t.label, t.costUsd])).toEqual([['.edge', 'At the edge', 250]]);
    expect(b.totalCostUsd).toBe(680);
  });

  it('checks a scoped budget against the cost of what it covers', () => {
    const { diagram } = parse(shop('  cost @Payments <= 200 usd/month\n  cost group checkout <= 300 usd/month\n  cost @Data <= 400 usd/month'));
    const [team, group, data] = runTests(diagram);
    expect(team).toMatchObject({ name: 'cost of @Payments ≤ $200/month', category: 'cost', passed: false, message: '@Payments costs $250/month (limit $200/month)' });
    expect(team.hint).toMatch(/^Biggest items: api \$200\/month, pay \$50\/month\./);
    expect(group).toMatchObject({ name: 'cost of group checkout ≤ $300/month', passed: true });
    expect(data).toMatchObject({ passed: true, message: '@Data costs $400/month (limit $400/month)' });
  });

  it('keeps a budget apart from the total in a diff and formats it as written', () => {
    const before = parse(shop('  cost <= 1k usd/month\n  cost @Payments <= 500 usd/month')).diagram;
    const after = parse(shop('  cost <= 1k usd/month\n  cost @Payments <= 300 usd/month')).diagram;
    const diff = diffDiagrams(before, after);
    expect(diff.requirements.changed.map((c) => c.key)).toEqual(['cost @Payments']);
    const source = shop('  cost   @Payments   <=  500 usd/month');
    expect(format(source)).toContain('  cost @Payments <= 500 usd/month');
  });
});
