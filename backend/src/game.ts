import type { GameStats } from '../../frontend/src/learn/achievements';
import { challengeDay } from '../../frontend/src/learn/challenge';
import { addDays } from '../../frontend/src/learn/streak';
import { readContent } from '../../frontend/src/game/engine/content';
import {
  buy,
  dailyScenario,
  emptyMeta,
  equip,
  firstClear,
  gameStats,
  loadoutAllowed,
  loadoutFor,
  maxAscension,
  MetaError,
  readMeta,
  recordRun,
  scenarioOpen,
  type Meta,
} from '../../frontend/src/game/engine/meta';
import { dailySeed } from '../../frontend/src/game/engine/rng';
import { Game, GameError } from '../../frontend/src/game/engine/run';
import { GAME_VERSION, MAX_ASCENSION } from '../../frontend/src/game/engine/rules';
import type { Action, GameContent, RunSetup } from '../../frontend/src/game/engine/types';
import { SIM_VERSION } from '../../frontend/src/sim/version';
import { authenticate, requireUser, type User } from './auth';
import type { Ctx } from './context';
import { sha256 } from './crypto';
import { now } from './env';
import { gameFiles } from './game.gen';
import { HttpError, json, rateLimit, readJson } from './http';
import { cached } from './stats';

/**
 * Scale or Fail (docs/GAME.md, frontend/src/game/engine). The server never
 * takes a score from a client: it starts every ranked run itself (picking
 * the seed and the loadout from the player's stored progress), then replays
 * the submitted actions with the same engine the page runs, and keeps what
 * the replay scores. Progress between runs changes only through replayed
 * runs and purchases checked against it, so unlocks and perks, which count
 * on the leaderboards, are earned.
 */

/** Entries of a leaderboard. */
export const LEADERBOARD_SIZE = 20;
/** A daily run started yesterday is still taken this long after 00:00 UTC. */
export const GRACE_SECONDS = 30 * 60;
/** A run's actions, at most (a long Endless run with every on-call and reroll stays far below). */
export const MAX_ACTIONS = 2000;
/** Seconds a wave takes at the least, played at top speed: a faster submission is not a person playing. */
export const MIN_SECONDS_PER_WAVE = 3;
/** Runs one sync request may replay (each takes up to a few hundred ms of the Worker's CPU). */
export const MAX_SYNC_RUNS = 3;
/** A run's actions carry a board per deploy, load test and live change: room for a long Endless run. */
const MAX_BODY = 512 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

let content: GameContent | undefined;
/** The game's content, read once per isolate. */
export function gameContent(): GameContent {
  if (!content) {
    const read = readContent(gameFiles);
    if (read.errors.length) throw new Error(`Game content: ${read.errors.map((e) => e.message).join('; ')}`);
    content = read.content;
  }
  return content;
}

const scenarioOf = (id: string) => gameContent().scenarios.find((s) => s.id === id);

/** What a run must be replayed with: the engine, the scenario and the simulation as they were at its start. */
export function versionsOf(scenario: string): string {
  return `g${GAME_VERSION}.s${scenarioOf(scenario)?.version ?? 0}.m${SIM_VERSION}`;
}

/** A leaderboard: one per scenario, ascension and versions, and one per daily run. */
export const scenarioBoard = (scenario: string, ascension: number) => `${scenario}:a${ascension}:${versionsOf(scenario)}`;
export const dailyBoard = (day: string) => `daily:${day}`;

async function loadMeta(DB: D1Database, userId: string): Promise<Meta> {
  const row = await DB.prepare('SELECT meta FROM game_meta WHERE user_id = ?').bind(userId).first<{ meta: string }>();
  return row ? readMeta(JSON.parse(row.meta)) : emptyMeta();
}

const saveMeta = (DB: D1Database, userId: string, meta: Meta) =>
  DB.prepare('INSERT INTO game_meta (user_id, meta, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET meta = ?2, updated_at = ?3').bind(userId, JSON.stringify(meta), now());

function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface RunRow {
  id: string;
  user_id: string;
  mode: string;
  board: string | null;
  day: string | null;
  scenario: string;
  ascension: number;
  setup: string;
  versions: string;
  started_at: number;
  submitted_at: number | null;
  score: number | null;
}

/** The daily run's day and scenario, as `GET /api/game/me` and the page show them. */
function today(t = now()) {
  const day = challengeDay(new Date(t * 1000));
  return { day, scenario: dailyScenario(gameContent(), day).id, seed: dailySeed(day) };
}

/**
 * GET /api/game/me: `{meta, best: {<board>: score}, daily: {day, scenario,
 * runId?, score?}}`, the player's progress, best score per leaderboard and
 * today's daily run.
 */
export async function getGameMe(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  const t = today();
  const [meta, best, daily] = await Promise.all([
    loadMeta(DB, user.id),
    DB.prepare('SELECT board, MAX(score) AS score FROM game_runs WHERE user_id = ? AND submitted_at IS NOT NULL AND board IS NOT NULL GROUP BY board')
      .bind(user.id)
      .all<{ board: string; score: number }>(),
    DB.prepare("SELECT id, submitted_at, score FROM game_runs WHERE user_id = ? AND mode = 'daily' AND day = ?")
      .bind(user.id, t.day)
      .first<{ id: string; submitted_at: number | null; score: number | null }>(),
  ]);
  return json(
    {
      meta,
      best: Object.fromEntries(best.results.map((r) => [r.board, r.score])),
      daily: { day: t.day, scenario: t.scenario, ...(daily ? { runId: daily.id, submitted: daily.submitted_at !== null, score: daily.score } : {}) },
    },
    200,
    NO_STORE,
  );
}

/**
 * POST /api/game/runs {mode: 'normal' | 'daily', scenario?, ascension?}:
 * starts a ranked run and answers `{runId, setup}`. A normal run gets a seed
 * from the server (so a player cannot shop for one) and the loadout of the
 * player's progress; the scenario must be open and the ascension at most one
 * above the highest cleared. The daily run is today's scenario and seed at
 * ascension 0; starting it again answers the same run until it is submitted.
 */
export async function postGameRun(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  const body = await readJson(request, 1024);
  await rateLimit(ctx.env.GAME_LIMITER, user.id, 'Too many game requests; wait a minute');
  const meta = await loadMeta(DB, user.id);
  const t = now();
  const id = crypto.randomUUID();

  if (body.mode === 'daily') {
    const d = today(t);
    const existing = await DB.prepare("SELECT * FROM game_runs WHERE user_id = ? AND mode = 'daily' AND day = ?").bind(user.id, d.day).first<RunRow>();
    if (existing) {
      if (existing.submitted_at !== null) throw new HttpError(409, "You played today's daily run; only the first counts");
      return json({ runId: existing.id, setup: JSON.parse(existing.setup) as RunSetup }, 200, NO_STORE);
    }
    const setup: RunSetup = { scenario: d.scenario, seed: d.seed, ascension: 0, mode: 'daily', loadout: loadoutFor(meta, 0) };
    await DB.prepare("INSERT OR IGNORE INTO game_runs (id, user_id, mode, board, day, scenario, ascension, setup, versions, started_at) VALUES (?, ?, 'daily', ?, ?, ?, 0, ?, ?, ?)")
      .bind(id, user.id, dailyBoard(d.day), d.day, d.scenario, JSON.stringify(setup), versionsOf(d.scenario), t)
      .run();
    const row = await DB.prepare("SELECT id, setup FROM game_runs WHERE user_id = ? AND mode = 'daily' AND day = ?").bind(user.id, d.day).first<{ id: string; setup: string }>();
    return json({ runId: row!.id, setup: JSON.parse(row!.setup) as RunSetup }, 200, NO_STORE);
  }

  if (body.mode !== undefined && body.mode !== 'normal') throw new HttpError(400, "mode is 'normal' or 'daily'");
  const scenario = typeof body.scenario === 'string' ? scenarioOf(body.scenario) : undefined;
  if (!scenario) throw new HttpError(400, 'Unknown scenario');
  const open = scenarioOpen(scenario, meta);
  if (!open.open) throw new HttpError(403, open.reason);
  const ascension = body.ascension ?? 0;
  if (typeof ascension !== 'number' || !Number.isInteger(ascension) || ascension < 0 || ascension > MAX_ASCENSION) throw new HttpError(400, `ascension is 0 to ${MAX_ASCENSION}`);
  if (ascension > maxAscension(meta, scenario.id)) throw new HttpError(403, `Clear ascension ${ascension - 1} of ${scenario.title} first`);
  const setup: RunSetup = { scenario: scenario.id, seed: randomSeed(), ascension, mode: 'normal', loadout: loadoutFor(meta, ascension) };
  await DB.prepare("INSERT INTO game_runs (id, user_id, mode, board, scenario, ascension, setup, versions, started_at) VALUES (?, ?, 'normal', ?, ?, ?, ?, ?, ?)")
    .bind(id, user.id, scenarioBoard(scenario.id, ascension), scenario.id, ascension, JSON.stringify(setup), versionsOf(scenario.id), t)
    .run();
  return json({ runId: id, setup }, 200, NO_STORE);
}

/** The actions of a request body, checked for shape (the replay checks the rest). */
function readActions(raw: unknown): Action[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'actions must be a non-empty list');
  if (raw.length > MAX_ACTIONS) throw new HttpError(413, `At most ${MAX_ACTIONS} actions`);
  for (const a of raw) if (!a || typeof a !== 'object' || typeof (a as { t?: unknown }).t !== 'string') throw new HttpError(400, 'Every action is an object with "t"');
  return raw as Action[];
}

/** Replays a finished run; 400 with the engine's message for an illegal action, or a run that is not over. */
function replay(setup: RunSetup, actions: Action[]): Game {
  let game: Game;
  try {
    game = Game.replay(gameContent(), setup, actions);
  } catch (e) {
    if (e instanceof GameError) throw new HttpError(400, `The run does not replay: ${e.message}`);
    throw e;
  }
  if (game.state.phase !== 'over') throw new HttpError(400, 'The run is not over: finish it (or retire) before submitting');
  return game;
}

/** Banks a replayed run in `meta`. */
function bank(meta: Meta, setup: RunSetup, game: Game): { meta: Meta; blueprints: number } {
  const blueprints = game.blueprints(firstClear(meta, setup.scenario));
  const survived = game.state.history.filter((h) => h.survived).length;
  return {
    blueprints,
    meta: recordRun(meta, { scenario: setup.scenario, ascension: setup.ascension, reached: survived, cleared: game.state.cleared, blueprints, seen: game.seen() }),
  };
}

/**
 * POST /api/game/runs/<id>/submit {actions}: replays the run from its stored
 * setup and keeps the result once. Answers `{score, outcome, waves,
 * blueprints, meta, rank, players}`. 409 for a run already submitted or one
 * started before the game, the scenario or the simulation changed.
 */
export async function postGameSubmit(request: Request, ctx: Ctx, runId: string): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  const body = await readJson(request, MAX_BODY);
  await rateLimit(ctx.env.GAME_LIMITER, user.id, 'Too many game requests; wait a minute');
  const row = await DB.prepare('SELECT * FROM game_runs WHERE id = ? AND user_id = ?').bind(runId, user.id).first<RunRow>();
  if (!row || row.mode === 'import') throw new HttpError(404, 'No such run');
  if (row.submitted_at !== null) throw new HttpError(409, 'This run was submitted already');
  if (row.versions !== versionsOf(row.scenario)) throw new HttpError(409, 'The game was updated since this run started, so it cannot be replayed; start a new one');
  const t = now();
  if (row.mode === 'daily') {
    const day = challengeDay(new Date(t * 1000));
    const late = row.day === addDays(day, -1) && t - Date.parse(`${day}T00:00:00Z`) / 1000 <= GRACE_SECONDS;
    if (row.day !== day && !late) throw new HttpError(409, 'That daily run is over');
  }
  const setup = JSON.parse(row.setup) as RunSetup;
  const actions = readActions(body.actions);
  const game = replay(setup, actions);
  const s = game.state;
  if (t - row.started_at < s.history.length * MIN_SECONDS_PER_WAVE) throw new HttpError(400, 'That was faster than anyone can play');

  const banked = bank(await loadMeta(DB, user.id), setup, game);
  const [updated] = await DB.batch([
    DB.prepare(
      'UPDATE game_runs SET submitted_at = ?, score = ?, waves = ?, outcome = ?, cleared = ?, blueprints = ?, actions = ? WHERE id = ? AND submitted_at IS NULL',
    ).bind(t, s.score, s.history.length, s.outcome ?? 'over', s.cleared ? 1 : 0, banked.blueprints, JSON.stringify(actions), runId),
    saveMeta(DB, user.id, banked.meta),
  ]);
  if (!updated.meta.changes) throw new HttpError(409, 'This run was submitted already');
  const rank = await rankOf(DB, row.board!, user.id);
  return json({ score: s.score, outcome: s.outcome, waves: s.history.length, cleared: s.cleared, blueprints: banked.blueprints, meta: banked.meta, ...rank }, 200, NO_STORE);
}

/** A player's rank on a board: by best score (a daily board has one run each), ties sharing a rank. */
async function rankOf(DB: D1Database, board: string, userId: string): Promise<{ rank: number | null; players: number }> {
  const row = await DB.prepare(
    `WITH best AS (SELECT user_id, MAX(score) AS score FROM game_runs WHERE board = ?1 AND submitted_at IS NOT NULL GROUP BY user_id)
     SELECT (SELECT COUNT(*) FROM best) AS players,
            (SELECT COUNT(*) + 1 FROM best o WHERE o.score > (SELECT score FROM best WHERE user_id = ?2)) AS rank,
            (SELECT score FROM best WHERE user_id = ?2) AS mine`,
  )
    .bind(board, userId)
    .first<{ players: number; rank: number; mine: number | null }>();
  return { rank: row?.mine == null ? null : row.rank, players: row?.players ?? 0 };
}

/** POST /api/game/buy {id}: spends Blueprints on an unlock or a perk level; answers `{meta}`. */
export async function postGameBuy(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  const body = await readJson(request, 1024);
  await rateLimit(ctx.env.GAME_LIMITER, user.id, 'Too many game requests; wait a minute');
  if (typeof body.id !== 'string') throw new HttpError(400, 'id is required');
  let meta: Meta;
  try {
    meta = buy(gameContent(), await loadMeta(DB, user.id), body.id);
  } catch (e) {
    if (e instanceof MetaError) throw new HttpError(400, e.message);
    throw e;
  }
  await saveMeta(DB, user.id, meta).run();
  return json({ meta }, 200, NO_STORE);
}

/** POST /api/game/equip {perks}: the perks to take into runs; answers `{meta}`. */
export async function postGameEquip(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  const body = await readJson(request, 1024);
  await rateLimit(ctx.env.GAME_LIMITER, user.id, 'Too many game requests; wait a minute');
  if (!Array.isArray(body.perks) || body.perks.some((p) => typeof p !== 'string')) throw new HttpError(400, 'perks is a list of perk ids');
  let meta: Meta;
  try {
    meta = equip(gameContent(), await loadMeta(DB, user.id), body.perks as string[]);
  } catch (e) {
    if (e instanceof MetaError) throw new HttpError(400, e.message);
    throw e;
  }
  await saveMeta(DB, user.id, meta).run();
  return json({ meta }, 200, NO_STORE);
}

type SyncEvent = { t: 'run'; setup: RunSetup; actions: Action[] } | { t: 'buy'; id: string } | { t: 'equip'; perks: string[] };

/**
 * POST /api/game/sync {events}: what a player did signed out, in order, so
 * their progress follows them: finished runs (`{t: 'run', setup, actions}`),
 * purchases (`{t: 'buy', id}`) and perks equipped (`{t: 'equip', perks}`).
 * Each run is replayed, must have been allowed by the progress at that point
 * (its loadout, scenario and ascension) and counts once; imported runs earn
 * progress but never appear on a leaderboard (their seed was the player's).
 * At most MAX_SYNC_RUNS runs a request: the answer `{meta, applied}` says how
 * many events were taken, and `error` why the next one was not.
 */
export async function postGameSync(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  const body = await readJson(request, MAX_BODY);
  await rateLimit(ctx.env.GAME_LIMITER, user.id, 'Too many game requests; wait a minute');
  if (!Array.isArray(body.events) || body.events.length > 50) throw new HttpError(400, 'events is a list of at most 50');
  const events = body.events as SyncEvent[];
  let meta = await loadMeta(DB, user.id);
  const statements: D1PreparedStatement[] = [];
  let applied = 0;
  let runs = 0;
  let error: string | undefined;
  const t = now();
  for (const event of events) {
    try {
      if (event?.t === 'buy' && typeof event.id === 'string') meta = buy(gameContent(), meta, event.id);
      else if (event?.t === 'equip' && Array.isArray(event.perks)) meta = equip(gameContent(), meta, event.perks);
      else if (event?.t === 'run' && event.setup && typeof event.setup === 'object') {
        if (runs >= MAX_SYNC_RUNS) break;
        runs++;
        const setup = event.setup;
        const scenario = scenarioOf(setup.scenario);
        if (!scenario) throw new MetaError('Unknown scenario');
        if (setup.mode !== 'daily') {
          const open = scenarioOpen(scenario, meta);
          if (!open.open) throw new MetaError(open.reason);
          if (setup.ascension > maxAscension(meta, scenario.id)) throw new MetaError('That ascension was not open yet');
        }
        const refused = setup.loadout && typeof setup.loadout === 'object' ? loadoutAllowed(meta, setup.loadout, setup.ascension) : 'A run needs its loadout';
        if (refused) throw new MetaError(refused);
        const actions = readActions(event.actions);
        const digest = await sha256(JSON.stringify([setup, actions]));
        const seen = await DB.prepare('SELECT 1 FROM game_runs WHERE user_id = ? AND digest = ?').bind(user.id, digest).first();
        if (!seen) {
          const game = replay(setup, actions);
          const banked = bank(meta, setup, game);
          meta = banked.meta;
          const s = game.state;
          statements.push(
            DB.prepare(
              `INSERT OR IGNORE INTO game_runs (id, user_id, mode, scenario, ascension, setup, versions, started_at, submitted_at, score, waves, outcome, cleared, blueprints, actions, digest)
               VALUES (?, ?, 'import', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(crypto.randomUUID(), user.id, setup.scenario, setup.ascension, JSON.stringify(setup), versionsOf(setup.scenario), t, t, s.score, s.history.length, s.outcome ?? 'over', s.cleared ? 1 : 0, banked.blueprints, JSON.stringify(actions), digest),
          );
        }
      } else throw new MetaError('Unknown event');
      applied++;
    } catch (e) {
      if (e instanceof MetaError || e instanceof HttpError) {
        error = e.message;
        break;
      }
      throw e;
    }
  }
  await DB.batch([...statements, saveMeta(DB, user.id, meta)]);
  return json({ meta, applied, ...(error ? { error } : {}) }, 200, NO_STORE);
}

interface BoardRow {
  id: string;
  name: string;
  score: number;
  waves: number;
  rank: number;
}

/**
 * GET /api/game/leaderboard?scenario=<id>&ascension=<n> or ?day=YYYY-MM-DD:
 * `{board, title, players, entries: [{rank, id, displayName, score, waves}]}`,
 * each player's best run, the top LEADERBOARD_SIZE of those who chose to
 * appear on leaderboards, ranked among everyone. Signed in, also `you`.
 */
export async function getGameLeaderboard(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const params = new URL(request.url).searchParams;
  let board: string;
  let title: string;
  if (params.has('day')) {
    const day = params.get('day')!;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new HttpError(400, 'day must be a date written YYYY-MM-DD');
    board = dailyBoard(day);
    title = `Daily run, ${day}: ${dailyScenario(gameContent(), day).title}`;
  } else {
    const scenario = scenarioOf(params.get('scenario') ?? '');
    if (!scenario) throw new HttpError(400, 'Unknown scenario');
    const ascension = Number(params.get('ascension') ?? 0);
    if (!Number.isInteger(ascension) || ascension < 0 || ascension > MAX_ASCENSION) throw new HttpError(400, `ascension is 0 to ${MAX_ASCENSION}`);
    board = scenarioBoard(scenario.id, ascension);
    title = `${scenario.title}${ascension ? `, ascension ${ascension}` : ''}`;
  }
  const user: User | undefined = await authenticate(request, ctx);
  const result = await cached(ctx, `game/${board}`, async () => {
    const [entries, players] = await DB.batch([
      DB.prepare(
        `WITH best AS (
           SELECT user_id, score, waves, submitted_at FROM (
             SELECT user_id, score, waves, submitted_at, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC, submitted_at) AS n
             FROM game_runs WHERE board = ?1 AND submitted_at IS NOT NULL
           ) WHERE n = 1
         )
         SELECT id, name, score, waves, rank FROM (
           SELECT u.id AS id, u.display_name AS name, u.public_profile AS public, b.score, b.waves, b.submitted_at,
             RANK() OVER (ORDER BY b.score DESC) AS rank
           FROM best b JOIN users u ON u.id = b.user_id
         ) WHERE public = 1 ORDER BY rank, submitted_at LIMIT ?2`,
      ).bind(board, LEADERBOARD_SIZE),
      DB.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM game_runs WHERE board = ? AND submitted_at IS NOT NULL').bind(board),
    ]);
    return {
      board,
      title,
      players: (players.results[0] as { n: number }).n,
      entries: (entries.results as unknown as BoardRow[]).map((r) => ({ rank: r.rank, id: r.id, displayName: r.name, score: r.score, waves: r.waves })),
    };
  });
  if (!user) return json(result, 200, NO_STORE);
  const mine = await DB.prepare('SELECT MAX(score) AS score FROM game_runs WHERE board = ? AND user_id = ? AND submitted_at IS NOT NULL').bind(board, user.id).first<{ score: number | null }>();
  const you = mine?.score == null ? null : { score: mine.score, ...(await rankOf(DB, board, user.id)) };
  return json({ ...result, you }, 200, NO_STORE);
}

/** What the export (GET /api/me/export) includes of the game. */
export async function exportGame(DB: D1Database, userId: string): Promise<{ meta: Meta | null; runs: unknown[] }> {
  const [meta, runs] = await Promise.all([
    DB.prepare('SELECT meta FROM game_meta WHERE user_id = ?').bind(userId).first<{ meta: string }>(),
    DB.prepare('SELECT id, mode, board, day, scenario, ascension, started_at, submitted_at, score, waves, outcome, cleared, blueprints FROM game_runs WHERE user_id = ? ORDER BY started_at')
      .bind(userId)
      .all(),
  ]);
  return { meta: meta ? readMeta(JSON.parse(meta.meta)) : null, runs: runs.results };
}

/** Cache keys of the leaderboards around today, for the tests to clear. */
export function gameCacheKeys(): string[] {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  return [
    ...[-1, 0, 1].map((n) => `game/${dailyBoard(day(n))}`),
    ...gameContent().scenarios.flatMap((s) => Array.from({ length: MAX_ASCENSION + 1 }, (_, a) => `game/${scenarioBoard(s.id, a)}`)),
  ];
}

/** The game badges' and the skill map's view of a player's progress (GET /api/me/achievements). */
export async function loadGameStats(DB: D1Database, userId: string): Promise<GameStats> {
  return gameStats(await loadMeta(DB, userId), gameContent());
}
