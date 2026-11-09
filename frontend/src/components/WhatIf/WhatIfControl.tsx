import { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, PenLine, Power, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import type { Diagram } from '../../dsl/types';
import { formatRps } from '../../sim/format';
import { iconButton, toolButton } from '../Playground/ui';
import { formatMultiplier, isActive, MULTIPLIERS, NO_WHATIF, stopOf, toggleFailed, totalRps, whatIfLabel, type LiveWhatIf } from './whatIf';

interface WhatIfControlProps {
  diagram: Diagram;
  whatIf: LiveWhatIf;
  onChange: (whatIf: LiveWhatIf) => void;
  /** Writes the live what-if as a `whatif` block. */
  onSave: () => void;
  /** Scales the traffic block's rates by the slider's multiplier. */
  onWriteTraffic: () => void;
  /** The card opens as a bottom sheet instead of under the pill. */
  phone: boolean;
}

/**
 * The live what-if on the canvas (docs/design/paid-plans.md P57): a slider
 * that multiplies all traffic from ×0.5 to ×10 and the nodes simulated down,
 * with a reset, "Save as what-if" and "Write to traffic". Shown while the
 * load overlay is on, as a pill in the toolbar that opens the card (a bottom
 * sheet on a phone), so it covers no node until it is used. It never edits
 * the text by itself.
 */
export default function WhatIfControl(props: WhatIfControlProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { diagram, whatIf, onChange, phone } = props;
  const active = isActive(whatIf);
  // The card closes on a click elsewhere and on Escape, like a menu.
  useEffect(() => {
    if (!open || phone) return;
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, phone]);
  const label = whatIfLabel(diagram, whatIf);
  return (
    <div ref={ref} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={active ? `What-if: ${label}` : 'What-if: traffic'}
        title={active ? `What-if: ${label}` : 'Try more or less traffic, or nodes down, without editing the code'}
        data-testid="whatif-open"
        data-active={active || undefined}
        className={`${toolButton} border-ink bg-surface shadow-brutal-sm data-[active]:bg-pop-yellow data-[active]:text-on-accent`}
      >
        <SlidersHorizontal size={16} />
        <span className="max-w-[9rem] truncate whitespace-nowrap tabular-nums">
          {whatIf.saved !== undefined ? whatIf.saved : !active ? formatMultiplier(whatIf.multiplier) : whatIf.multiplier !== 1 ? `What-if ${formatMultiplier(whatIf.multiplier)}` : 'What-if'}
        </span>
        {whatIf.saved === undefined && whatIf.failed.length > 0 && <span className="whitespace-nowrap text-xs">· {whatIf.failed.length} down</span>}
      </button>
      {active && (
        <button type="button" onClick={() => onChange(NO_WHATIF)} aria-label="Reset the what-if" title="Back to the design as written" className={`${iconButton} ml-0.5`}>
          <RotateCcw size={16} />
        </button>
      )}
      {open && !phone && (
        <section
          aria-label="What-if"
          data-testid="whatif-control"
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-sm border-bw-1 border-ink bg-surface px-3 py-2 text-ink shadow-brutal-md"
        >
          <WhatIfBody {...props} />
        </section>
      )}
      {open && phone && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onMouseDown={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="What-if"
            data-testid="whatif-control"
            className="rounded-t-brutal border-t-bw-2 border-ink bg-surface px-4 pb-6 pt-3 text-ink shadow-brutal-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex justify-end">
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className={`${iconButton} !h-8 !w-8`}>
                <X size={16} />
              </button>
            </div>
            <WhatIfBody {...props} />
          </div>
        </div>
      )}
    </div>
  );
}

/** The stops labelled under the slider, each under its own place. */
const TICKS = [0.5, 1, 3, 10] as const;

function WhatIfBody({ diagram, whatIf, onChange, onSave, onWriteTraffic, phone }: WhatIfControlProps) {
  const active = isActive(whatIf);
  const stop = stopOf(whatIf.multiplier);
  const multiplier = MULTIPLIERS[stop];
  const rate = formatRps(totalRps(diagram) * multiplier);
  const value = `${formatMultiplier(multiplier)} · ${rate}`;
  const small = phone ? 'text-sm' : 'text-xs';
  return (
    <div className={`grid gap-1.5 ${small}`}>
      <div className="flex min-h-7 items-center gap-2">
        {active ? (
          <span data-testid="whatif-badge" className="min-w-0 truncate rounded-full border-bw-1 border-ink bg-pop-yellow px-2 py-0.5 font-bold text-on-accent" title={whatIfLabel(diagram, whatIf)}>
            What-if: {whatIfLabel(diagram, whatIf)}
          </span>
        ) : (
          <span className="font-bold">Traffic</span>
        )}
        {active && (
          <button type="button" onClick={() => onChange(NO_WHATIF)} aria-label="Reset the what-if" title="Back to the design as written" className={`${iconButton} ml-auto !h-7 !w-7 shrink-0`}>
            <RotateCcw size={14} />
          </button>
        )}
      </div>
      {whatIf.saved === undefined ? (
        <label className="grid gap-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-muted">All traffic</span>
            <output data-testid="whatif-value" className="font-semibold tabular-nums">
              {value}
            </output>
          </span>
          <input
            type="range"
            min={0}
            max={MULTIPLIERS.length - 1}
            step={1}
            value={stop}
            onChange={(e) => onChange({ multiplier: MULTIPLIERS[Number(e.target.value)], failed: whatIf.failed })}
            aria-label="Traffic multiplier"
            aria-valuetext={value}
            className={`w-full accent-[rgb(var(--c-ink))] ${phone ? 'h-8' : ''}`}
          />
          <span className="relative h-4 text-[11px] text-muted tabular-nums" aria-hidden="true">
            {TICKS.map((m) => {
              const at = MULTIPLIERS.indexOf(m) / (MULTIPLIERS.length - 1);
              return (
                <span key={m} className="absolute top-0" style={{ left: `${at * 100}%`, transform: `translateX(-${at * 100}%)` }}>
                  ×{m}
                </span>
              );
            })}
          </span>
        </label>
      ) : (
        <p className="text-muted">Previewing the saved what-if. Reset to go back to the design as written.</p>
      )}
      {whatIf.failed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" aria-label="Nodes down">
          {whatIf.failed.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange(toggleFailed(whatIf, id))}
              title={`Bring ${id} back up`}
              aria-label={`${id} down: bring it back up`}
              className="inline-flex items-center gap-1 rounded-full border-bw-1 border-dashed border-ink px-2 py-0.5 font-mono hover:bg-ink/10"
            >
              <Power size={12} aria-hidden="true" />
              {id} down
              <X size={12} aria-hidden="true" />
            </button>
          ))}
          {whatIf.failed.length > 1 && (
            <button type="button" onClick={() => onChange({ multiplier: whatIf.multiplier, failed: [] })} className="px-1 font-semibold underline underline-offset-2">
              Bring all up
            </button>
          )}
        </div>
      )}
      {active && whatIf.saved === undefined && (
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={onSave} className={`${toolButton} !px-2 !py-1 ${small} border-ink`} title="Write it as a whatif block, to keep and compare">
            <BookmarkPlus size={14} />
            Save as what-if
          </button>
          {whatIf.multiplier !== 1 && (
            <button type="button" onClick={onWriteTraffic} className={`${toolButton} !px-2 !py-1 ${small}`} title={`Multiply the traffic block's rates by ${formatMultiplier(multiplier)}`}>
              <PenLine size={14} />
              Write to traffic
            </button>
          )}
        </div>
      )}
    </div>
  );
}
