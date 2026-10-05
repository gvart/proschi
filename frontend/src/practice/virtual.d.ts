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
