/** The modifier key's name in shortcut hints: ⌘ on Apple devices, Ctrl elsewhere. */
export const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
