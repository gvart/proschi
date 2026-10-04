import type { ReactNode } from 'react';
import { badgeClass, type BadgeTone } from './classes';

/** A small bordered label: a difficulty, a status, a count. */
export default function Badge({ tone, className, children }: { tone?: BadgeTone; className?: string; children?: ReactNode }) {
  return <span className={badgeClass({ tone, className })}>{children}</span>;
}
