import type { ReactNode } from 'react';
import type { FeatureId } from '../services/featureContract';
import { showsUpgrade, useFeature } from './featureState';
import UpgradeHint from './UpgradeHint';

interface FeatureProps {
  name: FeatureId;
  /** Shown when the feature is on. */
  pro?: ReactNode;
  /**
   * Shown when it is off, followed by the upgrade hint where showsUpgrade.
   * A function places the hint itself: it gets the hint, or null without one.
   */
  free?: ReactNode | ((hint: ReactNode) => ReactNode);
  /** Shown either way, also while loading. */
  both?: ReactNode;
  /** The hint in `free`: the standard <UpgradeHint /> by default, another node, or false for none. */
  hint?: ReactNode;
}

/** `pro` or `free` by the feature's answer; nothing of either while it loads. */
export function Feature({ name, pro, free, both, hint }: FeatureProps) {
  const state = useFeature(name);
  const upgrade = hint !== false && showsUpgrade(state) ? (hint === undefined || hint === null || hint === true ? <UpgradeHint /> : hint) : null;
  return (
    <>
      {both}
      {state.loading ? null : state.ok ? pro : typeof free === 'function' ? free(upgrade) : (
        <>
          {free}
          {upgrade}
        </>
      )}
    </>
  );
}
