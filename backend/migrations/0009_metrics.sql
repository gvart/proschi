-- Product metrics (backend/README.md "Usage counts", docs/PRIVACY.md): one
-- number per UTC day and event, e.g. ('2026-10-06', 'editor_open', 412).
-- Deliberately no user ids, IPs, cookies or per-visit rows: only the daily
-- aggregate. The daily cron deletes days older than 400 days.
CREATE TABLE daily_counts (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event)
);
