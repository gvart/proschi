import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, complete, hover, semanticTokens } from '../src/analysis';
import { runAnalyze } from '../src/simulation';

// The simulation model upgrades of docs/impl/feature-expansion.md, iteration 7.4-7.6.

const dir = mkdtempSync(join(tmpdir(), 'proschi-upgrades-'));

function capture(fn: (out: (s: string) => void, err: (s: string) => void) => number) {
  let out = '';
  let err = '';
  const code = fn(
    (s) => (out += s),
    (s) => (err += s),
  );
  return { code, out, err };
}

const shop = `user [Browser]
group checkout "Checkout" .edge {
  api [REST API] @Payments x2
  pay [Go] @Payments
}
db [PostgreSQL] @Data
legend {
  edge "At the edge" blue
}
user -> api
api -> pay
pay -> db
usecase "Pay" {
  user -> api : POST /pay
  api -> pay : charge
  pay -> db : INSERT payment
  api --> user : 201
}
traffic {
  "Pay" 100 rps
}
capacity {
  api cost 100 usd/month
  pay cost 50 usd/month
  db cost 400 usd/month
}
requirements {
  cost @Payments <= 200 usd/month
}
`;

describe('cost per team, group or tag', () => {
  const a = analyze(shop);
  const lines = shop.split('\n');
  const lineOf = (text: string) => lines.findIndex((l) => l.includes(text));

  it('hovers a team with its nodes, cost and budget', () => {
    expect(a.diagnostics).toEqual([]);
    const line = lineOf('api [REST API] @Payments');
    const md = hover(a, { line, character: lines[line].indexOf('@Payments') + 2 })?.markdown;
    expect(md).toContain('**@Payments** · team');
    expect(md).toContain('Owns `api`, `pay`');
    expect(md).toContain('Costs $250/month (38% of $650/month)');
    expect(md).toContain('Budget $200/month: **over it**');
    const inBudget = lineOf('cost @Payments');
    expect(hover(a, { line: inBudget, character: lines[inBudget].indexOf('@') + 1 })?.markdown).toContain('**@Payments** · team');
  });

  it('completes teams, tags and group after cost, and group ids after cost group', () => {
    const typing = analyze(shop.replace('  cost @Payments <= 200 usd/month', '  cost '));
    const line = lineOf('cost @Payments');
    expect(complete(typing, { line, character: 7 }).map((i) => i.label)).toEqual(['@Payments', '@Data', '.edge', 'group', '<=']);
    const group = analyze(shop.replace('  cost @Payments <= 200 usd/month', '  cost group '));
    expect(complete(group, { line, character: 13 }).map((i) => i.label)).toEqual(['checkout']);
  });

  it('marks the team and tag of a budget as semantic tokens', () => {
    const tagged = analyze(shop.replace('cost @Payments', 'cost .edge'));
    const line = lineOf('cost @Payments');
    expect(semanticTokens(a).filter((t) => t.line === line).map((t) => t.kind)).toEqual(['team']);
    expect(semanticTokens(tagged).filter((t) => t.line === line).map((t) => t.kind)).toEqual(['tag']);
  });

  it('prints the cost by team, group and tag in proschi analyze', () => {
    const file = join(dir, 'shop.proschi');
    writeFileSync(file, shop);
    const r = capture((out, err) => runAnalyze([file], out, err));
    expect(r.out).toContain('Total cost: $650/month\nCost by team: @Data $400, @Payments $250\nCost by group: checkout $250\nCost by tag: .edge $250\n');
  });
});
