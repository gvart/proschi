import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_DOCUMENT, MAX_DOCUMENTS, TOMBSTONE_TTL_MS, type CloudDocument } from '../src/documents';
import worker from '../src/index';
import { call, resetDatabase, signedInUser, WINDOW_TIMEOUT, withinOneWindow } from './helpers';

/** Cloud sync of the editor's diagrams: /api/me/documents. */

const put = (token: string, id: string, body: Record<string, unknown>, headers?: Record<string, string>) =>
  call(`/api/me/documents/${id}`, { method: 'PUT', token, body, headers });
const doc = (baseVersion: number, source = 'title "A"\n', name = 'a.proschi') => ({ name, source, baseVersion });

async function list(token: string, since?: number): Promise<{ documents: CloudDocument[]; cursor: number }> {
  const response = await call(`/api/me/documents${since === undefined ? '' : `?since=${since}`}`, { token });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  return (await response.json()) as { documents: CloudDocument[]; cursor: number };
}

async function saved(response: Response): Promise<CloudDocument> {
  expect(response.status).toBe(200);
  return ((await response.json()) as { document: CloudDocument }).document;
}

describe('synced documents', () => {
  beforeEach(resetDatabase);

  it('need a session, and refuse changes from another site', async () => {
    expect((await call('/api/me/documents')).status).toBe(401);
    expect((await put('', 'd1', doc(0))).status).toBe(401);
    expect((await call('/api/me/documents/d1', { method: 'DELETE' })).status).toBe(401);
    const { token } = await signedInUser();
    const evil = { Origin: 'https://evil.example' };
    expect((await put(token, 'd1', doc(0), evil)).status).toBe(403);
    expect((await call('/api/me/documents/d1', { method: 'DELETE', token, headers: evil })).status).toBe(403);
    expect((await call('/api/me/documents', { method: 'DELETE', token, headers: evil })).status).toBe(403);
    expect((await list(token)).documents).toEqual([]);
  });

  it('are saved, listed and kept apart per user, even with the same id', async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    const created = await saved(await put(a.token, 'doc-1', { ...doc(0), imports: { 'lib.proschi': 'service X' } }));
    expect(created).toMatchObject({ id: 'doc-1', name: 'a.proschi', source: 'title "A"\n', imports: { 'lib.proschi': 'service X' }, version: 1, deletedAt: null });
    await saved(await put(b.token, 'doc-1', doc(0, 'title "B"\n')));
    const listed = await list(a.token);
    expect(listed.documents).toEqual([created]);
    expect(listed.cursor).toBeGreaterThanOrEqual(created.updatedAt);
    expect((await list(b.token)).documents.map((d) => d.source)).toEqual(['title "B"\n']);
  });

  it('validate what is sent', async () => {
    const { token } = await signedInUser();
    expect((await put(token, 'bad id!', doc(0))).status).toBe(400);
    expect((await put(token, 'd', { source: '', baseVersion: 0 })).status).toBe(400);
    expect((await put(token, 'd', { name: 'a', source: 1, baseVersion: 0 })).status).toBe(400);
    expect((await put(token, 'd', { name: 'a', source: '' })).status).toBe(400);
    expect((await put(token, 'd', { name: 'a', source: '', baseVersion: -1 })).status).toBe(400);
    expect((await put(token, 'd', { ...doc(0), imports: ['x'] })).status).toBe(400);
    expect((await put(token, 'd', { ...doc(0), imports: { 'a.proschi': 3 } })).status).toBe(400);
    expect((await call('/api/me/documents?since=soon', { token })).status).toBe(400);
  });

  it('are capped at 64 KiB each, imports included', async () => {
    const { token } = await signedInUser();
    expect((await put(token, 'big', doc(0, 'x'.repeat(MAX_DOCUMENT)))).status).toBe(200);
    expect((await put(token, 'bigger', doc(0, 'x'.repeat(MAX_DOCUMENT + 1)))).status).toBe(413);
    const half = 'x'.repeat(MAX_DOCUMENT / 2);
    expect((await put(token, 'imports', { ...doc(0, half), imports: { 'lib.proschi': half } })).status).toBe(413);
  });

  it(`are capped at ${MAX_DOCUMENTS} per user, tombstones not counted`, async () => {
    const { id, token } = await signedInUser();
    const statements = Array.from({ length: MAX_DOCUMENTS }, (_, i) =>
      env.DB.prepare("INSERT INTO documents (user_id, id, name, source, updated_at, version) VALUES (?, ?, 'n.proschi', '', 1, 1)").bind(id, `d${i}`),
    );
    await env.DB.batch(statements);
    const full = await put(token, 'one-more', doc(0));
    expect(full.status).toBe(413);
    // Existing ones can still be saved.
    expect((await put(token, 'd0', doc(1))).status).toBe(200);
    expect((await call('/api/me/documents/d1?baseVersion=1', { method: 'DELETE', token })).status).toBe(200);
    expect((await put(token, 'one-more', doc(0))).status).toBe(200);
    // Restoring the tombstone would make 201.
    expect((await put(token, 'd1', doc(2))).status).toBe(413);
  });

  it('answer a stale write with 409 and the server copy', async () => {
    const { token } = await signedInUser();
    const v1 = await saved(await put(token, 'd', doc(0, 'one')));
    const v2 = await saved(await put(token, 'd', doc(1, 'two')));
    expect(v2.version).toBe(2);
    expect(v2.updatedAt).toBeGreaterThanOrEqual(v1.updatedAt);
    // Another device still on version 1.
    const stale = await put(token, 'd', doc(1, 'other'));
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { document: CloudDocument }).document).toEqual(v2);
    // A second "new" document with a taken id.
    expect((await put(token, 'd', doc(0, 'new'))).status).toBe(409);
    expect((await list(token)).documents.map((d) => d.source)).toEqual(['two']);
  });

  it('leave tombstones that `since` reports, and can be restored', async () => {
    const { token } = await signedInUser();
    const v1 = await saved(await put(token, 'd', doc(0, 'secret')));
    const { cursor } = await list(token);
    expect((await call('/api/me/documents/d?baseVersion=0', { method: 'DELETE', token })).status).toBe(409);
    const tomb = await saved(await call('/api/me/documents/d?baseVersion=1', { method: 'DELETE', token }));
    expect(tomb).toMatchObject({ id: 'd', name: '', source: '', imports: null, version: 2, deletedAt: expect.any(Number) });
    expect(tomb.updatedAt).toBeGreaterThanOrEqual(v1.updatedAt);
    // Deleting again, or what was never there.
    expect(await saved(await call('/api/me/documents/d', { method: 'DELETE', token }))).toEqual(tomb);
    expect((await call('/api/me/documents/nothing', { method: 'DELETE', token })).status).toBe(204);
    expect((await list(token, cursor)).documents).toEqual([tomb]);
    expect((await list(token, tomb.updatedAt + 1)).documents).toEqual([]);
    // A device that edited it meanwhile gets the tombstone, then restores it.
    const conflict = await put(token, 'd', doc(1, 'edited'));
    expect(conflict.status).toBe(409);
    expect(await saved(await put(token, 'd', doc(2, 'edited')))).toMatchObject({ version: 3, source: 'edited', deletedAt: null });
  });

  it('tombstones go after 30 days, with the daily cron', async () => {
    const { id, token } = await signedInUser();
    await saved(await put(token, 'old', doc(0)));
    await saved(await put(token, 'recent', doc(0)));
    await saved(await put(token, 'live', doc(0)));
    await call('/api/me/documents/old', { method: 'DELETE', token });
    await call('/api/me/documents/recent', { method: 'DELETE', token });
    await env.DB.prepare("UPDATE documents SET deleted_at = ? WHERE id = 'old'").bind(Date.now() - TOMBSTONE_TTL_MS - 1000).run();
    await worker.scheduled(createScheduledController({ cron: '17 3 * * *' }), env);
    const left = await env.DB.prepare('SELECT id FROM documents WHERE user_id = ? ORDER BY id').bind(id).all<{ id: string }>();
    expect(left.results.map((r) => r.id)).toEqual(['live', 'recent']);
  });

  it('are in the export, and go with the account or "Delete my cloud copies"', async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    const kept = await saved(await put(a.token, 'd', doc(0, 'mine')));
    const exported = (await (await call('/api/me/export', { token: a.token })).json()) as { documents: CloudDocument[] };
    expect(exported.documents).toEqual([kept]);

    await saved(await put(b.token, 'd', doc(0)));
    const cleared = await call('/api/me/documents', { method: 'DELETE', token: b.token });
    expect(await cleared.json()).toEqual({ deleted: 1 });
    expect((await list(b.token)).documents).toEqual([]);
    expect((await list(a.token)).documents).toEqual([kept]);

    expect((await call('/api/me', { method: 'DELETE', token: a.token })).status).toBe(204);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM documents').first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it('are limited to 120 requests a minute per user', async () => {
    const { token } = await signedInUser();
    await withinOneWindow(10_000);
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) statuses.push((await call('/api/me/documents', { token })).status);
    expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true);
    expect(statuses[120]).toBe(429);
    const limited = await put(token, 'd', doc(0));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
  }, WINDOW_TIMEOUT + 10_000);
});
