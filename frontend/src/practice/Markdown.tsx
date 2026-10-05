import { useMemo } from 'react';
import { highlightLines, type TokenClass } from '../landing/highlight';
import { parseInline, parseMarkdown, type Block, type Inline } from './markdown';

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
  }
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
