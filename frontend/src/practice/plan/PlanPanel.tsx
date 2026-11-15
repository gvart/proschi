import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import deck from 'virtual:practice-cards';
import { ArrowRight, CalendarDays, Check, Layers, MessagesSquare, Puzzle, Sofa, type LucideIcon } from 'lucide-react';
import { eyebrow } from '../../components/Playground/ui';
import {
  addDays,
  buildPlan,
  carryOver,
  DEFAULT_MINUTES,
  daysLeft,
  itemDone,
  MAX_DAYS,
  pickable,
  type PlanActivity,
  type PlanDay,
  type PlanItem,
  type PlanItemKind,
  type PlanPhase,
  type PlanSettings,
} from '../../learn/interviewPlan';
import { localDay } from '../../learn/review';
import { loadHistory } from '../modes/store';
import { soloSummaryCounts } from '../interview/record';
import { setupHref } from '../interview/links';
import type { Progress } from '../progress';
import { OPTIONAL_STEPS } from '../roadmapStages';
import type { Account } from '../useAccount';
import { learnerInput } from '../hub/learnerInput';
import { useTodayCards } from '../hub/todayCards';
import { deleteAccountPlan, mergeAccountPlan, putAccountPlan, setPlanSettings, updatePlan, usePlanState, type PlanState, type TodayList } from './planStore';

/**
 * The interview-date plan (Max; learn/interviewPlan.ts, P55) on the roadmap:
 * pick the date and the minutes a day, then see the days left, a strip of
 * every day to the interview coloured by phase, and today's list, ticked off
 * from what was done (a solve, the cards reviewed, an interview on your own
 * finished). Any day of the strip shows its list. Loaded lazily: it bundles
 * every card.
 */

export interface PlanPanelProps {
  account: Account;
  progress: Progress;
  skills?: readonly { topic: string; mastery: number }[];
  /** Problem ids in the roadmap's order. */
  roadmap: readonly string[];
  /** Signed in on Max: the account keeps the plan too. */
  sync: boolean;
}

const MINUTE_CHOICES = [15, 30, 45, 60, 90, 120];

const PHASE: Record<PlanPhase, { label: string; about: string; cell: string }> = {
  learn: { label: 'Learn', about: 'Problems for your weakest skills', cell: 'bg-pop-yellow text-on-accent' },
  mock: { label: 'Mock', about: 'Mock interviews on your own', cell: 'bg-pop-blue text-on-accent' },
  review: { label: 'Review', about: 'Cards and light revision', cell: 'bg-pop-lilac text-on-accent' },
  rest: { label: 'Rest', about: 'A light recap, nothing new', cell: 'bg-pop-pink text-on-accent' },
  interview: { label: 'Interview', about: 'The day itself', cell: 'bg-ink text-paper' },
};

const KIND: Record<PlanItemKind, { label: string; icon: LucideIcon }> = {
  problem: { label: 'Problem', icon: Puzzle },
  cards: { label: 'Cards', icon: Layers },
  topic: { label: 'Cards', icon: Layers },
  interview: { label: 'Mock interview', icon: MessagesSquare },
  recap: { label: 'Recap', icon: Sofa },
};

function itemHref(item: PlanItem): string | undefined {
  if (item.kind === 'problem') return `#/${item.problem}`;
  if (item.kind === 'cards') return '#/review';
  if (item.kind === 'topic') return `#/review/${item.topic}`;
  if (item.kind === 'interview') return setupHref(item.problem, 'solo');
  return '#/progress';
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
const LONG = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const card = 'mt-6 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md';
const button =
  'inline-flex min-h-[36px] items-center gap-1.5 rounded-sm border-bw-1 border-ink px-3 text-sm font-bold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue';
const textButton = 'text-sm font-semibold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue rounded-sm';

export default function PlanPanel({ account, progress, skills, roadmap, sync }: PlanPanelProps) {
  const state = usePlanState();
  const today = localDay(new Date());
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (sync) void mergeAccountPlan();
  }, [sync]);
  const save = (settings: PlanSettings | undefined) => {
    setPlanSettings(settings);
    setEditing(false);
    if (!sync) return;
    void (settings ? putAccountPlan(settings) : deleteAccountPlan()).catch(() => undefined);
  };
  const settings = state.settings && state.settings.date >= today ? state.settings : undefined;
  return (
    <section aria-labelledby="interview-plan" className={card} data-testid="interview-plan">
      <h2 id="interview-plan" className={`flex items-center gap-1.5 ${eyebrow}`}>
        <CalendarDays size={13} aria-hidden="true" />
        Interview plan
      </h2>
      {!settings || editing ? (
        <PlanSetup today={today} current={settings} passed={!settings ? state.settings?.date : undefined} onSave={save} onCancel={settings ? () => setEditing(false) : undefined} />
      ) : (
        <Plan account={account} progress={progress} skills={skills} roadmap={roadmap} sync={sync} state={state} settings={settings} today={today} onChange={() => setEditing(true)} onRemove={() => save(undefined)} />
      )}
    </section>
  );
}

/** The date and minutes: a first plan, or a change of it. */
function PlanSetup({ today, current, passed, onSave, onCancel }: { today: string; current?: PlanSettings; passed?: string; onSave: (s: PlanSettings) => void; onCancel?: () => void }) {
  const [date, setDate] = useState(current?.date ?? addDays(today, 14));
  const [minutes, setMinutes] = useState(current?.minutes ?? DEFAULT_MINUTES);
  const ok = pickable(date, today);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    // The same date keeps its start, so the phases stay where they were.
    onSave({ date, minutes, start: current && current.date === date ? current.start : today });
  };
  return (
    <form onSubmit={submit} className="mt-2">
      {!current && (
        <>
          <p className="font-display text-lg font-extrabold leading-tight text-ink">When is your interview?</p>
          <p className="mt-1 max-w-2xl text-sm text-ink/80">
            {passed
              ? `Your interview on ${LONG.format(asDate(passed))} has passed. Pick the next one for a new plan.`
              : 'Pick the date and how long you have each day. You get a plan for every day until then: problems for your weakest skills first, then mock interviews, then review, and a rest day before.'}
          </p>
        </>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
          Interview date
          <input
            type="date"
            required
            value={date}
            min={addDays(today, 1)}
            max={addDays(today, MAX_DAYS)}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-[40px] rounded-sm border-bw-1 border-ink bg-paper px-2 font-normal text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
          Minutes a day
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="min-h-[40px] rounded-sm border-bw-1 border-ink bg-paper px-2 font-normal text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue"
          >
            {MINUTE_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!ok} className={`${button} bg-ink text-paper hover:bg-ink/85 disabled:opacity-50`}>
          {current ? 'Save' : 'Make my plan'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={textButton}>
            Cancel
          </button>
        )}
      </div>
      {!ok && date && <p className="mt-2 text-sm text-fail">Pick a date from tomorrow to {MAX_DAYS} days ahead.</p>}
    </form>
  );
}

/** Today's activity, for the ticks. */
function useActivity(progress: Progress, loaded: ReturnType<typeof useTodayCards>, ticked: PlanState['ticked'], today: string, dueNow: number): PlanActivity | undefined {
  return useMemo(() => {
    if (!loaded) return undefined;
    const topicsReviewed = new Set<string>();
    for (const c of deck.cards) {
      const s = loaded.loaded.states[c.id];
      if (s && localDay(new Date(s.lastReview * 1000)) === today) for (const t of c.tags) topicsReviewed.add(t);
    }
    const interviews = loadHistory().filter((s) => localDay(new Date(s.startedAt)) === today && soloSummaryCounts(s)).length;
    return {
      solved: new Set(Object.keys(progress).filter((id) => progress[id].status === 'solved')),
      dueNow,
      reviewsToday: loaded.loaded.today.reviews,
      topicsReviewed,
      interviews,
      ticked: new Set(ticked?.day === today ? ticked.keys : []),
    };
  }, [loaded, progress, ticked, today, dueNow]);
}

function Plan({
  account,
  progress,
  skills,
  roadmap,
  sync,
  state,
  settings,
  today,
  onChange,
  onRemove,
}: Omit<PlanPanelProps, 'sync'> & { sync: boolean; state: PlanState; settings: PlanSettings; today: string; onChange: () => void; onRemove: () => void }) {
  const loaded = useTodayCards(account);
  const input = useMemo(() => (loaded ? learnerInput(progress, loaded, skills, Math.floor(Date.now() / 1000)) : undefined), [loaded, progress, skills]);
  const pinned = state.last?.day === today ? state.last.items : undefined;
  const days = useMemo(() => {
    if (!input) return undefined;
    const carry = pinned ? undefined : carryOver(state.last, today, new Set(input.solved));
    return buildPlan({ ...input, today, settings, roadmap, carry, pinned, skip: OPTIONAL_STEPS });
  }, [input, today, settings, roadmap, pinned, state.last]);
  // Today's list, once made, stays for the day.
  const first = days?.[0];
  useEffect(() => {
    if (!pinned && first?.day === today) updatePlan((s) => ({ ...s, last: { day: today, items: first.items } }));
  }, [pinned, first, today]);
  const activity = useActivity(progress, loaded, state.ticked, today, input?.due.total ?? 0);
  const done = useMemo(() => new Set(first && activity ? first.items.filter((i) => itemDone(i, activity)).map((i) => i.key) : []), [first, activity]);

  // Signed in on Max: today's list goes to the account for the evening reminder, when it changes.
  const sent = useRef('');
  useEffect(() => {
    if (!sync || !first || !activity || first.day !== today) return;
    const list: TodayList = { day: today, items: first.items.slice(0, 8).map((i) => ({ title: i.title.slice(0, 120), done: done.has(i.key) })) };
    const key = JSON.stringify([settings, list]);
    if (key === sent.current) return;
    sent.current = key;
    void putAccountPlan(settings, list).catch(() => undefined);
  }, [sync, first, activity, done, settings, today]);

  const [selected, setSelected] = useState<string>();
  const left = daysLeft(settings, today);
  const shown = days?.find((d) => d.day === selected) ?? first;
  const toggle = (key: string) =>
    updatePlan((s) => {
      const keys = s.ticked?.day === today ? s.ticked.keys : [];
      return { ...s, ticked: { day: today, keys: keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key] } };
    });

  return (
    <>
      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        <p className="flex items-baseline gap-2">
          <span className="font-display text-4xl font-extrabold leading-none tabular-nums text-ink" data-testid="plan-days-left">
            {left}
          </span>
          <span className="font-semibold text-ink">{left === 0 ? 'Interview today' : left === 1 ? 'day to go' : 'days to go'}</span>
        </p>
        <p className="text-sm text-ink/80">
          Interview on <span className="font-semibold text-ink">{LONG.format(asDate(settings.date))}</span> · {settings.minutes} min a day
        </p>
        <p className="flex gap-3 sm:ml-auto">
          <button type="button" onClick={onChange} className={textButton}>
            Change
          </button>
          <button type="button" onClick={onRemove} className={textButton}>
            Remove
          </button>
        </p>
      </div>
      {days ? (
        <>
          <Strip days={days} today={today} selected={shown?.day} onSelect={setSelected} done={first && done.size === first.items.length && first.items.length > 0} />
          {shown && <DayList day={shown} today={today} done={shown.day === today ? done : undefined} onTick={toggle} />}
        </>
      ) : (
        <p role="status" className="mt-3 text-sm text-muted">
          Making your plan…
        </p>
      )}
    </>
  );
}

/** Every day to the interview, coloured by phase; a day opens its list. Scrolls sideways on its own when it is longer than the card. */
function Strip({ days, today, selected, onSelect, done }: { days: PlanDay[]; today: string; selected?: string; onSelect: (day: string) => void; done?: boolean }) {
  const phases = [...new Set(days.map((d) => d.phase))];
  return (
    <>
      <div className="-m-1 mt-2 overflow-x-auto p-1" data-testid="plan-strip">
        <ol className="flex gap-1.5">
          {days.map((d) => {
            const date = asDate(d.day);
            const isToday = d.day === today;
            const on = d.day === selected;
            return (
              <li key={d.day} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onSelect(d.day)}
                  aria-pressed={on}
                  aria-label={`${LONG.format(date)}: ${PHASE[d.phase].label}${isToday ? ', today' : ''}`}
                  data-phase={d.phase}
                  className={`relative flex h-14 w-11 flex-col items-center justify-center rounded-sm border-bw-1 text-center leading-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue ${PHASE[d.phase].cell} ${on ? 'border-ink outline-2 outline-offset-1 outline-ink' : 'border-ink/30'}`}
                >
                  <span className="text-[10px] font-bold uppercase opacity-80">{isToday ? 'Today' : WEEKDAY.format(date)}</span>
                  <span className="mt-1 font-display text-base font-extrabold tabular-nums">{date.getUTCDate()}</span>
                  {isToday && done && <Check size={11} strokeWidth={3} aria-hidden="true" className="absolute right-0.5 top-0.5" />}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/80" aria-label="Phases">
        {phases.map((p) => (
          <li key={p} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-[2px] border-bw-1 border-ink/40 ${PHASE[p].cell}`} />
            <span className="font-semibold text-ink">{PHASE[p].label}</span>
            <span className="max-sm:hidden">{PHASE[p].about}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A day's list: today's with its ticks, another day's as planned for now. */
function DayList({ day, today, done, onTick }: { day: PlanDay; today: string; done?: ReadonlySet<string>; onTick: (key: string) => void }) {
  const isToday = day.day === today;
  const minutes = day.items.reduce((n, i) => n + i.minutes, 0);
  const finished = done ? day.items.filter((i) => done.has(i.key)).length : 0;
  return (
    <div className="mt-4 border-t-bw-1 border-dashed border-ink/25 pt-3" data-testid="plan-day">
      <h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-display text-lg font-extrabold leading-tight text-ink">{isToday ? 'Today' : LONG.format(asDate(day.day))}</span>
        <span className="text-sm text-ink/80">
          {PHASE[day.phase].label}
          {day.items.length > 0 && ` · about ${minutes} min`}
          {isToday && day.items.length > 0 && ` · ${finished} of ${day.items.length} done`}
        </span>
      </h3>
      {!isToday && day.phase !== 'interview' && <p className="mt-0.5 text-xs text-muted">As planned today; it changes with what you do before then.</p>}
      {day.phase === 'interview' ? (
        <p className="mt-2 text-sm text-ink/80">The day itself. Nothing to practise: you are ready. Good luck!</p>
      ) : (
        <ol className="mt-2 space-y-2" data-testid="plan-items">
          {day.items.map((item, n) => {
            const isDone = !!done?.has(item.key);
            const { label, icon: Icon } = KIND[item.kind];
            const href = itemHref(item);
            return (
              <li key={item.key} className={`flex items-start gap-3 rounded-sm border-bw-1 border-ink bg-paper px-3 py-2.5 ${isDone ? 'opacity-70' : ''}`} data-done={isDone || undefined}>
                {done && item.kind === 'recap' ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isDone}
                    aria-label={`Mark "${item.title}" done`}
                    onClick={() => onTick(item.key)}
                    className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border-bw-1 border-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue ${isDone ? 'bg-pass text-paper' : 'bg-surface'}`}
                  >
                    {isDone && <Check size={13} strokeWidth={3} aria-hidden="true" />}
                  </button>
                ) : !done ? (
                  <span className="mt-0.5 w-5 shrink-0 text-center font-display text-base font-extrabold tabular-nums text-ink" aria-hidden="true">
                    {n + 1}
                  </span>
                ) : (
                  <span
                    aria-label={isDone ? 'Done' : 'Not done yet'}
                    className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border-bw-1 ${isDone ? 'border-ink bg-pass text-paper' : 'border-ink/40'}`}
                  >
                    {isDone && <Check size={13} strokeWidth={3} aria-hidden="true" />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {href ? (
                      <a href={href} className={`font-semibold text-ink hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue rounded-sm ${isDone ? 'line-through decoration-ink/40' : ''}`}>
                        {item.title}
                      </a>
                    ) : (
                      <span className="font-semibold text-ink">{item.title}</span>
                    )}
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                      <Icon size={11} aria-hidden="true" />
                      {label} · {item.minutes} min
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-ink/80">{item.reason}</span>
                </span>
                {href && <ArrowRight size={16} className="mt-1 shrink-0 text-ink max-sm:hidden" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
