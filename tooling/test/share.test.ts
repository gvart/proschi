import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeShareLink } from '../../frontend/src/playground/share';
import { run } from '../src/cli';

function capture(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const dir = mkdtempSync(join(tmpdir(), 'proschi-share-'));
mkdirSync(join(dir, 'docs'));
mkdirSync(join(dir, 'shared'));
writeFileSync(join(dir, 'shared', 'base.proschi'), 'db [PostgreSQL]\n');
writeFileSync(join(dir, 'docs', 'given.proschi'), 'import "../shared/base.proschi"\nclient [Browser]\n');
const shop = 'import "given.proschi"\napi [REST API]\nclient -> api\napi -> db\n';
writeFileSync(join(dir, 'docs', 'shop.proschi'), shop);
writeFileSync(join(dir, 'alone.proschi'), 'a -> b\n');

describe('proschi share-link', () => {
  it('prints an editor link the web editor decodes, with the imported files', () => {
    const r = capture(['share-link', join(dir, 'docs', 'shop.proschi')]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^https:\/\/proschi\.app\/app\/#code=/);
    const link = decodeShareLink(r.out.slice(r.out.indexOf('#')));
    expect(link?.source).toBe(shop);
    // Keyed as the editor resolves them: relative to the document, known by its name.
    expect(link?.imports).toEqual({
      'given.proschi': 'import "../shared/base.proschi"\nclient [Browser]\n',
      '../shared/base.proschi': 'db [PostgreSQL]\n',
    });
  });

  it('leaves imports out when there are none and takes another base', () => {
    const r = capture(['share-link', '--base', 'http://localhost:5173/app/', join(dir, 'alone.proschi')]);
    expect(r.out).toMatch(/^http:\/\/localhost:5173\/app\/#code=[^&]+$/);
  });

  it('rejects bad usage', () => {
    expect(capture(['share-link']).code).toBe(2);
    expect(capture(['share-link', '--base', 'ftp://x', 'a.proschi']).code).toBe(2);
    expect(capture(['share-link', join(dir, 'missing.proschi')]).code).toBe(2);
  });
});
