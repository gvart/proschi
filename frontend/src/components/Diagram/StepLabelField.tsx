import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { opLabel, type StepVocabulary } from '../../dsl/typesys/vocabulary';
import { field } from '../Playground/ui';
import { statusRank } from './stepLabel';

/**
 * A step's label with what its components' types allow, as a combobox: the
 * target's operations (its own first, each with read or write), on a
 * response the responder's statuses, and the labels the design already uses
 * between such components. Typing filters the list; anything else typed
 * still works, as in the code.
 */

interface Option {
  key: string;
  /** What the option puts at the start of the label. */
  insert: string;
  text: string;
  detail?: string;
  group: string;
}

/** The standard reason phrases (RFC 9110), shown next to a status; only the number goes in the label. */
const REASON: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  102: 'Processing',
  103: 'Early Hints',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  207: 'Multi-Status',
  208: 'Already Reported',
  226: 'IM Used',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  421: 'Misdirected Request',
  422: 'Unprocessable Content',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  508: 'Loop Detected',
  510: 'Not Extended',
  511: 'Network Authentication Required',
};


function optionsOf(v: StepVocabulary, kind: string): Option[] {
  const type = v.type?.name;
  if (kind === 'response') {
    const statuses = [...v.statuses]
      .sort((a, b) => statusRank(a) - statusRank(b))
      .map((s) => ({
        key: `s${s}`,
        insert: `${s} `,
        text: String(s),
        detail: REASON[s],
        group: `${type} answers with`,
      }));
    return [
      ...statuses,
      ...v.used.map((u) => ({
        key: `u${u}`,
        insert: u,
        text: u,
        group: 'Used in this design',
      })),
    ];
  }
  const ops = v.ops.map((o) => ({
    key: `o${o.name}`,
    insert: opLabel(o.name, v),
    text: o.name,
    detail: o.access === 'forward' ? 'passes on' : o.access,
    group: o.from === type ? `${type} operations` : `From ${o.from}`,
  }));
  const methods = v.methods.map((m) => ({
    key: `m${m}`,
    insert: opLabel(m, v),
    text: m,
    detail: 'HTTP method',
    group: 'HTTP methods',
  }));
  return [
    ...ops,
    ...methods,
    ...v.used.map((u) => ({
      key: `u${u}`,
      insert: u,
      text: u,
      group: 'Used in this design',
    })),
  ];
}

/** The label with its first word (the operation or status) replaced by `insert`. */
function withStart(label: string, insert: string): string {
  if (!insert.endsWith(' ') && !insert.endsWith('/')) return insert;
  const rest = label.replace(/^\s*("[^"]*"|\S+)\s*/, '');
  return insert.endsWith('/') ? `${insert.slice(0, -1)}${rest.startsWith('/') ? rest : `/${rest}`}` : `${insert}${rest}`;
}

function hint(v: StepVocabulary, kind: string): string {
  const name = v.type?.name;
  if (!name) return 'Free text: this component has no type.';
  const speaks = v.protocol ? ` It speaks ${v.protocol}.` : '';
  if (kind === 'response') return v.statuses.length ? `${name} answers with one of its statuses.${speaks}` : `${name} lists no statuses: any answer is fine.${speaks}`;
  if (v.ops.length) return `Starts with one of ${name}'s ${v.ops.length} operations.${speaks}`;
  return `${name} takes any label.${speaks}`;
}

export default function StepLabelField({ id, value, onChange, vocabulary, kind }: { id: string; value: string; onChange: (label: string) => void; vocabulary: StepVocabulary; kind: string }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const all = useMemo(() => optionsOf(vocabulary, kind), [vocabulary, kind]);
  const word = value.trim().replace(/^"/, '').split(/[\s/]/)[0].toLowerCase();
  const shown = useMemo(() => {
    if (!word) return all;
    const starts = all.filter((o) => o.text.toLowerCase().startsWith(word));
    const contains = all.filter((o) => !o.text.toLowerCase().startsWith(word) && `${o.text} ${o.key.startsWith('s') ? (o.detail ?? '') : ''}`.toLowerCase().includes(word));
    return [...starts, ...contains];
  }, [all, word]);
  const index = Math.min(active, shown.length - 1);

  useEffect(() => {
    if (index >= 0) listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (o: Option) => {
    onChange(withStart(value, o.insert));
    setOpen(false);
    setActive(-1);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  };

  // Shown while the first word (the operation or status) is being picked, and kept on blur: closing it then would move
  // the form's buttons from under the pointer. Once the label goes on past its first word, it is out of the way.
  const expanded = open && shown.length > 0 && !/\s/.test(value.trimStart());
  let lastGroup = '';
  return (
    <div>
      <input
        ref={inputRef}
        id={id}
        autoFocus
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && index >= 0 ? `${listId}-${index}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive(Math.min(index + 1, shown.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(Math.max(index - 1, -1));
          } else if (e.key === 'Enter' && expanded && index >= 0) {
            e.preventDefault();
            choose(shown[index]);
          } else if (e.key === 'Escape' && expanded) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
        placeholder={kind === 'response' ? 'Pick or type the answer' : 'Pick or type an operation'}
        autoComplete="off"
        spellCheck={false}
        className={`w-full ${field} !py-1 font-mono`}
      />
      {expanded && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Labels"
          // Keep focus in the field while picking.
          onMouseDown={(e) => e.preventDefault()}
          className="mt-1 max-h-48 overflow-y-auto rounded-sm border-bw-1 border-ink bg-surface py-1"
        >
          {shown.map((o, i) => {
            const heading = o.group !== lastGroup ? o.group : undefined;
            lastGroup = o.group;
            return (
              <li key={o.key} role="presentation">
                {heading && <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{heading}</div>}
                <div
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === index}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={`flex cursor-pointer items-baseline gap-2 px-2 py-1 ${i === index ? 'bg-pop-yellow text-on-accent' : ''}`}
                >
                  <span className="min-w-0 truncate font-mono text-xs font-semibold">{o.text}</span>
                  {o.detail && <span className={`ml-auto shrink-0 text-[11px] ${i === index ? 'text-on-accent/80' : 'text-muted'}`}>{o.detail}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted">{hint(vocabulary, kind)}</p>
    </div>
  );
}
