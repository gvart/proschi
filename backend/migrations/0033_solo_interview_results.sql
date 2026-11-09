-- What an interview on your own did beyond the effort (docs/design/paid-plans.md
-- P53, frontend/src/learn/soloInterview.ts SoloResults): the time per phase,
-- the questions, estimates, last check run and self-review, as JSON, for the
-- trend per skill (interview_history, Pro) and the printable report
-- (interview_report, Max). NULL for sessions sent before it was kept; the
-- browser's next send fills it in.
ALTER TABLE solo_interviews ADD COLUMN results TEXT;
