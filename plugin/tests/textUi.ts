import { test as base, type TestBody, type TestOptions } from 'claude-code/testing'

/**
 * `test` for the text UI (docs/design/terminal-mod.md D4): `graphics: off`,
 * so a drawing is text cells from its first draw, as in a terminal without
 * pictures (picture.test.tsx has the drawings in pictures).
 */
export function test(name: string, ...rest: readonly [TestBody] | readonly [TestOptions, TestBody]): void {
  const [options, body] = rest.length === 2 ? rest : [{} as TestOptions, rest[0]]
  base(name, { ...options, options: { graphics: 'off', ...options.options } }, body)
}
