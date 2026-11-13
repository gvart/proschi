import { api } from './api';
import type { ProgressExport } from '../learn/progressExport';

/**
 * Export and proof (docs/design/paid-plans.md P56; backend/src/certificates.ts
 * and progressExport.ts): the progress export (Pro), the mastery certificate
 * (Max) and Proschi's branding on the account's embeds (Pro).
 */

/** The account's own certificate: its public id, whether it is shown, and when it was issued (Unix seconds). */
export interface MyCertificate {
  id: string;
  public: boolean;
  issuedAt: number;
}

/** GET /api/certificates/<id>: what anyone sees, drawn from the owner's progress. Times are Unix seconds. */
export interface PublicCertificate {
  id: string;
  displayName: string;
  issuedAt: number;
  asOf: number;
  level: number;
  xp: number;
  readiness: number;
  problems: number;
  solved: { id: string; title: string; difficulty: string }[];
  skills: { topic: string; title: string; mastery: number }[];
  streak: { longest: number };
}

export const getMyCertificate = () => api<{ certificate: MyCertificate | null }>('/api/me/certificate').then((r) => r.certificate);

export const setCertificate = (on: boolean) => api<{ certificate: MyCertificate | null }>('/api/me/certificate', { method: 'PUT', body: { public: on } }).then((r) => r.certificate);

export const getCertificate = (id: string) => api<PublicCertificate>(`/api/certificates/${encodeURIComponent(id)}`);

export const getEmbedBranding = () => api<{ branding: boolean }>('/api/me/embeds').then((r) => r.branding);

export const setEmbedBranding = (branding: boolean) => api<{ branding: boolean }>('/api/me/embeds', { method: 'PUT', body: { branding } }).then((r) => r.branding);

export const getProgressExport = () => api<ProgressExport>('/api/me/export?view=progress');
