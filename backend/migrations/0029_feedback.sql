-- Messages to the operator from the app's "Send feedback" (src/feedback.ts):
-- a bug, a question, a proposal or anything else, from signed-in users only,
-- read in the admin panel's Inbox. No email goes out and there is no reply
-- thread. Deleting the account deletes its messages (ON DELETE CASCADE) and,
-- first, their screenshots in R2 (FEEDBACK_BUCKET). Times are Unix seconds.
CREATE TABLE feedback_messages (
  -- A random UUID.
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'question', 'proposal', 'other')),
  -- Optional, up to 200 characters; the message up to 5,000. Plain text.
  subject TEXT,
  message TEXT NOT NULL,
  -- JSON {path, userAgent, viewport, plan, version}: what the dialog showed
  -- the user before sending, and the deployed version.
  context TEXT NOT NULL,
  -- The editor's or practice problem's source, only when the user ticked
  -- "Attach my current diagram"; at most 64 KiB.
  diagram TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done')),
  -- The operator's internal note: never shown to the user nor in their export.
  note TEXT,
  created_at INTEGER NOT NULL,
  -- When the operator first opened it; NULL is unread.
  read_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX feedback_messages_created ON feedback_messages (created_at);
CREATE INDEX feedback_messages_user ON feedback_messages (user_id, created_at);
CREATE INDEX feedback_messages_status ON feedback_messages (status, created_at);

-- A message's screenshots (PNG, JPEG or WebP, up to 3 of 5 MB each), stored
-- in R2 under a random key and served only to the admin.
CREATE TABLE feedback_files (
  key TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES feedback_messages (id) ON DELETE CASCADE,
  -- Kept so the account's objects can be found and deleted before the account.
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes INTEGER NOT NULL,
  position INTEGER NOT NULL
);

CREATE INDEX feedback_files_message ON feedback_files (message_id, position);
CREATE INDEX feedback_files_user ON feedback_files (user_id);
