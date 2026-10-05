/**
 * Articles that go with the roadmap, one Markdown file each in this folder
 * (<id>.md, no front matter): read in the practice app at
 * practice/#/roadmap/<id> without signing in, and as a static page at
 * practice/<id>/ (plugins/practicePages.ts). Their ids are reserved, so no
 * problem can take them (RESERVED_IDS in ../problemFiles.ts).
 */

export interface Guide {
  id: string;
  title: string;
  /** One sentence for the roadmap card and the page description. */
  summary: string;
}

export const GUIDES: Guide[] = [
  {
    id: 'approach',
    title: 'How to approach a system design interview',
    summary:
      'A four-step plan for the 45 minutes: scope the problem, sketch a high-level design, go deep where it matters and wrap up, with the estimation and availability numbers you need on the way.',
  },
];

export const findGuide = (id: string): Guide | undefined => GUIDES.find((g) => g.id === id);
