import type { ReactNode } from 'react';
import { observeReveal } from './motion';

export interface RevealProps {
  as?: 'div' | 'section' | 'li' | 'article' | 'figure';
  /** Staggers siblings: each step waits a little longer (data-reveal-delay, 1–3). */
  delay?: 1 | 2 | 3;
  className?: string;
  children?: ReactNode;
}

// A stable callback ref (React 19 runs its returned cleanup on unmount).
const revealRef = (el: HTMLElement | null) => (el ? observeReveal(el) : undefined);

/**
 * Fades and slides its content in as it scrolls into view. Static markup gets
 * the same with a `data-reveal` attribute (and enhance.ts). Content stays
 * visible without JavaScript and under reduced motion. Do not combine with
 * `magnetic` on one element: both move it with `translate`.
 */
export default function Reveal({ as: Tag = 'div', delay, className, children }: RevealProps) {
  return (
    <Tag ref={revealRef} className={className} data-reveal="" data-reveal-delay={delay}>
      {children}
    </Tag>
  );
}
