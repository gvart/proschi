import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { closeDialog, removeToast, snapshot, subscribe, type DialogEntry, type ToastEntry } from './dialogStore';
import './dialogs.css';

/**
 * Renders the dialogs and toasts opened through src/design/dialogs.ts. It
 * mounts itself, once, on first use; nothing to place in the app.
 */
export default function DialogHost() {
  const { dialogs, toasts } = useSyncExternalStore(subscribe, snapshot);
  return (
    <>
      {dialogs.map((d) => (
        <EntryDialog key={d.id} entry={d} />
      ))}
      <Toasts toasts={toasts} />
    </>
  );
}

function EntryDialog({ entry }: { entry: DialogEntry }) {
  if (entry.kind === 'confirm') return <ConfirmDialog entry={entry} />;
  if (entry.kind === 'prompt') return <PromptDialog entry={entry} />;
  return <CopyDialog entry={entry} />;
}

/**
 * The shell: a native modal <dialog> (top layer, so it opens above other
 * modals; focus is trapped, the page behind is inert), Escape or the
 * backdrop cancels, and focus returns to what opened it.
 */
function Modal({ entry, initialFocus, onCancel, title, children }: {
  entry: DialogEntry;
  initialFocus: RefObject<HTMLElement | null>;
  onCancel: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    initialFocus.current?.focus();
  }, [initialFocus]);

  return (
    <dialog
      ref={ref}
      className="ps-dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-tone={'tone' in entry.options ? entry.options.tone : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onMouseDown={(e) => e.target === ref.current && onCancel()}
    >
      <div className="ps-dialog__panel">
        <h2 id={titleId} className="ps-dialog__title">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

/** Takes the dialog down, gives focus back to its opener and settles the promise. */
function finish(entry: DialogEntry, settle: () => void) {
  closeDialog(entry.id);
  if (entry.opener instanceof HTMLElement && entry.opener.isConnected) entry.opener.focus();
  settle();
}

function Actions({ cancelRef, confirmRef, cancelLabel, confirmLabel, danger, disabled, onCancel }: {
  cancelRef?: RefObject<HTMLButtonElement | null>;
  confirmRef?: RefObject<HTMLButtonElement | null>;
  cancelLabel?: string;
  confirmLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onCancel?: () => void;
}) {
  return (
    <div className="ps-dialog__actions">
      {onCancel && (
        <button ref={cancelRef} type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={onCancel}>
          {cancelLabel ?? 'Cancel'}
        </button>
      )}
      <button ref={confirmRef} type="submit" className={`ps-btn ps-btn--${danger ? 'danger' : 'primary'} ps-btn--sm`} disabled={disabled}>
        {confirmLabel}
      </button>
    </div>
  );
}

function ConfirmDialog({ entry }: { entry: Extract<DialogEntry, { kind: 'confirm' }> }) {
  const { title, body, confirmLabel = 'OK', cancelLabel, tone } = entry.options;
  const danger = tone === 'danger';
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const done = (yes: boolean) => finish(entry, () => entry.resolve(yes));
  return (
    // A dangerous action starts on Cancel, so a stray Enter doesn't take it.
    <Modal entry={entry} title={title} initialFocus={danger ? cancelRef : confirmRef} onCancel={() => done(false)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          done(true);
        }}
      >
        {body && <div className="ps-dialog__body">{body}</div>}
        <Actions cancelRef={cancelRef} confirmRef={confirmRef} cancelLabel={cancelLabel} confirmLabel={confirmLabel} danger={danger} onCancel={() => done(false)} />
      </form>
    </Modal>
  );
}

function PromptDialog({ entry }: { entry: Extract<DialogEntry, { kind: 'prompt' }> }) {
  const { title, body, label, defaultValue = '', placeholder, confirmText, validate, confirmLabel = 'OK', cancelLabel, tone } = entry.options;
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const done = (answer: string | null) => finish(entry, () => entry.resolve(answer));

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  return (
    <Modal entry={entry} title={title} initialFocus={inputRef} onCancel={() => done(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (confirmText !== undefined && value !== confirmText) return;
          const problem = validate?.(value);
          if (problem) setError(problem);
          else done(value);
        }}
      >
        {body && <div className="ps-dialog__body">{body}</div>}
        <label htmlFor={inputId} className="ps-dialog__label">
          {confirmText !== undefined ? (
            <>
              {label} Type <strong className="ps-dialog__code">{confirmText}</strong> to confirm.
            </>
          ) : (
            label
          )}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="ps-dialog__field"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={confirmText === undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p id={errorId} className="ps-dialog__error">
            {error}
          </p>
        )}
        <Actions
          cancelLabel={cancelLabel}
          confirmLabel={confirmLabel}
          danger={tone === 'danger'}
          disabled={confirmText !== undefined && value !== confirmText}
          onCancel={() => done(null)}
        />
      </form>
    </Modal>
  );
}

function CopyDialog({ entry }: { entry: Extract<DialogEntry, { kind: 'copy' }> }) {
  const { title = 'Copy this', body, label = 'Select the text and copy it.' } = entry.options;
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const [copied, setCopied] = useState(false);
  const multiline = entry.text.includes('\n');
  const done = () => finish(entry, entry.resolve);

  useEffect(() => {
    fieldRef.current?.select();
  }, []);

  const copy = () => {
    const field = fieldRef.current;
    if (!field) return;
    field.select();
    // The clipboard API already failed; the older command still works from a click in most browsers.
    setCopied(document.execCommand?.('copy') ?? false);
  };

  return (
    <Modal entry={entry} title={title} initialFocus={fieldRef} onCancel={done}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          done();
        }}
      >
        {body && <div className="ps-dialog__body">{body}</div>}
        <label htmlFor={fieldId} className="ps-dialog__label">
          {label}
        </label>
        <textarea
          ref={fieldRef}
          id={fieldId}
          className="ps-dialog__field ps-dialog__field--copy"
          readOnly
          rows={multiline ? 8 : 2}
          value={entry.text}
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="ps-dialog__actions">
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="submit" className="ps-btn ps-btn--primary ps-btn--sm">
            Done
          </button>
        </div>
      </form>
    </Modal>
  );
}

const DEFAULT_DURATION = 5000;
const LONG_DURATION = 8000;

function Toasts({ toasts }: { toasts: ToastEntry[] }) {
  if (toasts.length === 0) return null;
  return (
    <section className="ps-toasts" aria-label="Notifications">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </section>
  );
}

function Toast({ toast }: { toast: ToastEntry }) {
  const { title, body, tone = 'default', action, duration = action || tone === 'danger' ? LONG_DURATION : DEFAULT_DURATION } = toast.options;
  const [paused, setPaused] = useState(false);
  const dismiss = () => removeToast(toast.id);

  useEffect(() => {
    if (paused || duration <= 0) return;
    const timer = window.setTimeout(() => removeToast(toast.id), duration);
    return () => window.clearTimeout(timer);
  }, [paused, duration, toast.id]);

  return (
    <div
      className="ps-toast"
      data-tone={tone}
      role={tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setPaused(false)}
      onKeyDown={(e) => e.key === 'Escape' && dismiss()}
    >
      <div className="ps-toast__text">
        <p className="ps-toast__title">{title}</p>
        {body && <div className="ps-toast__body">{body}</div>}
      </div>
      {action && (
        <button
          type="button"
          className="ps-btn ps-btn--sm ps-toast__action"
          onClick={() => {
            action.onClick();
            dismiss();
          }}
        >
          {action.label}
        </button>
      )}
      <button type="button" className="ps-toast__close" aria-label="Dismiss" onClick={dismiss}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
