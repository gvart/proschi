/** Where the numbers come from: the "How the simulation works" page, next to the editor and practice pages. */
export default function ModelLink({ className = '' }: { className?: string }) {
  return (
    <p className={`text-right text-xs ${className}`}>
      <a href="../model/" target="_blank" rel="noopener" className="text-blue-700 hover:underline">
        How is this calculated?
      </a>
    </p>
  );
}
