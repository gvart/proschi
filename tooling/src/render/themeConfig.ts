import { dirname, resolve } from 'node:path';
import { findConfigFile, readConfig } from '../openapi/config';
import { THEME_CHOICES, getTheme, isThemeName, type RenderTheme } from './theme';

/**
 * The flag wins; else the `"theme"` of the proschi.json nearest `file`; else
 * `fallback` (an editor setting, which proschi.json overrides); else
 * sketch-light. Throws on an unknown name in proschi.json or `fallback`.
 */
export function themeFor(file: string, flag?: string, fallback?: string): RenderTheme {
  if (flag) return getTheme(flag);
  const configFile = findConfigFile(dirname(resolve(file)));
  const name = configFile ? readConfig(configFile).theme : undefined;
  if (name !== undefined && !isThemeName(name)) throw new Error(`Unknown theme '${name}' in ${configFile}; use ${THEME_CHOICES.join(', ')}`);
  return getTheme(name ?? (fallback || undefined));
}

/** `--theme <name>` or `--theme=<name>` at `args[i]`: the name and the index of its last argument, or an error. */
export function themeFlagAt(args: string[], i: number): { value: string; next: number } | { error: string } {
  const arg = args[i];
  const next = arg === '--theme' ? i + 1 : i;
  const value = arg === '--theme' ? args[next] : arg.slice('--theme='.length);
  if (!value || value.startsWith('-')) return { error: `Missing theme after --theme; use ${THEME_CHOICES.join(', ')}` };
  if (!isThemeName(value)) return { error: `Unknown theme '${value}'; use ${THEME_CHOICES.join(', ')}` };
  return { value, next };
}
