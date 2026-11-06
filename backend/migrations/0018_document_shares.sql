-- Live share links (/share/<token>, src/documentShares.ts): a Pro user's
-- private, revocable, read-only link to one of their synced diagrams. Unlike
-- a short link (0010, `shares`), which is a snapshot, it shows the diagram as
-- it is now. At most one live link per diagram; a revoked one stays (with
-- revoked_at) so its token is never handed out again. Deleting the diagram
-- row or the account deletes its links (ON DELETE CASCADE). Times are Unix
-- milliseconds, like documents'.
CREATE TABLE document_shares (
  -- 16 random bytes in base64url: 22 characters, 128 bits.
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- Revoked at this time; NULL while the link works.
  revoked_at INTEGER,
  FOREIGN KEY (user_id, document_id) REFERENCES documents (user_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX document_shares_live ON document_shares (user_id, document_id) WHERE revoked_at IS NULL;
