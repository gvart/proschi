-- Who answers in a Design partner chat (src/partner.ts, docs/design/
-- paid-plans.md P59; backend/README.md "Design partner"): 'partner', the
-- software architect of the editor and the Problems tab's workspace, or
-- 'coach', the Interview coach of a roadmap problem's interview prep stages.
-- Set when the chat starts (the API's {kind: 'prep', problemId} is a
-- practice session with the coach) and never changed, so a conversation
-- can't switch persona midway.
ALTER TABLE partner_sessions ADD COLUMN persona TEXT NOT NULL DEFAULT 'partner' CHECK (persona IN ('partner', 'coach'));
