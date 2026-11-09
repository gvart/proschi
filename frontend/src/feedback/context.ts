/**
 * What goes with a feedback message besides what the user writes, and the
 * checks on its screenshots, as plain functions (the dialog shows the same
 * values it sends; backend/src/feedback.ts checks them again).
 */

export const KINDS = [
  { id: 'bug', label: 'Bug' },
  { id: 'question', label: 'Question' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'other', label: 'Other' },
] as const;
export type Kind = (typeof KINDS)[number]['id'];

export const MAX_MESSAGE = 5000;
export const MAX_SUBJECT = 200;
export const MAX_FILES = 3;
export const MAX_FILE = 5 * 1024 * 1024;
/** A diagram larger than this is not offered (the server's 64 KiB). */
export const MAX_DIAGRAM = 64 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export interface FeedbackContext {
  /** The page and its hash, without the query (it can hold a token). */
  path: string;
  userAgent: string;
  viewport: string;
}

export function collectContext(win: Pick<Window, 'location' | 'innerWidth' | 'innerHeight' | 'navigator'> = window): FeedbackContext {
  return {
    path: `${win.location.pathname}${win.location.hash}`.slice(0, 300),
    userAgent: win.navigator.userAgent,
    viewport: `${win.innerWidth}×${win.innerHeight}`,
  };
}

/** "Chrome 130 on macOS": the browser and system a user agent names, for people; the full string is sent. */
export function describeBrowser(ua: string): string {
  const found = (
    [
      ['Edge', /Edg\/(\d+)/],
      ['Firefox', /Firefox\/(\d+)/],
      ['Chrome', /Chrome\/(\d+)/],
      ['Safari', /Version\/(\d+)[.\d]* .*Safari/],
    ] as const
  )
    .map(([name, re]) => [name, re.exec(ua)?.[1]] as const)
    .find(([, version]) => version);
  const browser = found ? `${found[0]} ${found[1]}` : 'Unknown browser';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  return os ? `${browser} on ${os}` : browser;
}

/** Why `file` can't be added next to `count` screenshots already there; undefined when it can. */
export function screenshotProblem(file: { type: string; size: number }, count: number): string | undefined {
  if (count >= MAX_FILES) return `At most ${MAX_FILES} screenshots.`;
  if (!IMAGE_TYPES.includes(file.type)) return 'Screenshots must be PNG, JPEG or WebP images.';
  if (file.size > MAX_FILE) return 'A screenshot can be at most 5 MB.';
  return undefined;
}

export const formatSize = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
