/**
 * `decompressFromEncodedURIComponent` from lz-string with a cap on the output.
 *
 * LZ-string output grows quadratically with its input at worst: a share link of
 * a few tens of kilobytes can expand to hundreds of megabytes and freeze or
 * crash the tab while it decompresses. This is the same algorithm (lz-string
 * 1.5, `_decompress`, MIT), but it gives up as soon as the text would pass
 * `maxChars`, so the work done is bounded by the cap, not by the link.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
const VALUE = new Map([...ALPHABET].map((c, i) => [c, i]));

export class TooLargeError extends Error {
  readonly maxChars: number;

  constructor(maxChars: number) {
    super(`Decompressed text is larger than ${maxChars} characters`);
    this.maxChars = maxChars;
    this.name = 'TooLargeError';
  }
}

/**
 * Decompresses `input`; returns null when it is not valid lz-string data and
 * throws TooLargeError when the result would be longer than `maxChars`.
 */
export function decompressBounded(input: string, maxChars: number): string | null {
  if (input === '') return null;
  const data = input.replace(/ /g, '+');
  const length = data.length;
  let val = VALUE.get(data[0]) ?? 0;
  let position = 32;
  let index = 1;

  const readBits = (count: number): number => {
    let bits = 0;
    for (let power = 1, max = 2 ** count; power !== max; power *= 2) {
      const bit = val & position;
      position >>= 1;
      if (position === 0) {
        position = 32;
        val = VALUE.get(data[index++]) ?? 0;
      }
      if (bit > 0) bits |= power;
    }
    return bits;
  };

  const dictionary: string[] = ['', '', ''];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let total = 0;
  const result: string[] = [];
  const emit = (text: string) => {
    total += text.length;
    if (total > maxChars) throw new TooLargeError(maxChars);
    result.push(text);
  };

  let c: string;
  switch (readBits(2)) {
    case 0:
      c = String.fromCharCode(readBits(8));
      break;
    case 1:
      c = String.fromCharCode(readBits(16));
      break;
    default:
      return '';
  }
  dictionary[3] = c;
  let w = c;
  emit(c);

  for (;;) {
    if (index > length) return '';
    let code = readBits(numBits);
    switch (code) {
      case 0:
      case 1:
        dictionary[dictSize++] = String.fromCharCode(readBits(code === 0 ? 8 : 16));
        code = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join('');
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }

    let entry: string;
    if (dictionary[code] !== undefined && code < dictSize) entry = dictionary[code];
    else if (code === dictSize) entry = w + w.charAt(0);
    else return null;
    emit(entry);

    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}
