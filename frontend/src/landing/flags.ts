/**
 * Copy in index.html that is true only in some builds: `<!--if:accounts-->…<!--/if-->`
 * (VITE_ACCOUNTS: sign-in and sync) and `<!--if:billing-->…<!--/if-->` (paid
 * plans and credits, VITE_BILLING with accounts, as services/billing.ts
 * billingEnabled). Kept without its markers when the flag is on, dropped
 * otherwise, at build time (vite.config.ts), so a build never mentions what
 * it doesn't have.
 */

export type Flags = Record<'accounts' | 'billing', boolean>;

export const flagsFromEnv = (env: Record<string, string | undefined>): Flags => {
  const accounts = env.VITE_ACCOUNTS === 'true';
  return { accounts, billing: accounts && env.VITE_BILLING === 'true' };
};

export function fillFlagBlocks(html: string, flags: Flags): string {
  return html.replace(/<!--if:([a-z]+)-->([\s\S]*?)<!--\/if-->/g, (_, name: string, body: string) => {
    if (!(name in flags)) throw new Error(`index.html: unknown flag <!--if:${name}-->`);
    return flags[name as keyof Flags] ? body : '';
  });
}
