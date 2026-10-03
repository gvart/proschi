/**
 * Hex values of the Tailwind classes the canvas draws with, for code that
 * draws without Tailwind (the SVG renderer behind `proschi render` and the
 * VS Code preview). canvasColors.test.ts checks them against Tailwind's own
 * palette and against every class `getComponentTypeColor()` returns.
 */
export const TAILWIND_HEX: Record<string, string> = {
  'bg-gray-500': '#6b7280',
  'bg-blue-400': '#60a5fa',
  'bg-blue-500': '#3b82f6',
  'bg-green-500': '#22c55e',
  'bg-purple-500': '#a855f7',
  'bg-orange-500': '#f97316',
  'bg-yellow-400': '#facc15',
  'bg-yellow-500': '#eab308',
  'bg-indigo-500': '#6366f1',
  'bg-cyan-500': '#06b6d4',
  'bg-pink-500': '#ec4899',
  'bg-teal-500': '#14b8a6',
  'bg-red-500': '#ef4444',
  // Card, text and note colours used by ComponentNode and TextNode.
  'border-gray-300': '#d1d5db',
  'text-gray-800': '#1f2937',
  'text-gray-700': '#374151',
  'text-gray-600': '#4b5563',
  'text-gray-500': '#6b7280',
  'bg-yellow-100': '#fef9c3',
  'border-yellow-300': '#fde047',
  'text-yellow-600': '#ca8a04',
  'text-yellow-800': '#854d0e',
};

/** Tailwind's default `font-sans` stack, which the editor uses. */
export const CANVAS_FONT =
  "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'";
