// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Select, { type SelectOption } from './Select';

afterEach(cleanup);

const OPTIONS: SelectOption[] = [
  { value: 'a', label: 'Apple', group: 'Fruit' },
  { value: 'b', label: 'Banana', group: 'Fruit', description: 'Yellow' },
  { value: 'c', label: 'Carrot', group: 'Veg' },
  { value: 'd', label: 'Daikon', group: 'Veg', disabled: true },
  { value: 'e', label: 'Eggplant', group: 'Veg' },
];

function Harness({ initial = 'a' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Select aria-label="Food" value={value} onChange={setValue} options={OPTIONS} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const box = () => screen.getByRole('combobox', { name: 'Food' });
const value = () => screen.getByTestId('value').textContent;

describe('Select', () => {
  it('shows the current label and opens a listbox with the selected option checked', () => {
    render(<Harness initial="b" />);
    expect(box().textContent).toContain('Banana');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(box());
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option')).toHaveLength(5);
    expect(screen.getByRole('option', { name: /Banana/ }).getAttribute('aria-selected')).toBe('true');
    expect(box().getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: /Banana/ }).id);
    expect(screen.getByRole('group', { name: 'Veg' })).toBeTruthy();
  });

  it('picks with a click and closes', () => {
    render(<Harness />);
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('option', { name: 'Carrot' }));
    expect(value()).toBe('c');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('moves with arrows past disabled options, Home and End, and picks with Enter', () => {
    render(<Harness initial="c" />);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(value()).toBe('e');
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'Home' });
    fireEvent.keyDown(box(), { key: ' ' });
    expect(value()).toBe('a');
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'End' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(value()).toBe('e');
  });

  it('jumps by typeahead and leaves the value alone on Escape', () => {
    render(<Harness />);
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'c' });
    expect(box().getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Carrot' }).id);
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(value()).toBe('a');
  });

  it('closes on a click outside', () => {
    render(<Harness />);
    fireEvent.click(box());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not open when disabled', () => {
    render(<Select aria-label="Food" value="a" onChange={() => {}} options={OPTIONS} disabled />);
    fireEvent.click(box());
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
