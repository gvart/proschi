import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { ResolvedTheme } from './useEditorTheme';

/**
 * Focus themes for the code editor: low contrast, few hues, one accent (the cursor).
 * Colour belongs to the diagram; the text you are writing should be quiet.
 * The palette is the editor palette in the design plan; editorThemes.test.ts pins it.
 */
export const FOCUS_PALETTE = {
  dark: {
    background: '#16171B',
    text: '#C9CCD3',
    comment: '#5F6470',
    keyword: '#9AA7C7',
    string: '#A8BFA0',
    number: '#C7B08A',
    selection: '#2A2E38',
    cursor: '#FFD23F',
    // Derived: quieter than the text, louder than the background.
    gutter: '#4B4F5A',
    activeLine: '#1B1C21',
    activeGutter: '#8A8F9B',
    panel: '#1E1F25',
    border: '#2A2C33',
  },
  light: {
    background: '#FFFDF6',
    text: '#2A2A2A',
    comment: '#8A8577',
    keyword: '#3D4FB8',
    string: '#2F7A55',
    number: '#9A5B00',
    selection: '#EAE4D0',
    cursor: '#2A2A2A',
    gutter: '#B3AE9F',
    activeLine: '#FBF7EA',
    activeGutter: '#5B5B5B',
    panel: '#F6F1E3',
    border: '#E7E1CF',
  },
} as const;

export const EDITOR_FONT = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Layout shared by both themes. */
export const editorLayout = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: EDITOR_FONT, lineHeight: '1.65' },
  '.cm-content': { padding: '10px 0' },
  '.cm-gutters': { border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px' },
  '&.cm-focused': { outline: 'none' },
});

function focusTheme(mode: ResolvedTheme): Extension {
  const c = FOCUS_PALETTE[mode];
  const dark = mode === 'dark';
  const theme = EditorView.theme(
    {
      '&': { color: c.text, backgroundColor: c.background },
      '.cm-content': { caretColor: c.cursor },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.cursor, borderLeftWidth: '2px' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: c.selection,
      },
      '.cm-activeLine': { backgroundColor: c.activeLine },
      '.cm-gutters': { backgroundColor: c.background, color: c.gutter },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: c.activeGutter },
      '.cm-foldPlaceholder': { backgroundColor: c.panel, border: `1px solid ${c.border}`, color: c.comment },
      '&.cm-focused .cm-matchingBracket': { backgroundColor: 'transparent', outline: `1px solid ${c.comment}` },
      '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'transparent', outline: `1px dashed ${c.comment}` },
      '.cm-selectionMatch': { backgroundColor: dark ? '#22252D' : '#F2ECDA' },
      '.cm-searchMatch': { backgroundColor: dark ? '#3A3424' : '#FBE7A6', outline: 'none' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: dark ? '#57492A' : '#F6D365' },
      '.cm-panels': { backgroundColor: c.panel, color: c.text },
      '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${c.border}` },
      '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${c.border}` },
      '.cm-tooltip': { backgroundColor: c.panel, color: c.text, border: `1px solid ${c.border}` },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: c.selection, color: c.text },
      '.cm-completionDetail': { color: c.comment },
      '.cm-completionMatchedText': { textDecoration: 'none', color: c.keyword },
      '.cm-diagnostic': { borderLeftWidth: '3px' },
    },
    { dark },
  );
  const style = HighlightStyle.define([
    { tag: [t.comment, t.lineComment, t.blockComment], color: c.comment, fontStyle: 'italic' },
    { tag: [t.keyword, t.controlKeyword, t.definitionKeyword], color: c.keyword },
    { tag: [t.string, t.special(t.string)], color: c.string },
    { tag: [t.number, t.integer, t.float], color: c.number },
    // Kinds ([Redis]) and attributes (@team) read as annotations, not as more colour.
    { tag: [t.typeName, t.attributeName], color: c.keyword, fontStyle: 'italic' },
    { tag: [t.operator, t.punctuation, t.brace, t.bracket], color: c.comment },
    { tag: t.link, color: c.string, textDecoration: 'none' },
    { tag: [t.variableName, t.name], color: c.text },
    { tag: t.invalid, color: dark ? '#FF6B61' : '#C62828' },
  ]);
  return [theme, syntaxHighlighting(style)];
}

/** Built once each: CodeEditor swaps them through a Compartment, so a theme change never rebuilds the editor. */
export const focusDark = focusTheme('dark');
export const focusLight = focusTheme('light');

export function focusThemeFor(mode: ResolvedTheme): Extension {
  return mode === 'dark' ? focusDark : focusLight;
}
