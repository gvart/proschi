import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  /** A second, quieter line under the label in the list. */
  description?: string;
  /** Options with the same `group` that follow each other sit under one heading. */
  group?: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** The accessible name, when no <label for={id}> names it. */
  'aria-label'?: string;
  id?: string;
  /** Shown when `value` matches no option (e.g. "No use cases"). */
  placeholder?: string;
  /** A leading label or icon inside the trigger. */
  prefix?: ReactNode;
  title?: string;
  disabled?: boolean;
  /** `md` is the height of a toolbar button, `sm` is compact (forms, filters). */
  size?: 'md' | 'sm';
  /** Classes for the trigger, for its width. */
  className?: string;
}

const SIZE = {
  md: 'px-3 py-2 sm:py-1.5',
  sm: 'px-2 py-1',
};

const trigger =
  'group inline-flex items-center gap-1.5 min-w-0 text-left text-sm font-semibold rounded-sm border-bw-1 border-ink bg-surface text-ink shadow-brutal-sm cursor-pointer ' +
  'transition-[translate,box-shadow,background-color] duration-d1 hover:-translate-x-px hover:-translate-y-px hover:shadow-brutal-md ' +
  'aria-expanded:translate-x-0.5 aria-expanded:translate-y-0.5 aria-expanded:shadow-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pop-yellow ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-none disabled:shadow-none';

const MARGIN = 8;
const MAX_HEIGHT = 320;

/**
 * The design system's select: a button showing the current value that opens a
 * listbox in the app's look (thick border, hard shadow, yellow accent) instead
 * of the browser's. Focus stays on the button (ARIA combobox with
 * `aria-activedescendant`): arrows, Home/End, PageUp/PageDown, typeahead,
 * Enter/Space and Escape work as in a native select. The list is drawn in a
 * portal with fixed position, so no scroll container clips it; it opens down,
 * flips up when there is more room above, and is kept inside the viewport.
 */
export default function Select({ value, onChange, options, id, placeholder = '', prefix, title, disabled, size = 'md', className = '', ...rest }: SelectProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });

  const selected = options.findIndex((o) => o.value === value);
  const shown = selected >= 0 ? options[selected].label : placeholder;

  const groups = useMemo(() => {
    const out: { label?: string; items: { option: SelectOption; index: number }[] }[] = [];
    options.forEach((option, index) => {
      const last = out[out.length - 1];
      if (last && last.label === option.group) last.items.push({ option, index });
      else out.push({ label: option.group, items: [{ option, index }] });
    });
    return out;
  }, [options]);

  const openList = useCallback(() => {
    if (disabled) return;
    setActive(selected >= 0 ? selected : options.findIndex((o) => !o.disabled));
    setOpen(true);
  }, [disabled, selected, options]);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  const pick = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close(true);
  };

  /** The next enabled option from `from` in `step` direction, or `from` if there is none. */
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i;
    return from;
  };

  // Before paint: put the list under the button, or above it when there is more room there, inside the viewport.
  const place = useCallback(() => {
    const button = buttonRef.current;
    const list = listRef.current;
    if (!button || !list) return;
    const r = button.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    list.style.maxHeight = '';
    list.style.minWidth = `${Math.min(r.width, vw - 2 * MARGIN)}px`;
    list.style.maxWidth = `${vw - 2 * MARGIN}px`;
    const width = list.offsetWidth;
    const height = Math.min(list.scrollHeight + 4, MAX_HEIGHT);
    const below = vh - r.bottom - MARGIN - 6;
    const above = r.top - MARGIN - 6;
    const up = below < height && above > below;
    const room = Math.max(up ? above : below, 96);
    list.style.maxHeight = `${Math.min(MAX_HEIGHT, room)}px`;
    const shownHeight = Math.min(height, room);
    list.style.left = `${Math.max(MARGIN, Math.min(r.left, vw - MARGIN - width))}px`;
    list.style.top = `${up ? r.top - 6 - shownHeight : r.bottom + 6}px`;
    list.dataset.side = up ? 'up' : 'down';
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, options]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !buttonRef.current?.contains(t)) close();
    };
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) place();
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close, place]);

  useEffect(() => {
    if (open && active >= 0) listRef.current?.querySelector(`[id="${listId}-${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, listId]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || e.altKey || e.ctrlKey || e.metaKey) return;
    const { key } = e;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        e.preventDefault();
        openList();
      } else if (key === 'Home' || key === 'End') {
        e.preventDefault();
        openList();
        setActive(key === 'Home' ? step(-1, 1) : step(options.length, -1));
      }
    } else if (key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => step(a, 1));
    } else if (key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => step(a, -1));
    } else if (key === 'PageDown' || key === 'PageUp') {
      e.preventDefault();
      setActive((a) => {
        let next = a;
        for (let i = 0; i < 8; i++) next = step(next, key === 'PageDown' ? 1 : -1);
        return next;
      });
    } else if (key === 'Home') {
      e.preventDefault();
      setActive(step(-1, 1));
    } else if (key === 'End') {
      e.preventDefault();
      setActive(step(options.length, -1));
    } else if (key === 'Enter' || (key === ' ' && !typed.current.text)) {
      e.preventDefault();
      pick(active);
    } else if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (key === 'Tab') {
      close();
    }
    if (key.length === 1 && (key !== ' ' || typed.current.text)) {
      const now = Date.now();
      const t = typed.current;
      t.text = now - t.at > 700 ? key : t.text + key;
      t.at = now;
      const needle = t.text.toLowerCase();
      const from = open ? active : selected;
      const hit = [...options.keys()].map((i) => (i + Math.max(from, 0) + (t.text.length === 1 ? 1 : 0)) % options.length).find((i) => !options[i].disabled && options[i].label.toLowerCase().startsWith(needle));
      if (hit !== undefined) {
        e.preventDefault();
        if (open) setActive(hit);
        else if (options[hit].value !== value) onChange(options[hit].value);
      }
    }
  };

  const popover = open && (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={rest['aria-label']}
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-[1000] overflow-y-auto overscroll-contain rounded-sm border-bw-2 border-ink bg-surface text-ink py-1 shadow-brutal-md motion-safe:animate-[ps-pop_var(--d-spring)_var(--e-spring)] data-[side=up]:origin-bottom data-[side=down]:origin-top"
      style={{ left: 0, top: 0 }}
    >
      {groups.map((g, gi) => (
        <div key={gi} role={g.label ? 'group' : 'presentation'} aria-label={g.label}>
          {g.label && (
            <div aria-hidden="true" className="px-3 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
              {g.label}
            </div>
          )}
          {g.items.map(({ option, index }) => (
            <div
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === selected}
              aria-disabled={option.disabled || undefined}
              onClick={() => pick(index)}
              onMouseMove={() => !option.disabled && active !== index && setActive(index)}
              className={`flex items-start gap-2 px-3 py-1.5 text-sm cursor-pointer ${index === active ? 'bg-pop-yellow text-on-accent' : ''} ${index === selected ? 'font-bold' : 'font-medium'} ${option.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block break-words">{option.label}</span>
                {option.description && <span className={`block text-xs font-normal ${index === active ? 'opacity-80' : 'text-muted'}`}>{option.description}</span>}
              </span>
              <Check size={14} aria-hidden="true" className={`mt-0.5 shrink-0 ${index === selected ? '' : 'invisible'}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={rest['aria-label']}
        data-value={value}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={`${trigger} ${SIZE[size]} ${className}`}
      >
        {prefix}
        <span className="min-w-0 flex-1 truncate">{shown}</span>
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 transition-transform duration-d1 group-aria-expanded:rotate-180" />
      </button>
      {popover && createPortal(popover, buttonRef.current?.closest('dialog[open]') ?? document.body)}
    </>
  );
}
