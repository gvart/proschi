// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { confirm, copyFallback, copyText, notify, prompt } from './dialogs';
import { snapshot } from './dialogStore';

beforeAll(() => {
  // jsdom has <dialog> but not its modal methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(async () => {
  // Close whatever a test left open, so each starts with none.
  while (snapshot().dialogs.length > 0) await act(async () => void fireEvent(screen.getAllByRole('dialog').at(-1)!, new Event('cancel', { cancelable: true })));
  await act(async () => screen.queryAllByRole('button', { name: 'Dismiss' }).forEach((b) => fireEvent.click(b)));
  vi.useRealTimers();
});

const open = <T,>(fn: () => Promise<T>) => {
  let p!: Promise<T>;
  act(() => {
    p = fn();
  });
  return p;
};

describe('confirm', () => {
  it('resolves true on the confirm button, with the title, body and labels', async () => {
    const answer = open(() => confirm({ title: 'Delete "Checkout"?', body: 'This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete "Checkout"?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('This cannot be undone.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resolves false on Cancel and on Escape', async () => {
    const first = open(() => confirm({ title: 'Leave?' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(first).resolves.toBe(false);

    const second = open(() => confirm({ title: 'Leave?' }));
    fireEvent(await screen.findByRole('dialog'), new Event('cancel', { cancelable: true }));
    await expect(second).resolves.toBe(false);
  });

  it('focuses Cancel first when dangerous, the confirm button otherwise, and gives focus back on close', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const danger = open(() => confirm({ title: 'Drop it?', confirmLabel: 'Drop', tone: 'danger' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await danger;
    expect(document.activeElement).toBe(opener);

    const plain = open(() => confirm({ title: 'Go on?', confirmLabel: 'Go' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Go' })));
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await plain;
    opener.remove();
  });
});

describe('prompt', () => {
  it('resolves the typed value, or null when cancelled', async () => {
    const answer = open(() => prompt({ title: 'Rename', label: 'Display name', defaultValue: 'api' }));
    const field = await screen.findByLabelText('Display name');
    expect((field as HTMLInputElement).value).toBe('api');
    fireEvent.change(field, { target: { value: 'Gateway' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await expect(answer).resolves.toBe('Gateway');

    const cancelled = open(() => prompt({ title: 'Rename', label: 'Display name' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(cancelled).resolves.toBeNull();
  });

  it('keeps the confirm button disabled until the confirmation text is typed', async () => {
    const answer = open(() => prompt({ title: 'Delete Ada?', label: "This can't be undone.", confirmText: 'DELETE', confirmLabel: 'Delete account', tone: 'danger' }));
    const button = await screen.findByRole('button', { name: 'Delete account' });
    const field = screen.getByRole('textbox');
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.change(field, { target: { value: 'delete' } });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.change(field, { target: { value: 'DELETE' } });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    await expect(answer).resolves.toBe('DELETE');
  });

  it('shows the validation error and stays open until the value passes', async () => {
    const answer = open(() => prompt({ title: 'Name', label: 'Name', validate: (v) => (v.trim() ? null : 'A name is needed.') }));
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
    expect(screen.getByText('A name is needed.')).toBeTruthy();
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'db' } });
    expect(screen.queryByText('A name is needed.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await expect(answer).resolves.toBe('db');
  });
});

describe('copyFallback and copyText', () => {
  it('shows the text in a read-only field and resolves on Done', async () => {
    const closed = open(() => copyFallback('https://proschi.app/s/abc', { title: 'Copy this share link' }));
    await screen.findByRole('dialog', { name: 'Copy this share link' });
    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(field.value).toBe('https://proschi.app/s/abc');
    expect(field.readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await expect(closed).resolves.toBeUndefined();
  });

  it('copyText writes the clipboard, and falls back to the dialog when that fails', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await expect(copyText('one')).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();

    let copied!: Promise<boolean>;
    await act(async () => {
      copied = copyText('two', { title: 'Copy this' });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await expect(copied).resolves.toBe(false);
  });
});

describe('notify', () => {
  it('stacks toasts with status or alert roles, and dismisses them', async () => {
    act(() => {
      notify({ title: 'Saved', tone: 'success' });
      notify({ title: 'Could not export', tone: 'danger' });
    });
    expect((await screen.findByRole('status')).textContent).toContain('Saved');
    expect(screen.getByRole('alert').textContent).toContain('Could not export');
    act(() => fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('goes by itself after its duration, runs its action, and closes on Escape', async () => {
    vi.useFakeTimers();
    act(() => {
      notify({ title: 'Brief', duration: 1000 });
    });
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1001));
    expect(screen.queryByRole('status')).toBeNull();

    const onClick = vi.fn();
    act(() => {
      notify({ title: 'Deleted', action: { label: 'Undo', onClick }, duration: 0 });
    });
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Undo' })));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();

    let dismiss!: () => void;
    act(() => {
      dismiss = notify({ title: 'Sticky', duration: 0 });
      notify({ title: 'Esc me', duration: 0 });
    });
    act(() => fireEvent.keyDown(screen.getByText('Esc me'), { key: 'Escape' }));
    expect(screen.queryByText('Esc me')).toBeNull();
    act(() => dismiss());
    expect(screen.queryByText('Sticky')).toBeNull();
  });
});
