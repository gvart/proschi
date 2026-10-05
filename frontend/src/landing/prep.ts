import type { RoadmapStage } from '../practice/roadmap';

/**
 * The landing page's interview prep section: the roadmap's stages
 * (src/practice/roadmap.ts) and its counts, rendered into index.html at build
 * time (plugins/practiceListings.ts replaces the `<!--roadmap:…-->`
 * placeholders), so the section is complete at first paint and never falls
 * behind the roadmap.
 */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The `<li>` items of the stage list. */
export function prepStagesHtml(stages: Pick<RoadmapStage, 'id' | 'title' | 'problems'>[]): string {
  return stages
    .map(
      (s, i) => `<li class="prep__stage" data-stage="${escapeHtml(s.id)}">
  <span class="prep__stage-no" aria-hidden="true">${i + 1}</span>
  <span class="prep__stage-title">${escapeHtml(s.title)}</span>
  <span class="prep__stage-count">${s.problems.length} ${s.problems.length === 1 ? 'problem' : 'problems'}</span>
</li>`,
    )
    .join('\n');
}

/** What each `<!--roadmap:name-->` placeholder becomes. */
export function prepPlaceholders(stages: Pick<RoadmapStage, 'id' | 'title' | 'problems'>[]): Record<string, string> {
  return {
    stages: prepStagesHtml(stages),
    'stage-count': String(stages.length),
    'problem-count': String(stages.reduce((n, s) => n + s.problems.length, 0)),
  };
}

const PLACEHOLDER = /<!--roadmap:([a-z-]+)-->/g;

/** `html` with every `<!--roadmap:…-->` placeholder filled; an unknown name is an error. */
export function fillPrepPlaceholders(html: string, stages: Pick<RoadmapStage, 'id' | 'title' | 'problems'>[]): string {
  const values = prepPlaceholders(stages);
  return html.replace(PLACEHOLDER, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`unknown placeholder <!--roadmap:${name}-->`);
    return value;
  });
}
