import { useEffect, useMemo, useState } from 'react';
import Tour, { type TourStep } from './Tour';
import { useIsPhone } from './layout';
import { MODEL_URL } from './links';
import { markSeen } from './seen';

type Pane = 'statement' | 'code' | 'diagram' | 'tests';

export interface PracticeTourProps {
  setPane: (pane: Pane) => void;
  /** Number of test runs so far on this page. */
  runs: number;
  runTests: () => void;
  onClose: () => void;
}

const q = (selector: string) => () => {
  for (const el of document.querySelectorAll(selector)) if (el.getClientRects().length > 0) return el;
  return null;
};

/** Three steps on the first problem: read it, run the tests on the starter, budgets. */
export default function PracticeTour({ setPane, runs, runTests, onClose }: PracticeTourProps) {
  const phone = useIsPhone();
  const [startRuns] = useState(runs);
  useEffect(() => markSeen('practice'), []);
  const ran = runs > startRuns;

  const steps = useMemo<TourStep[]>(
    () => [
      {
        id: 'read',
        title: 'Read the problem',
        target: q('[data-tour="statement"]'),
        sides: ['right'],
        dock: 'bottom',
        onEnter: () => setPane('statement'),
        body: (
          <p>
            <strong>Functional requirements</strong> name the use cases and scenarios to write. <strong>Scale</strong> and{' '}
            <strong>Constraints</strong> become the tests. The given <code className="font-mono text-[0.8125rem]">problem.proschi</code> is
            read-only.
          </p>
        ),
      },
      {
        id: 'run',
        title: 'Edit the starter, run the tests',
        target: phone ? q('[data-tour="tab-tests"]') : q('[data-tour="run"]'),
        sides: ['top', 'left'],
        dock: 'bottom',
        onEnter: () => setPane('code'),
        body: (
          <p>
            Your design goes in the editor; the starter already imports the problem. Add components, connections and use cases, then{' '}
            <strong>Run tests</strong>{phone ? ' in the Tests tab' : ''}. The starter fails on purpose.
          </p>
        ),
        task: 'Press Run tests.',
        done: ran,
        doneText: 'Each line is a requirement or test, with what was measured.',
        auto: true,
        settleMs: 600,
        action: ran ? undefined : { label: 'Run now', run: runTests },
      },
      {
        id: 'budgets',
        title: 'Budgets make brute force fail',
        target: q('[data-tour="tests"]'),
        sides: ['top', 'left'],
        dock: 'bottom',
        onEnter: () => setPane('tests'),
        body: (
          <>
            <p>
              Latency, availability and cost all have limits. One instance of everything fails availability; <code className="font-mono">x50</code>{' '}
              everywhere blows the cost budget. Size each part for its load, then run again.
            </p>
            <p>
              Stuck? Hints are under the problem.{' '}
              <a href={MODEL_URL} className="text-blue-700 underline-offset-2 hover:underline">
                How the simulation works
              </a>
            </p>
          </>
        ),
      },
    ],
    [phone, ran, setPane, runTests],
  );

  return <Tour label="Practice tour" steps={steps} phone={phone} onClose={onClose} />;
}
