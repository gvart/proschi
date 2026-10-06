import { api } from './api';
import { fileMap } from '../playground/sanitize';

/**
 * Short links (backend/src/shares.ts): a signed-in user stores a diagram on
 * the server and gets `/s/<id>`, which link previews show with the diagram's
 * image and which opens the editor (`/app/?s=<id>`). The embed page reads
 * them too (`/embed/?s=<id>`). Anyone with the link can read a share.
 */

/** A share id: 10 base62 characters. */
export const SHARE_ID = /^[A-Za-z0-9]{10}$/;

/** The preview's size cap on the server, in bytes. */
export const MAX_PREVIEW_BYTES = 300 * 1024;

export interface CreatedShare {
  id: string;
  url: string;
  title: string;
  hasImage: boolean;
  createdAt: number;
}

export interface SharedDiagram {
  id: string;
  title: string;
  source: string;
  imports?: Record<string, string>;
}

export interface ShareListing {
  shares: { id: string; url: string; title: string; hasImage: boolean; createdAt: number }[];
  max: number;
}

/** The `?s=<id>` of a page address, when it is a well-formed share id. */
export function shareIdFromSearch(search: string): string | undefined {
  const id = new URLSearchParams(search).get('s') ?? '';
  return SHARE_ID.test(id) ? id : undefined;
}

export function createShare(source: string, imports: Record<string, string> | undefined, image: string | undefined): Promise<CreatedShare> {
  return api<CreatedShare>('/api/shares', {
    method: 'POST',
    body: { source, ...(imports && Object.keys(imports).length ? { imports } : {}), ...(image ? { image } : {}) },
  });
}

/** A share's diagram; no sign-in needed. */
export async function fetchShare(id: string): Promise<SharedDiagram> {
  const share = await api<SharedDiagram>(`/api/shares/${id}`);
  if (typeof share.source !== 'string') throw new Error('The short link answered no diagram');
  const imports = fileMap(share.imports);
  return { id: share.id, title: share.title, source: share.source, ...(imports ? { imports } : {}) };
}

export const listShares = (): Promise<ShareListing> => api<ShareListing>('/api/me/shares');

export const deleteShare = (id: string): Promise<void> => api<void>(`/api/shares/${id}`, { method: 'DELETE' });

const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The `<iframe>` that embeds a diagram: `embedUrl` is the embed page with
 * `?s=<id>` or `#code=…` (see embedUrl).
 */
export function embedSnippet(embedUrl: string, title: string, height = 480): string {
  return `<iframe src="${escapeAttr(embedUrl)}" title="${escapeAttr(title)} · Proschi" width="100%" height="${height}" style="border:0" loading="lazy" allowfullscreen></iframe>`;
}

/**
 * The embed page's address for a short link (`?s=`) or a share hash
 * (`#code=…`), next to the editor: `editorHref` is the editor's address,
 * so the build works under any sub-path.
 */
export function embedUrl(editorHref: string, target: { id: string } | { hash: string }): string {
  const url = new URL('../embed/', editorHref);
  url.search = '';
  url.hash = '';
  return 'id' in target ? `${url.href}?s=${target.id}` : `${url.href}${target.hash}`;
}
