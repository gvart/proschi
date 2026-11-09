import { mockSignedIn, SIGNED_IN } from './accounts';
import { codeEditor, expect, test } from './fixtures';
import { PartnerMock } from './partner';

/** The pinned diagrams sidebar folds into its rail while the Design partner is open, so the diagram keeps its width. */
test('opening the Design partner folds the pinned sidebar, and closing it brings it back', async ({ page }) => {
  await mockSignedIn(page, SIGNED_IN);
  await new PartnerMock().mock(page);
  await page.goto('app/?example=url-shortener');
  await expect(codeEditor(page)).toBeVisible();
  const files = page.getByRole('complementary', { name: 'Diagrams' });
  const rail = page.getByRole('navigation', { name: 'Diagrams rail' });
  await expect(files).toBeVisible();

  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('region', { name: 'Design partner' });
  await expect(panel).toBeVisible();
  await expect(files).toBeHidden();
  await expect(rail).toBeVisible();

  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel).toBeHidden();
  await expect(files).toBeVisible();
  await expect(rail).toBeHidden();
});
