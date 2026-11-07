import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Row } from './settingsUi';

/** A running app or CLI sign-in (GET /api/me/apps, backend/src/apptokens.ts). */
export interface AppSignIn {
  id: string;
  scopes: string[];
  /** Unix seconds. */
  createdAt: number;
  expiresAt: number;
}

/** What each token scope lets an app do (backend/src/scopes.ts). */
export const SCOPE_LABEL: Record<string, string> = {
  'profile:read': 'read your name',
  'documents:read': 'read your synced diagrams',
  'documents:write': 'change your synced diagrams',
  progress: 'record practice progress',
};

/** "Can read your name and read your synced diagrams." */
export function scopesText(scopes: string[]): string {
  const parts = scopes.map((s) => SCOPE_LABEL[s] ?? s);
  if (!parts.length) return 'Can only read public pages.';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `Can ${list}.`;
}

const dateOf = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Settings › Connected accounts: the `proschi` command line tool, editor
 * extensions and apps signed in to the account, each with what its tokens
 * may do. None of them ever reaches billing, credits, the AI features or
 * account changes (docs/design/paid-plans.md P42). "Sign out everywhere"
 * (Data & privacy) ends them all.
 */
export function AppSignIns() {
  const [apps, setApps] = useState<AppSignIn[] | null>(null);
  useEffect(() => {
    let live = true;
    api<{ apps: AppSignIn[] }>('/api/me/apps').then(
      (r) => live && setApps(r.apps),
      () => live && setApps([]),
    );
    return () => {
      live = false;
    };
  }, []);
  if (!apps?.length) return null;
  return (
    <Row label="Apps and command line" help="Signed in with the proschi command line tool, an editor extension or an app. They never reach billing, credits, mock interviews or your account settings.">
      <ul className="mt-3 space-y-2 text-sm" aria-label="App sign-ins">
        {apps.map((a) => (
          <li key={a.id} className="rounded-sm border-bw-1 border-ink/20 p-3">
            <span className="font-semibold text-ink">Signed in {dateOf(a.createdAt)}</span>
            <span className="text-muted"> · until {dateOf(a.expiresAt)} unless used</span>
            <p className="mt-0.5 text-ink/80">{scopesText(a.scopes)}</p>
          </li>
        ))}
      </ul>
    </Row>
  );
}
