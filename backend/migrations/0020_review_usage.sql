-- AI design reviews a user asked for, per UTC day (POST /api/review,
-- src/review.ts; docs/design/paid-plans.md P17): Pro gets 20 a day. A review
-- is counted before the model is called, with an increment that only
-- happens under the cap, and given back when the call fails. Part of
-- Download my data; deleted with the account (ON DELETE CASCADE).
CREATE TABLE review_usage (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- YYYY-MM-DD, UTC.
  day TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (user_id, day)
);
