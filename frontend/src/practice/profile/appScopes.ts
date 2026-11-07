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
