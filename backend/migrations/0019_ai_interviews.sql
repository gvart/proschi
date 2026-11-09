-- AI mock interviews (src/interviews.ts, docs/design/paid-plans.md P3–P8).
-- Each session spends one credit (src/credits.ts, ref_id = the session id).
-- Transcripts are kept for 90 days, then the daily cron (src/cron.ts)
-- deletes the messages and clears `state`, which holds the transcript and the
-- last design, and keeps the verdict for history (P8). Deleting the account
-- deletes everything here (ON DELETE CASCADE). Times are Unix milliseconds.
CREATE TABLE ai_interviews (
  -- A random UUID; also the credit's ref_id.
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  -- active: turns can be taken; finishing: the verdict is being written;
  -- finished: it has a verdict; failed: the model failed early and the credit
  -- was refunded; abandoned: a newer session replaced it.
  status TEXT NOT NULL CHECK (status IN ('active', 'finishing', 'finished', 'failed', 'abandoned')),
  -- The interviewer's state (src/ai/interviewer.ts InterviewState) as JSON;
  -- NULL once past the 90-day retention.
  state TEXT,
  -- Bumped by every saved turn, so two turns at once can't both be kept.
  version INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  -- Input-equivalent tokens (src/ai/budget.ts billedTokens) and the cost in USD so far.
  tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  -- The verdict ({passed, scores, wentWell, wentWrong, nextSteps}) as JSON, once finished.
  verdict TEXT
);

CREATE INDEX ai_interviews_user ON ai_interviews (user_id, started_at);
CREATE INDEX ai_interviews_started ON ai_interviews (started_at);

-- The transcript as the candidate saw it: the interviewer's replies (with
-- the coaching hint that came with each) and the candidate's own words.
CREATE TABLE ai_interview_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id TEXT NOT NULL REFERENCES ai_interviews (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('interviewer', 'candidate')),
  text TEXT NOT NULL,
  -- {kind: focus|improve|wrapup, text} on an interviewer reply; NULL without one.
  hint TEXT,
  -- 1 when the candidate's turn sent the design.
  design INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);

CREATE INDEX ai_interview_messages_interview ON ai_interview_messages (interview_id, id);
CREATE INDEX ai_interview_messages_at ON ai_interview_messages (at);
