const LETTERS = [...'proschi'];

/**
 * The logo: two boxes wired together on a yellow tile, a packet that runs the
 * wire on hover, and the name, whose letters hop one after another.
 */
export default function Wordmark({ href, compact = false }: { href: string; compact?: boolean }) {
  return (
    <a className={compact ? 'ps-wordmark ps-wordmark--compact' : 'ps-wordmark'} href={href} aria-label="Proschi home">
      <span className="ps-wordmark__tile" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path className="ps-wordmark__wire" d="M9 7h5.5v10H15" />
          <rect className="ps-wordmark__box" x="2.5" y="3.5" width="7" height="7" />
          <rect className="ps-wordmark__box ps-wordmark__box--b" x="14.5" y="13.5" width="7" height="7" />
          <circle className="ps-wordmark__packet" r="2.4" />
        </svg>
      </span>
      <span className="ps-wordmark__text" aria-hidden="true">
        {LETTERS.map((letter, i) => (
          <span key={i}>{letter}</span>
        ))}
      </span>
    </a>
  );
}
