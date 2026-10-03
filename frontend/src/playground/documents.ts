/** A diagram saved in this browser. Its name comes from the `title` line. */
export interface SavedDiagram {
  id: string;
  source: string;
  updatedAt: string;
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
    const existing = docs.find((d) => d.source === input.sharedSource);
    if (existing) {
      currentId = existing.id;
    } else {
      const doc = { id: newId(), source: input.sharedSource, updatedAt: now() };
      docs = [doc, ...docs];
      currentId = doc.id;
    }
  }

  if (docs.length === 0) docs.push({ id: newId(), source: input.fallbackSource, updatedAt: now() });
  if (!docs.some((d) => d.id === currentId)) currentId = docs[0].id;
  return { docs, currentId };
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
  return { docs: [doc, ...state.docs], currentId: doc.id };
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
