import { describe, expect, it } from 'vitest';
import { FOCUS_PALETTE, focusDark, focusLight, focusThemeFor } from './editorThemes';
import { editorThemeFor } from './useEditorTheme';
import { isZenShortcut } from './useZenMode';

describe('focus themes', () => {
  it('use the design plan’s editor palette', () => {
    expect(FOCUS_PALETTE.dark).toMatchObject({
      background: '#16171B',
      text: '#C9CCD3',
      comment: '#5F6470',
      keyword: '#9AA7C7',
      string: '#A8BFA0',
      number: '#C7B08A',
      selection: '#2A2E38',
      cursor: '#FFD23F',
    });
    expect(FOCUS_PALETTE.light).toMatchObject({
      background: '#FFFDF6',
      text: '#2A2A2A',
      keyword: '#3D4FB8',
      string: '#2F7A55',
      number: '#9A5B00',
      comment: '#8A8577',
    });
  });

  it('keep the yellow cursor as the dark theme’s only accent', () => {
    const accents = Object.entries(FOCUS_PALETTE.dark).filter(([, hex]) => hex === '#FFD23F');
    expect(accents.map(([key]) => key)).toEqual(['cursor']);
  });

  it('are picked by mode', () => {
    expect(focusThemeFor('dark')).toBe(focusDark);
    expect(focusThemeFor('light')).toBe(focusLight);
  });
});

describe('editorThemeFor', () => {
  it('is dark unless light was chosen explicitly', () => {
    expect(editorThemeFor('system')).toBe('dark');
    expect(editorThemeFor('dark')).toBe('dark');
    expect(editorThemeFor('light')).toBe('light');
  });
});

describe('isZenShortcut', () => {
  const key = (init: Partial<KeyboardEvent>) => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });

  it('is Ctrl+. or Cmd+.', () => {
    expect(isZenShortcut(key({ key: '.', ctrlKey: true }))).toBe(true);
    expect(isZenShortcut(key({ key: '.', metaKey: true }))).toBe(true);
    // Layouts where the key prints something else still have the Period key.
    expect(isZenShortcut(key({ key: ':', code: 'Period', ctrlKey: true }))).toBe(true);
  });

  it('ignores a plain dot and other modifiers', () => {
    expect(isZenShortcut(key({ key: '.' }))).toBe(false);
    expect(isZenShortcut(key({ key: '.', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isZenShortcut(key({ key: '.', ctrlKey: true, altKey: true }))).toBe(false);
    expect(isZenShortcut(key({ key: ',', ctrlKey: true }))).toBe(false);
  });
});
