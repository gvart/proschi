import type { ReactNode } from 'react';
import { cardClass, type Accent } from './classes';

export interface CardProps {
  /** A coloured stripe along the top. */
  accent?: Accent;
  /** Lifts on hover and presses on click. Links are always interactive. */
  interactive?: boolean;
  /** Makes the whole card a link. */
  href?: string;
  as?: 'div' | 'article' | 'section' | 'li';
  className?: string;
  children?: ReactNode;
}

/** A bordered surface with a hard shadow. */
export default function Card({ accent, interactive, href, as: Tag = 'div', className, children }: CardProps) {
  if (href !== undefined) {
    return (
      <a href={href} className={cardClass({ accent, interactive: true, className })}>
        {children}
      </a>
    );
  }
  return <Tag className={cardClass({ accent, interactive, className })}>{children}</Tag>;
}
