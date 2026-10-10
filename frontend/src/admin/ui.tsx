import { useEffect, useState, type ReactNode } from 'react';

/** Shared pieces of the admin panel's tabs. */

export function ErrorNote({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="adm-error" role="alert">
      {children}
    </p>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <p className="adm-muted" role="status">
      Loading {what}…
    </p>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'pass' | 'fail' | 'warn' }) {
  return (
    <div className={`adm-stat${tone ? ` adm-stat--${tone}` : ''}`}>
      <span className="adm-stat__label">{label}</span>
      <span className="adm-stat__value">{value}</span>
      {note !== undefined && <span className="adm-stat__note">{note}</span>}
    </div>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="adm-section">
      <div className="adm-section__head">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** "Showing 1–50 of 230", with previous and next buttons. */
export function Pager({ offset, pageSize, total, onChange }: { offset: number; pageSize: number; total: number; onChange: (offset: number) => void }) {
  if (total <= pageSize && offset === 0) return <p className="adm-muted">{total === 1 ? '1 result' : `${total} results`}</p>;
  return (
    <div className="adm-pager">
      <span className="adm-muted">
        {total ? `${offset + 1}–${Math.min(offset + pageSize, total)} of ${total}` : 'No results'}
      </span>
      <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - pageSize))}>
        Previous
      </button>
      <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" disabled={offset + pageSize >= total} onClick={() => onChange(offset + pageSize)}>
        Next
      </button>
    </div>
  );
}

/** A search box that reports its value a moment after typing stops. */
export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onChange(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);
  return (
    <input
      type="search"
      className="adm-input"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );
}

export function LevelBadge({ level }: { level: string }) {
  const tone = level === 'error' ? 'fail' : level === 'warn' ? 'yellow' : 'neutral';
  return <span className={`ps-badge ps-badge--${tone}`}>{level}</span>;
}
