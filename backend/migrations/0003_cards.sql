-- Daily review of practice cards (docs/CARDS.md). Times are Unix seconds.

-- Every review a user made, as the client sent it; rows are only ever added.
-- The client makes the id (a UUID), so a review sent twice, e.g. retried
-- after a dropped connection, is stored once. Ids are per user, so one
-- user's ids never collide with another's.
CREATE TABLE card_reviews (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The card's file name (frontend/src/practice/cards/<topic>/<id>.md).
  card_id TEXT NOT NULL,
  -- The card's `version` when it was reviewed; a review of a higher one starts the card over.
  card_version INTEGER NOT NULL,
  -- 1 again, 2 hard, 3 good, 4 easy.
  rating INTEGER NOT NULL,
  reviewed_at INTEGER NOT NULL,
  -- From showing the card to answering it.
  duration_ms INTEGER,
  -- The user's local date of the review, YYYY-MM-DD, for the daily counts.
  day TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX card_reviews_user ON card_reviews (user_id, reviewed_at);
-- Replaying one card's reviews after new ones arrive.
CREATE INDEX card_reviews_user_card ON card_reviews (user_id, card_id, reviewed_at);

-- Per user and card: the scheduler's state (frontend/src/learn/fsrs.ts),
-- derived from card_reviews by replaying them, so it can always be rebuilt.
CREATE TABLE card_state (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  card_version INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  -- Days until the chance of recall falls to 90%.
  stability REAL NOT NULL,
  -- 1 (easy) to 10 (hard).
  difficulty REAL NOT NULL,
  reps INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  last_review_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, card_id)
);
