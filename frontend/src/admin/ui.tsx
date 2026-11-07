import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SortDir } from './hooks';
import { pageOf, type PageId } from './route';

/** Shared pieces of the admin panel's tabs. */

export function ErrorNote({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="adm-error" role="alert">
      {children}
    </p>
  );
}

/** The page's title (its sidebar label unless `title` says otherwise), its one-line description, and its actions on the right. */
export function PageHeader({ page, title, description, actions }: { page: PageId; title?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  const info = pageOf(page);
  return (
    <header className="adm-page-head">
      <div className="adm-page-head__text">
        <h1>{title ?? info.label}</h1>
        <p className="adm-muted">{description ?? info.description}</p>
      </div>
      {actions && <div className="adm-page-head__actions">{actions}</div>}
    </header>
  );
}

/** Grey bars where rows or numbers will be, while the first load runs. */
export function Skeleton({ rows = 5, what }: { rows?: number; what: string }) {
  return (
    <div className="adm-skeleton" role="status" aria-label={`Loading ${what}…`}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="adm-skeleton__row" style={{ width: `${100 - ((i * 17) % 35)}%` }} />
      ))}
    </div>
  );
}

/** A list or table with nothing in it: what that means, and what to do about it if anything. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="adm-empty">{children}</p>;
}

/** A column header that sorts the table: aria-sort says how it is sorted now. */
export function SortHeader({ label, active, dir, onSort, numeric }: { label: string; active: boolean; dir?: SortDir; onSort: () => void; numeric?: boolean }) {
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th scope="col" className={numeric ? 'adm-num' : undefined} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`adm-sort${active ? ' is-active' : ''}`} onClick={onSort}>
        {label}
        <Icon size={14} aria-hidden="true" />
      </button>
    </th>
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

/**
 * A modal dialog (the native <dialog>, so focus is trapped and Escape
 * closes it) holding a form: `onSubmit` runs on submit; the dialog stays
 * open, with the error, until it resolves true.
 */
export function Dialog({ title, open, onClose, onSubmit, submitLabel, danger, busy, error, children }: {
  title: string;
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="adm-dialog" aria-labelledby="adm-dialog-title" onClose={onClose}>
      <form
        className="adm-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h2 id="adm-dialog-title" className="adm-dialog__title">
          {title}
        </h2>
        {children}
        <ErrorNote>{error}</ErrorNote>
        <div className="adm-actions adm-dialog__actions">
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`ps-btn ps-btn--${danger ? 'danger' : 'primary'} ps-btn--sm`} disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** An account's name, opening it; "unknown" without one. */
export function UserLink({ user, onOpenUser }: { user: { id: string; displayName: string } | null; onOpenUser: (id: string) => void }) {
  if (!user) return <span className="adm-muted">unknown</span>;
  return (
    <button type="button" className="adm-link" onClick={() => onOpenUser(user.id)}>
      {user.displayName}
    </button>
  );
}
