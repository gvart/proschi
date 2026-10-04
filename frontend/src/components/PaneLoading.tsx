/** Fills the space of a pane whose code is still loading (a lazy chunk), so nothing jumps when it arrives. */
export default function PaneLoading({ label = 'Loading…', overlay = false }: { label?: string; overlay?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`${overlay ? 'fixed inset-0 z-50 bg-black/20' : 'h-full w-full'} flex items-center justify-center gap-2 text-sm text-gray-500`}
    >
      <span className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}
