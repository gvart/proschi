import type { Page } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { mockInterviews } from './aiInterview';
import { answerDialog, expect, test } from './fixtures';

/** Signs in, agrees to the consent and starts a mock interview; the chat region. */
async function startInterview(page: Page) {
  await page.addInitScript(() => localStorage.setItem('proschi.aiInterview.consent', 'true'));
  await page.goto('practice/#/url-shortener');
  await page.getByRole('button', { name: 'Interview mode' }).click();
  const start = page.getByRole('region', { name: 'Interview mode' });
  await start.getByRole('radio', { name: /Mock interview/ }).click();
  await start.getByRole('button', { name: 'Start a mock interview' }).click();
  const chat = page.getByRole('region', { name: 'Mock interview', exact: true });
  await expect(chat.getByText(/Today we'll design URL Shortener/)).toBeVisible();
  return chat;
}

/**
 * A fake Web Speech recognizer: `window.__speech.say(text, final)` sends a
 * result to the running one, and `window.__speech.deny = true` makes the
 * next start fail as a blocked microphone.
 */
async function fakeSpeech(page: Page) {
  await page.addInitScript(() => {
    type Handler = ((e: unknown) => void) | null;
    const speech = { current: undefined as undefined | FakeRecognition, deny: false, starts: 0, say(text: string, final: boolean) {
      speech.current?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] });
    } };
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
          } else this.onstart?.(undefined);
        }, 10);
      }
      stop() {
        setTimeout(() => this.onend?.(undefined), 10);
      }
      abort() {
        this.stop();
      }
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition, __speech: speech });
  });
}

/** A fake speechSynthesis that records what it was asked to say in `window.__spoken`. */
async function fakeSynthesis(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    let cancels = 0;
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [],
        speak: (u: { text: string }) => spoken.push(u.text),
        cancel: () => cancels++,
        addEventListener() {},
        removeEventListener() {},
        onvoiceschanged: null,
      },
    });
    Object.assign(window, { __spoken: spoken, __cancels: () => cancels });
  });
}

/**
 * The AI interviewer in interview mode (build with accounts, API mocked):
 * pick it on the start screen, agree once to what is sent, talk over three
 * turns with coaching hints (toasts, two at most, and a history list), send
 * the design, resume after a reload, finish and read the verdict. Voice
 * input, spoken replies and the phone layout too. The scripted mode stays
 * the default.
 */
test.describe('AI interviewer', () => {
  test('a full session: start, three turns with hint toasts, resume, finish and the verdict', async ({ page }) => {
    await mockSignedIn(page);
    const mock = await mockInterviews(page, {
      replies: [
        { text: 'About 100 million new links a month, and reads outnumber writes 100 to 1.', hint: { kind: 'focus', text: 'Ask how fast a redirect must be.' } },
        { text: 'Seven of ten tests pass. What happens when the cache misses?', hint: { kind: 'improve', text: 'Explain the cache miss path and its p99.' }, phase: 'design' },
        { text: 'Good. Where is the bottleneck now?', hint: { kind: 'focus', text: 'Name the component that saturates first.' }, phase: 'design' },
      ],
    });
    await page.goto('practice/#/url-shortener');
    await page.getByRole('button', { name: 'Interview mode' }).click();

    const start = page.getByRole('region', { name: 'Interview mode' });
    await expect(start.getByRole('radio', { name: /On your own \(free\)/ })).toHaveAttribute('aria-checked', 'true');
    await start.getByRole('radio', { name: /Mock interview/ }).click();
    // The estimate for the chosen length, against the balance.
    await expect(start.getByTestId('ai-credits')).toContainText('about 45–60 credits for 45 min; you have 100.');
    // Never more than the cap, and never more than what there is: the interview wraps up at 0.
    await expect(start.getByTestId('ai-credits-cap')).toHaveText(', never more than 100 credits');
    await start.getByRole('radio', { name: '30 min' }).click();
    await expect(start.getByTestId('ai-credits')).toContainText('about 30–40 credits for 30 min; you have 100.');
    await start.getByRole('radio', { name: '45 min' }).click();
    await start.getByRole('button', { name: 'Start a mock interview' }).click();

    // The one-time consent names what goes to the AI provider.
    const consent = page.getByRole('region', { name: 'Mock interview consent' });
    await expect(consent.getByText(/Proschi sends Anthropic/)).toBeVisible();
    await expect(consent.getByText(/90 days/)).toBeVisible();
    await consent.getByRole('button', { name: 'I agree, start the interview' }).click();

    const chat = page.getByRole('region', { name: 'Mock interview', exact: true });
    await expect(chat.getByText(/Today we'll design URL Shortener/)).toBeVisible();
    await expect(chat.getByRole('timer', { name: 'Time left' })).toHaveText(/^(45:00|44:5\d)$/);
    await expect(chat.locator('[aria-current="step"]')).toHaveText('1. Clarify');

    await chat.getByRole('textbox', { name: 'Your answer' }).fill('How many new links a month, and what is the read to write ratio?');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByText(/reads outnumber writes 100 to 1/)).toBeVisible();
    // The hint comes as a toast in the corner, and stays in the panel's coaching list.
    const toasts = page.getByTestId('hint-toast');
    await expect(toasts).toHaveCount(1);
    await expect(toasts.first()).toHaveText('Ask how fast a redirect must be.');
    await expect(page.getByRole('status').filter({ hasText: 'Focus now' })).toBeVisible();

    await chat.getByRole('textbox', { name: 'Your answer' }).fill('Here is my design.');
    await chat.getByRole('button', { name: 'Send my design' }).click();
    await expect(chat.getByText(/What happens when the cache misses\?/)).toBeVisible();
    await expect(toasts).toHaveCount(2);
    await expect(toasts.last()).toHaveAttribute('data-kind', 'improve');
    await expect(chat.getByText('Design sent')).toBeVisible();
    await chat.getByRole('textbox', { name: 'Your answer' }).fill('The cache misses read the database, then set the code.');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByText('Good. Where is the bottleneck now?')).toBeVisible();
    // Never more than two at once: the oldest went.
    await expect(toasts).toHaveCount(2);
    await expect(toasts).toHaveText(['Explain the cache miss path and its p99.', 'Name the component that saturates first.']);
    const history = chat.getByTestId('coaching-history');
    await history.getByText('Coaching').click();
    await expect(history.getByTestId('coaching-card')).toHaveCount(3);
    await expect(history.getByTestId('coaching-card').first()).toContainText('Name the component that saturates first.');
    expect(mock.turns).toHaveLength(3);
    expect(mock.turns[0]).toEqual({ message: 'How many new links a month, and what is the read to write ratio?' });
    expect(mock.turns[1].message).toBe('Here is my design.');
    expect(mock.turns[1].design).toContain('import "problem.proschi"');

    // A reload resumes the session from the server.
    await page.reload();
    await expect(chat.getByText('Good. Where is the bottleneck now?')).toBeVisible();
    await expect(toasts).toHaveCount(0);
    await chat.getByTestId('coaching-history').getByText('Coaching').click();
    await expect(chat.getByTestId('coaching-history')).toContainText('Explain the cache miss path');
    await expect(chat.locator('[aria-current="step"]')).toHaveText('3. Design');

    await chat.getByRole('button', { name: 'Finish and get the verdict' }).click();
    await answerDialog(page, 'Finish');
    const verdict = page.getByRole('region', { name: 'Interview verdict' });
    await expect(verdict.getByTestId('verdict-result')).toHaveText('Pass');
    await expect(verdict.getByRole('row', { name: /Communication 5\/5/ })).toBeVisible();
    await expect(verdict.getByText(/storage estimate skipped the 5-year retention/)).toBeVisible();
    await expect(verdict.getByText('Try the Pastebin problem next')).toBeVisible();

    await verdict.getByRole('button', { name: 'Leave interview mode' }).click();
    await expect(page.getByRole('button', { name: 'Interview mode' })).toBeVisible();
  });

  for (const param of ['mock', 'ai'] as const) {
    test(`a deep link, #/<problem>?interview=${param}, opens interview mode with the mock interview chosen, starting nothing`, async ({ page }) => {
      await mockSignedIn(page);
      await mockInterviews(page, { replies: [] });
      const starts: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/interviews') starts.push(r.url());
      });
      await page.goto(`practice/#/url-shortener?interview=${param}`);
      const start = page.getByRole('region', { name: 'Interview mode' });
      await expect(start.getByRole('radio', { name: /Mock interview/ })).toHaveAttribute('aria-checked', 'true');
      await expect(start.getByRole('button', { name: 'Start a mock interview' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Mock interview', exact: true })).toHaveCount(0);
      expect(starts).toEqual([]);
      // Without the query, the same problem opens as usual: no interview mode.
      await page.goto('practice/#/');
      await page.goto('practice/#/url-shortener');
      await expect(page.getByRole('button', { name: 'Interview mode' })).toBeVisible();
    });
  }

  for (const choice of ['resume', 'replace'] as const) {
    test(`an interview already open: ${choice === 'resume' ? 'Resume it (the default)' : 'End it and start a new one'}`, async ({ page, errors }) => {
      await mockSignedIn(page);
      const mock = await mockInterviews(page, { replies: [], credits: 120, open: 'Welcome back: where were we on the read path?' });
      await page.addInitScript(() => localStorage.setItem('proschi.aiInterview.consent', 'true'));
      await page.goto('practice/#/url-shortener');
      await page.getByRole('button', { name: 'Interview mode' }).click();
      const start = page.getByRole('region', { name: 'Interview mode' });
      await start.getByRole('radio', { name: /Mock interview/ }).click();
      await start.getByRole('button', { name: 'Start a mock interview' }).click();

      const open = page.getByRole('region', { name: 'Mock interview in progress' });
      await expect(open.getByRole('heading', { name: 'You have a mock interview in progress' })).toBeVisible();
      await expect(open.getByRole('button', { name: 'Resume it' })).toBeFocused();
      await expect(open.getByText(/credits the old interview used are not returned/)).toBeVisible();
      const chat = page.getByRole('region', { name: 'Mock interview', exact: true });
      if (choice === 'resume') {
        await open.getByRole('button', { name: 'Resume it' }).click();
        await expect(chat.getByText('Welcome back: where were we on the read path?')).toBeVisible();
        expect(mock.starts).toEqual([{ replace: false, deep: false }]);
      } else {
        await open.getByRole('button', { name: 'End it and start a new one' }).click();
        await expect(chat.getByText(/Today we'll design URL Shortener/)).toBeVisible();
        await expect(chat.getByText('Welcome back: where were we on the read path?')).toHaveCount(0);
        expect(mock.starts).toEqual([{ replace: false, deep: false }, { replace: true, deep: false }]);
      }
      // The 409 active_session is expected; Chromium logs every non-2xx load.
      for (let i = errors.length - 1; i >= 0; i--) if (/status of 409/.test(errors[i])) errors.splice(i, 1);
    });
  }

  test('a start refused for want of credits (402 no_credits) says what it needs', async ({ page, errors }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [], credits: 50, needed: 70 });
    await page.addInitScript(() => localStorage.setItem('proschi.aiInterview.consent', 'true'));
    await page.goto('practice/#/url-shortener');
    await page.getByRole('button', { name: 'Interview mode' }).click();
    const start = page.getByRole('region', { name: 'Interview mode' });
    await start.getByRole('radio', { name: /Mock interview/ }).click();
    await start.getByRole('button', { name: 'Start a mock interview' }).click();
    await expect(start.getByTestId('ai-credits')).toContainText('You have 50 credits. A 45-minute mock interview takes at least 70.');
    await expect(start.getByRole('button', { name: 'Start a mock interview' })).toBeDisabled();
    // The 402 is expected; Chromium logs every non-2xx load.
    for (let i = errors.length - 1; i >= 0; i--) if (/status of 402/.test(errors[i])) errors.splice(i, 1);
  });

  test('out of credits mid-interview: a calm note, the wrap-up and the verdict', async ({ page }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [{ text: 'Let us wrap up: summarise your design.', phase: 'wrapup' }], runsOutAfter: 1 });
    await page.addInitScript(() => localStorage.setItem('proschi.aiInterview.consent', 'true'));
    await page.goto('practice/#/url-shortener');
    await page.getByRole('button', { name: 'Interview mode' }).click();
    const start = page.getByRole('region', { name: 'Interview mode' });
    await start.getByRole('radio', { name: /Mock interview/ }).click();
    await start.getByRole('button', { name: 'Start a mock interview' }).click();
    const chat = page.getByRole('region', { name: 'Mock interview', exact: true });
    await expect(chat.getByTestId('out-of-credits')).toHaveCount(0);
    await chat.getByRole('textbox', { name: 'Your answer' }).fill('How many links a month?');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByTestId('out-of-credits')).toHaveText(/out of credits, so the interviewer is wrapping up\. Your verdict is already paid for/);
    await expect(chat.locator('[aria-current="step"]')).toHaveText('4. Wrap-up');
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByTestId('account-credits')).toHaveAttribute('data-low', 'true');
    await page.keyboard.press('Escape');
    await chat.getByRole('button', { name: 'Finish and get the verdict' }).click();
    await answerDialog(page, 'Finish');
    await expect(page.getByRole('region', { name: 'Interview verdict' }).getByTestId('verdict-result')).toHaveText('Pass');
  });

  test('the scripted mode still starts by default, and too few credits offers a top-up instead of the AI start', async ({ page, errors }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [], credits: 12 });
    await page.goto('practice/#/url-shortener');
    await page.getByRole('button', { name: 'Interview mode' }).click();
    const start = page.getByRole('region', { name: 'Interview mode' });
    await start.getByRole('radio', { name: /Mock interview/ }).click();
    await expect(start.getByTestId('ai-credits')).toContainText('You have 12 credits. A 45-minute mock interview takes about 45–60.');
    await expect(start.getByRole('button', { name: 'Buy 1,000 credits, €12' })).toBeVisible();
    await expect(start.getByTestId('ai-upgrade')).toHaveAttribute('href', '../pricing/');
    await expect(start.getByRole('button', { name: 'Start a mock interview' })).toBeDisabled();
    expect(errors).toEqual([]);
    await start.getByRole('radio', { name: /On your own \(free\)/ }).click();
    await start.getByRole('button', { name: 'Start the interview' }).click();
    await expect(start.getByRole('button', { name: 'Ask: How fast must a redirect be?' })).toBeVisible();
  });

  test('voice input: the mic listens hands-free, shows the words as they come and says when it is blocked', async ({ page }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [{ text: 'About 100 million links a month.' }] });
    await fakeSpeech(page);
    const chat = await startInterview(page);
    const mic = chat.getByTestId('mic-button');
    const box = chat.getByRole('textbox', { name: 'Your answer' });
    await expect(mic).toHaveAttribute('data-state', 'idle');
    await mic.click();
    await expect(mic).toHaveAttribute('data-state', 'listening');
    await expect(mic).toContainText('Listening');
    // Interim words show in the composer, then the finished phrase stays.
    await page.evaluate(() => (window as unknown as { __speech: { say(t: string, f: boolean): void } }).__speech.say('how many links', false));
    await expect(box).toHaveValue('how many links');
    await page.evaluate(() => (window as unknown as { __speech: { say(t: string, f: boolean): void } }).__speech.say('How many links a month?', true));
    await expect(box).toHaveValue('How many links a month?');
    // The browser ends a session on its own; listening goes on.
    await page.evaluate(() => (window as unknown as { __speech: { current: { onend(): void } } }).__speech.current.onend());
    await expect.poll(() => page.evaluate(() => (window as unknown as { __speech: { starts: number } }).__speech.starts)).toBe(2);
    await expect(mic).toHaveAttribute('data-state', 'listening');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByText('About 100 million links a month.')).toBeVisible();
    await expect(mic).toHaveAttribute('data-state', 'idle');
    await expect(box).toHaveValue('');

    await page.evaluate(() => ((window as unknown as { __speech: { deny: boolean } }).__speech.deny = true));
    await mic.click();
    await expect(mic).toHaveAttribute('data-state', 'denied');
    await expect(chat.getByTestId('mic-note')).toContainText('The microphone is blocked');
  });

  test('the speaker reads replies aloud when on, is off by default and is remembered', async ({ page }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [{ text: 'About 100 million links a month.' }, { text: 'Go on.' }] });
    await fakeSynthesis(page);
    const chat = await startInterview(page);
    const speaker = chat.getByTestId('speaker-toggle');
    await expect(speaker).toHaveAttribute('aria-pressed', 'false');
    const box = chat.getByRole('textbox', { name: 'Your answer' });
    await box.fill('How many links?');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByText('About 100 million links a month.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toEqual([]);
    await speaker.click();
    await expect(speaker).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(chat.getByTestId('speaker-toggle')).toHaveAttribute('aria-pressed', 'true');
    await box.fill('And the reads?');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByText('Go on.')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toEqual(['Go on.']);
    // Typing stops the voice.
    const before = await page.evaluate(() => (window as unknown as { __cancels(): number }).__cancels());
    await box.fill('x');
    expect(await page.evaluate(() => (window as unknown as { __cancels(): number }).__cancels())).toBeGreaterThan(before);
  });
});

test.describe('AI interviewer on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the chat has its own Interview tab, and a reply on another tab says so with a way back', async ({ page }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [{ text: 'Seven of ten tests pass.', hint: { kind: 'improve', text: 'Explain the cache miss path.' } }] });
    const chat = await startInterview(page);
    const tab = page.getByTestId('tab-interview');
    await expect(tab).toHaveText('Interview');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    // The reply waits until the candidate has gone to the Code tab.
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route(/\/api\/interviews\/[^/]+\/turn$/, async (route) => {
      await gate;
      await route.fallback();
    });
    await chat.getByRole('textbox', { name: 'Your answer' }).fill('Here is my design.');
    await chat.getByRole('button', { name: 'Send my design' }).click();
    await page.getByRole('tab', { name: 'Code' }).click();
    await expect(chat).toBeHidden();
    release();
    const toast = page.getByRole('status').filter({ hasText: 'The interviewer replied' });
    await expect(toast).toBeVisible();
    await expect(page.getByTestId('hint-toast')).toHaveText('Explain the cache miss path.');
    await toast.getByRole('button', { name: 'Open the interview' }).click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(chat.getByText('Seven of ten tests pass.')).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });
});
