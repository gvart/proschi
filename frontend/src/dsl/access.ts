/**
 * Read or write: the access of a request step (docs/design/hld-and-practice.md
 * §7.2). Shared by the parser, which sets `DiagramStep.access`, and the
 * simulation, which counts read and write load separately.
 */

export type Access = 'read' | 'write';

/** HTTP methods that write. Every other method (GET, HEAD, OPTIONS) reads. */
export const WRITE_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * First words of a label (compared case-insensitively) that make a step
 * without an HTTP method a write. Any other word reads: GET, SELECT, QUERY,
 * SCAN, FETCH, LOOKUP, GEOSEARCH, GETITEM, MGET, an event name, …
 */
export const WRITE_VERBS: readonly string[] = [
  'INSERT',
  'UPDATE',
  'UPSERT',
  'DELETE',
  'PUT',
  'SET',
  'WRITE',
  'APPEND',
  'INCR',
  'DECR',
  'LPUSH',
  'RPUSH',
  'ZADD',
  'HSET',
  'GEOADD',
  'PUBLISH',
  'SEND',
  'ENQUEUE',
  'PRODUCE',
  'CHARGE',
  'CREATE',
  // DynamoDB and Redis commands that store data
  'PUTITEM',
  'UPDATEITEM',
  'DELETEITEM',
  'BATCHWRITEITEM',
  'INCRBY',
  'HINCRBY',
  'SADD',
  'XADD',
  'MSET',
  // Plain words for storing something
  'SAVE',
  'STORE',
  'UPLOAD',
  'COMMIT',
  'RECORD',
  'MARK',
  // Claiming a resource changes state: a seat, a driver, stock
  'RESERVE',
  'HOLD',
  'BOOK',
  // Handing something on: a write at the receiver (a queue, a provider), like SEND and PUBLISH
  'EMIT',
  'NOTIFY',
];

/**
 * The access of a request step: `write` for a writing HTTP method; without a
 * method, `write` when the label's first word is in WRITE_VERBS; `read`
 * otherwise. `label` is the step label without its `x<N>` / `~<size>`
 * prefixes; a leading quote is skipped, so `"charge card"` writes.
 */
export function accessOf(httpMethod: string | undefined, label: string): Access {
  if (httpMethod) return WRITE_METHODS.includes(httpMethod.toUpperCase()) ? 'write' : 'read';
  const word = /^\s*"?([A-Za-z_]+)/.exec(label)?.[1];
  return word && WRITE_VERBS.includes(word.toUpperCase()) ? 'write' : 'read';
}
