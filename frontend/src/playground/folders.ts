import { addDoc, fileNameOf, removeDoc, titleOf, type DocumentState, type SavedDiagram } from './documents';
import { retitle } from './sync';

/**
 * Folders of the editor's diagrams. A folder is the directory part of a
 * diagram's file name (`payments/api.proschi` is in `payments`), so folders
 * sync with the account as they are, imports between them work like in a
 * repository, and an empty folder does not exist.
 */

/** A folder path as typed: segments trimmed, empty, `.` and `..` ones dropped, no leading or trailing slash. '' is the top. */
export function cleanFolder(path: string): string {
  return path
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

/** The folder a file name is in, '' at the top. */
export function folderOf(fileName: string): string {
  const i = fileName.lastIndexOf('/');
  return i < 0 ? '' : fileName.slice(0, i);
}

/** A file name without its folder. */
export function baseOf(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf('/') + 1);
}

const join = (folder: string, base: string) => (folder ? `${folder}/${base}` : base);

/** `name` if free, else `name-2.proschi`, `name-3.proschi`, … */
function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const stem = name.replace(/\.proschi$/, '');
  for (let n = 2; ; n++) if (!taken.has(`${stem}-${n}.proschi`)) return `${stem}-${n}.proschi`;
}

const takenBy = (docs: SavedDiagram[], except?: string) => new Set(docs.filter((d) => d.id !== except).map(fileNameOf));

/** Moves a diagram into `folder` ('' for the top), keeping its file's base name (numbered when taken there). Imports of its old path stop resolving. */
export function moveDoc(state: DocumentState, id: string, folder: string): DocumentState {
  const doc = state.docs.find((d) => d.id === id);
  if (!doc) return state;
  const name = fileNameOf(doc);
  const target = cleanFolder(folder);
  if (folderOf(name) === target) return state;
  const fileName = freeName(join(target, baseOf(name)), takenBy(state.docs, id));
  return { ...state, docs: state.docs.map((d) => (d.id === id ? { ...d, fileName } : d)) };
}

/** Adds a new diagram inside `folder` and opens it. */
export function addDocIn(state: DocumentState, source: string, folder: string, now?: () => string, newId?: () => string): DocumentState {
  const added = addDoc(state, source, now, newId);
  return moveDoc(added, added.currentId, folder);
}

/** A copy of a diagram next to it, titled "<title> copy", opened. Share-link imports come along. */
export function duplicateDoc(state: DocumentState, id: string, now?: () => string, newId?: () => string): DocumentState {
  const doc = state.docs.find((d) => d.id === id);
  if (!doc) return state;
  const added = addDoc(state, retitle(doc.source, `${titleOf(doc.source)} copy`), now, newId);
  const copy = added.currentId;
  const name = fileNameOf(doc).replace(/\.proschi$/, '');
  const fileName = freeName(`${name}-copy.proschi`, takenBy(added.docs, copy));
  return { ...added, docs: added.docs.map((d) => (d.id === copy ? { ...d, fileName, ...(doc.imports ? { imports: doc.imports } : {}) } : d)) };
}

const inFolder = (fileName: string, folder: string) => fileName.startsWith(`${folder}/`);

/** Renames (or moves) folder `from` to `to`, with its subfolders. Names already taken at the target are numbered. */
export function renameFolder(state: DocumentState, from: string, to: string): DocumentState {
  const source = cleanFolder(from);
  const target = cleanFolder(to);
  if (!source || source === target || inFolder(target, source)) return state;
  const moving = new Set(state.docs.filter((d) => inFolder(fileNameOf(d), source)).map((d) => d.id));
  if (moving.size === 0) return state;
  const taken = new Set(state.docs.filter((d) => !moving.has(d.id)).map(fileNameOf));
  const docs = state.docs.map((d) => {
    if (!moving.has(d.id)) return d;
    const fileName = freeName(join(target, fileNameOf(d).slice(source.length + 1)), taken);
    taken.add(fileName);
    return { ...d, fileName };
  });
  return { ...state, docs };
}

/** The diagrams in a folder and its subfolders. */
export function docsInFolder(docs: SavedDiagram[], folder: string): SavedDiagram[] {
  return docs.filter((d) => inFolder(fileNameOf(d), cleanFolder(folder)));
}

/** Deletes a folder with every diagram in it; deleting them all leaves a blank diagram, as removeDoc does. */
export function removeFolder(state: DocumentState, folder: string, now?: () => string, newId?: () => string): DocumentState {
  return docsInFolder(state.docs, folder).reduce((s, d) => removeDoc(s, d.id, now, newId), state);
}

/** Every folder that has a diagram somewhere under it, parents included, sorted. */
export function allFolders(docs: SavedDiagram[]): string[] {
  const folders = new Set<string>();
  for (const d of docs) {
    const parts = folderOf(fileNameOf(d)).split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
}

export interface FolderNode {
  /** Its full path, '' for the top. */
  path: string;
  name: string;
  folders: FolderNode[];
  /** Sorted by title. */
  docs: SavedDiagram[];
}

/** The diagrams as a folder tree: folders first, then diagrams, each sorted by name. */
export function buildTree(docs: SavedDiagram[]): FolderNode {
  const root: FolderNode = { path: '', name: '', folders: [], docs: [] };
  const nodes = new Map<string, FolderNode>([['', root]]);
  const nodeOf = (path: string): FolderNode => {
    const found = nodes.get(path);
    if (found) return found;
    const parent = nodeOf(folderOf(path));
    const node: FolderNode = { path, name: baseOf(path), folders: [], docs: [] };
    parent.folders.push(node);
    nodes.set(path, node);
    return node;
  };
  for (const d of docs) nodeOf(folderOf(fileNameOf(d))).docs.push(d);
  const sort = (node: FolderNode) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.docs.sort((a, b) => titleOf(a.source).localeCompare(titleOf(b.source)) || fileNameOf(a).localeCompare(fileNameOf(b)));
    node.folders.forEach(sort);
  };
  sort(root);
  return root;
}

/** Whether a diagram matches a search: every word in its title or file path, ignoring case. */
export function matchesQuery(doc: SavedDiagram, query: string): boolean {
  const hay = `${titleOf(doc.source)} ${fileNameOf(doc)}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/**
 * The other diagrams whose imports may name one of `ids` by its current file
 * name (a quoted path ending in its base name): moving or renaming those
 * files breaks them. A hint for a warning, not a parse.
 */
export function importersOf(docs: SavedDiagram[], ids: ReadonlySet<string>): SavedDiagram[] {
  const bases = docs.filter((d) => ids.has(d.id)).map((d) => baseOf(fileNameOf(d)));
  if (bases.length === 0) return [];
  return docs.filter((d) => !ids.has(d.id) && bases.some((base) => d.source.includes(`/${base}"`) || d.source.includes(`"${base}"`)));
}
