import { useId, useState } from 'react';
import { X } from 'lucide-react';
import type { StepKind } from '../../dsl/edit';
import { eyebrow, field } from '../Playground/ui';
import { isHttpHead, type More } from './stepLabel';

/**
 * The rest of a step's label, past its operation or status: headers from the
 * target's type, the payload, fan-out and payload size. The Flows view edits
 * them in a selected step's details card (FlowsPanel.tsx), a phone in its
 * step's sheet (FlowsPhone.tsx).
 */

/** The rest of a label, folded: headers from the target's type, the payload, fan-out and payload size. */
export function MoreFields({ kind, head, more, onMore, headers, typeName }: { kind: StepKind; head: string; more: More; onMore: (more: More) => void; headers: string[]; typeName?: string }) {
  const count = (more.tail ? 1 : 0) + (more.fanOut ? 1 : 0) + (more.size ? 1 : 0) + more.headers.length;
  return (
    <details className="group/more rounded-sm border-bw-1 border-ink/20 px-2 py-1" open={count > 0 || undefined}>
      <summary className="cursor-pointer select-none text-xs font-semibold">
        {kind === 'response' ? 'Payload' : 'Headers, payload and fan-out'}
        {count > 0 && <span className="ml-1 text-muted">({count})</span>}
      </summary>
      <div className="pb-1 pt-2">
        <MoreBody kind={kind} head={head} more={more} onMore={onMore} headers={headers} typeName={typeName} />
      </div>
    </details>
  );
}

/** The fields of the rest of a label: at most eight header chips (a filter narrows them), the payload, fan-out and size. */
export function MoreBody({ kind, head, more, onMore, headers, typeName }: { kind: StepKind; head: string; more: More; onMore: (more: More) => void; headers: string[]; typeName?: string }) {
  const id = useId();
  const [filter, setFilter] = useState('');
  const set = (patch: Partial<More>) => onMore({ ...more, ...patch });
  const http = isHttpHead(head) && kind !== 'response';
  const offered = headers.filter((h) => !more.headers.includes(h) && h.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 8);
  return (
    <>
      <div className="space-y-2">
        {http && headers.length > 0 && (
          <div className="space-y-1">
            <label htmlFor={`${id}-h`} className={`block ${eyebrow}`}>
              Headers {typeName ? `${typeName} takes` : ''}
            </label>
            {more.headers.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {more.headers.map((h) => (
                  <button key={h} type="button" aria-label={`Remove header ${h}`} onClick={() => set({ headers: more.headers.filter((x) => x !== h) })} className="inline-flex items-center gap-1 rounded-full border-bw-1 border-ink bg-pop-yellow/40 px-2 py-0.5 font-mono text-[11px]">
                    {h}
                    <X size={10} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
            <input id={`${id}-h`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter headers" autoComplete="off" className={`w-full ${field} !py-1 text-xs`} />
            <div className="flex flex-wrap gap-1" aria-label="Headers to add">
              {offered.map((h) => (
                <button key={h} type="button" onClick={() => set({ headers: [...more.headers, h] })} className="rounded-full border-bw-1 border-ink/30 px-2 py-0.5 font-mono text-[11px] hover:border-ink hover:bg-pop-yellow/30">
                  + {h}
                </button>
              ))}
            </div>
          </div>
        )}
        {kind !== 'response' && !http && headers.length > 0 && <p className="text-xs text-muted">Headers go after an HTTP method and a path, e.g. GET /orders.</p>}
        <div className="space-y-0.5">
          <label htmlFor={`${id}-t`} className={`block ${eyebrow}`}>
            Payload or note
          </label>
          <input id={`${id}-t`} value={more.tail} onChange={(e) => set({ tail: e.target.value })} placeholder={'e.g. {"id": 42}'} autoComplete="off" spellCheck={false} className={`w-full ${field} !py-1 font-mono text-xs`} />
        </div>
        {kind !== 'response' && (
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-0.5">
              <label htmlFor={`${id}-x`} className={`block ${eyebrow}`}>
                Calls per request
              </label>
              <input
                id={`${id}-x`}
                type="number"
                min={1}
                value={more.fanOut ?? ''}
                onChange={(e) => set({ fanOut: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)) })}
                placeholder="1"
                className={`w-full ${field} !py-1 text-xs`}
              />
            </div>
            <div className="space-y-0.5">
              <label htmlFor={`${id}-s`} className={`block ${eyebrow}`}>
                Payload size
              </label>
              <input id={`${id}-s`} value={more.size ?? ''} onChange={(e) => set({ size: e.target.value.trim() || undefined })} placeholder="e.g. 2MB" autoComplete="off" className={`w-full ${field} !py-1 text-xs`} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
