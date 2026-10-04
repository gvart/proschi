import { readProgress, type Progress } from '../practice/progress';
import { defaultIds, fileNameOf, readDiagram, type DocumentState, type SavedDiagram } from './documents';
import { isRecord } from './sanitize';
import { readZip, writeZip } from './zip';

/**
 * "Export all" / "Import backup…": every diagram saved in this browser as a
 * `.proschi` file in one zip, plus `proschi-backup.json` with what the files
 * cannot hold (ids, dates, imports carried by share links) and the practice
 * progress. Importing merges into what is already here.
 */

export const BACKUP_JSON = 'proschi-backup.json';
export const BACKUP_FORMAT = 'proschi-backup';

interface BackupDocument {
  id: string;
  /** Path of the diagram's `.proschi` file in the zip. */
  file: string;
  fileName: string;
  updatedAt: string;
  imports?: Record<string, string>;
}

interface BackupJson {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  currentId: string;
  documents: BackupDocument[];
  practice: Progress;
}

/** A zip path that cannot climb out of an extraction folder: no leading `/`, no `..`, no backslashes. */
export function safeZipPath(name: string): string {
  const parts = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/') || 'diagram.proschi';
}

/** The backup zip of `state` and practice `progress`. */
export function buildBackup(state: DocumentState, progress: Progress, now = new Date()): Uint8Array<ArrayBuffer> {
  const taken = new Set<string>([BACKUP_JSON]);
  const files: { name: string; data: string }[] = [];
  const documents: BackupDocument[] = state.docs.map((doc) => {
    const fileName = fileNameOf(doc);
    const base = safeZipPath(fileName).replace(/\.proschi$/, '');
    let file = `${base}.proschi`;
    for (let n = 2; taken.has(file); n++) file = `${base}-${n}.proschi`;
    taken.add(file);
    files.push({ name: file, data: doc.source });
    return { id: doc.id, file, fileName, updatedAt: doc.updatedAt, ...(doc.imports ? { imports: doc.imports } : {}) };
  });
  const json: BackupJson = { format: BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), currentId: state.currentId, documents, practice: progress };
  return writeZip([...files, { name: BACKUP_JSON, data: JSON.stringify(json, null, 2) }], now);
}

export interface Backup {
  docs: SavedDiagram[];
  progress: Progress;
}

/**
 * Reads a backup zip. Without `proschi-backup.json` (a zip of `.proschi` files
 * made by hand) each file becomes a diagram named after it. Throws ZipError,
 * or an Error with a readable message, on a file that is not a backup.
 */
export function readBackup(bytes: Uint8Array, newId: () => string = defaultIds): Backup {
  const entries = readZip(bytes);
  const decoder = new TextDecoder();
  const text = new Map(entries.map((e) => [e.name, decoder.decode(e.data)]));
  const manifestText = text.get(BACKUP_JSON);

  if (manifestText === undefined) {
    const docs = entries
      .filter((e) => e.name.endsWith('.proschi'))
      .map((e) => ({ id: newId(), source: text.get(e.name)!, updatedAt: new Date().toISOString(), fileName: safeZipPath(e.name) }));
    if (docs.length === 0) throw new Error('This zip has no .proschi files and no proschi-backup.json.');
    return { docs, progress: {} };
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error(`${BACKUP_JSON} in this zip is not valid JSON.`);
  }
  if (!isRecord(manifest) || manifest.format !== BACKUP_FORMAT) throw new Error(`${BACKUP_JSON} in this zip is not a Proschi backup.`);
  const docs: SavedDiagram[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(manifest.documents) ? manifest.documents : []) {
    if (!isRecord(item) || typeof item.file !== 'string') continue;
    const source = text.get(item.file);
    const doc = readDiagram({ ...item, source });
    if (doc && !seen.has(doc.id)) {
      seen.add(doc.id);
      docs.push(doc);
    }
  }
  return { docs, progress: readProgress(manifest.practice) };
}

export interface MergePlan {
  /** Diagrams not here yet (by id and by file name). */
  added: SavedDiagram[];
  /** Diagrams whose id or file name is taken by one with other content. */
  conflicts: { incoming: SavedDiagram; existing: SavedDiagram }[];
  /** Diagrams already here with the same content. */
  unchanged: number;
}

/** Sorts the diagrams of a backup into new ones, conflicting ones and ones already here. */
export function planMerge(state: DocumentState, incoming: SavedDiagram[]): MergePlan {
  const plan: MergePlan = { added: [], conflicts: [], unchanged: 0 };
  for (const doc of incoming) {
    const existing = state.docs.find((d) => d.id === doc.id) ?? state.docs.find((d) => fileNameOf(d) === fileNameOf(doc));
    if (!existing) plan.added.push(doc);
    else if (existing.source === doc.source) plan.unchanged++;
    else plan.conflicts.push({ incoming: doc, existing });
  }
  return plan;
}

/**
 * Applies a plan: adds the new diagrams and replaces the content of the
 * conflicting ones the person agreed to overwrite (the existing diagram keeps
 * its id, so it stays selected and nothing else points at a missing id).
 */
export function applyMerge(state: DocumentState, plan: MergePlan, overwrite: (conflict: MergePlan['conflicts'][number]) => boolean): DocumentState {
  const replace = new Map<string, SavedDiagram>();
  for (const conflict of plan.conflicts) {
    if (overwrite(conflict)) replace.set(conflict.existing.id, { ...conflict.incoming, id: conflict.existing.id });
  }
  const ids = new Set(state.docs.map((d) => d.id));
  const added = plan.added.map((d) => (ids.has(d.id) ? { ...d, id: defaultIds() } : d));
  const docs = [...state.docs.map((d) => replace.get(d.id) ?? d), ...added];
  return { ...state, docs };
}

/** `proschi-backup-2026-10-04.zip` */
export const backupFileName = (now = new Date()): string => `proschi-backup-${now.toISOString().slice(0, 10)}.zip`;

/** What an import did, in one sentence. */
export function mergeSummary(plan: MergePlan, replaced: number, problems: number): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [`added ${plural(plan.added.length, 'diagram')}`];
  if (plan.conflicts.length) parts.push(`replaced ${replaced} of ${plural(plan.conflicts.length, 'changed diagram')}`);
  if (plan.unchanged) parts.push(`${plan.unchanged} already here`);
  if (problems) parts.push(`restored progress on ${plural(problems, 'practice problem')}`);
  return `Backup imported: ${parts.join(', ')}.`;
}
