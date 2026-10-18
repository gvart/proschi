// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { basicSetup } from 'codemirror';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { autocompletion, completionStatus, startCompletion } from '@codemirror/autocomplete';
import { tabKeymap } from './tabKeymap';

// jsdom does no layout; CodeMirror measures text ranges when it draws the completion popup.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

let view: EditorView | undefined;
afterEach(() => view?.destroy());

/** An editor set up like CodeEditor's; `|` marks the cursor, `[` `]` a selection. */
function editor(text: string): EditorView {
  const from = text.search(/[|[]/);
  const doc = text.replace(/[|[\]]/g, '');
  const to = text.includes(']') ? text.indexOf(']') - 1 : from;
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [
        basicSetup,
        tabKeymap,
        autocompletion({ override: [() => ({ from: 0, options: [{ label: 'service' }] })], interactionDelay: 0 }),
      ],
    }),
  });
  return view;
}

function press(v: EditorView, key: string, shiftKey = false): boolean {
  return runScopeHandlers(v, new KeyboardEvent('keydown', { key, shiftKey }), 'editor');
}

const cursor = (v: EditorView) => v.state.selection.main.head;

describe('Tab in the editor', () => {
  it('inserts an indent at the cursor, not at the start of the line', () => {
    const v = editor('api -> |db');
    expect(press(v, 'Tab')).toBe(true);
    expect(v.state.doc.toString()).toBe('api ->   db');
    expect(cursor(v)).toBe(9);
  });

  it('indents every selected line when the selection spans several', () => {
    const v = editor('[a -> b\nb -> c]');
    press(v, 'Tab');
    expect(v.state.doc.toString()).toBe('  a -> b\n  b -> c');
  });

  it('outdents with Shift-Tab', () => {
    const v = editor('    a -> |b');
    press(v, 'Tab', true);
    expect(v.state.doc.toString()).toBe('  a -> b');
  });

  it('accepts the open completion instead of indenting', async () => {
    const v = editor('ser|');
    startCompletion(v);
    await vi.waitFor(() => expect(completionStatus(v.state)).toBe('active'));
    press(v, 'Tab');
    expect(v.state.doc.toString()).toBe('service');
    expect(completionStatus(v.state)).toBeNull();
  });
});
