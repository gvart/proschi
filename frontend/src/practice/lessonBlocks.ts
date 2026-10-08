/**
 * The lesson blocks' names and fences (docs/PRACTICE.md, "Lesson blocks"),
 * shared by the Markdown reader (markdown.ts) and the lesson check
 * (lesson.ts). Pure, with no imports.
 */

export const CALLOUT_TONES = ['tip', 'pitfall', 'interview', 'takeaway'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/** Each tone's title when the block names none. */
export const CALLOUT_TITLES: Record<CalloutTone, string> = { tip: 'Tip', pitfall: 'Pitfall', interview: 'In the interview', takeaway: 'Key takeaway' };

/** The fence languages that are lesson blocks rather than code. */
export const RICH_BLOCKS = ['tldr', 'callout', 'numbers', 'deepdive', 'quiz'] as const;
/** The title of a ```tldr block. */
export const TLDR_TITLE = 'In 30 seconds';

/** An opening fence: its backticks, its language and the rest of the info line. */
export const FENCE = /^\s*(`{3,})\s*([\w-]*)(?:\s+(.*?))?\s*$/;
/** Whether a line closes a fence opened with `ticks` backticks: as many or more, nothing else. */
export const closesFence = (line: string, ticks: string) => new RegExp(`^\\s*\`{${ticks.length},}\\s*$`).test(line);
