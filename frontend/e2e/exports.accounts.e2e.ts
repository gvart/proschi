import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { mockSignedIn, SIGNED_IN } from './accounts';
import { canvasNodes, expect, test, waitForCanvas } from './fixtures';
import { FREE, MAX, PRO } from './history';

/**
 * Export and proof (docs/design/paid-plans.md P56) in the build with
 * accounts and paid plans (API mocked): Settings › Exports & certificate
 * (the progress export on Pro, embeds without branding on Pro, the mastery
 * certificate on Max), the editor's 3× PNG and the HLD's PDF (Pro), the
 * certificate page (`#/c/<id>`) and an embed whose owner hid Proschi's
 * branding. Free sees each as the way to its plan. With EXPORTS_SHOTS=<dir>,
 * saves screenshots there.
 */

const SHOTS = process.env.EXPORTS_SHOTS;
const CERT_ID = 'Ab3_x-9QrT0z';

const CERTIFICATE = {
  id: CERT_ID,
  displayName: 'Grace Hopper',
  issuedAt: Date.parse('2026-11-02T00:00:00Z') / 1000,
  asOf: Date.parse('2026-11-09T00:00:00Z') / 1000,
  level: 9,
  xp: 3400,
  readiness: 0.64,
  problems: 40,
  solved: [
    { id: 'url-shortener', title: 'URL Shortener', difficulty: 'easy' },
    { id: 'pastebin', title: 'Pastebin', difficulty: 'easy' },
    { id: 'chat', title: 'Chat', difficulty: 'medium' },
    { id: 'rate-limiter', title: 'Rate Limiter', difficulty: 'medium' },
  ],
  skills: [
    { topic: 'caching', title: 'Caching', mastery: 0.86 },
    { topic: 'estimation', title: 'Estimation', mastery: 0.78 },
    { topic: 'databases', title: 'Databases', mastery: 0.71 },
    { topic: 'sharding', title: 'Sharding', mastery: 0.55 },
    { topic: 'queues', title: 'Queues', mastery: 0.42 },
    { topic: 'security', title: 'Security', mastery: 0.12 },
  ],
  streak: { longest: 21 },
};

const PROGRESS = {
  exportedAt: '2026-11-09T10:00:00.000Z',
  displayName: 'gvart',
  level: { level: 4, xp: 520 },
  readiness: 0.43,
  streak: { current: 3, longest: 9 },
  problemsSolved: 1,
  problemsTotal: 40,
  mastery: [{ topic: 'caching', title: 'Caching', mastery: 0.71 }],
  problems: [{ problemId: 'url-shortener', title: 'URL Shortener', difficulty: 'easy', solved: true, solvedAt: '2026-10-01T00:00:00.000Z', runs: 2, firstRunAt: null, runsToSolve: 2, bestCostUsd: 12.5, bestP99Ms: 80 }],
  interviews: [],
  soloInterviews: [],
  cards: [],
};

/** The routes of this file over mockSignedIn's; answers what was written. */
async function mockExports(page: Page, opts: { certificate?: { id: string; public: boolean; issuedAt: number } | null; branding?: boolean } = {}) {
  const writes: { path: string; body: unknown }[] = [];
  let certificate = opts.certificate ?? null;
  let branding = opts.branding ?? true;
  await page.route(/\/api\/(me\/certificate|me\/embeds|certificates\/|me\/export\?view=progress)/, (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === 'PUT') writes.push({ path: pathname, body: request.postDataJSON() });
    if (pathname === '/api/me/certificate') {
      if (request.method() === 'PUT') {
        const on = (request.postDataJSON() as { public: boolean }).public;
        certificate = { id: CERT_ID, public: on, issuedAt: CERTIFICATE.issuedAt };
      }
      return route.fulfill({ json: { certificate } });
    }
    if (pathname === '/api/me/embeds') {
      if (request.method() === 'PUT') branding = (request.postDataJSON() as { branding: boolean }).branding;
      return route.fulfill({ json: { branding } });
    }
    if (pathname === `/api/certificates/${CERT_ID}`) return route.fulfill({ json: CERTIFICATE });
    if (pathname.startsWith('/api/certificates/')) return route.fulfill({ status: 404, json: { error: 'No such certificate' } });
    return route.fulfill({ json: PROGRESS });
  });
  return writes;
}

test.describe('Settings › Exports & certificate', () => {
  test('Free: each row is the way to its plan, with nothing to download', async ({ page }) => {
    await mockSignedIn(page, FREE);
    await mockExports(page);
    await page.goto('practice/#/me');
    const section = page.getByRole('region', { name: 'Exports & certificate' });
    await expect(section).toBeVisible();
    await expect(section.getByRole('link', { name: 'Part of Pro' })).toHaveCount(2);
    await expect(section.getByRole('link', { name: 'Part of Max' })).toHaveAttribute('href', /pricing\/$/);
    await expect(section.getByRole('button')).toHaveCount(0);
    await expect(section.getByRole('switch')).toHaveCount(0);
  });

  test('Pro: the progress export as JSON and as CSV files, and embeds without branding', async ({ page }) => {
    await mockSignedIn(page, PRO);
    const writes = await mockExports(page);
    await page.goto('practice/#/me');
    const section = page.getByRole('region', { name: 'Exports & certificate' });

    let download = page.waitForEvent('download');
    await section.getByRole('button', { name: 'JSON' }).click();
    let file = await download;
    expect(file.suggestedFilename()).toBe('proschi-progress.json');
    expect(JSON.parse(await readFile(await file.path(), 'utf8'))).toMatchObject({ level: { level: 4 } });

    download = page.waitForEvent('download');
    await section.getByRole('button', { name: 'CSV (.zip)' }).click();
    file = await download;
    expect(file.suggestedFilename()).toBe('proschi-progress-csv.zip');
    const zip = await readFile(await file.path());
    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');
    for (const name of ['summary.csv', 'mastery.csv', 'problems.csv', 'interviews.csv', 'cards.csv']) expect(zip.includes(Buffer.from(name))).toBe(true);

    const hide = section.getByRole('switch', { name: 'Embeds without Proschi branding' });
    await expect(hide).not.toBeChecked();
    await hide.check();
    await expect(hide).toBeChecked();
    expect(writes).toEqual([{ path: '/api/me/embeds', body: { branding: false } }]);
    // The certificate is Max's.
    await expect(section.getByRole('link', { name: 'Part of Max' })).toBeVisible();
    await expect(section.getByRole('switch', { name: 'Mastery certificate' })).toHaveCount(0);
  });

  test('Max: turning the certificate on gives its page, LinkedIn and a share', async ({ page }) => {
    await mockSignedIn(page, MAX);
    const writes = await mockExports(page);
    await page.goto('practice/#/me');
    const section = page.getByRole('region', { name: 'Exports & certificate' });
    const on = section.getByRole('switch', { name: 'Mastery certificate' });
    await expect(on).not.toBeChecked();
    await on.check();
    await expect(on).toBeChecked();
    expect(writes).toEqual([{ path: '/api/me/certificate', body: { public: true } }]);
    const linkedIn = section.getByRole('link', { name: 'Add to LinkedIn' });
    await expect(linkedIn).toHaveAttribute('href', /^https:\/\/www\.linkedin\.com\/profile\/add\?startTask=CERTIFICATION_NAME&/);
    const href = new URL((await linkedIn.getAttribute('href'))!);
    expect(href.searchParams.get('certId')).toBe(CERT_ID);
    expect(href.searchParams.get('certUrl')).toMatch(new RegExp(`/c/${CERT_ID}$`));
    expect(href.searchParams.get('organizationName')).toBe('Proschi');
    await expect(section.getByRole('link', { name: 'See your certificate' })).toHaveAttribute('href', `#/c/${CERT_ID}`);
    if (SHOTS) await section.screenshot({ path: `${SHOTS}/settings-max.png` });

    await on.uncheck();
    await expect(section.getByRole('link', { name: 'Add to LinkedIn' })).toHaveCount(0);
    expect(writes.at(-1)).toEqual({ path: '/api/me/certificate', body: { public: false } });
  });
});

test.describe('the certificate page', () => {
  test('shows the level, mastery per skill and problems solved, and prints', async ({ page }) => {
    await mockSignedIn(page, MAX);
    await mockExports(page, { certificate: { id: CERT_ID, public: true, issuedAt: CERTIFICATE.issuedAt } });
    await page.goto(`practice/#/c/${CERT_ID}`);
    const sheet = page.getByRole('article', { name: 'Mastery certificate of Grace Hopper' });
    await expect(sheet.getByRole('heading', { name: 'Grace Hopper' })).toBeVisible();
    await expect(page).toHaveTitle('Grace Hopper: mastery certificate · Proschi');
    await expect(sheet.getByTestId('certificate-level')).toHaveText('9');
    await expect(sheet).toContainText('3,400 XP');
    await expect(sheet).toContainText('4/40');
    await expect(sheet).toContainText('64%');
    await expect(sheet.getByRole('listitem').filter({ hasText: 'Caching' })).toContainText('86%');
    await expect(sheet).toContainText('Rate Limiter');
    await expect(sheet).toContainText('Issued November 2, 2026');
    await expect(sheet).toContainText(`/c/${CERT_ID}`);
    // Its owner gets LinkedIn's form.
    await expect(page.getByRole('link', { name: 'Add to LinkedIn' })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/certificate-desktop.png`, fullPage: true });

    // Print shows the sheet alone.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
    await expect(sheet.getByRole('heading', { name: 'Grace Hopper' })).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
  });

  test('someone else’s: no LinkedIn button; an unknown or hidden one is not found', async ({ page }) => {
    await mockSignedIn(page, SIGNED_IN);
    await mockExports(page);
    await page.goto(`practice/#/c/${CERT_ID}`);
    await expect(page.getByRole('heading', { name: 'Grace Hopper' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add to LinkedIn' })).toHaveCount(0);
    await page.goto('practice/#/c/ZZZZZZZZZZZZ');
    await expect(page.getByRole('heading', { name: 'No certificate here' })).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('fits the screen', async ({ page }) => {
      await mockSignedIn(page, MAX);
      await mockExports(page, { certificate: { id: CERT_ID, public: true, issuedAt: CERTIFICATE.issuedAt } });
      await page.goto(`practice/#/c/${CERT_ID}`);
      await expect(page.getByRole('heading', { name: 'Grace Hopper' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/certificate-phone.png`, fullPage: true });
    });
  });
});

test.describe('Pro exports in the editor', () => {
  test('Pro: PNG at 3× from the Export menu, and the HLD as PDF', async ({ page }) => {
    await mockSignedIn(page, PRO);
    await page.addInitScript(() => {
      // The print dialog, in every frame: noted instead of shown.
      window.print = () => {
        (window.top as unknown as { printed?: string[] }).printed ??= [];
        (window.top as unknown as { printed: string[] }).printed.push(document.title);
      };
    });
    await page.goto('app/?example=ecommerce');
    await waitForCanvas(page, 6);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'PNG image', exact: true })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/export-menu-pro.png`, clip: { x: 900, y: 0, width: 540, height: 420 }, animations: 'disabled' });
    const download = page.waitForEvent('download');
    await menu.getByRole('menuitem', { name: 'PNG image, 3× (high-DPI)' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('e-commerce-platform@3x.png');
    const png = await readFile(await file.path());
    // The IHDR width: 3× the 2× image's, so wider than any 2× export of this diagram could be.
    const width = png.readUInt32BE(16);
    expect(width % 3).toBe(0);

    await page.getByRole('tablist', { name: 'Diagram view' }).getByRole('tab', { name: 'HLD' }).click();
    await page.getByRole('button', { name: 'PDF' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { printed?: string[] }).printed)).toEqual(['E-Commerce Platform — High-level design']);
  });

  test('Free: the 3× PNG and the PDF lead to Pro', async ({ page }) => {
    await mockSignedIn(page, FREE);
    await page.goto('app/?example=ecommerce');
    await expect(canvasNodes(page).first()).toBeVisible();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'PNG image, 3× · Pro' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'PNG image, 3× (high-DPI)' })).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/export-menu-free.png`, clip: { x: 900, y: 0, width: 540, height: 420 }, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.getByRole('tablist', { name: 'Diagram view' }).getByRole('tab', { name: 'HLD' }).click();
    await expect(page.getByRole('link', { name: 'PDF · Pro' })).toHaveAttribute('href', /pricing\/$/);
    await expect(page.getByRole('button', { name: 'PDF' })).toHaveCount(0);
  });
});

test.describe('an embed', () => {
  const SHARE = {
    id: 'aB3dE5gH7j',
    title: 'Shop',
    source: 'title "Shop"\n\nweb "Web" [React]\napi "Orders API" [Go]\ndb "Orders DB" [PostgreSQL]\nweb -> api : POST /orders\napi -> db : INSERT\n',
    hasImage: false,
    createdAt: 1,
  };

  test('of a Pro owner who hid the branding has no "Open in Proschi"', async ({ page }) => {
    await page.route(/\/api\/shares\//, (route) => route.fulfill({ json: { ...SHARE, branding: false } }));
    await page.goto(`embed/?s=${SHARE.id}`);
    await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();
    await waitForCanvas(page, 3);
    await expect(page.getByRole('link', { name: 'Open in Proschi' })).toHaveCount(0);
    await expect(page).toHaveTitle('Shop');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/embed-unbranded.png` });
  });

  test('of anyone else keeps it', async ({ page }) => {
    await page.route(/\/api\/shares\//, (route) => route.fulfill({ json: SHARE }));
    await page.goto(`embed/?s=${SHARE.id}`);
    await expect(page.getByRole('link', { name: 'Open in Proschi' })).toBeVisible();
    await expect(page).toHaveTitle('Shop · Proschi');
  });
});
