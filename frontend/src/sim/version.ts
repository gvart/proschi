/**
 * The simulation's version. Bump it when a change to the simulation or the
 * test runner can change whether a design passes, or its cost or p99: the
 * server (backend/) then leaves solves recorded under the old version out of
 * the global stats, and a user's next run of a problem starts its stats over.
 */
export const SIM_VERSION = 1;
