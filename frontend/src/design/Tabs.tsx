import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { tabId, tabPanelProps } from './classes';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Extra text after the label, like a count. */
  badge?: ReactNode;
}

export interface TabsProps<T extends string> {
  /** The tablist's accessible name. */
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Prefix for the tab and panel ids; see tabPanelProps. */
  idPrefix: string;
  /** Stretches the tabs across the full width (phone pane switchers). */
  fill?: boolean;
  className?: string;
}

/**
 * ARIA tabs with a thick underline: arrow keys, Home and End move between
 * tabs (and select them), only the selected tab is in the tab order.
 */
export default function Tabs<T extends string>({ label, items, value, onChange, idPrefix, fill, className }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent) => {
    const index = items.findIndex((item) => item.id === value);
    const last = items.length - 1;
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = items[(next + items.length) % items.length];
    onChange(target.id);
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(idPrefix, target.id))}`)?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={['ps-tabs', fill && 'ps-tabs--fill', className].filter(Boolean).join(' ')} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.id)}
            aria-selected={selected}
            aria-controls={tabPanelProps(idPrefix, item.id).id}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className="ps-tab"
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge !== undefined && <span className="ps-tab__badge">{item.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
