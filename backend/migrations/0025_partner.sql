-- Design partner chats (src/partner.ts, docs/design/paid-plans.md P29, P30;
-- backend/README.md "Design partner"). A session is one chat in the editor or on a
-- practice problem; its turns are the user's messages and the partner's
-- answers, and its changes the edits the partner proposed. Transcripts are
-- kept for 90 days after the session was last used, then the daily cron
-- (src/cron.ts) deletes the session with its turns and changes (P8). Deleting
-- the account deletes everything here (ON DELETE CASCADE). Times are Unix
-- milliseconds.
CREATE TABLE partner_sessions (
  -- A random UUID.
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- 'editor' or 'practice'; a practice session has its problem id.
  context_kind TEXT NOT NULL CHECK (context_kind IN ('editor', 'practice')),
  problem_id TEXT,
  -- 1: Deep mode (Max, P31), the turns run on Opus.
  deep INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  -- The last turn's time; the 90 days count from here.
  updated_at INTEGER NOT NULL,
  -- One turn at a time: a turn claims the session until this time before it
  -- calls the model, and another turn meanwhile answers 409
  -- turn_in_progress. NULL when no turn is running.
  turning_until INTEGER
);

CREATE INDEX partner_sessions_user ON partner_sessions (user_id, created_at);
CREATE INDEX partner_sessions_updated ON partner_sessions (updated_at);

CREATE TABLE partner_turns (
  -- A random UUID.
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES partner_sessions (id) ON DELETE CASCADE,
  -- The turn's place in its session, from 1.
  n INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'partner')),
  -- review, build, chat, improve or solve (the user's turn's, and its answer's).
  intent TEXT NOT NULL,
  -- Markdown.
  message TEXT NOT NULL,
  -- [{id, text, options?}] as JSON on a partner turn that asks; NULL otherwise.
  questions TEXT,
  -- 1 on a practice partner turn with changes (P30).
  assisted INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  UNIQUE (session_id, n)
);

CREATE TABLE partner_changes (
  -- A random UUID.
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES partner_sessions (id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES partner_turns (id) ON DELETE CASCADE,
  -- Its place in its turn, from 0.
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  why TEXT NOT NULL,
  -- [{find, replace}] as JSON.
  edits TEXT NOT NULL,
  -- The server's check of it ({ok: true, source, summary, before, after} or {ok: false, reason}) as JSON.
  result TEXT NOT NULL,
  -- 'accepted' or 'rejected' once the user decided; NULL before.
  decision TEXT CHECK (decision IN ('accepted', 'rejected')),
  -- 1 once the decision was told to the model in a later turn.
  fed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX partner_changes_session ON partner_changes (session_id, turn_id, position);
