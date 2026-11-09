import { Flag, Lightbulb, Target } from 'lucide-react';
import type { HintKind } from './api';

/** How a coaching hint shows: its label, tint and icon (the chat's markers, the toasts, the verdict's coaching). */
export const HINT_LABEL: Record<HintKind, string> = { focus: 'Focus now', improve: 'Can improve', wrapup: 'Wrap up' };
export const HINT_STYLE: Record<HintKind, string> = { focus: 'bg-pop-yellow/30', improve: 'bg-pop-blue/25', wrapup: 'bg-pop-pink/25' };
export const HINT_ICON: Record<HintKind, typeof Target> = { focus: Target, improve: Lightbulb, wrapup: Flag };
