import { describe, expect, it } from 'vitest';
import { arcadeChallengeText, arcadeShareText, badgeShareText, multiple, problemLink, profileLink, profileShareText, solveShareText, waveMark } from './share';

describe('arcade share text', () => {
  it('has the day, a square per wave, the score and the rank', () => {
    expect(arcadeShareText({ day: '2026-10-06', waves: ['clean', 'clean', 'hit', 'lost'], score: 12340, rank: 7 })).toBe(
      'Proschi Scale or Fail · daily 2026-10-06\n🟩🟩🟨🟥\nScore 12,340 · #7 today\nhttps://proschi.app/practice/#/arcade/daily',
    );
  });

  it('leaves out a rank it does not have', () => {
    expect(arcadeShareText({ day: '2026-10-06', waves: ['clean'], score: 900, rank: null })).toBe(
      'Proschi Scale or Fail · daily 2026-10-06\n🟩\nScore 900\nhttps://proschi.app/practice/#/arcade/daily',
    );
    expect(arcadeShareText({ day: '2026-10-06', waves: [], score: 0 })).toBe('Proschi Scale or Fail · daily 2026-10-06\nScore 0\nhttps://proschi.app/practice/#/arcade/daily');
  });

  it('marks a wave by how it went', () => {
    expect(waveMark({ clean: true, survived: true })).toBe('clean');
    expect(waveMark({ clean: false, survived: true })).toBe('hit');
    expect(waveMark({ clean: false, survived: false })).toBe('lost');
  });

  it('dares a friend to beat the score', () => {
    expect(arcadeChallengeText(12340)).toBe('Beat my score: 12,340 in today’s Proschi Scale or Fail daily run. https://proschi.app/practice/#/arcade/daily');
  });
});

describe('solve share text', () => {
  it('compares the cost to the reference and gives the p99', () => {
    expect(solveShareText({ id: 'ticket-booking', title: 'Ticket Booking', costUsd: 400, referenceCostUsd: 500, p99Ms: 140 })).toBe(
      'I solved Ticket Booking on Proschi at 0.8× the reference cost and p99 140 ms\nhttps://proschi.app/practice/ticket-booking/',
    );
  });

  it('says what it knows', () => {
    expect(solveShareText({ id: 'pastebin', title: 'Pastebin', p99Ms: 8.46 })).toBe('I solved Pastebin on Proschi with p99 8.5 ms\nhttps://proschi.app/practice/pastebin/');
    expect(solveShareText({ id: 'pastebin', title: 'Pastebin', costUsd: 30, referenceCostUsd: 20 })).toBe('I solved Pastebin on Proschi at 1.5× the reference cost\nhttps://proschi.app/practice/pastebin/');
    expect(solveShareText({ id: 'pastebin', title: 'Pastebin', costUsd: 30, referenceCostUsd: 0, p99Ms: 1500 })).toBe('I solved Pastebin on Proschi with p99 1.5 s\nhttps://proschi.app/practice/pastebin/');
    expect(solveShareText({ id: 'pastebin', title: 'Pastebin' })).toBe('I solved Pastebin on Proschi\nhttps://proschi.app/practice/pastebin/');
  });

  it('writes multiples briefly', () => {
    expect(multiple(0.8)).toBe('0.8×');
    expect(multiple(1)).toBe('1×');
    expect(multiple(1.25)).toBe('1.3×');
    expect(multiple(12.4)).toBe('12×');
    expect(multiple(0.05)).toBe('0.05×');
  });
});

describe('links and badges', () => {
  it('links profiles and problems at their own addresses', () => {
    expect(profileLink('a1-b2')).toBe('https://proschi.app/u/a1-b2');
    expect(problemLink('url-shortener')).toBe('https://proschi.app/practice/url-shortener/');
  });

  it('shares a badge with the public profile', () => {
    expect(badgeShareText({ title: 'Hundred club', userId: 'u1' })).toBe('I earned the “Hundred club” badge on Proschi\nhttps://proschi.app/u/u1');
  });

  it('shares a profile, one’s own or someone else’s', () => {
    expect(profileShareText({ displayName: 'Ada', userId: 'u1', own: true })).toBe('My system design practice on Proschi\nhttps://proschi.app/u/u1');
    expect(profileShareText({ displayName: 'Ada', userId: 'u1', own: false })).toBe('Ada on Proschi\nhttps://proschi.app/u/u1');
  });
});
