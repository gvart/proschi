import { useEffect, useRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { buttonClass, type ButtonSize, type ButtonVariant } from './classes';
import { magnetic } from './motion';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Drifts toward a nearby pointer (mouse only, and not under reduced motion). */
  magnetic?: boolean;
  /** An icon after the label that nudges forward on hover, like an arrow. */
  trailing?: ReactNode;
  children?: ReactNode;
}

type LinkProps = CommonProps & { href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'>;
type NativeButtonProps = CommonProps & { href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;
export type ButtonProps = LinkProps | NativeButtonProps;

/** A chunky button with a hard shadow: lifts on hover, presses into its shadow. An <a> when given `href`. */
export default function Button(props: ButtonProps) {
  const { variant, size, magnetic: isMagnetic, trailing, children, className, ...rest } = props;
  const ref = useRef<HTMLAnchorElement & HTMLButtonElement>(null);

  useEffect(() => {
    if (isMagnetic && ref.current) return magnetic(ref.current);
  }, [isMagnetic]);

  // One span for the label, so text and inline markup in it are not spaced apart as flex items.
  const content = (
    <>
      <span>{children}</span>
      {trailing && (
        <span className="ps-btn__trail" aria-hidden="true">
          {trailing}
        </span>
      )}
    </>
  );
  const shared = { ref, className: buttonClass({ variant, size, className }), 'data-magnetic': isMagnetic || undefined };

  if (rest.href !== undefined) {
    return (
      <a {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} {...shared}>
        {content}
      </a>
    );
  }
  const { type = 'button', ...buttonRest } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={type} {...buttonRest} {...shared}>
      {content}
    </button>
  );
}
