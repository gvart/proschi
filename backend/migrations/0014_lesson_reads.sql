-- Lessons read (frontend/src/practice/problems/<id>/lesson.md) and roadmap
-- guides (frontend/src/practice/guide/<id>.md), so the roadmap marks them on
-- every device and the reading badges count them. POST /api/me/lessons adds
-- rows; a read is never undone. Times are Unix seconds.
CREATE TABLE lesson_reads (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- A problem id or a guide id.
  lesson_id TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
