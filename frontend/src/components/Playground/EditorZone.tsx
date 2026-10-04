import type { HTMLAttributes } from 'react';
import { useEditorTheme } from './useEditorTheme';
import './editorZone.css';

/**
 * The quiet area around the code editor: it takes the editor's focus theme
 * (dark unless the visitor chose light), so the diagnostics and captions next
 * to the code match it instead of the page.
 */
export default function EditorZone({ className = '', ...rest }: HTMLAttributes<HTMLElement>) {
  const theme = useEditorTheme();
  return <section {...rest} data-editor-zone={theme} className={`editor-zone ${className}`} />;
}
