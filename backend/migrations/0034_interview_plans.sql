-- The interview-date plan (interview_plan, Max; docs/design/paid-plans.md
-- P55, frontend/src/learn/interviewPlan.ts): the date and minutes a day the
-- learner picked, and today's list as the browser last built it, so the
-- evening reminder (src/reminders.ts) can name what is left. The schedule
-- itself is built in the browser.
CREATE TABLE interview_plans (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- The interview, YYYY-MM-DD (the learner's calendar).
  interview_date TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  -- When the date was set, YYYY-MM-DD: the plan's phases count from it.
  start_day TEXT NOT NULL,
  -- The day of today_items, YYYY-MM-DD, and that day's list as JSON
  -- [{title, done}]; NULL until the browser sends one.
  today_day TEXT,
  today_items TEXT,
  updated_at INTEGER NOT NULL
);
