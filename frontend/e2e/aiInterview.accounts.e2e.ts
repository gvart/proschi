import type { Page } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { mockInterviews } from './aiInterview';
import { answerDialog, expect, test, toSetupStep } from './fixtures';

/**
 * The mock interview with the interviewer (build with accounts, API mocked):
 * the set-up (credits, consent line, voice or text), the room (the
 * whiteboard, the chat on the right with coaching inline and as toasts,
 * Send my design, resume after a reload), the hands-free voice mode and the
 * result. On your own, see interview.e2e.ts.
 */

const chatOf = (page: Page) => page.getByRole('region', { name: 'Mock interview', exact: true });
const currentStage = (page: Page) => page.getByRole('list', { name: 'Stages' }).locator('[aria-current="step"]');

/** Past the brief (typed out on Clarify): a key shows it all, then to the questions. */
async function openChat(page: Page) {
  await expect(page.getByTestId('brief')).toBeVisible();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Ask your clarifying questions' }).click();
}

/** Next, and the turn it sends answered (P49). */
async function next(page: Page, label: 'Estimate' | 'Design' | 'Wrap-up') {
  await page.getByRole('button', { name: `Next: ${label}` }).click();
  await expect(currentStage(page)).toContainText(label);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

/** From the set-up, on URL Shortener: Start, then the room's chat. */
async function startInterview(page: Page, opts: { talk?: 'Voice' | 'Text' } = {}) {
  await page.goto('practice/#/interview?problem=url-shortener');
  if (opts.talk) {
    await toSetupStep(page, 'talk');
    await page.getByRole('radiogroup', { name: 'How you talk' }).getByRole('radio', { name: new RegExp(`^${opts.talk}`) }).click();
  }
  await toSetupStep(page);
  await page.getByRole('button', { name: 'Start the mock interview' }).click();
  await openChat(page);
  const chat = chatOf(page);
  await expect(chat.getByText(/Today we'll design URL Shortener/)).toBeVisible();
  return chat;
}

/** Whether two boxes overlap. */
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every toast's box (the hint toasts are inside them). */
const toastBoxes = (page: Page) => page.locator('.ps-toast').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }));

/** Drops the expected non-2xx loads Chromium logs. */
const allowStatus = (errors: string[], status: number) => {
  for (let i = errors.length - 1; i >= 0; i--) if (new RegExp(`status of ${status}`).test(errors[i])) errors.splice(i, 1);
};

/**
 * A fake Web Speech recognizer: `window.__speech.say(text, final)` sends a
 * result to the running one, and `window.__speech.deny = true` makes the
 * next start fail as a blocked microphone.
 */
async function fakeSpeech(page: Page) {
  await page.addInitScript(() => {
    type Handler = ((e: unknown) => void) | null;
    const speech = {
      current: undefined as undefined | FakeRecognition,
      deny: false,
      starts: 0,
      on: false,
      say(text: string, final: boolean) {
        speech.current?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] });
      },
    };
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: Handler = null;
      onend: Handler = null;
      onerror: Handler = null;
      onstart: Handler = null;
      start() {
        speech.starts++;
        speech.current = this;
        setTimeout(() => {
          if (speech.deny) {
            this.onerror?.({ error: 'not-allowed' });
            this.onend?.(undefined);
          } else {
            speech.on = true;
            this.onstart?.(undefined);
          }
        }, 10);
      }
      stop() {
        speech.on = false;
        setTimeout(() => this.onend?.(undefined), 10);
      }
      abort() {
        this.stop();
      }
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition, __speech: speech });
  });
}

/** A fake speechSynthesis: records what it says in `window.__spoken`, and ends each utterance after `window.__speakMs` (300 ms). */
async function fakeSynthesis(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    let cancels = 0;
    Object.assign(window, { __spoken: spoken, __cancels: () => cancels, __speakMs: 300 });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [],
        speak: (u: { text: string; onend?: () => void }) => {
          spoken.push(u.text);
          setTimeout(() => u.onend?.(), (window as unknown as { __speakMs: number }).__speakMs);
        },
        cancel: () => cancels++,
        addEventListener() {},
        removeEventListener() {},
        onvoiceschanged: null,
      },
    });
  });
}

const say = (page: Page, text: string, final: boolean) => page.evaluate(([t, f]) => (window as unknown as { __speech: { say(t: string, f: boolean): void } }).__speech.say(t as string, f as boolean), [text, final] as const);

test.describe('mock interview with the interviewer', () => {
  test('a full session: the set-up, three turns with coaching, the design sent, a reload, the verdict and the result', async ({ page }) => {
    await mockSignedIn(page);
    const mock = await mockInterviews(page, {
      replies: [
        { text: 'About 100 million new links a month, and reads outnumber writes 100 to 1.', hint: { kind: 'focus', text: 'Ask how fast a redirect must be.' } },
        { text: 'How many writes a second is that?', phase: 'estimate' },
        { text: 'Show me the design when it is ready.', phase: 'design' },
        { text: 'Seven of ten tests pass. What happens when the cache misses?', hint: { kind: 'improve', text: 'Explain the cache miss path and its p99.' }, phase: 'design' },
        { text: 'Good. Where is the bottleneck now?', hint: { kind: 'focus', text: 'Name the component that saturates first.' }, phase: 'design' },
      ],
    });
    await page.goto('practice/#/interview?problem=url-shortener');
    // The interviewer is chosen when there is one, on the wizard's first screen of five.
    await expect(page.getByRole('heading', { level: 2, name: 'Who interviews you?' })).toBeVisible();
    await expect(page.getByTestId('setup-progress')).toHaveText('Step 1 of 5');
    await expect(page.getByRole('radiogroup', { name: 'Interviewer' }).getByRole('radio', { name: /Mock interview/ })).toHaveAttribute('aria-checked', 'true');
    // The review: the estimate for the length, against the balance.
    await toSetupStep(page);
    await expect(page.getByRole('list', { name: 'Your interview' })).toContainText('URL Shortener');
    await expect(page.getByTestId('ai-credits')).toContainText('about 45–60 credits for 45 min; you have 100.');
    await expect(page.getByTestId('ai-credits-cap')).toHaveText(', never more than 100 credits');
    // A row of the review opens its screen, and Continue comes back to the review.
    await page.getByRole('button', { name: 'Change the length' }).click();
    await page.getByRole('radio', { name: '30 min' }).click();
    await page.getByRole('button', { name: /^Back to review/ }).click();
    await expect(page.getByTestId('ai-credits')).toContainText('about 30–40 credits for 30 min; you have 100.');
    await page.getByRole('button', { name: 'Change the length' }).click();
    await page.getByRole('radio', { name: '45 min' }).click();
    await page.getByRole('button', { name: /^Back to review/ }).click();
    // Starting is the agreement: the line names what goes to Anthropic.
    await expect(page.getByTestId('consent-line')).toContainText('Starting sends Anthropic');
    await expect(page.getByTestId('consent-line')).toContainText('90 days');
    await page.getByRole('button', { name: 'Start the mock interview' }).click();

    await expect(page).toHaveURL(/#\/interview\/url-shortener$/);
    await expect(page.getByRole('timer')).toHaveAccessibleName(/^Time left: (45:00|44:5\d)$/);
    await expect(currentStage(page)).toContainText('Clarify');
    // Clarify opens on the brief, then pins it over the chat.
    await openChat(page);
    await expect(page.getByTestId('pinned-brief')).toContainText('URL Shortener');
    const chat = chatOf(page);
    await expect(chat.getByText(/Today we'll design URL Shortener/)).toBeVisible();

    const box = chat.getByRole('textbox', { name: 'Your answer' });
    await box.fill('How many new links a month, and what is the read to write ratio?');
    await box.press('Enter');
    await expect(chat.getByText(/reads outnumber writes 100 to 1/)).toBeVisible();
    // The hint comes as a toast and stays inline under the reply.
    const toasts = page.getByTestId('hint-toast');
    await expect(toasts).toHaveCount(1);
    await expect(toasts.first()).toHaveText('Ask how fast a redirect must be.');
    await expect(chat.getByTestId('coaching-card')).toHaveCount(1);

    // Next moves on, telling the interviewer; the design is sent from the whiteboard's stages.
    await next(page, 'Estimate');
    await next(page, 'Design');
    await box.fill('Here is my design.');
    await chat.getByRole('button', { name: 'Send my design' }).click();
    await expect(chat.getByText(/What happens when the cache misses\?/)).toBeVisible();
    await expect(chat.getByText('Design sent')).toBeVisible();
    await box.fill('The cache misses read the database, then set the code.');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByText('Good. Where is the bottleneck now?')).toBeVisible();
    // Never more than two toasts at once: the oldest went. All three stay in the chat.
    await expect(toasts).toHaveCount(2);
    await expect(toasts).toHaveText(['Explain the cache miss path and its p99.', 'Name the component that saturates first.']);
    // The chat shows this stage's conversation; the earlier stages are behind an expander.
    await expect(chat.getByTestId('coaching-card')).toHaveCount(2);
    await chat.getByTestId('show-earlier').click();
    await expect(chat.getByTestId('coaching-card')).toHaveCount(3);
    expect(mock.turns).toHaveLength(5);
    expect(mock.turns[0]).toEqual({ message: 'How many new links a month, and what is the read to write ratio?', stage: 'clarify' });
    expect(mock.turns[1]).toMatchObject({ message: "I'm ready to move on to the estimate stage.", stage: 'estimate' });
    expect(mock.turns[3].message).toBe('Here is my design.');
    expect(mock.turns[3].design).toContain('import "problem.proschi"');

    // A reload resumes the session from the server, on the same stage.
    await page.reload();
    await expect(chat.getByText('Good. Where is the bottleneck now?')).toBeVisible();
    await expect(toasts).toHaveCount(0);
    await expect(chat.getByTestId('coaching-card')).toHaveCount(2);
    await expect(currentStage(page)).toContainText('Design');

    await page.getByRole('button', { name: 'Finish and get the verdict' }).click();
    await answerDialog(page, 'Finish');
    const result = page.getByTestId('interview-result');
    const verdict = result.getByRole('region', { name: 'Interview verdict' });
    await expect(verdict.getByTestId('verdict-result')).toHaveText('Pass');
    await expect(verdict.getByRole('row', { name: /Communication 5\/5/ })).toBeVisible();
    await expect(verdict.getByText('Try the Pastebin problem next')).toBeVisible();
    await expect(result.getByRole('link', { name: 'Try this problem again' })).toHaveAttribute('href', '#/interview?problem=url-shortener&with=mock');
    await result.getByRole('link', { name: 'New interview' }).click();
    await toSetupStep(page, 'problem');
    await expect(page.getByRole('radio', { name: 'Surprise me' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'Same as last time' })).toBeVisible();
  });

  test('Surprise me starts on a problem the account has not done, revealed in the room', async ({ page }) => {
    await mockSignedIn(page);
    const mock = await mockInterviews(page, { replies: [] });
    const problems: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/interviews') problems.push((r.postDataJSON() as { problem: string }).problem);
    });
    await page.goto('practice/#/interview');
    await toSetupStep(page, 'problem');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('radiogroup', { name: 'Difficulty' }).getByRole('radio', { name: 'Easy' }).click();
    await toSetupStep(page);
    await page.getByRole('button', { name: 'Start the mock interview' }).click();
    await expect(page.getByTestId('brief')).toBeVisible();
    expect(mock.starts).toHaveLength(1);
    expect(['pastebin', 'rate-limiter', 'snowflake-ids', 'shopping-cart', 'url-shortener']).toContain(problems[0]);
    await expect(page).toHaveURL(new RegExp(`#/interview/${problems[0]}$`));
  });

  for (const param of ['mock', 'ai'] as const) {
    test(`a deep link, #/<problem>?interview=${param}, opens the set-up with the problem and the interviewer, starting nothing`, async ({ page }) => {
      await mockSignedIn(page);
      const mock = await mockInterviews(page, { replies: [] });
      await page.goto(`practice/#/url-shortener?interview=${param}`);
      await expect(page).toHaveURL(/#\/interview\?problem=url-shortener&with=mock$/);
      await expect(page.getByRole('radiogroup', { name: 'Interviewer' }).getByRole('radio', { name: /Mock interview/ })).toHaveAttribute('aria-checked', 'true');
      await toSetupStep(page, 'problem');
      await expect(page.getByTestId('chosen-problem')).toContainText('URL Shortener');
      await toSetupStep(page);
      await expect(page.getByRole('button', { name: 'Start the mock interview' })).toBeVisible();
      expect(mock.starts).toEqual([]);
    });
  }

  for (const choice of ['resume', 'replace'] as const) {
    test(`an interview already open: ${choice === 'resume' ? 'Resume it (the default)' : 'End it and start a new one'}`, async ({ page, errors }) => {
      await mockSignedIn(page);
      const mock = await mockInterviews(page, { replies: [], credits: 120, open: 'Welcome back: where were we on the read path?' });
      await page.goto('practice/#/interview?problem=pastebin');
      // The set-up says so before Start, too.
      await expect(page.getByTestId('open-interview')).toContainText('URL Shortener');
      await toSetupStep(page);
      await page.getByRole('button', { name: 'Start the mock interview' }).click();

      const open = page.getByRole('region', { name: 'Mock interview in progress' });
      await expect(open.getByRole('heading', { name: 'You have a mock interview in progress' })).toBeVisible();
      await expect(open.getByRole('button', { name: 'Resume it' })).toBeFocused();
      await expect(open.getByText(/credits the old interview used are not returned/)).toBeVisible();
      const chat = chatOf(page);
      if (choice === 'resume') {
        await open.getByRole('button', { name: 'Resume it' }).click();
        await expect(page).toHaveURL(/#\/interview\/url-shortener$/);
        await openChat(page);
        await expect(chat.getByText('Welcome back: where were we on the read path?')).toBeVisible();
        expect(mock.starts).toEqual([{ replace: false, deep: false }]);
      } else {
        await open.getByRole('button', { name: 'End it and start a new one' }).click();
        await expect(page).toHaveURL(/#\/interview\/pastebin$/);
        await openChat(page);
        await expect(chat.getByText(/Today we'll design/)).toBeVisible();
        await expect(chat.getByText('Welcome back: where were we on the read path?')).toHaveCount(0);
        expect(mock.starts).toEqual([{ replace: false, deep: false }, { replace: true, deep: false }]);
      }
      allowStatus(errors, 409);
    });
  }

  test('a start refused for want of credits (402 no_credits) says what it needs', async ({ page, errors }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [], credits: 50, needed: 70 });
    await page.goto('practice/#/interview?problem=url-shortener');
    await toSetupStep(page);
    await page.getByRole('button', { name: 'Start the mock interview' }).click();
    await expect(page.getByTestId('ai-credits')).toContainText('You have 50 credits. A 45-minute mock interview takes at least 70.');
    await expect(page.getByRole('button', { name: 'Start the mock interview' })).toBeDisabled();
    allowStatus(errors, 402);
  });

  test('too few credits offers a top-up, and On my own still starts for free', async ({ page, errors }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [], credits: 12 });
    await page.goto('practice/#/interview?problem=url-shortener');
    await toSetupStep(page);
    await expect(page.getByTestId('ai-credits')).toContainText('You have 12 credits. A 45-minute mock interview takes about 45–60.');
    await expect(page.getByRole('button', { name: 'Buy 1,000 credits, €12' })).toBeVisible();
    await expect(page.getByTestId('ai-upgrade')).toHaveAttribute('href', '../pricing/');
    await expect(page.getByRole('button', { name: 'Start the mock interview' })).toBeDisabled();
    expect(errors).toEqual([]);
    // On my own skips the credits, the consent and voice, and says it is free.
    await page.getByRole('button', { name: 'Change the interviewer' }).click();
    await page.getByRole('radio', { name: 'On my own' }).click();
    await page.getByRole('button', { name: /^Back to review/ }).click();
    await expect(page.getByTestId('solo-free')).toContainText('Free.');
    await expect(page.getByTestId('consent-line')).toHaveCount(0);
    await expect(page.getByTestId('ai-credits')).toHaveCount(0);
    await page.getByRole('button', { name: 'Start the interview' }).click();
    await expect(page.getByTestId('brief')).toBeVisible();
  });

  test('out of credits mid-interview: a calm note, the wrap-up and the verdict', async ({ page }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [{ text: 'Let us wrap up: summarise your design.', phase: 'wrapup' }], runsOutAfter: 1 });
    const chat = await startInterview(page);
    await expect(chat.getByTestId('out-of-credits')).toHaveCount(0);
    await chat.getByRole('textbox', { name: 'Your answer' }).fill('How many links a month?');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByTestId('out-of-credits')).toHaveText(/out of credits, so the interviewer is wrapping up\. Your verdict is already paid for/);
    // The stage stays the user's to move on; finishing works from any of them.
    await expect(currentStage(page)).toContainText('Clarify');
    await page.getByRole('button', { name: 'Finish and get the verdict' }).click();
    await answerDialog(page, 'Finish');
    await expect(page.getByRole('region', { name: 'Interview verdict' }).getByTestId('verdict-result')).toHaveText('Pass');
  });

  test('Check my design runs the tests on the whiteboard and can send it to the interviewer', async ({ page }) => {
    await mockSignedIn(page);
    const mock = await mockInterviews(page, { replies: [{ text: 'Numbers?' }, { text: 'Design?' }, { text: 'Thanks, I see the design.' }] });
    const chat = await startInterview(page);
    await expect(page.getByRole('button', { name: 'Check my design' })).toHaveCount(0);
    await next(page, 'Estimate');
    await next(page, 'Design');
    await page.getByRole('button', { name: 'Check my design' }).click();
    const checks = page.getByTestId('checks');
    await expect(checks.getByRole('status')).toHaveText(/^\d+ of 10 checks pass$/);
    await checks.getByRole('button', { name: 'Send my design to the interviewer' }).click();
    await expect(chat.getByText('Thanks, I see the design.')).toBeVisible();
    expect(mock.turns[2].design).toContain('import "problem.proschi"');
  });

  test('each turn sends the stage and, from Estimate on, the worksheet; the facts learned and the transcript follow the stage', async ({ page }) => {
    await mockSignedIn(page);
    const mock = await mockInterviews(page, {
      known: ['New links: 100M a month', 'Reads outnumber writes 100 to 1'],
      replies: [{ text: 'About 100 million new links a month.' }, { text: 'How many writes a second is that?' }, { text: 'Right order of magnitude.' }],
    });
    const chat = await startInterview(page);
    const box = chat.getByRole('textbox', { name: 'Your answer' });
    await box.fill('How many new links a month?');
    await box.press('Enter');
    await expect(chat.getByText('About 100 million new links a month.')).toBeVisible();

    await next(page, 'Estimate');
    await expect(page.getByRole('heading', { level: 2, name: 'Back-of-the-envelope numbers' })).toBeFocused();
    // What the interviewer has told the candidate, from the server (P38).
    await expect(page.getByTestId('requirements').getByRole('listitem')).toHaveText(['New links: 100M a month', 'Reads outnumber writes 100 to 1']);
    const sheet = page.getByTestId('worksheet');
    await sheet.getByLabel('Writes per second: value').fill('100M / 30 / 86400');
    await expect(sheet.getByText('= 38.6 /s')).toBeVisible();
    await sheet.getByRole('button', { name: 'Add row' }).click();
    await sheet.getByLabel('What this row estimates').last().fill('Short codes in 5 years');
    await sheet.getByLabel('Short codes in 5 years: value').fill('6B');
    await box.fill('About 39 writes a second.');
    await box.press('Enter');
    await expect(chat.getByText('Right order of magnitude.')).toBeVisible();

    expect(mock.turns.map((t) => t.stage)).toEqual(['clarify', 'estimate', 'estimate']);
    expect(mock.turns[0].worksheet).toBeUndefined();
    expect(mock.turns[2].worksheet).toEqual([
      { label: 'Writes per second', expression: '100M / 30 / 86400', unit: '/s' },
      { label: 'Short codes in 5 years', expression: '6B' },
    ]);
    // This stage's conversation only, with Clarify's behind the expander.
    await expect(chat.getByText('About 100 million new links a month.')).toHaveCount(0);
    await chat.getByTestId('show-earlier').click();
    await expect(chat.getByText('About 100 million new links a month.')).toBeVisible();

    // Clarify, read-only from the stepper; the worksheet survives a reload.
    await page.getByRole('button', { name: 'View Clarify (read-only)' }).click();
    await expect(page.getByTestId('stage-banner')).toHaveText(/^Viewing Clarify \(read-only\)\s*·\s*Back to Estimate$/);
    const past = page.getByTestId('past-stage');
    await expect(past.getByText('How many new links a month?')).toBeVisible();
    await expect(past.getByRole('textbox', { name: 'Your answer' })).toHaveCount(0);
    await page.getByTestId('stage-banner').getByRole('button', { name: 'Back to Estimate' }).click();
    await page.reload();
    await expect(page.getByTestId('worksheet').getByLabel('Writes per second: value')).toHaveValue('100M / 30 / 86400');
  });

  test('the coaching toasts sit clear of the chat on the right', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [{ text: 'Numbers?' }, { text: 'Design?' }, { text: 'Seven of ten tests pass.', hint: { kind: 'improve', text: 'Explain the cache miss path.' } }] });
    const chat = await startInterview(page);
    await next(page, 'Estimate');
    await next(page, 'Design');
    await chat.getByRole('textbox', { name: 'Your answer' }).fill('Here is my design.');
    await chat.getByRole('button', { name: 'Send my design' }).click();
    await expect(page.getByTestId('hint-toast')).toBeVisible();
    const rail = (await page.getByTestId('interview-rail').boundingBox())!;
    const boxes = await toastBoxes(page);
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(overlaps(box, rail)).toBe(false);
  });

  test('voice: hands-free listening, sent after a pause with a countdown, replies spoken, then text again', async ({ page }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [{ text: 'About 100 million links a month.' }, { text: 'Go on.' }] });
    await fakeSpeech(page);
    await fakeSynthesis(page);
    const chat = await startInterview(page, { talk: 'Voice' });
    const talk = page.getByRole('radiogroup', { name: 'Talk with the interviewer' });
    await expect(talk.getByRole('radio', { name: 'Voice' })).toHaveAttribute('aria-checked', 'true');
    const mic = chat.getByTestId('mic-button');
    const status = chat.getByTestId('voice-status');
    // The mic starts on its own.
    await expect(mic).toHaveAttribute('data-state', 'listening');
    await expect(status).toHaveAttribute('data-state', 'listening');

    // Words, then silence: a countdown, which Cancel stops.
    await say(page, 'how many', false);
    await expect(chat.getByRole('textbox', { name: 'Your answer' })).toHaveValue('how many');
    await say(page, 'How many links a month?', true);
    await expect(status).toHaveAttribute('data-state', 'sending');
    await expect(status).toContainText(/Sending in \d\.\d s/);
    await status.getByRole('button', { name: 'Cancel' }).click();
    await expect(status).toHaveAttribute('data-state', 'listening');
    // New words start the countdown again; this time it sends.
    await say(page, 'And the reads?', true);
    await expect(status).toHaveAttribute('data-state', 'sending');
    await expect(chat.getByText('About 100 million links a month.')).toBeVisible({ timeout: 5000 });
    // The reply is spoken while the mic waits, then it listens again.
    // The brief was read aloud first (P49), then the reply.
    await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length)).toBe(2);
    const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
    expect(spoken[0]).toMatch(/^URL Shortener\. Design a service that turns long URLs/);
    expect(spoken[1]).toBe('About 100 million links a month.');
    await expect(status).toHaveAttribute('data-state', 'listening');
    await expect(mic).toHaveAttribute('data-state', 'listening');

    // Barge in: Interrupt stops the voice.
    await page.evaluate(() => ((window as unknown as { __speakMs: number }).__speakMs = 60_000));
    await say(page, 'Go on then.', true);
    await status.getByRole('button', { name: 'Send now' }).click();
    await expect(chat.getByText('Go on.', { exact: true })).toBeVisible();
    await expect(status).toHaveAttribute('data-state', 'speaking');
    const before = await page.evaluate(() => (window as unknown as { __cancels(): number }).__cancels());
    await status.getByRole('button', { name: 'Interrupt' }).click();
    expect(await page.evaluate(() => (window as unknown as { __cancels(): number }).__cancels())).toBeGreaterThan(before);
    await expect(mic).toHaveAttribute('data-state', 'listening');

    // Text mode: the mic stops, and the choice is remembered.
    await talk.getByRole('radio', { name: 'Text' }).click();
    await expect(mic).toHaveAttribute('data-state', 'idle');
    await expect(status).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('radiogroup', { name: 'Talk with the interviewer' }).getByRole('radio', { name: 'Text' })).toHaveAttribute('aria-checked', 'true');
  });

  test('a blocked microphone says so, and typing still works', async ({ page }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [{ text: 'Typed is fine.' }] });
    await fakeSpeech(page);
    await page.addInitScript(() => ((window as unknown as { __speech: { deny: boolean } }).__speech.deny = true));
    const chat = await startInterview(page, { talk: 'Voice' });
    await expect(chat.getByTestId('mic-button')).toHaveAttribute('data-state', 'denied');
    await expect(chat.getByTestId('mic-note')).toContainText('The microphone is blocked');
    await chat.getByRole('textbox', { name: 'Your answer' }).fill('Typing instead.');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByText('Typed is fine.')).toBeVisible();
  });
});

test.describe('mock interview on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Chat first, the toasts above the composer, and a reply on the whiteboard says so with a way back', async ({ page }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [{ text: 'Numbers?' }, { text: 'Design?' }, { text: 'Seven of ten tests pass.', hint: { kind: 'improve', text: 'Explain the cache miss path.' } }, { text: 'Go on.' }] });
    const chat = await startInterview(page);
    // A stage at a time: Estimate has its own Worksheet and Chat tabs, Chat first; the Next bar sits at the foot.
    const nextBar = page.getByTestId('next-bar');
    await nextBar.getByRole('button', { name: 'Next: Estimate' }).click();
    const estimate = page.getByRole('tablist', { name: 'Estimate' });
    await expect(estimate.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    await expect(chat.getByText('Numbers?')).toBeVisible();
    await estimate.getByRole('tab', { name: 'Worksheet' }).click();
    await expect(page.getByTestId('worksheet')).toBeVisible();
    await nextBar.getByRole('button', { name: 'Next: Design' }).click();
    await expect(chat.getByText('Design?')).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Room' });
    await expect(tabs.getByRole('tab')).toHaveText(['Chat', 'Whiteboard']);
    await expect(tabs.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('partner-button')).toHaveCount(0);

    await chat.getByRole('textbox', { name: 'Your answer' }).fill('Here is my design.');
    await chat.getByRole('button', { name: 'Send my design' }).click();
    await expect(page.getByTestId('hint-toast')).toBeVisible();
    const composer = (await chat.getByRole('form', { name: 'Your answer' }).boundingBox())!;
    for (const box of await toastBoxes(page)) expect(box.y + box.height).toBeLessThanOrEqual(composer.y);

    // The next reply waits until the candidate is on the whiteboard.
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route(/\/api\/interviews\/[^/]+\/turn$/, async (route) => {
      await gate;
      await route.fallback();
    });
    await chat.getByRole('textbox', { name: 'Your answer' }).fill('The cache comes first.');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await tabs.getByRole('tab', { name: 'Whiteboard' }).click();
    await expect(chat).toBeHidden();
    release();
    const toast = page.getByRole('status').filter({ hasText: 'The interviewer replied' });
    await expect(toast).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Chat' }).getByLabel('New message')).toBeVisible();
    await toast.getByRole('button', { name: 'Open the chat' }).click();
    await expect(tabs.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    await expect(chat.getByText('Go on.', { exact: true })).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });
});
