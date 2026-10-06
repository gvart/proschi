import type { Forecast } from '../engine/run';
import type { ScenarioDef, WaveDef } from '../engine/types';
import { SENDER_LABEL } from './visual';

/** The mascot's face while it talks: calm, pleased, or ears back. */
export type Mood = 'calm' | 'happy' | 'alarmed';

export interface Briefing {
  mood: Mood;
  /** Short paragraphs, said in order. */
  lines: string[];
}

const pct = (r: number) => `${Math.round(Math.abs(r - 1) * 100)}%`;
const reqs = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : `${Math.round(n)}`);

const CURVE_LINE: Record<Forecast['curve'], string> = {
  flat: 'Traffic stays level all month.',
  day: 'A normal month: busy afternoons, quiet nights.',
  ramp: 'Traffic climbs all month, so the busiest moment is at the end.',
  spike: 'Expect one sharp spike, about four times the usual traffic.',
  'double-peak': 'Two rush hours this month, with a lull between them.',
};

/** A Proschi requirement line in plain words; the line itself when it is not one we know. */
export function sayRequirement(line: string): string {
  let m = /^p([\d.]+)\s+"([^"]+)"\s*<\s*([\d.]+)ms$/.exec(line.trim());
  if (m) return `${m[2]} must answer in under ${m[3]} ms for ${m[1]}% of requests.`;
  m = /^availability\s+"([^"]+)"\s*>=\s*([\d.]+)%$/.exec(line.trim());
  if (m) return `${m[1]} must stay up ${m[2]}% of the time.`;
  m = /^cost\s*<=\s*([\d.,]+)\s*usd\/month$/.exec(line.trim());
  if (m) return `The cloud bill has to stay under $${Number(m[1].replace(/,/g, '')).toLocaleString('en-US')} a month.`;
  m = /^durable\s+"([^"]+)"$/.exec(line.trim());
  if (m) return `${m[1]} must never lose a request, even when a box dies.`;
  if (/^survive any node failure$/.test(line.trim())) return 'We have to survive losing any single box: two of everything.';
  return `New rule: ${line.trim()}.`;
}

/**
 * What the mascot says when a wave's plan begins: the wave's own brief (a
 * boss's intro), then what is new since last month, in plain words. Built
 * from the forecast, so every scenario gets one without writing it.
 */
export function briefing(scenario: ScenarioDef, wave: WaveDef, forecast: Forecast): Briefing {
  const lines: string[] = [];
  const first = forecast.wave === 0;
  const { news } = forecast;
  if (wave.brief) lines.push(wave.brief);
  else if (forecast.boss) lines.push(`Boss wave: ${forecast.name ?? 'the big one'}! Everything we built gets tested this month.`);
  else if (first) lines.push(`Welcome aboard! ${scenario.summary}`);
  if (first && forecast.mutator) lines.push(`This run's twist is ${forecast.mutator.name}: ${forecast.mutator.text}`);

  if (wave.diagnosis) lines.push("We're being paged! Read the alert, then name the root cause before you touch the board.");
  else if (forecast.ticket) lines.push(`New ticket from ${SENDER_LABEL[forecast.ticket.from]}: “${forecast.ticket.title}”. The details are right below.`);

  const peak = forecast.peak.reduce((a, p) => a + p.rps, 0);
  if (news.growth !== undefined && Math.abs(news.growth - 1) >= 0.05) {
    lines.push(`Traffic is ${news.growth > 1 ? 'up' : 'down'} ${pct(news.growth)} on last month, peaking at about ${reqs(peak)} requests a second. ${CURVE_LINE[forecast.curve]}`);
  } else if (!first) lines.push(`About the same traffic as last month, peaking near ${reqs(peak)} requests a second. ${CURVE_LINE[forecast.curve]}`);
  else lines.push(`We start at about ${reqs(peak)} requests a second at the peak. ${CURVE_LINE[forecast.curve]}`);

  const fresh = news.useCases.map((k) => scenario.useCases[k]).filter(Boolean);
  if (fresh.length && !first) lines.push(`New ${fresh.length === 1 ? 'feature' : 'features'} going live: ${fresh.map((u) => `${u.name} (${u.method} ${u.path})`).join(', ')}.`);
  for (const r of news.requirements) lines.push(sayRequirement(r));

  // On the first wave a far-user mutator has said it already.
  const farUsers = forecast.global > 0 && (first || wave.global !== undefined) && !(first && forecast.mutator?.global);
  if (farUsers) lines.push(`${Math.round(forecast.global * 100)}% of our users are far away now: every request they make crosses an ocean.`);
  for (const e of forecast.events) lines.push(`Heads-up: ${e.telegraph}`);
  if (forecast.contract) lines.push('After this wave a client offers us a contract. More revenue, if we can carry it.');
  if (forecast.bountyOffer.length) lines.push(`${forecast.bountyOffer.length} bounties on offer this month: take one if you like. Met, it pays; missed, it costs a little.`);
  if (first && forecast.spread) lines.push(`Forecasts are estimates: the real peak lands within ${Math.round(forecast.spread * 100)}% either way. Leave some headroom.`);
  if (forecast.surprises && news.surprises) lines.push('From now on not every incident is on the forecast, and one that breaks something can set off another. The on-call can rate-limit, warm the cache, switch a feature off or bring a node back.');
  // The code pane, as the scenario opens it up (watch, then type, then type only).
  const waveNo = forecast.wave + 1;
  const { edit, only } = scenario.code;
  if (first && edit > 1) lines.push('Open the Code tab while you build: every change on the board writes a line of Proschi there, and it lights up.');
  else if (waveNo === edit && edit > 1) lines.push('From this wave you can type the board yourself in the Code tab. Ctrl+Space lists what you can place.');
  if (waveNo === only) lines.push('From now on new components are typed in the Code tab, not placed from the palette (on a phone the palette stays).');

  const quiet = !first && !fresh.length && !news.requirements.length && !farUsers && !forecast.events.length && !forecast.ticket && !wave.diagnosis;
  if (quiet) lines.push('Nothing else is new. Check the forecast and deploy when you are ready.');

  const mood: Mood = forecast.boss || wave.diagnosis || forecast.events.length ? 'alarmed' : first ? 'happy' : 'calm';
  return { mood, lines };
}
