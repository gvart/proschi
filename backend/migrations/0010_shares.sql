-- Short share links (/s/<id>): a diagram a signed-in user chose to publish
-- at an unguessable address, with an optional preview image the browser
-- rendered. Public to anyone with the link; the owner can delete it, and it
-- goes with the account (ON DELETE CASCADE). Times are Unix seconds.
CREATE TABLE shares (
  -- 10 random base62 characters (about 59 bits).
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The diagram's `title`, read from the source when it was stored.
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  -- JSON: imported files (path → source), so the diagram renders without them; NULL without imports.
  imports TEXT,
  -- PNG, at most 300 KB, checked for its signature and size; NULL without a preview.
  image BLOB,
  image_width INTEGER,
  image_height INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX shares_by_user ON shares (user_id, created_at);
