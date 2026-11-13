import type { Page } from '@playwright/test';
import lz from 'lz-string';
import { canvasNodes, codeEditor, expect, test, waitForCanvas } from './fixtures';

/**
 * The auto layout keeps room between layers for the load overlay's edge
 * chips: none lies over a node, the replicas' stacked cards included.
 */

/** A Pastebin: replicas on every hop, labelled and unlabelled edges, and enough traffic for every edge to carry a chip. */
const PASTEBIN = `user "User" [Actor]
cdn "CDN" [AWS CloudFront] x2
api "Paste API" [REST API] x3
db "Database" [PostgreSQL] x2
s3 "AWS S3" [AWS S3]
user -> cdn
cdn -> api : HTTPS (origin)
api -> db
api -> s3 : GET / PUT object
usecase "Read paste" {
  user -> cdn : GET /k7Qz2
  cdn -> api : GET /k7Qz2
  api -> db : SELECT paste
  api -> s3 : GET object
}
usecase "Create paste" {
  user -> cdn : POST /pastes
  cdn -> api : POST /pastes
  api -> s3 : PUT object
  api -> db : INSERT paste
}
traffic {
  "Read paste" 10k rps
  "Create paste" 500 rps
}
`;

type Rect = { left: number; top: number; right: number; bottom: number };

/** Every edge chip that lies over a node's box, its stacked replica cards included (canvas.css, 4px a card). */
async function chipsOverNodes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const rect = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const scale = (el: Element) => el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth || 1;
    const nodes = Array.from(document.querySelectorAll('.pc-node')).map((el) => {
      const box = rect(el);
      const stack = Number(el.getAttribute('data-stack') ?? 0) * 4 * scale(el);
      return { name: el.textContent ?? '', box: { ...box, right: box.right + stack, bottom: box.bottom + stack } };
    });
    const over = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return Array.from(document.querySelectorAll('.pc-edge-load')).flatMap((chip) => {
      const box = rect(chip);
      return nodes.filter((n) => over(box, n.box)).map((n) => `"${chip.textContent}" over "${n.name.slice(0, 30)}"`);
    });
  });
}

test('no edge chip of the load overlay lies over a node', async ({ page }) => {
  await page.goto(`app/#code=${lz.compressToEncodedURIComponent(PASTEBIN)}`);
  await expect(codeEditor(page)).toBeVisible();
  await waitForCanvas(page, 5);
  await expect(page.getByRole('button', { name: 'Overlay: load' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-layout-busy]')).toHaveCount(0);
  await expect(page.locator('.pc-edge-load').filter({ hasText: 'rps' })).toHaveCount(4);
  await expect(canvasNodes(page).filter({ hasText: 'Paste API' }).locator('.pc-node')).toHaveAttribute('data-stack', '2');
  if (process.env.LAYOUT_SHOTS) await page.screenshot({ path: `${process.env.LAYOUT_SHOTS}/editor.png` });
  await expect.poll(() => chipsOverNodes(page)).toEqual([]);
});
