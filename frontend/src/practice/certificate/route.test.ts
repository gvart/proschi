import { describe, expect, it } from 'vitest';
import { certificateAddressOf, certificateIdOf } from './route';

describe('certificate routes', () => {
  it('reads `#/c/<id>`', () => {
    expect(certificateIdOf('c/Ab3_x-9QrT0z')).toBe('Ab3_x-9QrT0z');
    expect(certificateIdOf('c/short')).toBe('');
    expect(certificateIdOf('c/')).toBe('');
    expect(certificateIdOf('url-shortener')).toBeUndefined();
    expect(certificateIdOf('u/Ab3_x-9QrT0z')).toBeUndefined();
  });

  it('maps the certificate’s own address to the practice page’s', () => {
    expect(certificateAddressOf('/c/Ab3_x-9QrT0z')).toBe('/practice/#/c/Ab3_x-9QrT0z');
    expect(certificateAddressOf('/c/Ab3_x-9QrT0z/')).toBe('/practice/#/c/Ab3_x-9QrT0z');
    expect(certificateAddressOf('/c/bad')).toBeUndefined();
    expect(certificateAddressOf('/practice/')).toBeUndefined();
  });
});
