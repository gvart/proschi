/**
 * The paid features' ids and what `GET /api/me/plan` says about each
 * (backend/src/features.ts, docs/design/paid-plans.md P22). Pure and
 * dependency-free, so the Worker imports this file and the two sides can't
 * disagree on the ids. Which plans get a feature is decided only on the
 * server; the page reads the answer.
 */

export const FEATURE_IDS = ['ai_interview', 'interview_history', 'ai_roadmap', 'share_links', 'design_partner', 'deep_mode', 'interview_report', 'design_diff', 'interview_plan', 'data_export', 'certificate', 'pro_exports', 'saved_whatifs'] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

/** Why a feature is not on: no account, the account's plan lacks it, or it lacks it and no plan can be bought on this server. */
export type FeatureReason = 'signed_out' | 'needs_pro' | 'billing_off';

export type FeatureAccess = { ok: true } | { ok: false; reason: FeatureReason };
