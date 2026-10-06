import { BLANK_SOURCE, defaultClock, defaultIds, fileNameOf, titleOf, type DocumentState, type SavedDiagram } from './documents';
import { fileMap, isRecord, isSafeKey } from './sanitize';

/**
 * Cloud sync of the editor's diagrams, the pure part: what the page and the
 * account (GET/PUT/DELETE /api/me/documents, backend/src/documents.ts) need
 * to send each other, and how what the server answers merges into the
 * diagrams in this browser. Nothing here touches the network or storage;
 * cloudSync.ts does, on a timer.
 *
 * The browser remembers, per diagram it synced, the server's version and a
 * fingerprint of the content at that version. A diagram whose content no
 * longer matches its fingerprint was edited here and is sent with that
 * version as its base; one remembered but gone was deleted here. When both
 * sides changed, neither wins silently: the server's copy keeps the id and
 * this browser's is kept beside it, renamed "<name> (conflict <date>)".
 */

/** A document as the account keeps it (CloudDocument in backend/src/documents.ts). */
export interface RemoteDoc {
  id: string;
  name: string;
  source: string;
  imports: Record<string, string> | null;
  version: number;
  /** Unix milliseconds, the server's clock. */
  updatedAt: number;
  /** Unix milliseconds; null unless deleted (a tombstone). */
  deletedAt: number | null;
}

export interface SyncMeta {
  /** The account this was synced with; another account starts over, like a first sign-in. */
  userId: string;
  /** The server's time of the last pull (GET ?since=); null before the first. */
  cursor: number | null;
  /** Per diagram synced: the server's version and the fingerprint of its content then. */
  docs: Record<string, { version: number; fp: string }>;
  /** Diagrams the server refused (too large, account full), with their fingerprint then: not sent again until they change. */
  refused: Record<string, string>;
}

/** What `proschi.docs.sync` holds. */
export interface StoredSync {
  /** Cloud sync turned off in this browser: diagrams stay local only. */
  off?: boolean;
  meta?: SyncMeta;
}

/** A write to send: a diagram edited here (`put`), or one deleted here (`delete`). */
export type SyncOp =
  | { kind: 'put'; id: string; baseVersion: number; fp: string; body: { name: string; source: string; imports: Record<string, string> | null } }
  | { kind: 'delete'; id: string; baseVersion: number };

export const emptyMeta = (userId: string): SyncMeta => ({ userId, cursor: null, docs: {}, refused: {} });

/** `proschi.docs.sync` as stored, which may be damaged: what is well-formed is kept. */
export function readStoredSync(value: unknown): StoredSync {
  if (!isRecord(value)) return {};
  const out: StoredSync = value.off === true ? { off: true } : {};
  const meta = value.meta;
  if (isRecord(meta) && typeof meta.userId === 'string') {
    const docs: SyncMeta['docs'] = {};
    if (isRecord(meta.docs)) {
      for (const [id, entry] of Object.entries(meta.docs)) {
        if (isSafeKey(id) && isRecord(entry) && Number.isSafeInteger(entry.version) && typeof entry.fp === 'string') docs[id] = { version: entry.version as number, fp: entry.fp };
      }
    }
    const refused: SyncMeta['refused'] = {};
    if (isRecord(meta.refused)) for (const [id, fp] of Object.entries(meta.refused)) if (isSafeKey(id) && typeof fp === 'string') refused[id] = fp;
    const cursor = typeof meta.cursor === 'number' && Number.isFinite(meta.cursor) ? meta.cursor : null;
    out.meta = { userId: meta.userId, cursor, docs, refused };
  }
  return out;
}

/** cyrb53: a fast 53-bit string hash, plenty to tell edits apart. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function contentFingerprint(name: string, source: string, imports: Record<string, string> | null | undefined): string {
  const files = imports ? Object.entries(imports).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : [];
  return `${source.length}:${hash(JSON.stringify([name, source, files]))}`;
}

// Diagrams are immutable values, so each is hashed once, not on every keystroke.
const fingerprints = new WeakMap<SavedDiagram, string>();

/** The fingerprint of what syncs of a diagram: its file name, source and imports. */
export function fingerprint(doc: SavedDiagram): string {
  let fp = fingerprints.get(doc);
  if (fp === undefined) {
    fp = contentFingerprint(fileNameOf(doc), doc.source, doc.imports);
    fingerprints.set(doc, fp);
  }
  return fp;
}

export const remoteFingerprint = (doc: RemoteDoc): string => contentFingerprint(doc.name, doc.source, doc.imports);

/** The server's copy as a diagram in this browser. */
export function toLocal(doc: RemoteDoc): SavedDiagram {
  const imports = fileMap(doc.imports);
  return { id: doc.id, source: doc.source, fileName: doc.name, updatedAt: new Date(doc.updatedAt).toISOString(), ...(imports ? { imports } : {}) };
}

/** "2026-10-06 14:05" in local time, for a conflict copy's name. */
function stamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TITLE_LINE = /^([ \t]*)title[ \t]+(?:"(?:[^"\\]|\\.)*"|[A-Za-z_]\w*)/m;

/** The source with its `title` line saying `title` (one is added when missing). */
export function retitle(source: string, title: string): string {
  const quoted = `"${title.replace(/["\\]/g, '\\$&')}"`;
  return TITLE_LINE.test(source) ? source.replace(TITLE_LINE, (_, indent: string) => `${indent}title ${quoted}`) : `title ${quoted}\n${source}`;
}

/** This browser's side of a conflict, under a new id and a name that says so: "<name> (conflict <date>)". */
export function conflictCopy(doc: SavedDiagram, id: string, now: string): SavedDiagram {
  const when = stamp(now);
  const base = fileNameOf(doc).replace(/\.proschi$/, '');
  return { ...doc, id, source: retitle(doc.source, `${titleOf(doc.source)} (conflict ${when})`), fileName: `${base} (conflict ${when}).proschi`, updatedAt: now };
}

export interface MergeResult {
  state: DocumentState;
  meta: SyncMeta;
  /** The titles of conflict copies made, to tell the user. */
  conflicts: string[];
}

/**
 * Merges the server's changes (a pull, or the copy a 409 answered with)
 * into this browser's diagrams. For each:
 *
 * - already seen (its version is not newer): nothing;
 * - deleted there: deleted here too, unless edited here, then restored by the next push;
 * - unknown here, or deleted here while it changed there: added (an edit beats a delete);
 * - unchanged here, or changed to the same content: the server's copy is taken;
 * - changed on both sides: the server's copy keeps the id, this browser's
 *   is kept as a conflict copy, and stays the open one if it was.
 *
 * On the first sync with an account (no cursor yet), a diagram never synced
 * that is identical to one the account has (the starter example on a new
 * device, say) is dropped instead of being uploaded twice.
 */
export function applyRemote(state: DocumentState, meta: SyncMeta, remotes: RemoteDoc[], now = defaultClock, newId = defaultIds): MergeResult {
  const docs = [...state.docs];
  let currentId = state.currentId;
  const known: SyncMeta['docs'] = { ...meta.docs };
  const conflicts: string[] = [];
  let changed = false;

  for (const remote of remotes) {
    // Ids name properties of `known`.
    if (!isSafeKey(remote.id)) continue;
    const seen = known[remote.id];
    if (seen && remote.version <= seen.version) continue;
    const i = docs.findIndex((d) => d.id === remote.id);
    const local = i >= 0 ? docs[i] : undefined;
    const dirty = local !== undefined && fingerprint(local) !== seen?.fp;

    if (remote.deletedAt !== null) {
      if (local && dirty) {
        // Edited here: kept, and sent on top of the tombstone, which restores it.
        known[remote.id] = { version: remote.version, fp: '' };
        continue;
      }
      if (local) {
        docs.splice(i, 1);
        changed = true;
      }
      delete known[remote.id];
      continue;
    }

    const remoteFp = remoteFingerprint(remote);
    known[remote.id] = { version: remote.version, fp: remoteFp };
    if (!local) {
      docs.push(toLocal(remote));
      changed = true;
    } else if (!dirty || fingerprint(local) === remoteFp) {
      if (fingerprint(local) !== remoteFp) {
        docs[i] = toLocal(remote);
        changed = true;
      }
    } else {
      const copy = conflictCopy(local, newId(), now());
      docs.splice(i, 1, toLocal(remote), copy);
      if (currentId === remote.id) currentId = copy.id;
      conflicts.push(titleOf(copy.source));
      changed = true;
    }
  }

  if (meta.cursor === null) {
    const has = (id: string) => Object.hasOwn(known, id);
    const synced = new Map(docs.filter((d) => has(d.id)).map((d) => [known[d.id].fp, d.id]));
    for (let i = docs.length - 1; i >= 0; i--) {
      const twin = !has(docs[i].id) && synced.get(fingerprint(docs[i]));
      if (twin) {
        if (currentId === docs[i].id) currentId = twin;
        docs.splice(i, 1);
        changed = true;
      }
    }
  }

  const nextMeta = { ...meta, docs: known };
  if (!changed) return { state, meta: nextMeta, conflicts };
  if (docs.length === 0) docs.push({ id: newId(), source: BLANK_SOURCE, fileName: 'untitled.proschi', updatedAt: now() });
  if (!docs.some((d) => d.id === currentId)) currentId = docs[0].id;
  return { state: { docs, currentId }, meta: nextMeta, conflicts };
}

/** The writes waiting to be sent: diagrams edited or made here (oldest first), then those deleted here. */
export function pendingOps(state: DocumentState, meta: SyncMeta): SyncOp[] {
  const ops: SyncOp[] = [];
  const edited = state.docs.filter((d) => {
    if (!isSafeKey(d.id)) return false;
    const fp = fingerprint(d);
    return fp !== meta.docs[d.id]?.fp && meta.refused[d.id] !== fp;
  });
  for (const d of [...edited].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    ops.push({
      kind: 'put',
      id: d.id,
      baseVersion: meta.docs[d.id]?.version ?? 0,
      fp: fingerprint(d),
      body: { name: fileNameOf(d), source: d.source, imports: d.imports ?? null },
    });
  }
  const here = new Set(state.docs.map((d) => d.id));
  for (const [id, { version }] of Object.entries(meta.docs)) if (!here.has(id)) ops.push({ kind: 'delete', id, baseVersion: version });
  return ops;
}

/** After the server saved a put: its version, and the fingerprint of what was sent (later edits stay pending). */
export function afterPut(meta: SyncMeta, op: Extract<SyncOp, { kind: 'put' }>, saved: RemoteDoc): SyncMeta {
  const refused = { ...meta.refused };
  delete refused[op.id];
  return { ...meta, docs: { ...meta.docs, [op.id]: { version: saved.version, fp: op.fp } }, refused };
}

/** After the server deleted a diagram (or did not have it). */
export function afterDelete(meta: SyncMeta, id: string): SyncMeta {
  const docs = { ...meta.docs };
  delete docs[id];
  return { ...meta, docs };
}

/** After the server refused a put for good (413): not sent again until the diagram changes. */
export function afterRefused(meta: SyncMeta, op: Extract<SyncOp, { kind: 'put' }>): SyncMeta {
  return { ...meta, refused: { ...meta.refused, [op.id]: op.fp } };
}
