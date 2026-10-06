import { clozeWithAnswers, type Card, type ClozeCard } from '../src/learn/cards'
import { inlineText, parseInline } from '../src/practice/markdown.ts'

/**
 * A review card's sides as plain text, for the static card pages' titles,
 * descriptions and structured data (plugins/cardPages.ts) and the problem
 * pages' lists of related cards (plugins/practicePages.ts).
 */

/** Markdown as one line of plain text: inline marks dropped, list markers and line breaks folded. */
export function markdownText(md: string): string {
  return md
    .split('\n')
    .map((line) => inlineText(parseInline(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').replace(/^#+\s+/, ''))))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** How a cloze card's gap reads as plain text. */
export const BLANK = '_____'
/**
 * The gap in Markdown: a private-use character the Markdown reader leaves
 * alone (underscores would read as emphasis), for the page to draw as a line.
 */
export const BLANK_MARK = '\uE000'

/** A cloze card's text with its gaps marked BLANK_MARK. */
export const clozeBlanked = (card: ClozeCard) => card.text.replace(/\{\{\d+\}\}/g, BLANK_MARK)

/** The question side as Markdown: a cloze card with its gaps marked BLANK_MARK. */
export function questionMarkdown(card: Card): string {
  switch (card.type) {
    case 'flip':
      return card.front
    case 'choice':
    case 'estimate':
      return card.question
    case 'cloze':
      return clozeBlanked(card)
  }
}

export const questionText = (card: Card) => markdownText(questionMarkdown(card)).replaceAll(BLANK_MARK, BLANK)

/** A number as people write it: 2300 → "2,300". */
export const formatNumber = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 })

/** The answer as plain text: the back, the right option, the number with its unit, or the filled-in sentence. */
export function answerText(card: Card): string {
  switch (card.type) {
    case 'flip':
      return markdownText(card.back)
    case 'choice':
      return markdownText(card.options.find((o) => o.correct)?.text ?? '')
    case 'estimate':
      return `About ${formatNumber(card.answer)} ${card.unit}.`
    case 'cloze':
      return markdownText(clozeWithAnswers(card))
  }
}
