import type { Page } from '@playwright/test';
import { answerDialog, canvasNodes, chooseOption, codeEditor, editorText, expect, test, toSetupStep } from './fixtures';

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
const currentStage = (page: Page) => page.getByRole('list', { name: 'Stages' }).locator('[aria-current="step"]');

/** Clicks Next until the room is on `stage` (P49). */
async function toStage(page: Page, stage: 'Estimate' | 'Design' | 'Wrap-up') {
  const order = ['Clarify', 'Estimate', 'Design', 'Wrap-up'];
  const now = (await currentStage(page).textContent()) ?? '';
  const from = order.findIndex((label) => now.includes(label));
  for (const label of order.slice(from + 1, order.indexOf(stage) + 1)) {
    await page.getByRole('button', { name: `Next: ${label}` }).click();
    await expect(currentStage(page)).toContainText(label);
  }
}

/** Records the sound cues played (sounds.ts dispatches one event per cue) in `window.__cues`. */
async function recordCues(page: Page) {
  await page.addInitScript(() => {
    const cues: string[] = [];
    window.addEventListener('proschi:cue', (e) => cues.push((e as CustomEvent<string>).detail));
    Object.assign(window, { __cues: cues });
  });
}
const cues = (page: Page) => page.evaluate(() => (window as unknown as { __cues: string[] }).__cues);

/** From the set-up wizard: the problem chosen by name in the picker, the length, then Start on the review. */
async function startOn(page: Page, title: string, minutes?: string) {
  await page.goto('practice/#/interview');
  await page.getByRole('radio', { name: 'Choose a problem' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a problem' });
  await picker.getByRole('searchbox', { name: 'Search problems' }).fill(title);
  await picker.getByRole('list', { name: 'Problems' }).getByRole('button', { name: new RegExp(title) }).first().click();
  await expect(picker).toBeHidden();
  await expect(page.getByTestId('chosen-problem')).toContainText(title);
  if (minutes) {
    await toSetupStep(page, 'length');
    await page.getByRole('radio', { name: minutes }).click();
  }
  await toSetupStep(page);
  await page.getByRole('button', { name: 'Start the interview' }).click();
  await expect(room(page)).toBeVisible();
}

test.describe('mock interview set-up', () => {
  test('Surprise me picks a problem not done yet, so the next one differs, and the problem waits for the room', async ({ page }) => {
    await page.goto('practice/#/interview');
    await expect(page.getByRole('heading', { level: 1, name: 'Mock interview' })).toBeVisible();
    // Without the interviewer the wizard starts at the problem: one question a screen, a default chosen.
    await expect(page.getByRole('heading', { level: 2, name: 'Which problem?' })).toBeVisible();
    await expect(page.getByTestId('setup-progress')).toHaveText('Step 1 of 3');
    await expect(page.getByRole('radio', { name: 'Surprise me' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'Same as last time' })).toHaveCount(0);
    // The filters, folded under Filters, narrow the pool.
    await expect(page.getByRole('radiogroup', { name: 'Difficulty' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('radiogroup', { name: 'Difficulty' }).getByRole('radio', { name: 'Easy' }).click();
    await expect(page.getByTestId('pool-size')).toHaveText(/^5 problems to draw from, 5 not done yet\.$/);
    await page.getByRole('radiogroup', { name: 'Difficulty' }).getByRole('radio', { name: 'Any' }).click();

    // Enter continues from the question, which takes the focus on each new screen.
    await page.getByRole('button', { name: /^Continue/ }).click();
    const question = page.getByRole('heading', { level: 2, name: 'How long?' });
    await expect(question).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Ready when you are' })).toBeFocused();
    await expect(page.getByRole('list', { name: 'Your interview' })).toContainText('A surprise, shown in the room');
    await expect(page.getByTestId('consent-line')).toHaveCount(0);
    // Browser Back steps back through the screens, not off the page.
    await page.goBack();
    await expect(question).toBeVisible();
    await page.goForward();
    await page.getByRole('button', { name: 'Start the interview' }).click();
    await expect(room(page)).toBeVisible();
    const first = roomProblem(page);
    expect(first).not.toBe('hello-proschi');
    await expect(page.getByTestId('brief')).toBeVisible();

    // Leaving keeps it (paused) and offers it back; the next surprise is another problem.
    await page.getByRole('button', { name: 'Exit the interview' }).click();
    await answerDialog(page, 'Leave');
    await expect(page.getByTestId('open-solo')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Same as last time' })).toBeVisible();
    await toSetupStep(page);
    await page.getByRole('button', { name: 'Start the interview' }).click();
    await expect(room(page)).toBeVisible();
    expect(roomProblem(page)).not.toBe(first);
  });

  test('Choose a problem: a searchable list, and a problem’s Wrap-up preselects its problem', async ({ page }) => {
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

    await page.goto('practice/#/roadmap/url-shortener');
    await page.getByRole('navigation', { name: 'Stages' }).getByRole('button', { name: 'Wrap-up' }).click();
    const link = page.getByRole('link', { name: /Practice this as a mock interview/ });
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
  test('clarify, estimate, design and wrap up with Next, against the clock, then the summary and a new interview', async ({ page }) => {
    await recordCues(page);
    await startOn(page, 'URL Shortener', '30 min');
    await expect(page.getByRole('timer')).toHaveAccessibleName(/^Time left: (30:00|29:5\d)\. Pause the clock$/);
    await expect(currentStage(page)).toContainText('Clarify');

    // Clarify: the brief is typed out until a key shows it all; the scale and constraints are hidden until asked for.
    const brief = page.getByTestId('brief');
    await expect(brief).toHaveAttribute('data-typing', 'true');
    await page.keyboard.press('Space');
    await expect(brief).not.toHaveAttribute('data-typing');
    await page.getByRole('button', { name: 'Ask your clarifying questions' }).click();
    await expect(page.getByTestId('pinned-brief')).toBeVisible();
    await page.getByRole('button', { name: 'Ask: How fast must a redirect be?' }).click();
    await expect(page.getByText('Good question')).toBeVisible();
    await page.getByRole('button', { name: 'Ask: Can I use Kubernetes?' }).click();
    await expect(page.getByText('Weak question')).toBeVisible();

    // Estimate: the requirements learned, and the worksheet's rows scored against their range.
    await page.getByRole('button', { name: 'Next: Estimate' }).click();
    await expect(currentStage(page)).toContainText('Estimate');
    await expect(page.getByRole('heading', { level: 2, name: 'Back-of-the-envelope numbers' })).toBeFocused();
    await expect.poll(() => cues(page)).toContain('phase');
    await expect(page.getByTestId('requirements')).toContainText('p99 of a redirect under 50 ms');
    const sheet = page.getByTestId('worksheet');
    await sheet.getByLabel('How many short codes are created in a year at 100 a second?').fill('100 * 86400 * 365');
    await expect(sheet.getByText('= 3.15B codes')).toBeVisible();
    await sheet.getByRole('button', { name: 'Check' }).first().click();
    await expect(sheet.getByText(/In range: the answer is 3,200,000,000 codes/)).toBeVisible();
    await expect(page.getByTestId('worksheet-score')).toHaveText('1 of 3 in range');
    await sheet.getByRole('button', { name: 'Add row' }).click();
    await expect(sheet.getByTestId('worksheet-row')).toHaveCount(4);
    await expect(sheet.getByLabel('What this row estimates')).toBeFocused();
    await page.getByLabel('Calculator').fill('2^10');
    await expect(page.getByTestId('calc-result')).toHaveText('= 1.02k');

    // Design: the whiteboard; checking runs the tests over it.
    await page.getByRole('button', { name: 'Next: Design' }).click();
    await rail(page).getByRole('button', { name: 'Check my design' }).click();
    await expect(page.getByTestId('checks').getByRole('status')).toHaveText(/^\d+ of 10 checks pass$/);
    await expect.poll(() => cues(page)).toContain('fail');
    await expect(rail(page).getByText(/Last check: \d+ of 10 pass/)).toBeVisible();
    await rail(page).getByRole('button', { name: /^Requirements \(1\) · Estimates \(1\)/ }).click();
    await expect(page.getByTestId('estimates-summary')).toContainText('3.15B codes');

    // Pausing stops the clock, and the interview survives a reload.
    await page.getByRole('timer').click();
    await expect(page.getByRole('timer')).toHaveAccessibleName(/Resume the clock$/);
    await page.reload();
    await expect(currentStage(page)).toContainText('Design');

    await page.getByRole('button', { name: 'Next: Wrap-up' }).click();
    await expect(page.getByRole('button', { name: /^Next/ })).toHaveCount(0);
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
    await toSetupStep(page);
    await page.getByRole('button', { name: 'Start the interview' }).click();
    await expect(room(page)).toBeVisible();
    expect(roomProblem(page)).not.toBe('url-shortener');
  });

  test('past stages open read-only from the stepper, with a banner back to the current one', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startOn(page, 'URL Shortener');
    // Under reduced motion the brief is shown whole at once.
    await expect(page.getByTestId('brief')).not.toHaveAttribute('data-typing');
    await page.getByRole('button', { name: 'Ask your clarifying questions' }).click();
    await page.getByRole('button', { name: 'Ask: How fast must a redirect be?' }).click();
    await toStage(page, 'Estimate');
    await page.getByTestId('worksheet').getByLabel('How many short codes are created in a year at 100 a second?').fill('1B');
    await page.getByTestId('worksheet').getByRole('button', { name: 'Check' }).first().click();
    await toStage(page, 'Design');

    await page.getByRole('button', { name: 'View Clarify (read-only)' }).click();
    const banner = page.getByTestId('stage-banner');
    await expect(banner).toContainText('Viewing Clarify (read-only)');
    await expect(page.getByRole('heading', { level: 2, name: 'Clarify, as it was' })).toBeFocused();
    const past = page.getByTestId('past-stage');
    await expect(past.getByText('How fast must a redirect be?')).toBeVisible();
    await expect(past.getByRole('button', { name: /^Ask:/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next: Wrap-up' })).toBeDisabled();

    await page.getByRole('button', { name: 'View Estimate (read-only)' }).click();
    await expect(banner).toContainText('Viewing Estimate (read-only)');
    await expect(past.getByLabel('Your estimate').first()).toHaveAttribute('readonly', '');
    await expect(past.getByRole('button', { name: 'Check' })).toHaveCount(0);
    await expect(past.getByRole('button', { name: 'Add row' })).toHaveCount(0);

    await banner.getByRole('button', { name: 'Back to Design' }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Whiteboard' })).toBeVisible();
    await expect(currentStage(page)).toContainText('Design');
  });

  test('the code is hidden until Show code, which opens a drawer beside the whiteboard and is remembered', async ({ page }) => {
    await startOn(page, 'URL Shortener');
    // The whiteboard's stages only: no code or checks while clarifying.
    await expect(page.getByRole('button', { name: 'Show code' })).toHaveCount(0);
    await toStage(page, 'Design');
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
    await page.getByRole('radio', { name: 'Choose a problem' }).click();
    await page.getByRole('dialog', { name: 'Choose a problem' }).getByRole('button', { name: /^URL Shortener/ }).click();
    await toSetupStep(page);
    const setupSound = page.getByTestId('setup-sound');
    await expect(setupSound).toHaveAttribute('aria-checked', 'true');
    await setupSound.click();
    await expect(setupSound).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Start the interview' }).click();
    const sound = page.getByTestId('room-sound');
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    await toStage(page, 'Estimate');
    expect(await cues(page)).toEqual([]);

    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByTestId('room-sound')).toHaveAttribute('aria-pressed', 'true');
    await toStage(page, 'Design');
    await expect.poll(() => cues(page)).toEqual(['phase']);
  });

  test('an easy problem solved with the mouse alone: settings, Flows and Check my design', async ({ page }) => {
    await startOn(page, 'Snowflake IDs');
    await toStage(page, 'Design');
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

test.describe('an interview as progress', () => {
  test('one too short to count says so, with the bar, and earns nothing', async ({ page }) => {
    await startOn(page, 'URL Shortener', '30 min');
    await toStage(page, 'Wrap-up');
    await rail(page).getByRole('button', { name: 'Finish the interview' }).click();

    const progress = page.getByTestId('interview-result').getByRole('region', { name: 'Your progress' });
    await expect(progress).toContainText('Too short to count towards your progress');
    await expect(progress.getByTestId('result-too-short')).toContainText('10 minutes or more, or reaches Design with something drawn');
    await expect(progress.locator('[data-new-badge]')).toHaveCount(0);

    await page.goto('practice/#/progress');
    await expect(page.getByTestId('xp')).toHaveText('0 XP');
    await expect(page.getByRole('region', { name: 'Interviews on your own' }).getByRole('listitem')).toContainText('Too short to count');
  });

  test('a finished interview on your own adds XP and a badge on the result, once, and joins the progress page', async ({ page }) => {
    await page.clock.install();
    await startOn(page, 'URL Shortener', '30 min');
    await toStage(page, 'Design');
    // Eleven minutes of design: past the 10 minutes an interview needs to count.
    await page.clock.fastForward('11:00');
    await toStage(page, 'Wrap-up');
    await rail(page).getByRole('button', { name: 'Finish the interview' }).click();

    const progress = page.getByTestId('interview-result').getByRole('region', { name: 'Your progress' });
    await expect(progress.getByTestId('result-xp')).toHaveText('+20 XP · Level 1');
    const badges = progress.getByRole('list', { name: 'New badges' });
    await expect(badges.locator('[data-new-badge="interview-first"]')).toContainText('First interview');
    // The skill map moved: URL Shortener's topics got the interview's bonus.
    await expect(progress.getByRole('list', { name: 'Skills that moved' }).getByRole('listitem').first()).toContainText(/\d+% → \d+%/);

    // A reload counts nothing twice: the badge was earned with the interview, and no XP is added again.
    await page.reload();
    await expect(progress.getByTestId('result-xp')).toHaveText('Level 1');
    await expect(progress.locator('[data-new-badge="interview-first"]')).toBeVisible();

    await progress.getByRole('link', { name: 'See your progress' }).click();
    await expect(page).toHaveURL(/#\/progress$/);
    await expect(page.getByTestId('xp')).toHaveText('20 XP');
    await expect(page.locator('[data-achievement="interview-first"]')).toHaveAttribute('data-earned', 'true');
    const history = page.getByRole('region', { name: 'Interviews on your own' });
    await expect(history.getByRole('listitem')).toHaveCount(1);
    await expect(history.getByRole('listitem')).toContainText('URL Shortener');
    await expect(history.getByRole('link')).toHaveAttribute('href', '#/interview?problem=url-shortener&with=solo');
    // Shown on the result already: no toast celebrates it again.
    await expect(page.getByRole('status', { name: 'New badge' })).toHaveCount(0);
  });
});

test.describe('the interview room on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a stage at a time with the Next bar; the interview tab first, then the whiteboard; the code tab only with Show code', async ({ page }) => {
    await startOn(page, 'URL Shortener');
    const next = page.getByTestId('next-bar');
    await expect(next.getByRole('button', { name: 'Next: Estimate' })).toBeVisible();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Ask your clarifying questions' }).click();
    await next.getByRole('button', { name: 'Next: Estimate' }).click();
    await expect(page.getByTestId('worksheet')).toBeVisible();
    await next.getByRole('button', { name: 'Next: Design' }).click();
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
    // The wrap-up's bar finishes, and the toasts sit above it.
    await next.getByRole('button', { name: 'Next: Wrap-up' }).click();
    await expect(next.getByRole('button', { name: 'Finish' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ps-toast-bottom'))).not.toBe('');
  });
});
