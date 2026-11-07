import { ApiError } from '../services/api';
import type { FeedbackContext, Kind } from './context';

export interface FeedbackDraft {
  kind: Kind;
  subject: string;
  message: string;
  context: FeedbackContext;
  diagram?: string;
  screenshots: File[];
}

/** POST /api/feedback (backend/src/feedback.ts), as multipart so the screenshots go along; the server reads the User-Agent itself. */
export async function sendFeedback(draft: FeedbackDraft): Promise<void> {
  const form = new FormData();
  form.append('kind', draft.kind);
  form.append('subject', draft.subject);
  form.append('message', draft.message);
  form.append('path', draft.context.path);
  form.append('viewport', draft.context.viewport);
  if (draft.diagram) form.append('diagram', draft.diagram);
  for (const file of draft.screenshots) form.append('screenshot', file, file.name);
  const response = await fetch('/api/feedback', { method: 'POST', body: form, credentials: 'same-origin' });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, data.error ?? `${response.status} ${response.statusText}`);
  }
}
