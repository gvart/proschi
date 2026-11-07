import type { CampaignDraft } from './api';

/**
 * The launch campaign's draft ("Use launch template" in the composer, never
 * seeded on its own): a gift of credits to every account, by email and in
 * the app, announcing mock interviews, Design partner and the plans. In the
 * site's voice: plain, short, no "AI" in the names (docs/design/paid-plans.md P25).
 */
export const LAUNCH_TEMPLATE: CampaignDraft = {
  audience: { type: 'all' },
  credits: 150,
  email: true,
  inapp: true,
  subject: '{{credits}} credits are on your Proschi account',
  body: `Hi {{name}},

Thanks for practicing on Proschi early. Two new things to try, and **{{credits}} credits are on your account** to try them with. They never expire.

- **Mock interviews.** A 45-minute system design interview with an interviewer who asks follow-ups, pushes on trade-offs and ends with a verdict.
- **Design partner.** A chat beside your diagram that reviews it, answers questions and proposes changes you can accept or reject, each checked against the simulation first.

The editor, the simulation and every practice problem stay free. The new features run on credits: Free gets 100 once, Pro 800 a month, Max 2,200 a month. You see the estimate before you start and the real cost after.

[See the plans](https://proschi.app/pricing/)`,
  linkUrl: 'https://proschi.app/practice/',
  linkLabel: 'Try a mock interview',
};
