-- The plan the admin's comp gives (src/admin.ts compUser,
-- docs/design/paid-plans.md P24): 'pro' or 'max'. NULL is 'pro', as every
-- comp before this migration was. It counts only while `comp_until` is in
-- the future; the effective plan (src/plans.ts effectivePlan) is the higher
-- of `plan` and this.
ALTER TABLE users ADD COLUMN comp_plan TEXT CHECK (comp_plan IN ('pro', 'max'));
