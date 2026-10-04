import { useMemo } from 'react';
import { parseMarkdown, type Block, type Inline } from './markdown';

/** Renders a problem statement; see markdown.ts for what it understands. */
export default function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div className="space-y-3 text-sm leading-relaxed text-gray-800">{blocks.map((b, i) => <BlockView key={i} block={b} />)}</div>;
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = (['h1', 'h2', 'h3', 'h4'] as const)[block.level - 1];
      const size = block.level === 1 ? 'text-xl' : block.level === 2 ? 'text-base' : 'text-sm';
      return (
        <Tag className={`${size} pt-2 font-semibold text-gray-900`}>
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
      return <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs">{block.text}</pre>;
  }
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return n.text;
      case 'code':
        return (
          <code key={i} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em]">
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
          <a key={i} href={n.href} className="text-blue-700 underline hover:text-blue-900" {...(/^https?:/.test(n.href) ? { target: '_blank', rel: 'noreferrer' } : {})}>
            <Inlines nodes={n.children} />
          </a>
        );
    }
  });
}
