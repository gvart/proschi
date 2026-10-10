import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { ChevronRight, KeyRound, Lightbulb, MessagesSquare, TriangleAlert, Zap, type LucideIcon } from 'lucide-react';
import { highlightLines, type TokenClass } from '../landing/highlight';
import { CALLOUT_TITLES, TLDR_TITLE, parseInline, parseMarkdown, type Block, type CalloutTone, type Inline } from './markdown';

// The cards load only when a lesson quizzes some, so a statement never ships them.
const LessonQuiz = lazy(() => import('./LessonQuiz'));

/** Renders a problem statement or a lesson; see markdown.ts for what it understands. */
export default function Markdown({ source, blocks: given, large = false }: { source: string; /** Already parsed (e.g. for a table of contents). */ blocks?: Block[]; /** Article text size instead of the side panel's. */ large?: boolean }) {
  const blocks = useMemo(() => given ?? parseMarkdown(source), [given, source]);
  return (
    <div className={`space-y-3 ${large ? 'text-base' : 'text-sm'} leading-relaxed text-ink [overflow-wrap:anywhere]`}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} large={large} />
      ))}
    </div>
  );
}

/** One line of Markdown (code, bold, links) without a paragraph around it, e.g. a choice card's option inside a button. */
export function InlineMarkdown({ source }: { source: string }) {
  const nodes = useMemo(() => parseInline(source), [source]);
  return <Inlines nodes={nodes} />;
}

function BlockView({ block, large = false }: { block: Block; large?: boolean }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = (['h1', 'h2', 'h3', 'h4'] as const)[block.level - 1];
      const size = large ? (block.level <= 2 ? 'text-2xl font-display font-bold pt-4' : 'text-lg') : block.level === 1 ? 'text-xl' : block.level === 2 ? 'text-base' : 'text-sm';
      return (
        <Tag id={block.id} className={`${size} scroll-mt-14 pt-2 font-semibold text-ink`}>
          <Inlines nodes={block.children} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p>
          <Inlines nodes={block.children} />
        </p>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List className={`${block.ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>
          {block.items.map((item, i) => (
            <li key={i}>
              <Inlines nodes={item.children} />
              {item.sublist && (
                <ul className={`${item.sublist.ordered ? 'list-decimal' : 'list-[circle]'} mt-1 space-y-1 pl-5`}>
                  {item.sublist.items.map((sub, j) => (
                    <li key={j}>
                      <Inlines nodes={sub} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </List>
      );
    }
    case 'code':
      return block.lang === 'proschi' ? (
        <pre data-lang="proschi" className="overflow-x-auto rounded-md border border-ink/15 bg-paper p-3 font-mono text-xs [overflow-wrap:normal]">
          <ProschiCode text={block.text} />
        </pre>
      ) : (
        <pre className="overflow-x-auto rounded-md border border-ink/15 bg-paper p-3 font-mono text-xs [overflow-wrap:normal]">{block.text}</pre>
      );
    case 'table':
      // Scrolls inside its own box, so a wide table never widens the page.
      return (
        <div role="region" aria-label="Table" tabIndex={0} className="max-w-full overflow-x-auto rounded-md border border-ink/20 bg-paper">
          <table className="min-w-full border-collapse text-left text-[0.8125rem] [overflow-wrap:normal]">
            <thead>
              <tr className="border-b-2 border-ink/40 bg-ink/5">
                {block.header.map((cell, i) => (
                  <th key={i} scope="col" className={`px-2.5 py-1.5 font-semibold ${ALIGN[block.align[i] ?? 'left']}`}>
                    <Inlines nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-ink/10 align-top">
                  {row.map((cell, i) => (
                    <td key={i} className={`px-2.5 py-1.5 ${ALIGN[block.align[i] ?? 'left']}`}>
                      <Inlines nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'quote':
      return (
        <blockquote className="space-y-2 rounded-r-md border-l-4 border-pop-lilac bg-pop-lilac/15 px-3 py-2 text-ink">
          {block.children.map((b, i) => (
            <BlockView key={i} block={b} large={large} />
          ))}
        </blockquote>
      );
    case 'tldr':
      return (
        <aside aria-label={TLDR_TITLE} data-block="tldr" className="rounded-brutal border-bw-2 border-ink bg-pop-yellow/25 px-4 py-3 shadow-brutal-sm">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink">
            <Zap size={14} aria-hidden="true" />
            {TLDR_TITLE}
          </p>
          <Children blocks={block.children} large={large} />
        </aside>
      );
    case 'callout': {
      const { Icon, tone } = CALLOUT_STYLE[block.tone];
      return (
        <aside aria-label={block.title ? undefined : CALLOUT_TITLES[block.tone]} data-block="callout" data-tone={block.tone} className={`rounded-brutal border-bw-1 border-ink border-l-[6px] px-4 py-3 ${tone}`}>
          <p className="mb-1 flex items-center gap-1.5 font-semibold text-ink">
            <Icon size={16} aria-hidden="true" className="flex-shrink-0" />
            {block.title ? <Inlines nodes={block.title} /> : CALLOUT_TITLES[block.tone]}
          </p>
          <Children blocks={block.children} large={large} />
        </aside>
      );
    }
    case 'numbers':
      return (
        <dl data-block="numbers" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {block.items.map((item, i) => (
            <div key={i} className="flex flex-col-reverse justify-end rounded-brutal border-bw-1 border-ink bg-surface px-3 py-2.5 shadow-brutal-sm">
              <dt className="text-xs leading-snug text-ink/80">
                <Inlines nodes={item.label} />
              </dt>
              <dd className="font-display text-2xl font-bold tabular-nums leading-tight text-ink [overflow-wrap:normal]">{item.value}</dd>
            </div>
          ))}
        </dl>
      );
    case 'deepdive':
      return (
        <details data-block="deepdive" className="group rounded-brutal border-bw-1 border-ink bg-paper">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight size={16} aria-hidden="true" className="flex-shrink-0 transition-transform duration-d1 group-open:rotate-90" />
            <span className={`${eyebrowText} text-muted`}>Deep dive</span>
            <span className="min-w-0">
              <Inlines nodes={block.title} />
            </span>
          </summary>
          <div className="border-t-bw-1 border-dashed border-ink/40 px-4 py-3">
            <Children blocks={block.children} large={large} />
          </div>
        </details>
      );
    case 'quiz':
      return (
        <Suspense fallback={<p className="text-sm text-muted">Loading the quick check…</p>}>
          <LessonQuiz ids={block.ids} />
        </Suspense>
      );
  }
}

const eyebrowText = 'text-[11px] font-bold uppercase tracking-[0.08em]';

const CALLOUT_STYLE: Record<CalloutTone, { Icon: LucideIcon; tone: string }> = {
  tip: { Icon: Lightbulb, tone: 'border-l-pop-blue bg-pop-blue/10' },
  pitfall: { Icon: TriangleAlert, tone: 'border-l-pop-pink bg-pop-pink/15' },
  interview: { Icon: MessagesSquare, tone: 'border-l-pop-lilac bg-pop-lilac/15' },
  takeaway: { Icon: KeyRound, tone: 'border-l-pass bg-pass/10' },
};

/** The blocks inside a lesson block, spaced as the article's. */
function Children({ blocks, large }: { blocks: Block[]; large: boolean }): ReactNode {
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} large={large} />
      ))}
    </div>
  );
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

/** The landing page's display highlighter (src/landing/highlight.ts), as Tailwind colours. */
const TOKEN_CLASS: Record<TokenClass, string> = {
  keyword: 'font-bold text-ink',
  string: 'text-pass',
  tech: 'text-pop-blue',
  arrow: 'font-bold text-pop-blue',
  team: 'italic text-ink/75',
  comment: 'italic text-muted',
  status: 'font-semibold text-pop-pink',
  number: 'font-semibold text-pop-pink',
};

function ProschiCode({ text }: { text: string }) {
  const lines = useMemo(() => highlightLines(text.split('\n')), [text]);
  return (
    <code>
      {lines.map((segments, i) => (
        <span key={i} className="block">
          {segments.length === 0
            ? ' '
            : segments.map((s, j) =>
                s.cls ? (
                  <span key={j} className={TOKEN_CLASS[s.cls]}>
                    {s.text}
                  </span>
                ) : (
                  s.text
                ),
              )}
        </span>
      ))}
    </code>
  );
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return n.text;
      case 'code':
        return (
          <code key={i} className="rounded bg-ink/5 px-1 py-0.5 font-mono text-[0.85em]">
            {n.text}
          </code>
        );
      case 'strong':
        return (
          <strong key={i} className="font-semibold">
            <Inlines nodes={n.children} />
          </strong>
        );
      case 'em':
        return (
          <em key={i}>
            <Inlines nodes={n.children} />
          </em>
        );
      case 'link':
        return (
          <a key={i} href={n.href} className="text-pop-blue underline hover:text-pop-blue" {...(/^https?:/.test(n.href) ? { target: '_blank', rel: 'noreferrer' } : {})}>
            <Inlines nodes={n.children} />
          </a>
        );
    }
  });
}
