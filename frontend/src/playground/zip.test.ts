import { describe, expect, it } from 'vitest';
import { crc32, readZip, writeZip, ZipError } from './zip';

const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('round-trips files, including UTF-8 names and contents', () => {
    const files = [
      { name: 'checkout.proschi', data: 'title "Checkout"\na -> b' },
      { name: 'dir/café ☕.proschi', data: 'title "Café ☕"' },
      { name: 'empty.txt', data: '' },
      { name: 'bytes.bin', data: new Uint8Array([0, 255, 10, 13]) },
    ];
    const entries = readZip(writeZip(files, new Date(2026, 9, 4, 12, 30, 10)));
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    expect(text(entries[0].data)).toBe(files[0].data);
    expect(text(entries[1].data)).toBe(files[1].data);
    expect(entries[2].data.length).toBe(0);
    expect([...entries[3].data]).toEqual([0, 255, 10, 13]);
  });

  it('writes a file other tools can read: signatures and stored method', () => {
    const zip = writeZip([{ name: 'a.txt', data: 'hi' }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });

  it('rejects what is not a zip, a truncated zip and a corrupted entry', () => {
    expect(() => readZip(new TextEncoder().encode('not a zip at all, just text'))).toThrow(ZipError);
    const zip = writeZip([{ name: 'a.txt', data: 'hello world' }]);
    expect(() => readZip(zip.slice(0, zip.length - 30))).toThrow(ZipError);
    const corrupted = zip.slice();
    corrupted[30 + 'a.txt'.length] ^= 0xff; // first byte of the data
    expect(() => readZip(corrupted)).toThrow(/checksum/);
  });

  it('rejects offsets pointing outside the file', () => {
    const zip = writeZip([{ name: 'a.txt', data: 'hello' }]);
    const view = new DataView(zip.buffer);
    const central = view.getUint32(zip.length - 22 + 16, true);
    view.setUint32(central + 42, 0xfffffff0, true); // local header offset
    expect(() => readZip(zip)).toThrow(ZipError);
  });

  it('rejects compressed entries with a clear message', () => {
    const zip = writeZip([{ name: 'a.txt', data: 'hello' }]);
    const view = new DataView(zip.buffer);
    const central = view.getUint32(zip.length - 22 + 16, true);
    view.setUint16(central + 10, 8, true); // deflate
    expect(() => readZip(zip)).toThrow(/compressed/);
  });
});
