import { useSyncExternalStore } from 'react';
import { readThemePref, subscribeTheme, type Theme, type ThemePref } from '../../design/theme';

/**
 * Which focus theme the code editor uses. The site theme (src/design/theme.ts)
 * follows the system unless the visitor picks one; the editor instead stays on
 * the calm dark theme unless they explicitly picked light. So a page in light
 * mode by system default still gets a dark, quiet editing area.
 */
export type ResolvedTheme = Theme;

export function editorThemeFor(pref: ThemePref): ResolvedTheme {
  return pref === 'light' ? 'light' : 'dark';
}

export function resolvedEditorTheme(): ResolvedTheme {
  return editorThemeFor(readThemePref());
}

/** The editor's theme, updated when the visitor changes the site theme (here or in another tab). */
export function useEditorTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeTheme, resolvedEditorTheme, () => 'dark');
}
