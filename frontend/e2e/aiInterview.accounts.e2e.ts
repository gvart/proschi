import { mockSignedIn } from './accounts';
import { mockInterviews } from './aiInterview';
import { expect, test } from './fixtures';

/**
 * The AI interviewer in interview mode (build with accounts, API mocked):
 * pick it on the start screen, agree once to what is sent, talk over two
 * turns with a coaching card, send the design, resume after a reload, finish
 * and read the verdict. The scripted mode stays the default.
 */
test.describe('AI interviewer', () => {
  test('a full session: start, two turns with a hint, resume, finish and the verdict', async ({ page }) => {
    await mockSignedIn(page);
    const mock = await mockInterviews(page, {
      replies: [
        { text: 'About 100 million new links a month, and reads outnumber writes 100 to 1.', hint: { kind: 'focus', text: 'Ask how fast a redirect must be.' } },
        { text: 'Seven of ten tests pass. What happens when the cache misses?', hint: { kind: 'improve', text: 'Explain the cache miss path and its p99.' }, phase: 'design' },
      ],
    });
    await page.goto('practice/#/url-shortener');
    await page.getByRole('button', { name: 'Interview mode' }).click();

    const start = page.getByRole('region', { name: 'Interview mode' });
    await expect(start.getByRole('radio', { name: /Scripted \(free\)/ })).toHaveAttribute('aria-checked', 'true');
    await start.getByRole('radio', { name: /AI interviewer/ }).click();
    await expect(start.getByTestId('ai-credits')).toHaveText('1 interview left');
    await expect(start.getByTestId('ai-upgrade')).toHaveAttribute('href', '../pricing/');
    await start.getByRole('button', { name: 'Start the AI interview' }).click();

    // The one-time consent names what goes to the AI provider.
    const consent = page.getByRole('region', { name: 'AI interviewer consent' });
    await expect(consent.getByText(/Proschi sends Anthropic/)).toBeVisible();
    await expect(consent.getByText(/90 days/)).toBeVisible();
    await consent.getByRole('button', { name: 'I agree, start the interview' }).click();

    const chat = page.getByRole('region', { name: 'AI interview', exact: true });
    await expect(chat.getByText(/Today we'll design URL Shortener/)).toBeVisible();
    await expect(chat.getByRole('timer', { name: 'Time left' })).toHaveText(/^(45:00|44:5\d)$/);
    await expect(chat.locator('[aria-current="step"]')).toHaveText('1. Clarify');

    await chat.getByRole('textbox', { name: 'Your answer' }).fill('How many new links a month, and what is the read to write ratio?');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByText(/reads outnumber writes 100 to 1/)).toBeVisible();
    await expect(chat.getByTestId('coaching-card')).toContainText('Focus now');
    await expect(chat.getByTestId('coaching-card')).toContainText('Ask how fast a redirect must be.');

    await chat.getByRole('textbox', { name: 'Your answer' }).fill('Here is my design.');
    await chat.getByRole('button', { name: 'Send my design' }).click();
    await expect(chat.getByText(/What happens when the cache misses\?/)).toBeVisible();
    await expect(chat.getByTestId('coaching-card')).toContainText('Can improve');
    await expect(chat.getByText('Design sent')).toBeVisible();
    expect(mock.turns).toHaveLength(2);
    expect(mock.turns[0]).toEqual({ message: 'How many new links a month, and what is the read to write ratio?' });
    expect(mock.turns[1].message).toBe('Here is my design.');
    expect(mock.turns[1].design).toContain('import "problem.proschi"');

    // A reload resumes the session from the server.
    await page.reload();
    await expect(chat.getByText(/What happens when the cache misses\?/)).toBeVisible();
    await expect(chat.getByTestId('coaching-card')).toContainText('Explain the cache miss path');
    await expect(chat.locator('[aria-current="step"]')).toHaveText('3. Design');

    page.once('dialog', (d) => void d.accept());
    await chat.getByRole('button', { name: 'Finish and get the verdict' }).click();
    const verdict = page.getByRole('region', { name: 'Interview verdict' });
    await expect(verdict.getByTestId('verdict-result')).toHaveText('Pass');
    await expect(verdict.getByRole('row', { name: /Communication 5\/5/ })).toBeVisible();
    await expect(verdict.getByText(/storage estimate skipped the 5-year retention/)).toBeVisible();
    await expect(verdict.getByText('Try the Pastebin problem next')).toBeVisible();

    await verdict.getByRole('button', { name: 'Leave interview mode' }).click();
    await expect(page.getByRole('button', { name: 'Interview mode' })).toBeVisible();
  });

  for (const choice of ['resume', 'replace'] as const) {
    test(`an interview already open: ${choice === 'resume' ? 'Resume it (the default)' : 'End it and start a new one'}`, async ({ page, errors }) => {
      await mockSignedIn(page);
      const mock = await mockInterviews(page, { replies: [], credits: 2, open: 'Welcome back: where were we on the read path?' });
      await page.addInitScript(() => localStorage.setItem('proschi.aiInterview.consent', 'true'));
      await page.goto('practice/#/url-shortener');
      await page.getByRole('button', { name: 'Interview mode' }).click();
      const start = page.getByRole('region', { name: 'Interview mode' });
      await start.getByRole('radio', { name: /AI interviewer/ }).click();
      await start.getByRole('button', { name: 'Start the AI interview' }).click();

      const open = page.getByRole('region', { name: 'AI interview in progress' });
      await expect(open.getByRole('heading', { name: 'You have an AI interview in progress' })).toBeVisible();
      await expect(open.getByRole('button', { name: 'Resume it' })).toBeFocused();
      await expect(open.getByText(/credit is not returned/)).toBeVisible();
      const chat = page.getByRole('region', { name: 'AI interview', exact: true });
      if (choice === 'resume') {
        await open.getByRole('button', { name: 'Resume it' }).click();
        await expect(chat.getByText('Welcome back: where were we on the read path?')).toBeVisible();
        expect(mock.starts).toEqual([{ replace: false }]);
      } else {
        await open.getByRole('button', { name: 'End it and start a new one' }).click();
        await expect(chat.getByText(/Today we'll design URL Shortener/)).toBeVisible();
        await expect(chat.getByText('Welcome back: where were we on the read path?')).toHaveCount(0);
        expect(mock.starts).toEqual([{ replace: false }, { replace: true }]);
      }
      // The 409 active_session is expected; Chromium logs every non-2xx load.
      for (let i = errors.length - 1; i >= 0; i--) if (/status of 409/.test(errors[i])) errors.splice(i, 1);
    });
  }

  test('the scripted mode still starts by default, and no credits disables the AI start', async ({ page }) => {
    await mockSignedIn(page);
    await mockInterviews(page, { replies: [], credits: 0 });
    await page.goto('practice/#/url-shortener');
    await page.getByRole('button', { name: 'Interview mode' }).click();
    const start = page.getByRole('region', { name: 'Interview mode' });
    await start.getByRole('radio', { name: /AI interviewer/ }).click();
    await expect(start.getByTestId('ai-credits')).toHaveText('0 interviews left');
    await expect(start.getByRole('button', { name: 'Start the AI interview' })).toBeDisabled();
    await start.getByRole('radio', { name: /Scripted \(free\)/ }).click();
    await start.getByRole('button', { name: 'Start the interview' }).click();
    await expect(start.getByRole('button', { name: 'Ask: How fast must a redirect be?' })).toBeVisible();
  });
});
