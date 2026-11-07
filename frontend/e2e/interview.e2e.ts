import type { Page } from '@playwright/test';
import { answerDialog, canvasNodes, chooseOption, codeEditor, editorText, expect, test } from './fixtures';

/**
 * The mock interview's pages without accounts (practice/interview, P45): the
 * set-up (a random problem, or one chosen), the room on your own (the
 * whiteboard, the clock and the phases, the code behind "Show code", the
 * sound cues) and the result. With accounts and the interviewer, see
 * aiInterview.accounts.e2e.ts.
 */

const room = (page: Page) => page.getByTestId('interview-room');
const rail = (page: Page) => page.getByRole('region', { name: 'Interview on your own' });
const roomProblem = (page: Page) => new URL(page.url()).hash.replace('#/interview/', '');

/** Records the sound cues played (sounds.ts dispatches one event per cue) in `window.__cues`. */
async function recordCues(page: Page) {
  await page.addInitScript(() => {
    const cues: string[] = [];
    window.addEventListener('proschi:cue', (e) => cues.push((e as CustomEvent<string>).detail));
    Object.assign(window, { __cues: cues });
  });
}
const cues = (page: Page) => page.evaluate(() => (window as unknown as { __cues: string[] }).__cues);

/** From the set-up: the problem chosen by name in the picker, then Start. */
async function startOn(page: Page, title: string, minutes?: string) {
  await page.goto('practice/#/interview');
  await page.getByRole('radio', { name: 'Choose a problem' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a problem' });
  await picker.getByRole('searchbox', { name: 'Search problems' }).fill(title);
  await picker.getByRole('list', { name: 'Problems' }).getByRole('button', { name: new RegExp(title) }).first().click();
  await expect(picker).toBeHidden();
  await expect(page.getByTestId('chosen-problem')).toContainText(title);
  if (minutes) await page.getByRole('radio', { name: minutes }).click();
  await page.getByRole('button', { name: 'Start the interview' }).click();
  await expect(room(page)).toBeVisible();
}

test.describe('mock interview set-up', () => {
  test('Surprise me picks a problem not done yet, so the next one differs, and the problem waits for the room', async ({ page }) => {
    await page.goto('practice/#/interview');
    await expect(page.getByRole('heading', { level: 1, name: 'Mock interview' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Surprise me' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'Same as last time' })).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Your interview' })).toContainText('A surprise, shown in the room');
    // The filters narrow the pool.
    await page.getByRole('radiogroup', { name: 'Difficulty' }).getByRole('radio', { name: 'Easy' }).click();
    await expect(page.getByTestId('pool-size')).toHaveText(/^5 problems to draw from, 5 not done yet\.$/);
    await page.getByRole('radiogroup', { name: 'Difficulty' }).getByRole('radio', { name: 'Any' }).click();

    await page.getByRole('button', { name: 'Start the interview' }).click();
    await expect(room(page)).toBeVisible();
    const first = roomProblem(page);
    expect(first).not.toBe('hello-proschi');
    await expect(rail(page).getByText(/^The problem: /)).toBeVisible();

    // Leaving keeps it (paused) and offers it back; the next surprise is another problem.
    await page.getByRole('button', { name: 'Exit the interview' }).click();
    await answerDialog(page, 'Leave');
    await expect(page.getByTestId('open-solo')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Same as last time' })).toBeVisible();
    await page.getByRole('button', { name: 'Start the interview' }).click();
    await expect(room(page)).toBeVisible();
    expect(roomProblem(page)).not.toBe(first);
  });

  test('Choose a problem: a searchable list, and the problem page’s Interview mode preselects its problem', async ({ page }) => {
    await page.goto('practice/#/interview');
    await page.getByRole('radio', { name: 'Choose a problem' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a problem' });
    await expect(picker.getByRole('searchbox', { name: 'Search problems' })).toBeFocused();
    await picker.getByRole('searchbox', { name: 'Search problems' }).fill('zzzz');
    await expect(picker.getByText('No problem matches')).toBeVisible();
    await picker.getByRole('searchbox', { name: 'Search problems' }).fill('pastebin');
    await expect(picker.getByRole('list', { name: 'Problems' }).getByRole('button')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    // Closed without a choice: back to the surprise.
    await expect(page.getByRole('radio', { name: 'Surprise me' })).toHaveAttribute('aria-checked', 'true');

    await page.goto('practice/#/url-shortener');
    const link = page.getByRole('link', { name: 'Interview mode' });
    await expect(link).toHaveAttribute('href', '#/interview?problem=url-shortener');
    await link.click();
    await expect(page.getByRole('radio', { name: 'Choose a problem' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('chosen-problem')).toContainText('URL Shortener');
  });

  test('the old deep link #/<problem>?interview=mock opens the set-up with that problem', async ({ page }) => {
    await page.goto('practice/#/pastebin?interview=mock');
    await expect(page).toHaveURL(/#\/interview\?problem=pastebin&with=mock$/);
    await expect(page.getByTestId('chosen-problem')).toContainText('Pastebin');
    // A room with nothing open goes back to the set-up.
    await page.goto('practice/#/interview/rate-limiter');
    await expect(page).toHaveURL(/#\/interview\?problem=rate-limiter$/);
  });
});

test.describe('the interview room on your own', () => {
  test('clarify, estimate, design and wrap up against the clock, then the summary and a new interview', async ({ page }) => {
    await recordCues(page);
    await startOn(page, 'URL Shortener', '30 min');
    await expect(page.getByRole('timer')).toHaveAccessibleName(/^Time left: (30:00|29:5\d)\. Pause the clock$/);
    await expect(page.getByRole('list', { name: 'Phases' }).locator('[aria-current="step"]')).toContainText('Clarify');

    // Clarify: the scale and constraints are hidden until asked for.
    await rail(page).getByRole('button', { name: 'Ask: How fast must a redirect be?' }).click();
    await expect(rail(page).getByText('Good question')).toBeVisible();
    await rail(page).getByRole('button', { name: 'Ask: Can I use Kubernetes?' }).click();
    await expect(rail(page).getByText('Weak question')).toBeVisible();
    await rail(page).getByRole('button', { name: 'Reveal the rest' }).click();
    await expect(page.getByRole('list', { name: 'Phases' }).locator('[aria-current="step"]')).toContainText('Estimate');
    await expect.poll(() => cues(page)).toContain('phase');

    // Estimate: graded against a range.
    await rail(page).getByLabel('How many short codes are created in a year at 100 a second?').fill('3B');
    await rail(page).getByRole('button', { name: 'Check' }).first().click();
    await expect(rail(page).getByText(/In range: the answer is 3,200,000,000 codes/)).toBeVisible();
    await rail(page).getByRole('button', { name: 'Start designing' }).click();

    // Design: checking runs the tests over the whiteboard.
    await rail(page).getByRole('button', { name: 'Check my design' }).click();
    await expect(page.getByTestId('checks').getByRole('status')).toHaveText(/^\d+ of 10 checks pass$/);
    await expect.poll(() => cues(page)).toContain('fail');
    await expect(rail(page).getByText(/Last check: \d+ of 10 pass/)).toBeVisible();

    // Pausing stops the clock, and the interview survives a reload.
    await page.getByRole('timer').click();
    await expect(page.getByRole('timer')).toHaveAccessibleName(/Resume the clock$/);
    await page.reload();
    await expect(page.getByRole('list', { name: 'Phases' }).locator('[aria-current="step"]')).toContainText('Design');

    await rail(page).getByRole('button', { name: 'Wrap up' }).click();
    await rail(page).getByLabel(/I can explain one trade-off/).check();
    await rail(page).getByRole('button', { name: 'Finish the interview' }).click();

    const result = page.getByTestId('interview-result');
    await expect(result.getByRole('list', { name: 'Steps' }).locator('[aria-current="step"]')).toContainText('Result');
    const summary = result.getByRole('region', { name: 'Interview summary' });
    await expect(summary).toContainText('2 asked: 1 good (of 6), 1 weak');
    await expect(summary).toContainText('1 of 3 in range, 2 not answered');
    await expect(summary).toContainText('1 of 4 ticked');
    await expect.poll(() => cues(page)).toContain('finish');
    await expect(result.getByRole('link', { name: 'Try this problem again' })).toHaveAttribute('href', '#/interview?problem=url-shortener&with=solo');
    await result.getByRole('link', { name: 'New interview' }).click();
    await expect(page.getByRole('radio', { name: 'Surprise me' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Start the interview' }).click();
    await expect(room(page)).toBeVisible();
    expect(roomProblem(page)).not.toBe('url-shortener');
  });

  test('the code is hidden until Show code, which opens a drawer beside the whiteboard and is remembered', async ({ page }) => {
    await startOn(page, 'URL Shortener');
    await expect(page.getByRole('region', { name: 'Whiteboard' })).toBeVisible();
    await expect(codeEditor(page)).toHaveCount(0);
    const show = page.getByRole('button', { name: 'Show code' });
    await expect(show).toHaveAttribute('aria-pressed', 'false');
    await show.click();
    await expect(show).toHaveAttribute('aria-pressed', 'true');
    await expect(codeEditor(page)).toBeVisible();
    expect(await editorText(page)).toContain('import "problem.proschi"');
    const board = (await page.getByRole('region', { name: 'Whiteboard' }).boundingBox())!;
    const code = (await page.getByRole('region', { name: 'Code' }).boundingBox())!;
    expect(code.x + code.width).toBeLessThanOrEqual(board.x + 2);
    await page.reload();
    await expect(codeEditor(page)).toBeVisible();
    await page.getByRole('button', { name: 'Hide the code' }).click();
    await expect(codeEditor(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show code' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('sound is on by default, off from the set-up or the top bar, and remembered', async ({ page }) => {
    await recordCues(page);
    await page.goto('practice/#/interview');
    const setupSound = page.getByTestId('setup-sound');
    await expect(setupSound).toBeChecked();
    await setupSound.uncheck();
    await page.getByRole('radio', { name: 'Choose a problem' }).click();
    await page.getByRole('dialog', { name: 'Choose a problem' }).getByRole('button', { name: /^URL Shortener/ }).click();
    await page.getByRole('button', { name: 'Start the interview' }).click();
    const sound = page.getByTestId('room-sound');
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    await rail(page).getByRole('button', { name: 'Reveal the rest' }).click();
    await expect(page.getByRole('list', { name: 'Phases' }).locator('[aria-current="step"]')).toContainText('Estimate');
    expect(await cues(page)).toEqual([]);

    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByTestId('room-sound')).toHaveAttribute('aria-pressed', 'true');
    await rail(page).getByRole('button', { name: 'Start designing' }).click();
    await expect.poll(() => cues(page)).toEqual(['phase']);
  });

  test('an easy problem solved with the mouse alone: settings, Flows and Check my design', async ({ page }) => {
    await startOn(page, 'Snowflake IDs');
    await rail(page).getByRole('button', { name: 'Reveal the rest' }).click();
    await rail(page).getByRole('button', { name: 'Start designing' }).click();
    const board = page.getByRole('region', { name: 'Whiteboard' });

    // 15 generators, from the settings of the component.
    await canvasNodes(page).filter({ hasText: 'ID Generator' }).click();
    const settings = page.getByRole('region', { name: 'ID Generator settings' });
    for (let i = 0; i < 14; i++) await settings.getByRole('button', { name: 'More replicas' }).click();
    await expect(settings.getByText('x15', { exact: true })).toBeVisible();
    await board.click({ position: { x: 600, y: 700 } });

    // The second use case, from the traffic's suggestion, with two steps picked on the canvas.
    await board.getByRole('button', { name: 'Flows' }).click();
    const flows = page.getByRole('region', { name: 'Flows' });
    await flows.getByRole('button', { name: 'Start generator' }).click();
    await expect(flows.getByRole('tab', { name: 'Start generator' })).toHaveAttribute('aria-selected', 'true');
    await flows.getByRole('button', { name: 'Add a step' }).click();
    const step = flows.getByRole('form', { name: 'New step' });
    await expect(step.getByRole('status')).toHaveText('Click the component the step starts at.');
    await canvasNodes(page).filter({ hasText: 'ID Generator' }).click();
    await expect(step.getByRole('status')).toHaveText('Now click the component it goes to.');
    await canvasNodes(page).filter({ hasText: 'ZooKeeper' }).click();
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'idgen');
    await expect(step.getByLabel('Goes to')).toHaveAttribute('data-value', 'zk');
    await step.getByRole('textbox', { name: 'Label' }).fill('CREATE worker id');
    await step.getByRole('button', { name: 'Add step' }).click();
    await flows.getByRole('button', { name: 'Add a step' }).click();
    await chooseOption(step.getByLabel('Starts at'), 'ZooKeeper');
    await chooseOption(step.getByLabel('Goes to'), 'ID Generator');
    await expect(step.getByRole('radio', { name: 'Response' })).toHaveAttribute('aria-checked', 'true');
    await step.getByRole('textbox', { name: 'Label' }).fill('worker id');
    await step.getByRole('button', { name: 'Add step' }).click();
    await expect(flows.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveCount(2);

    await rail(page).getByRole('button', { name: 'Check my design' }).click();
    await expect(page.getByTestId('checks').getByRole('status')).toHaveText(/^All \d+ checks pass$/);
    await expect(rail(page).getByText(/Last check: \d+ of \d+ pass, solved\./)).toBeVisible();
    // Never typed: the code was hidden the whole time.
    await expect(codeEditor(page)).toHaveCount(0);
  });
});

test.describe('the interview room on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the interview tab first, then the whiteboard; the code tab only with Show code', async ({ page }) => {
    await startOn(page, 'URL Shortener');
    const tabs = page.getByRole('tablist', { name: 'Room' });
    await expect(tabs.getByRole('tab')).toHaveText(['Interview', 'Whiteboard']);
    await expect(tabs.getByRole('tab', { name: 'Interview' })).toHaveAttribute('aria-selected', 'true');
    await expect(rail(page)).toBeVisible();
    await tabs.getByRole('tab', { name: 'Whiteboard' }).click();
    await expect(page.getByRole('region', { name: 'Whiteboard' })).toBeVisible();
    await expect(rail(page)).toBeHidden();
    await page.getByRole('button', { name: 'Room options' }).click();
    await page.getByRole('menuitem', { name: 'Show code' }).click();
    await expect(tabs.getByRole('tab')).toHaveText(['Interview', 'Whiteboard', 'Code']);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });
});
