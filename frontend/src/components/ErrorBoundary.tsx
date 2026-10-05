import { Component, type ErrorInfo, type ReactNode } from 'react';
import { buttonClass } from '../design/classes';
import { GITHUB_URL } from '../design/site';

interface Props {
  /** What the user was in, for the message: "the editor", "practice". */
  where: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** A link to a new GitHub issue with the error filled in: the message and stack only, never the user's designs. */
export function issueHref(where: string, error: Error): string {
  const body = [`Something went wrong in ${where}.`, '', '```', String(error.stack ?? error.message).slice(0, 1500), '```', '', `Page: ${location.pathname}`, `Browser: ${navigator.userAgent}`].join('\n');
  const params = new URLSearchParams({ title: `Crash in ${where}: ${error.message.slice(0, 80)}`, body });
  return `${GITHUB_URL}/issues/new?${params}`;
}

/**
 * Keeps a rendering error from leaving a blank page: says what happened, that
 * the user's work is still in this browser (documents and progress are saved
 * to localStorage as they change), and offers a reload and a bug report.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Proschi crashed in ${this.props.where}`, error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main role="alert" className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p>
          Proschi hit an error in {this.props.where}. Your work is saved in this browser, so reloading the page should bring it
          back.
        </p>
        <pre className="max-h-40 overflow-auto rounded border border-ink/20 p-3 text-sm">{error.message}</pre>
        <p className="flex flex-wrap gap-3">
          <button type="button" className={buttonClass({ variant: 'primary' })} onClick={() => location.reload()}>
            Reload the page
          </button>
          <a className={buttonClass()} href={issueHref(this.props.where, error)} target="_blank" rel="noreferrer">
            Report the problem
          </a>
        </p>
      </main>
    );
  }
}
