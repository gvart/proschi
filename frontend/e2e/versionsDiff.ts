import type { Page } from '@playwright/test';
import { mockSignedIn, SIGNED_IN } from './accounts';
import { expect } from './fixtures';
import { Account, seed } from './versions';

/**
 * Two states of one design for the simulation deltas of a comparison
 * (versionsDiff.*.e2e.ts): the cache and the replicas cost more, cut the p99
 * and pass both checks.
 */
export const DELTA_BEFORE = `title "Orders"

shopper "Shopper" [Browser]
api "Orders API" [REST API] x2
db "Orders DB" [PostgreSQL]

shopper -> api : HTTPS
api -> db : SQL

usecase "Order status" {
  shopper -> api : GET /orders/42
  api -> db : SELECT order
  api --> shopper : 200
}

traffic {
  "Order status" 2k rps
}

requirements {
  p99 "Order status" < 50ms
  survive failure of db
}
`;

export const DELTA_AFTER = DELTA_BEFORE.replace('[REST API] x2', '[REST API] x3\ncache "Order cache" [Redis]')
  .replace('[PostgreSQL]', '[PostgreSQL] x2')
  .replace('api -> db : SQL', 'api -> db : SQL\napi -> cache : RESP')
  .replace('api -> db : SELECT order', 'api -> cache : GET order:42')
  .replace('2k rps', '3k rps');

/** Signs in on `plan`, with version v1 of DELTA_BEFORE saved and DELTA_AFTER as the draft, and opens the comparison of the two. */
export async function openDeltaCompare(page: Page, plan: 'free' | 'pro') {
  const account = new Account();
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan } });
  account.seed('orders', 'orders.proschi', 'v1', DELTA_BEFORE);
  // The account's copy of the diagram is the draft already, so syncing finds no conflict.
  account.docs.get('orders')!.source = DELTA_AFTER;
  await account.mock(page);
  await seed(page, [{ id: 'orders', fileName: 'orders.proschi', source: DELTA_AFTER }]);
  await page.goto('app/');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Versions…' }).click();
  await page.getByRole('dialog', { name: 'Versions' }).getByRole('button', { name: 'Compare v1' }).click();
  const compare = page.getByRole('dialog', { name: 'Compare versions' });
  await expect(compare.getByTestId('diff-counts')).toContainText('2 added');
  await expect(compare.locator('.react-flow__node.pc-diff-added')).toHaveText(/Order cache/);
  await expect(compare.locator('.react-flow__node.pc-diff-added')).toBeInViewport();
  return compare;
}
