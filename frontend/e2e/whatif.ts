import type { Page } from '@playwright/test';
import lz from 'lz-string';
import { expect, waitForCanvas } from './fixtures';

/**
 * A design for the what-if tests (whatif*.e2e.ts): the API runs at 25% of
 * what its two replicas take, so three times the traffic makes it the
 * bottleneck (75%); the database is a single point of failure.
 */
export const WHATIF_DOC = `user "User" [Actor]
api "Notes API" [REST API] x2
db "Notes DB" [PostgreSQL]
user -> api : HTTPS
api -> db : SQL
usecase "Read a note" {
  user -> api : GET /notes/1
  api -> db : SELECT note
}
traffic {
  "Read a note" 500 rps
}
capacity {
  api 1000 rps
  db 10000 rps
}
requirements {
  p99 "Read a note" < 200ms
  availability >= 99%
}
`;

export const WITH_WHATIFS = `${WHATIF_DOC}whatif "Launch day" {
  traffic "Read a note" x3
}
whatif "Database down" {
  fail db
}
`;

/** Opens the editor on `code` from a link, on the canvas. */
export async function openDoc(page: Page, code: string) {
  await page.goto(`app/#code=${lz.compressToEncodedURIComponent(code)}`);
  // Only the hash changed from a page already open, so load it again to open the link.
  await page.reload();
  await waitForCanvas(page, 3);
  await expect(page.getByRole('button', { name: /load$/ })).toHaveAttribute('aria-pressed', 'true');
}

export const resultsTab = (page: Page) => page.getByRole('tablist', { name: 'Diagram view' }).getByRole('tab', { name: /Results/ });
export const diagramTab = (page: Page) => page.getByRole('tablist', { name: 'Diagram view' }).getByRole('tab', { name: 'Diagram' });
