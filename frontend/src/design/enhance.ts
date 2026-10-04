// What the React components do, for static markup (the landing and model
// pages, whose header and footer are rendered at build time): theme toggles,
// the phone menu, magnetic buttons and scroll reveals. A few hundred bytes, so
// static pages get the behaviour without loading React.

import { bindMenu } from './menu';
import { magnetic, observeReveal } from './motion';
import { nextThemePref, readThemePref, setThemePref, subscribeTheme, systemTheme, themeToggleLabel } from './theme';

function bindThemeToggle(button: HTMLElement): () => void {
  const sync = () => {
    const pref = readThemePref();
    const label = themeToggleLabel(pref, systemTheme());
    button.dataset.pref = pref;
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  const onClick = () => setThemePref(nextThemePref(readThemePref(), systemTheme()));
  sync();
  button.addEventListener('click', onClick);
  const unsubscribe = subscribeTheme(sync);
  return () => {
    button.removeEventListener('click', onClick);
    unsubscribe();
  };
}

/**
 * Wires up [data-theme-toggle] buttons, details.ps-menu menus,
 * [data-magnetic] elements and [data-reveal] elements under `root`.
 * Returns a function that undoes it all.
 */
export function enhance(root: ParentNode = document): () => void {
  const cleanups: (() => void)[] = [];
  root.querySelectorAll<HTMLElement>('[data-theme-toggle]').forEach((el) => cleanups.push(bindThemeToggle(el)));
  root.querySelectorAll<HTMLDetailsElement>('details.ps-menu').forEach((el) => cleanups.push(bindMenu(el)));
  root.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((el) => cleanups.push(magnetic(el)));
  root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => cleanups.push(observeReveal(el)));
  return () => cleanups.forEach((cleanup) => cleanup());
}
