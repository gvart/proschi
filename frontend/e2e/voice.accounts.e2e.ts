import type { Page } from '@playwright/test';
import { mockSignedIn, SIGNED_IN } from './accounts';
import { expect, test } from './fixtures';
import { PartnerMock } from './partner';

/**
 * The mic button (src/voice/MicButton.tsx) in the Design partner composer,
 * with a fake Web Speech recognizer: recording never changes its size or
 * moves the composer. With VOICE_SHOTS=<dir>, saves the mic idle and
 * recording, light and dark.
 */

const SHOTS = process.env.VOICE_SHOTS;

async function fakeSpeech(page: Page) {
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onstart: (() => void) | null = null;
      start() {
        setTimeout(() => this.onstart?.(), 10);
      }
      stop() {
        setTimeout(() => this.onend?.(), 10);
      }
      abort() {
        this.stop();
      }
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
  });
}

test('recording keeps the mic 36x36 and the composer still', async ({ page }) => {
  await fakeSpeech(page);
  await mockSignedIn(page, SIGNED_IN);
  await new PartnerMock().mock(page);
  await page.goto('app/?example=url-shortener');
  await page.getByTestId('partner-button').click();
  const panel = page.getByRole('region', { name: 'Design partner' });
  const mic = panel.getByTestId('mic-button');
  const send = panel.getByRole('button', { name: 'Send' });
  const field = panel.getByRole('textbox', { name: 'Message Design partner' });
  await expect(mic).toHaveAttribute('data-state', 'idle');
  const boxes = () => Promise.all([mic.boundingBox(), send.boundingBox(), field.boundingBox()]);
  const before = await boxes();
  expect(before[0]).toMatchObject({ width: 36, height: 36 });
  if (SHOTS) await shoot(page, mic, 'mic-idle');

  await mic.click();
  await expect(mic).toHaveAttribute('data-state', 'listening');
  await expect(mic).toHaveAttribute('aria-label', /Listening/);
  await expect(mic).toHaveText('');
  expect(await boxes()).toEqual(before);
  if (SHOTS) await shoot(page, mic, 'mic-recording');

  await mic.click();
  await expect(mic).toHaveAttribute('data-state', 'idle');
  expect(await boxes()).toEqual(before);
});

async function shoot(page: Page, mic: ReturnType<Page['getByTestId']>, name: string) {
  const composer = mic.locator('xpath=ancestor::form[1]');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    await composer.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
    const box = (await mic.boundingBox())!;
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}-zoom.png`, clip: { x: box.x - 60, y: box.y - 12, width: box.width + 120, height: box.height + 24 } });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}
