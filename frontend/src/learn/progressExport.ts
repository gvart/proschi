/**
 * The progress export (Pro; GET /api/me/export?view=progress,
 * backend/src/progressExport.ts) as CSV files, one per table, for a
 * spreadsheet. Pure, like the rest of src/learn.
 */

export interface ProgressExport {
  exportedAt: string;
  displayName: string;
  level: { level: number; xp: number };
  readiness: number;
  streak: { current: number; longest: number };
  mastery: { topic: string; title: string; mastery: number }[];
  problems: {
    problemId: string;
    title: string;
    difficulty: string | null;
    solved: boolean;
    solvedAt: string | null;
    runs: number;
    firstRunAt: string | null;
    runsToSolve: number | null;
    bestCostUsd: number | null;
    bestP99Ms: number | null;
  }[];
  interviews: { id: string; problemId: string; minutes: number; status: string; startedAt: string; endedAt: string | null; passed: boolean | null; scores: Record<string, number> | null }[];
  soloInterviews: { problemId: string; startedAt: string; minutes: number; totalMinutes: number; reachedDesign: boolean; drew: boolean; solved: boolean }[];
  cards: { cardId: string; reps: number; lapses: number; stabilityDays: number; difficulty: number; lastReviewAt: string | null; dueAt: string | null }[];
}

type Cell = string | number | boolean | null | undefined;

/** One CSV field (RFC 4180): quoted when it holds a comma, quote or line break; a leading =, +, - or @ is prefixed with ' so a spreadsheet never runs it as a formula. */
export function csvField(value: Cell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV table: the header row, then a row per item, with CRLF line ends. */
export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

const percent = (share: number) => Math.round(share * 100);

/** Every table of the export, as files for a zip: summary, mastery, problems, interviews (with the interviewer and on your own) and cards. */
export function progressCsvFiles(data: ProgressExport): { name: string; data: string }[] {
  const skills = [...new Set(data.interviews.flatMap((i) => Object.keys(i.scores ?? {})))].sort();
  return [
    {
      name: 'summary.csv',
      data: toCsv(
        ['exported_at', 'display_name', 'level', 'xp', 'interview_ready_percent', 'streak_current_days', 'streak_longest_days', 'problems_solved'],
        [[data.exportedAt, data.displayName, data.level.level, data.level.xp, percent(data.readiness), data.streak.current, data.streak.longest, data.problems.filter((p) => p.solved).length]],
      ),
    },
    { name: 'mastery.csv', data: toCsv(['topic', 'title', 'mastery_percent'], data.mastery.map((m) => [m.topic, m.title, percent(m.mastery)])) },
    {
      name: 'problems.csv',
      data: toCsv(
        ['problem_id', 'title', 'difficulty', 'solved', 'solved_at', 'runs', 'first_run_at', 'runs_to_solve', 'best_cost_usd', 'best_p99_ms'],
        data.problems.map((p) => [p.problemId, p.title, p.difficulty, p.solved, p.solvedAt, p.runs, p.firstRunAt, p.runsToSolve, p.bestCostUsd, p.bestP99Ms]),
      ),
    },
    {
      name: 'interviews.csv',
      data: toCsv(
        ['mode', 'problem_id', 'started_at', 'minutes', 'status', 'passed', ...skills.map((s) => `score_${s}`), 'reached_design', 'solved'],
        [
          ...data.interviews.map((i) => ['interviewer', i.problemId, i.startedAt, i.minutes, i.status, i.passed, ...skills.map((s) => i.scores?.[s]), null, null]),
          ...data.soloInterviews.map((s) => ['on your own', s.problemId, s.startedAt, s.minutes, 'finished', null, ...skills.map(() => null), s.reachedDesign, s.solved]),
        ],
      ),
    },
    {
      name: 'cards.csv',
      data: toCsv(
        ['card_id', 'reps', 'lapses', 'stability_days', 'difficulty', 'last_review_at', 'due_at'],
        data.cards.map((c) => [c.cardId, c.reps, c.lapses, c.stabilityDays, c.difficulty, c.lastReviewAt, c.dueAt]),
      ),
    },
  ];
}
