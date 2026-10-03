/** A diagram saved in this browser. Its name comes from the `title` line. */
export interface SavedDiagram {
  id: string;
  source: string;
  updatedAt: string;
  /**
   * Name imports use for it: the file it was opened from, or one made from its
   * title when it was created. It does not follow later title edits, so imports
   * of it keep working; only renaming the file changes it.
   */
  fileName?: string;
  /**
   * Imported files (path → source) that came with a share link. They win over
   * saved diagrams of the same name, so the link renders as it was shared.
   */
  imports?: Record<string, string>;
}

export interface DocumentState {
  docs: SavedDiagram[];
  currentId: string;
}

export const BLANK_SOURCE = 'title "Untitled"\n\n';

type Clock = () => string;
type IdFactory = () => string;

export const defaultClock: Clock = () => new Date().toISOString();
export const defaultIds: IdFactory = () => `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

interface InitialInput {
  stored: DocumentState | null;
  /** Source from the editor before named diagrams existed. */
  legacySource: string | null;
  /** Source from a `#code=` share link. */
  sharedSource: string | null;
  /** Imported files carried by the share link. */
  sharedImports?: Record<string, string>;
  fallbackSource: string;
}

/**
 * Builds the starting state. A share link opens its diagram, reusing an
 * identical saved one so reloading a shared URL never piles up copies.
 */
export function initialState(input: InitialInput, now: Clock = defaultClock, newId: IdFactory = defaultIds): DocumentState {
  const valid = input.stored?.docs?.length ? input.stored : null;
  let docs = valid ? [...valid.docs] : [];
  let currentId = valid?.currentId ?? '';

  if (docs.length === 0 && input.legacySource && input.legacySource !== input.sharedSource) {
    docs.push({ id: newId(), source: input.legacySource, updatedAt: now() });
  }

  if (input.sharedSource !== null) {
    const imports = input.sharedImports && Object.keys(input.sharedImports).length ? { imports: input.sharedImports } : {};
    const existing = docs.find((d) => d.source === input.sharedSource);
    if (existing) {
      currentId = existing.id;
      if (imports.imports) docs = docs.map((d) => (d === existing ? { ...d, ...imports } : d));
    } else {
      const doc = { id: newId(), source: input.sharedSource, updatedAt: now(), ...imports };
      docs = [doc, ...docs];
      currentId = doc.id;
    }
  }

  if (docs.length === 0) docs.push({ id: newId(), source: input.fallbackSource, updatedAt: now() });
  if (!docs.some((d) => d.id === currentId)) currentId = docs[0].id;
  return { docs: nameDocs(docs), currentId };
}

export function currentDoc(state: DocumentState): SavedDiagram {
  return state.docs.find((d) => d.id === state.currentId) ?? state.docs[0];
}

export function updateCurrent(state: DocumentState, source: string, now: Clock = defaultClock): DocumentState {
  if (currentDoc(state).source === source) return state;
  return {
    ...state,
    docs: state.docs.map((d) => (d.id === state.currentId ? { ...d, source, updatedAt: now() } : d)),
  };
}

export function addDoc(state: DocumentState, source: string, now: Clock = defaultClock, newId: IdFactory = defaultIds): DocumentState {
  const doc = { id: newId(), source, updatedAt: now() };
  return { docs: nameDocs([doc, ...state.docs]), currentId: doc.id };
}

/** Adds a diagram opened from a file, remembering the file's name so imports can find it. */
export function addFile(state: DocumentState, source: string, fileName: string, now: Clock = defaultClock, newId: IdFactory = defaultIds): DocumentState {
  const next = addDoc(state, source, now, newId);
  return { ...next, docs: next.docs.map((d) => (d.id === next.currentId ? { ...d, fileName } : d)) };
}

/** Renames a diagram's file; `.proschi` is added when missing. Imports of the old name stop resolving. */
export function renameFile(state: DocumentState, id: string, fileName: string): DocumentState {
  const clean = fileName.trim().replace(/^\/+/, '');
  if (!clean) return state;
  const name = clean.endsWith('.proschi') ? clean : `${clean}.proschi`;
  return { ...state, docs: state.docs.map((d) => (d.id === id ? { ...d, fileName: name } : d)) };
}

export function selectDoc(state: DocumentState, id: string): DocumentState {
  return state.docs.some((d) => d.id === id) ? { ...state, currentId: id } : state;
}

/** Deletes a diagram; deleting the last one leaves a blank diagram behind. */
export function removeDoc(state: DocumentState, id: string, now: Clock = defaultClock, newId: IdFactory = defaultIds): DocumentState {
  const docs = state.docs.filter((d) => d.id !== id);
  if (docs.length === 0) return addDoc({ docs: [], currentId: '' }, BLANK_SOURCE, now, newId);
  return { docs, currentId: state.currentId === id ? docs[0].id : state.currentId };
}

/** Diagram name from its `title` line, without parsing the whole document. */
export function titleOf(source: string): string {
  const match = source.match(/^[ \t]*title[ \t]+(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_]\w*))/m);
  const title = match ? (match[1] ?? match[2]).replace(/\\(.)/g, '$1').trim() : '';
  return title || 'Untitled';
}

/** The name imports use for a diagram: its file name, or one made from its title. */
export function fileNameOf(doc: Pick<SavedDiagram, 'source' | 'fileName'>): string {
  return doc.fileName || derivedFileName(doc.source);
}

/**
 * Gives each diagram without a file name one made from its title, unique
 * among the others (`untitled-2.proschi`). Saved diagrams from before file
 * names existed get theirs here, once.
 */
function nameDocs(docs: SavedDiagram[]): SavedDiagram[] {
  if (docs.every((d) => d.fileName)) return docs;
  const taken = new Set(docs.flatMap((d) => (d.fileName ? [d.fileName] : [])));
  return docs.map((d) => {
    if (d.fileName) return d;
    const base = derivedFileName(d.source).slice(0, -'.proschi'.length);
    let name = `${base}.proschi`;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}.proschi`;
    taken.add(name);
    return { ...d, fileName: name };
  });
}

function derivedFileName(source: string): string {
  const slug = titleOf(source)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'diagram'}.proschi`;
}
