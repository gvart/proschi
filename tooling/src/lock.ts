/**
 * `proschi.lock` pins every remote import (git and https) to the bytes it
 * was first synced with; `.proschi/cache/` holds those bytes, named by their
 * sha256. Both live at the project root. Only `proschi imports sync` writes
 * them; every other command reads remote imports from here and never touches
 * the network.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImportError, parseRemoteSpec } from '../../frontend/src/dsl/imports';

export const LOCK_FILE = 'proschi.lock';
export const CACHE_DIR = join('.proschi', 'cache');

export interface GitLock {
  /** The commit the ref resolved to when it was first synced. */
  commit: string;
  /** sha256 (hex) of each file read from the repository, by path in the repository. */
  files: Record<string, string>;
}

export interface Lock {
  version: 1;
  /** By `<host>/<org>/<repo>@<ref>`. */
  git: Record<string, GitLock>;
  /** sha256 (hex) by URL. */
  https: Record<string, string>;
}

const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export const emptyLock = (): Lock => ({ version: 1, git: {}, https: {} });

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The lock key of a git spec's repository and ref. */
export const gitKey = (repo: string, ref: string): string => `${repo}@${ref}`;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Reads the project's lockfile: undefined when there is none. A lockfile
 * comes in with pull requests like any other file, so every value is checked
 * before it is used as a path (hashes name cache files).
 */
export function readLock(root: string): Lock | undefined {
  const file = join(root, LOCK_FILE);
  if (!existsSync(file)) return undefined;
  const invalid = (why: string) => new ImportError(`Invalid ${LOCK_FILE}: ${why}; delete it and run proschi imports sync`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw invalid((e as Error).message);
  }
  if (!isRecord(json) || json.version !== 1) throw invalid('expected {"version": 1, …}');
  const lock = emptyLock();
  const git = json.git ?? {};
  const https = json.https ?? {};
  if (!isRecord(git) || !isRecord(https)) throw invalid('"git" and "https" must be objects');
  for (const [key, entry] of Object.entries(git)) {
    const at = key.lastIndexOf('@');
    const valid =
      at > 0 &&
      isRecord(entry) &&
      typeof entry.commit === 'string' &&
      COMMIT.test(entry.commit) &&
      isRecord(entry.files) &&
      Object.entries(entry.files).every(([path, hash]) => typeof hash === 'string' && HASH.test(hash) && isGitSpec(`git:${key.slice(0, at)}//${path}@${key.slice(at + 1)}`));
    if (!valid) throw invalid(`bad git entry '${key}'`);
    lock.git[key] = { commit: entry.commit as string, files: { ...(entry.files as Record<string, string>) } };
  }
  for (const [url, hash] of Object.entries(https)) {
    if (typeof hash !== 'string' || !HASH.test(hash) || parseRemoteSpec(url)?.kind !== 'https') throw invalid(`bad https entry '${url}'`);
    lock.https[url] = hash;
  }
  return lock;
}

function isGitSpec(spec: string): boolean {
  try {
    return parseRemoteSpec(spec)?.kind === 'git';
  } catch {
    return false;
  }
}

const sorted = <T>(o: Record<string, T>, map: (v: T) => unknown = (v) => v) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, map(o[k])]));

/** The lockfile's text: keys sorted, so it diffs well and the same imports always give the same file. */
export function formatLock(lock: Lock): string {
  return JSON.stringify({ version: 1, git: sorted(lock.git, (e) => ({ commit: e.commit, files: sorted(e.files) })), https: sorted(lock.https) }, null, 2) + '\n';
}

export function writeLock(root: string, lock: Lock): void {
  writeFileSync(join(root, LOCK_FILE), formatLock(lock));
}

/** The sha256 the lock holds for a remote spec (canonical form), if any. */
export function lockedHash(lock: Lock, spec: string): string | undefined {
  const remote = parseRemoteSpec(spec);
  if (remote?.kind === 'git') return lock.git[gitKey(remote.repo, remote.ref)]?.files[remote.path];
  if (remote?.kind === 'https') return lock.https[remote.url];
  return undefined;
}

const cacheFile = (root: string, hash: string) => join(root, CACHE_DIR, hash);

/** Cached bytes with this sha256: undefined when not cached; an ImportError when the copy was altered. */
export function readCached(root: string, hash: string, spec: string): Buffer | undefined {
  if (!HASH.test(hash)) return undefined;
  const file = cacheFile(root, hash);
  if (!existsSync(file)) return undefined;
  const bytes = readFileSync(file);
  if (sha256(bytes) !== hash) throw new ImportError(`The cached copy of '${spec}' does not match its hash in ${LOCK_FILE}; run proschi imports sync`);
  return bytes;
}

/** Stores bytes in the cache under their sha256, which it returns. */
export function writeCached(root: string, bytes: Uint8Array): string {
  const hash = sha256(bytes);
  const dir = join(root, CACHE_DIR);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${hash}.${process.pid}.tmp`);
  writeFileSync(tmp, bytes);
  renameSync(tmp, cacheFile(root, hash));
  return hash;
}
