// The header's account control on static pages (the landing page, docs,
// problem and card pages, 404), which have no React: the same button as
// AccountMenu on the React pages, filled in from the session cookie. Signed
// out, "Sign in" with a link per provider; signed in, the name with "Your
// progress", "Settings" and "Sign out". Absent in builds without the API.

import { apiEnabled, loginUrl, type Me, type ProviderId } from '../services/api';
import { PROVIDER_LABEL } from '../practice/account';

const SIGN_IN_ICON = '<path d="m10 17 5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>';
const USER_ICON = '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>';

function icon(paths: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ps-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** The button and its menu, closed by a click outside, Escape (back to the button) or picking an item. */
function menu(label: string, iconPaths: string, text: string, items: HTMLElement[]): { root: HTMLElement; bind: () => () => void } {
  const root = element('div', 'ps-account');
  const button = element('button', 'ps-account__button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-expanded', 'false');
  button.append(icon(iconPaths), element('span', 'ps-account__name ps-hide-sm', text));
  const panel = element('div', 'ps-menu__panel ps-account__panel');
  panel.setAttribute('role', 'menu');
  panel.hidden = true;
  panel.append(...items);
  root.append(button, panel);

  const toggle = (open: boolean) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    // Like Menu.tsx: a panel that would cross an edge of the screen (8px kept free) moves back inside.
    panel.style.translate = '';
    const r = panel.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    let dx = r.right > width - 8 ? width - 8 - r.right : 0;
    if (r.left + dx < 8) dx = 8 - r.left;
    panel.style.translate = dx ? `${Math.round(dx)}px 0` : '';
  };
  const bind = () => {
    const onButton = () => toggle(panel.hidden);
    const onPointer = (e: PointerEvent) => !root.contains(e.target as Node) && toggle(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || panel.hidden) return;
      toggle(false);
      button.focus();
    };
    const onPick = (e: MouseEvent) => (e.target as Element).closest('[role="menuitem"]') && toggle(false);
    button.addEventListener('click', onButton);
    panel.addEventListener('click', onPick);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      button.removeEventListener('click', onButton);
      panel.removeEventListener('click', onPick);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  };
  return { root, bind };
}

function item<K extends 'a' | 'button'>(tag: K, text: string): HTMLElementTagNameMap[K] {
  const el = element(tag, 'ps-account__item', text);
  el.setAttribute('role', 'menuitem');
  return el;
}

const link = (href: string, text: string) => Object.assign(item('a', text), { href });

/** Fills a [data-account] slot of the static header; `base` is the way back to the site root. Returns the cleanup. */
export function bindAccount(slot: HTMLElement): () => void {
  if (!apiEnabled) return () => undefined;
  const base = slot.dataset.base ?? './';
  let unbind = () => {};
  let cancelled = false;

  const show = (control: ReturnType<typeof menu>) => {
    if (cancelled) return;
    unbind();
    slot.replaceChildren(control.root);
    slot.hidden = false;
    // Like the React pages' headers with menus: the bar makes room on phones.
    slot.closest('.ps-header')?.classList.add('ps-header--actions');
    unbind = control.bind();
  };

  const signedOut = async () => {
    const { providers } = (await fetch('/auth/providers').then((r) => r.json())) as { providers: ProviderId[] };
    if (!providers.length) {
      slot.hidden = true;
      return;
    }
    const { pathname, search, hash } = window.location;
    show(menu('Sign in', SIGN_IN_ICON, 'Sign in', providers.map((p) => link(loginUrl(p, `${pathname}${search}${hash}`), `Sign in with ${PROVIDER_LABEL[p] ?? p}`))));
  };

  const signedIn = (me: Me) => {
    const signOut = item('button', 'Sign out');
    signOut.type = 'button';
    signOut.addEventListener('click', () => {
      void fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' })
        .catch(() => undefined)
        .then(signedOut)
        .catch(() => (slot.hidden = true));
    });
    const who = element('p', 'ps-account__who', 'Signed in as ');
    who.append(element('strong', '', me.user.displayName));
    show(
      menu('Account', USER_ICON, me.user.displayName, [
        who,
        link(`${base}practice/#/progress`, 'Your progress'),
        link(`${base}practice/#/me`, 'Settings'),
        signOut,
      ]),
    );
  };

  fetch('/api/me', { credentials: 'same-origin' })
    .then(async (r) => (r.ok ? signedIn((await r.json()) as Me) : r.status === 401 ? signedOut() : undefined))
    // Without the server, the page simply has no account control.
    .catch(() => undefined);

  return () => {
    cancelled = true;
    unbind();
  };
}
