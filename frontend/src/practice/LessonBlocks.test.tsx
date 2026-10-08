// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../learn/cards';
import LessonQuiz from './LessonQuiz';
import LessonView from './LessonView';
import Markdown from './Markdown';
import Roadmap from './RoadmapView';

const { cards } = vi.hoisted(() => {
  const base = {
    topic: 'caching',
    tags: ['caching'],
    difficulty: 'easy',
    related: [],
    decks: [],
    version: 1,
    retired: false,
    distinctFrom: [],
  } as const;
  const cards: Card[] = [
    {
      ...base,
      id: 'pick',
      type: 'choice',
      question: 'Who fills the cache?',
      options: [
        { text: 'The database', correct: false },
        { text: 'The app', correct: true },
      ],
      why: 'The app owns cache-aside.',
    },
    {
      ...base,
      id: 'guess',
      type: 'estimate',
      question: 'Reads reaching the DB?',
      answer: 500,
      unit: 'rps',
      tolerance: 2,
      solution: '10,000 × 5%.',
    },
    {
      ...base,
      id: 'gap',
      type: 'cloze',
      text: 'Misses {{0}} the cache.',
      blanks: [['fill', 'populate']],
    },
    {
      ...base,
      id: 'turn',
      type: 'flip',
      front: 'What is a TTL?',
      back: 'A time to live.',
    },
    {
      ...base,
      id: 'old',
      type: 'flip',
      front: 'Retired',
      back: 'x',
      retired: true,
    },
  ];
  return { cards };
});
vi.mock('virtual:practice-cards', () => ({ default: { cards, topics: [] } }));

afterEach(cleanup);

describe('lesson blocks in the app', () => {
  it('draws the TL;DR, callouts, key numbers and a closed deep dive', () => {
    render(
      <Markdown
        source={[
          '```tldr',
          'Cache **reads**.',
          '```',
          '```callout pitfall Watch p99',
          'Misses decide it.',
          '```',
          '```callout takeaway',
          'Remember this.',
          '```',
          '```numbers',
          '100:1 | reads per write',
          '```',
          '```deepdive Counter blocks',
          'Hidden detail.',
          '```',
        ].join('\n')}
      />,
    );
    expect(screen.getByRole('complementary', { name: 'In 30 seconds' }).textContent).toContain('Cache reads.');
    expect(screen.getByText('Watch p99').closest('[data-tone]')?.getAttribute('data-tone')).toBe('pitfall');
    expect(screen.getByRole('complementary', { name: 'Key takeaway' }).textContent).toContain('Remember this.');
    const numbers = document.querySelector('[data-block="numbers"]')!;
    expect(within(numbers as HTMLElement).getByRole('definition').textContent).toContain('100:1');
    const details = document.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toContain('Deep diveCounter blocks');
  });

  it('grades a choice and shows why, once', () => {
    render(<LessonQuiz ids={['pick']} />);
    const quiz = screen.getByRole('region', { name: 'Quick check' });
    fireEvent.click(within(quiz).getByRole('button', { name: 'The database' }));
    expect(within(quiz).getByRole('status').textContent).toContain('Not quite');
    expect(within(quiz).getByRole('status').textContent).toContain('The app owns cache-aside.');
    expect(
      (
        within(quiz).getByRole('button', {
          name: 'The app',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('grades an estimate within its tolerance and shows the working', () => {
    render(<LessonQuiz ids={['guess']} />);
    fireEvent.change(screen.getByLabelText('Your estimate in rps'), {
      target: { value: '400' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByRole('status').textContent).toContain('Close enough: the answer is about 500 rps.');
    expect(screen.getByRole('status').textContent).toContain('10,000 × 5%.');
  });

  it('grades a cloze, and a flip card shows its answer', () => {
    render(<LessonQuiz ids={['gap', 'turn']} />);
    expect(screen.getByRole('region', { name: 'Quick check' }).textContent).toContain('2 questions');
    fireEvent.change(screen.getByLabelText('1'), {
      target: { value: 'Populate' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getAllByRole('status')[0].textContent).toContain('Right.');
    fireEvent.click(screen.getByRole('button', { name: /show the answer/ }));
    expect(screen.getAllByRole('status')[1].textContent).toContain('A time to live.');
  });

  it('leaves out retired and unknown cards, and shows nothing without any', () => {
    const { container } = render(<LessonQuiz ids={['old', 'nope']} />);
    expect(container.innerHTML).toBe('');
  });

  it('calls onRead once the end of the lesson comes into view', () => {
    let notify: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const onRead = vi.fn();
    render(<LessonView source={'## One\n\nText.\n\n## Two\n\nMore.'} onRead={onRead} />);
    notify!([{ isIntersecting: false }]);
    expect(onRead).not.toHaveBeenCalled();
    notify!([{ isIntersecting: true }]);
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('the roadmap', () => {
  const stages = [
    { id: 'one', title: 'One', why: 'First.', problems: ['a', 'b'] },
    { id: 'two', title: 'Two', why: 'Next.', problems: ['c'] },
  ];
  const problems = ['a', 'b', 'c'].map((id) => ({ id, title: `Problem ${id}`, summary: '', difficulty: 'easy' as const, tags: [] }));
  const guide = { id: 'approach', title: 'How to approach it', summary: 'Read me.', minutes: 9 };

  it('marks lessons and the guide read, and counts them per stage and in all', () => {
    render(
      <Roadmap
        stages={stages}
        problems={problems}
        progress={{ a: { status: 'solved' } }}
        access="open"
        providers={[]}
        onSignIn={() => {}}
        lessons={{ a: 5, b: 6, c: 7 }}
        guide={guide}
        read={['a', 'approach', 'elsewhere']}
      />,
    );
    expect(screen.getByRole('region', { name: 'Your progress' }).textContent).toContain('1 of 3 lessons read');
    const stage = screen.getByRole('listitem', { name: 'Stage 1: One' });
    expect(stage.textContent).toContain('1 / 2 lessons read');
    expect(within(stage).getByRole('link', { name: /Problem a/ }).textContent).toContain('min readRead');
    expect(within(stage).getByRole('link', { name: /Problem b/ }).textContent).not.toContain('Read');
    expect(screen.getByRole('link', { name: /How to approach it/ }).textContent).toContain('Read');
  });
});
