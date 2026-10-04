import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView, Decoration, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/**
 * The demo's editor: the calm dark "focus" palette, whatever the page theme
 * (a code window reads as one), with the yellow cursor as its only accent.
 */
const focusDark = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '12px', backgroundColor: '#16171B', color: '#C9CCD3' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', fontVariantLigatures: 'none', lineHeight: '1.65' },
    '.cm-content': { padding: '12px 0', caretColor: '#FFD23F' },
    '.cm-gutters': { backgroundColor: '#16171B', color: '#4A4E59', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
    '&.cm-focused .cm-activeLine': { backgroundColor: '#1D1F25' },
    '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid #FFD23F' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#2A2E38 !important' },
    '.cm-matchingBracket': { backgroundColor: '#2A2E38', outline: 'none' },
    '&.cm-focused': { outline: 'none' },
    '.cm-tooltip': { backgroundColor: '#1E1D24', color: '#C9CCD3', border: '2px solid #F4EFE3' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#FFD23F', color: '#111' },
  },
  { dark: true },
);

const focusDarkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#9AA7C7', fontWeight: '600' },
  { tag: [t.string, t.link], color: '#A8BFA0' },
  { tag: t.number, color: '#C7B08A' },
  { tag: t.comment, color: '#5F6470', fontStyle: 'italic' },
  { tag: t.typeName, color: '#B9A6E8' },
  { tag: t.attributeName, color: '#7F8594' },
  { tag: t.operator, color: '#FF7AB4' },
  { tag: [t.brace, t.punctuation], color: '#7F8594' },
  { tag: t.variableName, color: '#E6E8EC' },
]);

export const demoEditorTheme = [focusDark, syntaxHighlighting(focusDarkHighlight)];

class CaretWidget extends WidgetType {
  toDOM() {
    const caret = document.createElement('span');
    caret.className = 'demo-caret';
    caret.setAttribute('aria-hidden', 'true');
    return caret;
  }
  eq() {
    return true;
  }
}

/** A block caret at the end of the document, for while the tour is typing. */
export const typingCaret = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView) {
      return Decoration.set([Decoration.widget({ widget: new CaretWidget(), side: 1 }).range(view.state.doc.length)]);
    }
  },
  { decorations: (v) => v.decorations },
);

export const editorLabel = EditorView.contentAttributes.of({ 'aria-label': 'Proschi source of the demo, editable' });
