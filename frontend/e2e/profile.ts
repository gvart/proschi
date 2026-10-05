import type { Page } from '@playwright/test';

/** A public profile as GET /api/users/<id>/profile answers it (the e2e build has no API, so tests mock it). */
export const PROFILE = {
  id: '0b5e6f1c-4a7d-4c1e-9d3a-2f8e7a6b5c4d',
  displayName: 'Ada Lovelace',
  memberSince: 1_767_225_600,
  solved: [
    { id: 'url-shortener', difficulty: 'easy' },
    { id: 'pastebin', difficulty: 'easy' },
  ],
  streak: { current: 4, longest: 12 },
  challenge: { current: 2, longest: 6, best: 540 },
  readiness: 0.37,
  topics: [
    { topic: 'caching', mastery: 0.6 },
    { topic: 'estimation', mastery: 0.25 },
  ],
  badges: [
    { id: 'first-card', earnedAt: 1_767_312_000 },
    { id: 'first-solve', earnedAt: 1_767_398_400 },
  ],
};

/** Answers the profile API for PROFILE's id from `page`'s requests. */
export async function mockProfile(page: Page): Promise<void> {
  await page.route(`**/api/users/${PROFILE.id}/profile`, (route) => route.fulfill({ json: PROFILE, headers: { 'Cache-Control': 'no-store' } }));
}
