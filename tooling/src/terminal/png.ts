/**
 * The raster helper's files: PNGs encoded off the main thread (unfiltered,
 * zlib level 3), written once under a temporary name and renamed into place,
 * named by a content hash, their times touched when used again so a prune
 * keeps them. Shared by the diagram (rasterHost.ts) and the UI panels
 * (panelHost.ts).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { promisify } from 'node:util';
import { deflate as deflateCallback } from 'node:zlib';

/** Marks files as used now, so a prune keeps them. */
export function touch(files: string[]): void {
  const now = new Date();
  for (const f of files) {
    try {
      utimesSync(f, now, now);
    } catch {
      // Pruned by another call meanwhile: it is drawn again next time.
    }
  }
}

export const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 20);

/** Writes `bytes` to `file` unless it is there already, through a temporary name. */
export function put(file: string, bytes: Uint8Array | string): void {
  if (existsSync(file)) return;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
}

/** RGBA pixels, row by row, premultiplied (as resvg gives them). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Width and height from a PNG's IHDR. */
export function pngSize(file: string): { width: number; height: number } {
  const head = readFileSync(file).subarray(0, 24);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const deflate = promisify(deflateCallback);

/**
 * An RGBA PNG, unfiltered at zlib level 3: three times as fast as resvg's
 * own encoder for files a third larger, which is the better trade for frames
 * that go to a terminal right away. The rows are copied out at once, so the
 * pixels can go; the compression runs on libuv's thread pool.
 */
export async function encodePng({ width, height, data }: Pixels): Promise<Buffer> {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const idat = await deflate(raw, { level: 3 });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]);
}

/** PNGs encoded at once, at most: the thread pool's four, or the cores where there are fewer. Each holds a frame's rows. */
const ENCODERS = Math.max(1, Math.min(4, typeof availableParallelism === 'function' ? availableParallelism() : cpus().length));

/**
 * Encodes and writes PNGs while the next frames are drawn: `add` waits only
 * while ENCODERS are busy, `done` for the last of them. Compression is
 * most of a frame's time (zlib on 20 MB of rows), drawing the rest.
 */
export class Writer {
  private busy = new Set<Promise<void>>();

  async add(file: string, pixels: Pixels): Promise<void> {
    while (this.busy.size >= ENCODERS) await Promise.race(this.busy);
    const job: Promise<void> = encodePng(pixels)
      .then((png) => put(file, png))
      .finally(() => this.busy.delete(job));
    this.busy.add(job);
  }

  async done(): Promise<void> {
    await Promise.all(this.busy);
  }
}
