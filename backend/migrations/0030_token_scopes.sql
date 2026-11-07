-- Scopes of app and CLI tokens (docs/design/paid-plans.md P42, src/scopes.ts):
-- what a bearer token may reach, space-separated (RFC 6749 3.3). A cookie
-- session has every right and no scopes (NULL for kind 'web').
ALTER TABLE sessions ADD COLUMN scopes TEXT;
ALTER TABLE app_auth_codes ADD COLUMN scopes TEXT;

-- The tokens from before scopes keep what the CLI and the editor extensions
-- use: the account's name and the synced diagrams with their versions, read only.
UPDATE sessions SET scopes = 'profile:read documents:read' WHERE kind IN ('app_access', 'app_refresh');
UPDATE app_auth_codes SET scopes = 'profile:read documents:read';

