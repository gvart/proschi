// Light, dark or whatever the system says. public/theme-init.js applies the
// saved choice before first paint (a classic script, so the page never
// flashes the wrong theme); this module changes it later. Keep the two in step.

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'proschi.theme';
/** Fired on window after the choice changes in this tab. */
export const THEME_EVENT = 'proschi:theme';
/** The browser chrome colour per theme: --c-paper in src/design/tokens.css. */
export const THEME_COLOR: Record<Theme, string> = { light: '#FFF8E7', dark: '#141318' };

const DARK_QUERY = '(prefers-color-scheme: dark)';

function isPref(value: unknown): value is ThemePref {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readThemePref(): ThemePref {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return isPref(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function systemTheme(): Theme {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(pref: ThemePref, system: Theme = systemTheme()): Theme {
  return pref === 'system' ? system : pref;
}

/** Sets html[data-theme] (the resolved theme), html[data-theme-pref] and the theme-color meta. */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  const theme = resolveTheme(pref);
  root.dataset.theme = theme;
  root.dataset.themePref = pref;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: pref }));
}

/**
 * The toggle's next choice. The first press always changes what you see: from
 * "system" it goes to the opposite of the system theme, then to the system's
 * own theme set explicitly, then back to following the system.
 */
export function nextThemePref(pref: ThemePref, system: Theme = systemTheme()): ThemePref {
  const opposite: Theme = system === 'dark' ? 'light' : 'dark';
  if (pref === 'system') return opposite;
  if (pref === opposite) return system;
  return 'system';
}

export const THEME_LABEL: Record<ThemePref, string> = { system: 'Match system', light: 'Light', dark: 'Dark' };

/** The toggle's accessible name: what it shows now and what a press does. */
export function themeToggleLabel(pref: ThemePref, system: Theme = systemTheme()): string {
  const next = nextThemePref(pref, system);
  return `Theme: ${THEME_LABEL[pref]}. Switch to ${THEME_LABEL[next].toLowerCase()}`;
}

/**
 * Calls `onChange` when the choice changes here or in another tab, or the
 * system theme changes. Returns the unsubscribe function.
 */
export function subscribeTheme(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY && e.key !== null) return;
    applyTheme(readThemePref());
    onChange();
  };
  const media = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null;
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  media?.addEventListener('change', onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
    media?.removeEventListener('change', onChange);
  };
}
