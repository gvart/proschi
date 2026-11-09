import type { AppClient } from './apptokens';
import { CLI_CLIENT } from './apptokens';
import { HttpError } from './http';

/**
 * What an app's or the CLI's bearer token may reach (docs/design/paid-plans.md
 * P42). A cookie session has every right; a bearer token only the routes of
 * TOKEN_ROUTES, and of those only the ones its scopes name. Everything else
 * (billing, credits, mock interviews, the Design partner, the admin panel,
 * account deletion and export, email and sign-in changes, campaigns,
 * feedback, short links) answers it 403 before any handler runs, whatever the
 * token's scopes (src/index.ts route).
 */
export const TOKEN_SCOPES = ['profile:read', 'documents:read', 'documents:write', 'progress'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** What the `proschi` CLI, its language server and the editor extensions use: the account's name, and the synced diagrams with their versions (cloud imports, `proschi versions`). */
export const CLI_SCOPES: readonly TokenScope[] = ['profile:read', 'documents:read'];
/** A native app's (client=app): practice progress and diagram sync too. */
export const APP_SCOPES: readonly TokenScope[] = TOKEN_SCOPES;

export const scopesFor = (client: AppClient | undefined): readonly TokenScope[] => (client === CLI_CLIENT ? CLI_SCOPES : APP_SCOPES);

/** A route open to anyone: a bearer token is let through, and read if the route reads one. */
export const PUBLIC = 'public';

/**
 * Every route a bearer token may reach, with the scope it needs (or PUBLIC).
 * Matched like src/index.ts's routes: `*` is one path part.
 * test/scopes.test.ts runs every route of the Worker with a token.
 */
export const TOKEN_ROUTES: readonly (readonly [method: string, path: string, scope: TokenScope | typeof PUBLIC])[] = [
  ['POST', 'auth/token', PUBLIC],
  ['POST', 'auth/revoke', PUBLIC],
  ['GET', 'auth/providers', PUBLIC],
  ['GET', 'api/health', PUBLIC],
  ['GET', 'api/credits/estimates', PUBLIC],
  ['GET', 'api/stats', PUBLIC],
  ['GET', 'api/stats/*', PUBLIC],
  ['GET', 'api/leaderboard', PUBLIC],
  ['GET', 'api/users/*/profile', PUBLIC],
  ['GET', 'api/certificates/*', PUBLIC],
  ['GET', 'api/problems/*/leaderboard', PUBLIC],
  ['GET', 'api/challenge/today', PUBLIC],
  ['GET', 'api/challenge/leaderboard', PUBLIC],
  ['GET', 'api/game/leaderboard', PUBLIC],
  ['GET', 'api/share/*', PUBLIC],
  ['GET', 'api/shares/*', PUBLIC],
  ['GET', 'api/oembed', PUBLIC],
  ['GET', 's/*', PUBLIC],
  ['HEAD', 's/*', PUBLIC],
  ['POST', 'api/metrics', PUBLIC],

  ['GET', 'api/me', 'profile:read'],
  ['GET', 'api/me/limits', 'profile:read'],

  ['GET', 'api/me/documents', 'documents:read'],
  ['GET', 'api/me/documents/*/versions', 'documents:read'],
  ['GET', 'api/me/documents/*/versions/*', 'documents:read'],
  ['GET', 'api/me/versions/resolve', 'documents:read'],
  ['PUT', 'api/me/documents/*', 'documents:write'],
  ['DELETE', 'api/me/documents/*', 'documents:write'],
  ['POST', 'api/me/documents/*/versions', 'documents:write'],
  ['DELETE', 'api/me/documents/*/versions/*', 'documents:write'],

  ['POST', 'api/problems/*/runs', 'progress'],
  ['POST', 'api/me/import', 'progress'],
  ['POST', 'api/me/lessons', 'progress'],
  ['GET', 'api/me/mistakes', 'progress'],
  ['POST', 'api/me/mistakes', 'progress'],
  ['GET', 'api/me/activity', 'progress'],
  ['GET', 'api/me/achievements', 'progress'],
  ['POST', 'api/me/achievements/seen', 'progress'],
  ['GET', 'api/cards/state', 'progress'],
  ['POST', 'api/cards/reviews', 'progress'],
  ['POST', 'api/challenge/today/start', 'progress'],
  ['POST', 'api/challenge/today/attempt', 'progress'],
  ['GET', 'api/game/me', 'progress'],
  ['POST', 'api/game/runs', 'progress'],
  ['POST', 'api/game/runs/*/submit', 'progress'],
  ['POST', 'api/game/buy', 'progress'],
  ['POST', 'api/game/equip', 'progress'],
  ['POST', 'api/game/sync', 'progress'],
] as const;

/** The scope a bearer token needs for `method` on `parts` (PUBLIC for an open route), or undefined: no token may. */
export function tokenRoute(method: string, parts: string[]): TokenScope | typeof PUBLIC | undefined {
  const found = TOKEN_ROUTES.find(([m, path]) => {
    const want = path.split('/');
    return m === method && want.length === parts.length && want.every((p, i) => p === '*' || p === parts[i]);
  });
  return found?.[2];
}

/** Scopes as stored (space-separated); unknown names are dropped. */
export function parseScopes(text: string | null | undefined): TokenScope[] {
  return (text ?? '').split(' ').filter((s): s is TokenScope => (TOKEN_SCOPES as readonly string[]).includes(s));
}

/** The 403 for a bearer token on a route its scopes don't reach (RFC 6750 3.1). */
export function insufficientScope(scope?: TokenScope): HttpError {
  return new HttpError(403, "This app sign-in can't be used for that; sign in on the site", {
    'WWW-Authenticate': `Bearer error="insufficient_scope"${scope ? `, scope="${scope}"` : ''}`,
  });
}
