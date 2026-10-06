import Wordmark from './Wordmark';
import { FOOTER_COLUMNS, siteHref } from './site';

const GIANT = [...'proschi'];

/** The site footer, the same on every page that has one (see Header for how static pages get it). */
export default function Footer({ base }: { base: string }) {
  return (
    <footer className="ps-footer">
      <div className="ps-wrap ps-footer__grid">
        <div className="ps-footer__about">
          <Wordmark href={base} />
          <p className="ps-footer__tagline">Architecture diagrams as text, with request flows you can play.</p>
          <p className="ps-footer__fine">Free and open source. No account needed: signed out, your diagrams never leave your browser.</p>
        </div>
        <nav className="ps-footer__nav" aria-label="Footer">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} className="ps-footer__col">
              <h2 className="ps-footer__title">{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a className="ps-footer__link" href={siteHref(base, link.href)}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="ps-footer__giant" aria-hidden="true">
        {GIANT.map((letter, i) => (
          <span key={i}>{letter}</span>
        ))}
      </div>
    </footer>
  );
}
