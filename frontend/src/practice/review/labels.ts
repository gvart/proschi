import type { Card } from '../../learn/cards';

/** What each card type asks of the learner, as a card's header names it. */
export const TYPE_LABEL: Record<Card['type'], string> = { flip: 'Recall', choice: 'Pick one', estimate: 'Estimate', cloze: 'Fill the gaps' };
