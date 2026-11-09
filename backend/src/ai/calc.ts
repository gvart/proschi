/**
 * The interviewer's calculator (docs/design/paid-plans.md P38): a small,
 * safe arithmetic evaluator the model calls as the `calculate` tool before it
 * calls a number wrong, so a back-of-the-envelope check is computed, not
 * guessed.
 *
 *   100k * 86400 * 365              numbers with k, M, B (or G), T suffixes and thousands commas
 *   3.2B * 500 bytes in TB          units: bytes (KB, MB, GB, TB, PB and KiB…TiB), time (second … year)
 *   10000 * 5% / second             % is a hundredth; `in <unit>` converts the result
 *   2^10, (1 + 2) / 3, 1e6          + - * / ^, parentheses, exponents; ×, ÷ and · are * and /
 *
 * A number next to a unit multiplies it (`500 bytes` is 500 × bytes). Never
 * evaluates code: anything else is a CalcError the model is told about.
 */

export class CalcError extends Error {}

const SUFFIX: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6, B: 1e9, G: 1e9, T: 1e12 };

const DAY = 86_400;
/** Units, by lower-cased name; a value is in bytes or seconds. */
const UNITS: Record<string, number> = {
  byte: 1, bytes: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15, kib: 2 ** 10, mib: 2 ** 20, gib: 2 ** 30, tib: 2 ** 40, pib: 2 ** 50,
  bit: 1 / 8, bits: 1 / 8,
  ms: 1e-3, millisecond: 1e-3, milliseconds: 1e-3, s: 1, sec: 1, second: 1, seconds: 1, min: 60, minute: 60, minutes: 60, h: 3600, hour: 3600, hours: 3600,
  day: DAY, days: DAY, week: 7 * DAY, weeks: 7 * DAY, month: 30 * DAY, months: 30 * DAY, year: 365 * DAY, years: 365 * DAY,
  thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12,
};

type Token = { kind: 'num'; value: number } | { kind: 'unit'; name: string; value: number } | { kind: 'op'; op: string } | { kind: 'in' };

const MAX_CHARS = 300;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const s = src.replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+-]?\d+)?|^\.\d+/i.exec(s.slice(i));
    if (num) {
      let value = Number(num[0].replace(/,/g, ''));
      i += num[0].length;
      // A suffix right after the number (10k, 3.2B), not the start of a word (10 kb is a unit).
      const after = s.slice(i);
      const suffix = /^([kKMBGT])(?![a-zA-Z])/.exec(after);
      if (suffix) {
        value *= SUFFIX[suffix[1]];
        i += 1;
      }
      if (s[i] === '%') {
        value /= 100;
        i++;
      }
      tokens.push({ kind: 'num', value });
      continue;
    }
    const word = /^[a-zA-Z]+/.exec(s.slice(i));
    if (word) {
      const name = word[0].toLowerCase();
      i += word[0].length;
      if (name === 'in' || name === 'to') tokens.push({ kind: 'in' });
      else if (Object.prototype.hasOwnProperty.call(UNITS, name)) tokens.push({ kind: 'unit', name, value: UNITS[name] });
      else throw new CalcError(`Unknown word "${word[0]}"`);
      continue;
    }
    if ('+-*/^()'.includes(c)) {
      tokens.push({ kind: 'op', op: c });
      i++;
      continue;
    }
    throw new CalcError(`Unexpected "${c}"`);
  }
  return tokens;
}

/** Evaluates an expression; returns the value and, with `in <unit>`, the unit it is in. */
export function calculate(expression: string): { value: number; unit?: string } {
  if (expression.length > MAX_CHARS) throw new CalcError(`At most ${MAX_CHARS} characters`);
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (op: string) => {
    const t = peek();
    return t?.kind === 'op' && t.op === op;
  };

  function primary(): number {
    const t = peek();
    if (!t) throw new CalcError('The expression ends too early');
    if (t.kind === 'num' || t.kind === 'unit') {
      pos++;
      // A number and its unit belong together: 1 TB / 10 MB is (1 TB) / (10 MB).
      const unit = peek();
      if (t.kind === 'num' && unit?.kind === 'unit') {
        pos++;
        return t.value * unit.value;
      }
      return t.value;
    }
    if (t.kind === 'op' && t.op === '(') {
      pos++;
      const v = sum();
      if (!isOp(')')) throw new CalcError('A parenthesis is not closed');
      pos++;
      return v;
    }
    if (t.kind === 'op' && t.op === '-') {
      pos++;
      return -power();
    }
    throw new CalcError(`Unexpected ${t.kind === 'op' ? `"${t.op}"` : '"in"'}`);
  }
  function power(): number {
    const base = primary();
    if (!isOp('^')) return base;
    pos++;
    return base ** power();
  }
  function product(): number {
    let v = power();
    for (;;) {
      const t = peek();
      if (t?.kind === 'op' && (t.op === '*' || t.op === '/')) {
        pos++;
        const r = power();
        v = t.op === '*' ? v * r : v / r;
      } else if (t && (t.kind === 'num' || t.kind === 'unit' || (t.kind === 'op' && t.op === '('))) {
        // Side by side: 500 bytes, 2 (3 + 4).
        v *= power();
      } else return v;
    }
  }
  function sum(): number {
    let v = product();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[pos++] as { op: string }).op;
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  let value = sum();
  let unit: string | undefined;
  if (peek()?.kind === 'in') {
    pos++;
    const t = peek();
    if (t?.kind !== 'unit') throw new CalcError('"in" needs a unit after it');
    pos++;
    value /= t.value;
    unit = t.name;
  }
  if (pos < tokens.length) throw new CalcError('Unexpected text after the expression');
  if (!Number.isFinite(value)) throw new CalcError('The result is not a finite number');
  return { value, ...(unit ? { unit } : {}) };
}

/** A number for people: 6 significant digits with thousands commas, and a short form with M/B/T for large ones. */
export function formatNumber(n: number): string {
  const abs = Math.abs(n);
  const sig = (x: number, digits: number) => Number(x.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 6 });
  for (const [div, s] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M']] as const) if (abs >= div) return `${sig(n, 6)} (${sig(n / div, 4)}${s})`;
  return sig(n, 6);
}

/** The tool's answer: the result, or why it could not be computed (the model is told; never a thrown error). */
export function calculateTool(input: unknown): { content: string; isError: boolean } {
  const expression = (input as { expression?: unknown } | null)?.expression;
  if (typeof expression !== 'string' || !expression.trim()) return { content: 'Give an expression to evaluate', isError: true };
  try {
    const { value, unit } = calculate(expression);
    return { content: `${expression.trim()} = ${formatNumber(value)}${unit ? ` ${unit}` : ''}`, isError: false };
  } catch (e) {
    if (e instanceof CalcError) return { content: `Could not evaluate: ${e.message}`, isError: true };
    throw e;
  }
}

/** The tool's definition for the Messages API. */
export const CALCULATE_TOOL = {
  name: 'calculate',
  description:
    'Evaluates an arithmetic expression exactly, with unit conversion. Use it to check every number before you say whether a candidate\'s estimate or calculation is right or wrong, and for your own arithmetic. Supports + - * / ^ and parentheses, numbers like 10k, 3.2B, 1,000, 1e6 and 5%, and units: bytes, KB, MB, GB, TB, PB (powers of 1000), KiB…TiB, bits, ms, second, minute, hour, day, week, month (30 days), year (365 days). Data is in bytes and time in seconds, so "100M / day" is the rate per second. A number next to a unit multiplies it; end with "in <unit>" to convert, e.g. "3.2B * 500 bytes in TB". Several checks go in parallel calls.',
  input_schema: {
    type: 'object',
    properties: { expression: { type: 'string', description: 'The expression, e.g. "100 * 86400 * 365" or "10k * 5%"' } },
    required: ['expression'],
    additionalProperties: false,
  },
  strict: true,
} as const;
