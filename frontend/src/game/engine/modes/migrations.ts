import { BACKFILL_PREFIX } from '../compile';
import type { Game } from '../run';
import { BREACH_LEARN, GameError, type MigrationState } from '../state';
import { TRUST_PENALTY } from '../rules';
import { MIGRATION_PHASES, type MigrationDef, type MigrationPhase } from '../types';
import type { Mechanic } from './mode';

/**
 * Migrations (the startup and legacy modes): a schema change is one step a
 * wave (docs/GAME.md, "Migrations"): expand, dual-write, backfill, cut over,
 * contract; or all at once (a big bang), which locks the store's writes.
 */

const phaseIndex = (p: MigrationPhase) => MIGRATION_PHASES.indexOf(p);

/** The background job's use case key while a migration backfills. */
export const backfillKey = (id: string) => `${BACKFILL_PREFIX}${id}`;

/** A migration's state; one not started is at `none`. */
export function migrationOf(game: Game, id: string): MigrationState {
  return game.state.migrations[id] ?? { phase: 'none', wave: -1 };
}

/** The migration a use case waits for: it needs the new shape, and the cutover has not happened. */
export function blockedBy(game: Game, key: string): MigrationDef | undefined {
  return game.scenario.migrations.find((m) => m.needs.includes(key) && phaseIndex(migrationOf(game, m.id).phase) < phaseIndex('cutover'));
}

/** A use case still served that reads the old shape of a migration that dropped it. */
function readsDroppedShape(game: Game, key: string): boolean {
  return !game.state.sunset.includes(key) && game.scenario.migrations.some((m) => m.oldReaders.includes(key) && migrationOf(game, m.id).phase === 'contract');
}

/** Migrations done in one go this wave. */
const bigBangs = (game: Game) => game.state.bigBang.map((id) => game.scenario.migrations.find((m) => m.id === id)!).filter(Boolean);

export const migrations: Mechanic = {
  id: 'migrations',
  actions: {
    migrate(game, action) {
      const s = game.state;
      game.expect('plan');
      const def = game.scenario.migrations.find((m) => m.id === action.id);
      if (!def) throw new GameError(`No migration '${action.id}'`);
      const st = migrationOf(game, def.id);
      if (st.wave === s.wave) throw new GameError(`${def.name}: one step a wave; each step is its own deploy`);
      const at = phaseIndex(st.phase);
      const done = phaseIndex('contract');
      if (action.to === 'next') {
        if (at >= done) throw new GameError(`${def.name} is done`);
        s.migrations[def.id] = { phase: MIGRATION_PHASES[at + 1], wave: s.wave };
      } else if (action.to === 'rollback') {
        if (at <= 0) throw new GameError(`${def.name} has not started`);
        if (at >= done) throw new GameError(`${def.name} dropped the old shape; there is nothing to roll back to`);
        s.migrations[def.id] = { phase: MIGRATION_PHASES[at - 1], wave: s.wave };
      } else if (action.to === 'big-bang') {
        if (at >= phaseIndex('cutover')) throw new GameError(`${def.name} is already cut over`);
        s.migrations[def.id] = { phase: 'contract', wave: s.wave };
        s.bigBang.push(def.id);
      } else throw new GameError('A migration moves next, rolls back, or goes all at once');
    },
  },
  onWaveStart(game) {
    game.state.bigBang = [];
  },
  // Writers write both shapes from the dual-write to the contract, and a backfill adds its background job.
  shapeUseCases(game, useCases, jobs) {
    for (const m of game.scenario.migrations) {
      const at = phaseIndex(migrationOf(game, m.id).phase);
      if (at >= phaseIndex('dual-write') && at < phaseIndex('contract')) {
        for (const w of m.writers) {
          const uc = useCases[w];
          if (uc) useCases[w] = { ...uc, steps: uc.steps.map((st) => (st.op === 'write' && st.to === m.store ? { ...st, x: (st.x ?? 1) * 2 } : st)) };
        }
      }
      if (at === phaseIndex('backfill')) {
        const job = backfillKey(m.id);
        useCases[job] = {
          name: `Backfill ${m.entity}`,
          method: 'POST',
          path: `/jobs/backfill-${m.id}`,
          status: 200,
          value: 0,
          steps: [
            { op: 'read', to: m.store, entity: m.entity },
            { op: 'write', to: m.store, entity: m.entity },
          ],
          optional: true,
        };
        jobs.push({ key: job, rps: m.backfillRps });
      }
    }
  },
  serves: (game, key) => !blockedBy(game, key),
  // A migration done in one go: the ALTER holds the table's write lock for the first two ticks.
  writesDown(game, board, tick, comp) {
    const out: string[] = [];
    if (tick < 2) for (const m of bigBangs(game)) for (const n of board.nodes) if (comp(n.id)?.role === m.store) out.push(n.id);
    return out;
  },
  blocks(game, { key, useCase: uc, rps: r, breaches }) {
    // Its requests error out; the compat breach of afterServe says why.
    if (readsDroppedShape(game, key)) return true;
    const waiting = blockedBy(game, key);
    if (!waiting) return false;
    if (r > 0) {
      breaches.push({
        kind: 'unroutable',
        message: `"${uc.name}" needs the new ${waiting.entity} shape: take ${waiting.name} to its cutover first.`,
        hint: 'Expand, dual-write, backfill, then cut over: one step a wave.',
        useCase: key,
        trust: uc.optional ? TRUST_PENALTY.unroutableOptional : TRUST_PENALTY.unroutable,
        learn: BREACH_LEARN.migration,
      });
    }
    return true;
  },
  afterServe(game, { tick, rps, useCases, breaches }) {
    const s = game.state;
    if (tick === 0) {
      for (const m of bigBangs(game)) {
        breaches.push({
          kind: 'migration',
          message: `${m.name} ran as one big change: ${m.entity} writes were locked for two ticks while it rewrote every row.`,
          hint: 'Expand and contract: add the new shape, write both, backfill in batches, cut over, and only then drop the old one.',
          trust: TRUST_PENALTY.migration,
          learn: BREACH_LEARN.migration,
        });
      }
    }
    for (const m of game.scenario.migrations) {
      if (migrationOf(game, m.id).phase !== 'contract') continue;
      for (const key of m.oldReaders) {
        const r = rps.get(key) ?? 0;
        if (!s.useCases.includes(key) || s.sunset.includes(key) || r <= 0) continue;
        breaches.push({
          kind: 'compat',
          message: `"${useCases[key].name}" still reads the old ${m.entity} shape, which ${m.name} dropped: ${Math.round(r)} rps of errors.`,
          hint: 'Contract only once nothing reads the old shape: move or sunset its last readers first.',
          useCase: key,
          trust: TRUST_PENALTY.compat,
          learn: BREACH_LEARN.compat,
        });
      }
    }
  },
};
