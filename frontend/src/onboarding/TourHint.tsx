import { Compass, X } from 'lucide-react';

interface TourHintProps {
  onStart: () => void;
  onDismiss: () => void;
}

/** Over a shared diagram the content comes first: a small corner pill offers the tour instead of starting it. */
export default function TourHint({ onStart, onDismiss }: TourHintProps) {
  return (
    <div
      role="complementary"
      aria-label="Tour"
      className="fixed z-30 bottom-3 right-3 md:bottom-11 md:right-4 flex items-center gap-1 rounded-full border border-gray-200 bg-white/95 py-1 pl-3 pr-1 text-sm text-gray-700 shadow-md"
    >
      <Compass size={15} className="text-blue-600" aria-hidden="true" />
      <span className="hidden sm:inline">New to Proschi?</span>
      <button type="button" onClick={onStart} className="rounded-full px-2 py-1 font-medium text-blue-700 hover:bg-blue-50">
        Take the 1-minute tour
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss tour hint" className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
        <X size={14} />
      </button>
    </div>
  );
}
