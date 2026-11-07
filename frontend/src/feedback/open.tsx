import { createRoot, type Root } from 'react-dom/client';

let root: Root | undefined;
/** The element focused when the dialog opened, focused again when it closes. */
let opener: Element | null = null;

function close() {
  root?.render(null);
  if (opener instanceof HTMLElement) opener.focus();
}

/** Opens the feedback dialog over the page, on any page: it loads on first use and mounts a root of its own. */
export async function openFeedback(): Promise<void> {
  opener = document.activeElement;
  const { default: FeedbackDialog } = await import('./FeedbackDialog');
  if (!root) {
    const host = document.createElement('div');
    host.dataset.feedbackRoot = '';
    document.body.append(host);
    root = createRoot(host);
  }
  // A new key each time: the form starts empty.
  root.render(<FeedbackDialog key={Date.now()} onClose={close} />);
}
