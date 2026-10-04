import { useSyncExternalStore } from 'react';
import { nextThemePref, readThemePref, setThemePref, subscribeTheme, systemTheme, themeToggleLabel, type Theme, type ThemePref } from './theme';

// "pref:system", read together so one store snapshot covers both.
const snapshot = () => `${readThemePref()}:${systemTheme()}`;
const serverSnapshot = () => 'system:light';

/**
 * One square button cycling the theme between the system's, light and dark
 * (src/design/theme.ts). All three icons are in the markup and CSS shows the
 * one for data-pref, so static pages (enhance.ts) only flip the attribute.
 */
export default function ThemeToggle() {
  const [pref, system] = useSyncExternalStore(subscribeTheme, snapshot, serverSnapshot).split(':') as [ThemePref, Theme];
  const label = themeToggleLabel(pref, system);
  return (
    <button
      type="button"
      className="ps-iconbtn ps-theme"
      data-theme-toggle=""
      data-pref={pref}
      aria-label={label}
      title={label}
      onClick={() => setThemePref(nextThemePref(pref, system))}
    >
      <svg className="ps-theme__icon ps-theme__icon--system" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a8 8 0 0 1 0 16z" className="ps-theme__fill" />
      </svg>
      <svg className="ps-theme__icon ps-theme__icon--light" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.5" className="ps-theme__fill" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
      </svg>
      <svg className="ps-theme__icon ps-theme__icon--dark" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" className="ps-theme__fill" />
        <path d="M17 3v3M15.5 4.5h3" />
      </svg>
    </button>
  );
}
