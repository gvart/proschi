import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import { analyze } from './analyze';
import { analysisOverlay } from './overlay';

const source = `
user [Actor]
api [REST API] x2
db [PostgreSQL]
mail [Message Queue]
user -> api
api -> db
api -> mail

usecase "Buy" {
  user -> api : POST /buy
  api -> db : insert
  api ->> mail : receipt
}

traffic {
  "Buy" 800 rps
}

capacity {
  db 1000 rps shards 2
}
`;

describe('analysisOverlay', () => {
  const diagram = parse(source).diagram;
  const overlay = analysisOverlay(diagram, analyze(diagram));

  it('gives working nodes their utilisation, replicas and shards', () => {
    expect(overlay.nodes.api.replicas).toBe(2);
    expect(overlay.nodes.db.shards).toBe(2);
    expect(overlay.nodes.db.utilization).toBeGreaterThan(0);
    expect(overlay.nodes.user.utilization).toBeUndefined();
  });

  it('sums the flows of the traffic, async ones marked', () => {
    expect(overlay.flows).toEqual(
      expect.arrayContaining([
        { from: 'user', to: 'api', rps: 800, async: false },
        { from: 'api', to: 'db', rps: 800, async: false },
        { from: 'api', to: 'mail', rps: 800, async: true },
      ]),
    );
  });
});
