-- Scale or Fail, the system design game (docs/GAME.md). Progress between
-- runs and every run the server has replayed. Times are Unix seconds.

-- A player's progress (frontend/src/game/engine/meta.ts): Blueprints,
-- unlocks, perks, the furthest wave and highest ascension per scenario, the
-- codex. JSON, changed only by replayed runs and purchases.
CREATE TABLE game_meta (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  meta TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One row per run: written at the start (the server picks the seed and the
-- loadout), completed when the actions are submitted and replayed.
CREATE TABLE game_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- `normal`, `daily`, or `import` (a run played signed out, replayed when
  -- the player signs in; it counts for progress, never on a leaderboard).
  mode TEXT NOT NULL,
  -- The leaderboard: `<scenario>:a<ascension>:<versions>` or `daily:<day>`; NULL for imports.
  board TEXT,
  -- The UTC day of a daily run.
  day TEXT,
  scenario TEXT NOT NULL,
  ascension INTEGER NOT NULL,
  -- JSON: the RunSetup the run was started with (seed and loadout included).
  setup TEXT NOT NULL,
  -- GAME_VERSION, the scenario's version and SIM_VERSION at the start: a run
  -- is only replayed by the code it was played with.
  versions TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  -- The rest is NULL until the run is submitted.
  submitted_at INTEGER,
  score INTEGER,
  waves INTEGER,
  outcome TEXT,
  cleared INTEGER,
  blueprints INTEGER,
  -- JSON: the actions, kept for replays.
  actions TEXT,
  -- SHA-256 of an imported run's setup and actions, so it is counted once.
  digest TEXT
);

CREATE INDEX game_runs_user ON game_runs (user_id, started_at);
CREATE INDEX game_runs_board ON game_runs (board, score DESC) WHERE submitted_at IS NOT NULL;
CREATE UNIQUE INDEX game_runs_daily ON game_runs (user_id, day) WHERE mode = 'daily';
CREATE UNIQUE INDEX game_runs_digest ON game_runs (user_id, digest) WHERE digest IS NOT NULL;
