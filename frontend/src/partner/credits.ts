import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { parseEstimates, type Estimates } from './contract';

/**
 * Design partner's only contact with credits: the estimates shown before a
 * turn (GET /api/credits/estimates) and the balance a turn reports after
 * it. Kept in this one module so the shared credits client
 * (services/useCredits.ts: useEstimates, reportBalance) can replace it.
 */

let estimates: Promise<Estimates | undefined> | undefined;

/** GET /api/credits/estimates, asked once per page; undefined when it cannot be read. */
function getEstimates(): Promise<Estimates | undefined> {
  estimates ??= api<unknown>('/api/credits/estimates').then(parseEstimates, () => {
    estimates = undefined;
    return undefined;
  });
  return estimates;
}

export function useEstimates(): Estimates | undefined {
  const [value, setValue] = useState<Estimates>();
  useEffect(() => {
    let live = true;
    void getEstimates().then((e) => live && setValue(e));
    return () => {
      live = false;
    };
  }, []);
  return value;
}

/** A turn's answer says what is left; the shared client will spread it to the credits chip. */
export function reportBalance(balance: number): void {
  void balance;
}
