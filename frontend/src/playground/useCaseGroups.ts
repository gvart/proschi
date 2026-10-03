import type { DiagramUseCase } from '../dsl';

interface UseCaseGroup {
  /** `METHOD /path` shared by the group, or undefined when nothing is grouped. */
  label?: string;
  useCases: DiagramUseCase[];
}

/** Groups use cases by the endpoint of their first step, in document order. */
export function groupByEndpoint(useCases: DiagramUseCase[]): UseCaseGroup[] {
  if (!useCases.some((u) => u.endpoint)) return [{ useCases }];
  const groups = new Map<string, DiagramUseCase[]>();
  for (const u of useCases) {
    const label = u.endpoint ?? 'Other flows';
    groups.set(label, [...(groups.get(label) ?? []), u]);
  }
  return [...groups].map(([label, list]) => ({ label, useCases: list }));
}
