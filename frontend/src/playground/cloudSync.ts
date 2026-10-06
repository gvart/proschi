import type { DocStore } from './docStore';
import { afterDelete, afterPut, afterRefused, applyRemote, emptyMeta, pendingOps, readStoredSync, type RemoteDoc, type StoredSync, type SyncMeta } from './sync';

/**
 * Cloud sync of the editor's diagrams, the moving part (sync.ts has the
 * merge rules): pulls the account's changes on start, when the tab comes
 * back and when the browser is online again; pushes edits about 2 s after the
 * last change and when the page is hidden. Editing never waits for it: the
 * diagrams are always saved in this browser first, and anything the server
 * did not take is retried with a growing delay.
 */

export type SyncStatus =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'saving' }
  | { kind: 'saved'; note?: string }
  | { kind: 'offline' }
  | { kind: 'error'; message: string }
  | { kind: 'signed-out' };

/** A failed request: `status` 0 when the server could not be reached. */
export class SyncError extends Error {
  readonly status: number;
  readonly retryAfter?: number;
  /** The server's copy, with a 409. */
  readonly document?: RemoteDoc;
  constructor(status: number, message: string, retryAfter?: number, document?: RemoteDoc) {
    super(message);
    this.name = 'SyncError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.document = document;
  }
}

export interface Transport {
  list(since: number | null): Promise<{ documents: RemoteDoc[]; cursor: number }>;
  put(id: string, body: { name: string; source: string; imports: Record<string, string> | null; baseVersion: number }, keepalive?: boolean): Promise<RemoteDoc>;
  /** The tombstone, or null when the server did not have it. */
  remove(id: string, baseVersion: number, keepalive?: boolean): Promise<RemoteDoc | null>;
  removeAll(): Promise<void>;
}

export interface SyncStorage {
  load(): unknown;
  save(value: StoredSync): void;
}

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface DocSyncOptions {
  store: DocStore;
  transport: Transport;
  userId: string;
  storage: SyncStorage;
  timers?: Timers;
  now?: () => string;
  newId?: () => string;
  /** Conflict copies made (their titles), to tell the user. */
  onConflict?: (titles: string[]) => void;
  /** The server said the session is over. */
  onSignedOut?: () => void;
}

/** After the last change, before pushing. */
export const PUSH_DELAY_MS = 2000;
/** A pull asks for changes from this long before the last one, for clocks a little apart. */
export const PULL_OVERLAP_MS = 60_000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60_000;
/** Writes in one pass at most, so a server that keeps answering 409 cannot loop it forever. */
const MAX_OPS_PER_PASS = 500;

const browserTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export class DocSync {
  private readonly o: DocSyncOptions & { timers: Timers };
  private meta: SyncMeta;
  private off: boolean;
  private status: SyncStatus = { kind: 'loading' };
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private timer: unknown;
  private running = false;
  private again: { pull: boolean } | null = null;
  private failures = 0;
  private stopped = false;
  private unsubscribe?: () => void;

  constructor(options: DocSyncOptions) {
    this.o = { timers: browserTimers, ...options };
    const stored = readStoredSync(options.storage.load());
    this.off = stored.off === true;
    this.meta = stored.meta && stored.meta.userId === options.userId ? stored.meta : emptyMeta(options.userId);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get enabled(): boolean {
    return !this.off;
  }

  /** Starts syncing: a pull and push now, then pushes after edits. */
  start(): void {
    this.unsubscribe = this.o.store.subscribe(() => this.changed());
    if (this.off) this.setStatus({ kind: 'off' });
    else void this.sync();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.clearTimer();
  }

  /** Pulls and pushes now (the tab is back, the browser is online). */
  sync(): Promise<void> {
    return this.run({ pull: true });
  }

  /** Pushes what is pending now, e.g. as the page is hidden; `keepalive` lets the requests outlive the page. */
  flush(keepalive = false): Promise<void> {
    return this.run({ pull: false, keepalive });
  }

  /** Turns cloud sync on or off in this browser. Off keeps everything in this browser and leaves the account's copies alone. */
  setEnabled(on: boolean): void {
    this.off = !on;
    this.persist();
    if (on) void this.sync();
    else {
      this.clearTimer();
      this.setStatus({ kind: 'off' });
    }
  }

  /** "Delete my cloud copies": deletes every diagram from the account and leaves sync off. The diagrams in this browser stay. */
  async deleteCloudCopies(): Promise<void> {
    this.off = true;
    this.clearTimer();
    this.persist();
    await this.o.transport.removeAll();
    this.meta = emptyMeta(this.o.userId);
    this.persist();
    this.setStatus({ kind: 'off' });
  }

  private changed(): void {
    if (this.off || this.stopped || this.status.kind === 'signed-out') return;
    if (pendingOps(this.o.store.get(), this.meta).length === 0) return;
    if (!this.running && this.status.kind !== 'offline' && this.status.kind !== 'error') this.setStatus({ kind: 'saving' });
    // A retry already waiting keeps its delay; otherwise push once typing pauses.
    if (this.failures === 0) this.schedule(PUSH_DELAY_MS, { pull: false });
  }

  private schedule(ms: number, what: { pull: boolean }): void {
    this.clearTimer();
    this.timer = this.o.timers.set(() => {
      this.timer = undefined;
      void this.run(what);
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) this.o.timers.clear(this.timer);
    this.timer = undefined;
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    for (const listener of [...this.listeners]) listener(status);
  }

  private persist(): void {
    this.o.storage.save({ ...(this.off ? { off: true } : {}), meta: this.meta });
  }

  private async run({ pull, keepalive = false }: { pull: boolean; keepalive?: boolean }): Promise<void> {
    if (this.off || this.stopped || this.status.kind === 'signed-out') return;
    if (this.running) {
      this.again = { pull: pull || (this.again?.pull ?? false) };
      return;
    }
    this.running = true;
    this.clearTimer();
    const { store, transport } = this.o;
    let refusedNote: string | undefined;
    const conflicted = new Set<string>();
    try {
      if (pull) {
        const since = this.meta.cursor === null ? null : Math.max(0, this.meta.cursor - PULL_OVERLAP_MS);
        const { documents, cursor } = await transport.list(since);
        if (this.off || this.stopped) return;
        this.merge(documents);
        this.meta = { ...this.meta, cursor };
        this.persist();
      }
      for (let n = 0; n < MAX_OPS_PER_PASS; n++) {
        const op = pendingOps(store.get(), this.meta)[0];
        if (!op || this.off || this.stopped) break;
        this.setStatus({ kind: 'saving' });
        try {
          if (op.kind === 'put') this.meta = afterPut(this.meta, op, await transport.put(op.id, { ...op.body, baseVersion: op.baseVersion }, keepalive));
          else {
            await transport.remove(op.id, op.baseVersion, keepalive);
            this.meta = afterDelete(this.meta, op.id);
          }
        } catch (e) {
          if (!(e instanceof SyncError)) throw e;
          if (e.status === 409 && e.document && !conflicted.has(op.id)) {
            conflicted.add(op.id);
            this.merge([e.document]);
          }
          else if (e.status === 413 && op.kind === 'put') {
            this.meta = afterRefused(this.meta, op);
            refusedNote = e.message;
          } else throw e;
        }
        this.persist();
      }
      this.failures = 0;
      if (!this.off && !this.stopped) {
        const left = Object.keys(this.meta.refused).length;
        this.setStatus(left ? { kind: 'saved', note: refusedNote ?? 'Some diagrams stay in this browser only: too large, or your account is full.' } : { kind: 'saved' });
      }
    } catch (e) {
      this.persist();
      if (e instanceof SyncError && e.status === 401) {
        this.setStatus({ kind: 'signed-out' });
        this.o.onSignedOut?.();
        return;
      }
      this.failures++;
      const status = e instanceof SyncError ? e.status : 0;
      this.setStatus(status === 0 ? { kind: 'offline' } : { kind: 'error', message: e instanceof Error ? e.message : String(e) });
      const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (this.failures - 1));
      const wait = e instanceof SyncError && e.retryAfter !== undefined ? Math.max(backoff, e.retryAfter * 1000) : backoff;
      if (!this.stopped && !this.off) this.schedule(wait, { pull: true });
    } finally {
      this.running = false;
      const again = this.again;
      this.again = null;
      if (again && this.failures === 0) void this.run(again);
      else if (!this.stopped && !this.off && this.failures === 0 && pendingOps(store.get(), this.meta).length) this.schedule(PUSH_DELAY_MS, { pull: false });
    }
  }

  private merge(remotes: RemoteDoc[]): void {
    const { store } = this.o;
    const result = applyRemote(store.get(), this.meta, remotes, this.o.now, this.o.newId);
    this.meta = result.meta;
    store.set(result.state);
    if (result.conflicts.length) this.o.onConflict?.(result.conflicts);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init });
  } catch (e) {
    throw new SyncError(0, e instanceof Error ? e.message : String(e));
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as { error?: string; document?: RemoteDoc };
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? NaN);
    throw new SyncError(response.status, data.error ?? `${response.status} ${response.statusText}`, Number.isFinite(retryAfter) ? retryAfter : undefined, data.document);
  }
  return data as T;
}

/** The account's API (backend/src/documents.ts) on this site's origin. */
export const fetchTransport: Transport = {
  list: (since) => request(`/api/me/documents${since === null ? '' : `?since=${since}`}`),
  put: async (id, body, keepalive = false) =>
    (
      await request<{ document: RemoteDoc }>(`/api/me/documents/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive,
      })
    ).document,
  remove: async (id, baseVersion, keepalive = false) =>
    (await request<{ document: RemoteDoc } | undefined>(`/api/me/documents/${encodeURIComponent(id)}?baseVersion=${baseVersion}`, { method: 'DELETE', keepalive }))?.document ??
    null,
  removeAll: async () => {
    await request('/api/me/documents', { method: 'DELETE' });
  },
};
