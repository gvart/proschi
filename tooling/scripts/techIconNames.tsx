// Prints the canvas's icon per tech stack and per component type (frontend/src/utils/iconMapping.tsx)
// as the icons' component names, for build.mjs to write src/terminal/techIcons.gen.ts.
import type { ReactElement } from 'react';
import { techStackIcons, typeIcons } from '../../frontend/src/utils/iconMapping';

const nameOf = (icon: ReactElement | undefined): string => {
  const type = icon?.type as { displayName?: string; name?: string } | undefined;
  return type?.displayName ?? type?.name ?? 'Server';
};
const names = (icons: Record<string, ReactElement | undefined>) => Object.fromEntries(Object.entries(icons).map(([k, v]) => [k, nameOf(v)]));

process.stdout.write(JSON.stringify({ tech: names(techStackIcons), type: names(typeIcons) }));
