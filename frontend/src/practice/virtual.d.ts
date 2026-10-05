/** Built by plugins/practiceListings.ts. */
declare module 'virtual:practice-listings' {
  const listings: import('./listing').ProblemListing[];
  export default listings;
}

/** Built by plugins/practiceListings.ts: reading minutes of each problem's lesson and of each guide, by id. */
declare module 'virtual:practice-lessons' {
  export const lessons: Record<string, number>;
  export const guides: Record<string, number>;
}

/** Built by plugins/practiceCards.ts: every card and topic. Import it lazily: it is the whole deck. */
declare module 'virtual:practice-cards' {
  const bundle: { format: 1; hash: string; topics: import('../learn/cards').Topic[]; cards: import('../learn/cards').Card[] };
  export default bundle;
}

/** Built by plugins/practiceCards.ts: how many cards, topics and free sample cards there are. */
declare module 'virtual:practice-cards-summary' {
  const summary: { cards: number; topics: number; sample: number };
  export default summary;
}
