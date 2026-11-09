// The open dialogs and toasts behind src/design/dialogs.ts, rendered by
// DialogHost. A plain store, so the API works from any event handler.
import type { ReactNode } from 'react';

export type DialogTone = 'default' | 'danger';
export type ToastTone = 'default' | 'success' | 'danger';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** The confirm button's label, "OK" by default. Name the action: "Delete". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' paints the confirm button red and focuses Cancel first. */
  tone?: DialogTone;
}

export interface PromptOptions extends ConfirmOptions {
  /** The field's label. */
  label: string;
  defaultValue?: string;
  placeholder?: string;
  /** Typed confirmation: the confirm button stays disabled until the field reads exactly this, like "DELETE". */
  confirmText?: string;
  /** An error message for a value that can't be used, or nothing when it can. */
  validate?: (value: string) => string | null | undefined;
}

export interface CopyOptions {
  title?: string;
  body?: ReactNode;
  /** The field's label. */
  label?: string;
}

export interface NotifyOptions {
  title: string;
  body?: ReactNode;
  /** 'danger' toasts are announced at once (role="alert"); the others politely (role="status"). */
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** Milliseconds before it goes by itself (paused while hovered or focused); 0 keeps it until dismissed. */
  duration?: number;
}

interface Base {
  id: number;
  /** Focused again when the dialog closes. */
  opener: Element | null;
}

export type DialogEntry =
  | (Base & { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void })
  | (Base & { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void })
  | (Base & { kind: 'copy'; text: string; options: CopyOptions; resolve: () => void });

export interface ToastEntry {
  id: number;
  options: NotifyOptions;
}

export interface DialogState {
  dialogs: DialogEntry[];
  toasts: ToastEntry[];
}

let state: DialogState = { dialogs: [], toasts: [] };
let nextId = 1;
const listeners = new Set<() => void>();

function set(next: DialogState) {
  state = next;
  listeners.forEach((l) => l());
}

export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const snapshot = () => state;

// Distributive, so each kind keeps its own resolve and options.
type NewDialog<D = DialogEntry> = D extends unknown ? Omit<D, 'id' | 'opener'> : never;

export function openDialog(entry: NewDialog): void {
  const opener = typeof document === 'undefined' ? null : document.activeElement;
  set({ ...state, dialogs: [...state.dialogs, { ...entry, id: nextId++, opener } as DialogEntry] });
}

export function closeDialog(id: number): void {
  set({ ...state, dialogs: state.dialogs.filter((d) => d.id !== id) });
}

export function addToast(options: NotifyOptions): number {
  const id = nextId++;
  set({ ...state, toasts: [...state.toasts, { id, options }] });
  return id;
}

export function removeToast(id: number): void {
  if (state.toasts.some((t) => t.id === id)) set({ ...state, toasts: state.toasts.filter((t) => t.id !== id) });
}
