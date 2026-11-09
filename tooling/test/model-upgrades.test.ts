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

const payments = `api [REST API] x4
pay [Go] x2
api -> pay
usecase "Pay" {
  api -> pay : charge
}
traffic {
  "Pay" 1k rps
}
capacity {
  pay 600 rps errors 5% retries 3
}
whatif "Bad deploy" {
  pay errors 50%
}
`;

describe('retries and partial failure', () => {
  const a = analyze(payments);

  it('hovers the node with its errors, retries and storm risk', () => {
    expect(a.diagnostics).toEqual([]);
    expect(hover(a, { line: 1, character: 1 })?.markdown).toContain('Errors 5% · 3 retries: 1.05 calls a request (in the load), 99.99937% succeed in the end — **retry storm risk**');
  });

  it('completes errors and retries among the capacity parts, and nothing after them', () => {
    const typing = analyze(payments.replace('  pay 600 rps errors 5% retries 3', '  pay '));
    const labels = complete(typing, { line: 10, character: 6 }).map((i) => i.label);
    expect(labels).toContain('errors');
    expect(labels).toContain('retries');
    const value = analyze(payments.replace('  pay 600 rps errors 5% retries 3', '  pay errors '));
    expect(complete(value, { line: 10, character: 13 })).toEqual([]);
  });

  it('prints the storm warning and the what-if error rate in proschi analyze', () => {
    const file = join(dir, 'payments.proschi');
    writeFileSync(file, payments);
    const base = capture((out, err) => runAnalyze([file], out, err));
    expect(base.out).toContain("'pay' risks a retry storm: it runs at 88% with 5% errors and 3 retries.");
    const w = capture((out, err) => runAnalyze(['--whatif', 'Bad deploy', file], out, err));
    expect(w.out).toContain('What-if "Bad deploy": pay errors 50%');
  });
});
