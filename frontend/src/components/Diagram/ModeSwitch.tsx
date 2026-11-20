import { useEffect } from 'react';
import { Code2, Shapes } from 'lucide-react';
import { MOD_KEY } from '../Playground/modKey';
import { isModeShortcut, useEditorMode, type EditorMode } from './editorMode';

const MODES: { id: EditorMode; label: string; title: string; Icon: typeof Code2 }[] = [
  { id: 'code', label: 'Code', title: 'Code: write Proschi, with the diagram beside it to look at', Icon: Code2 },
  { id: 'visual', label: 'Visual', title: 'Visual: build on the canvas; the code is there to look at', Icon: Shapes },
];

interface ModeSwitchProps {
  /** Icons only (phones, a crowded bar); the names stay for screen readers. */
  compact?: boolean;
  /** Problems in the code, counted on Code while Visual hides them. */
  problems?: number;
  className?: string;
}

/**
 * The Code | Visual switch (editorMode.ts). It also answers Ctrl/Cmd+\, so a
 * page shows one at a time.
 */
export default function ModeSwitch({ compact = false, problems = 0, className = '' }: ModeSwitchProps) {
  const [mode, setMode] = useEditorMode();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isModeShortcut(e)) return;
      e.preventDefault();
      setMode(mode === 'code' ? 'visual' : 'code');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, setMode]);

  return (
    <div role="radiogroup" aria-label="Editor mode" data-tour="mode" className={`inline-flex shrink-0 rounded-sm border-bw-1 border-ink bg-paper p-0.5 ${className}`}>
      {MODES.map(({ id, label, title, Icon }) => {
        const badge = id === 'code' && mode === 'visual' && problems > 0;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => setMode(id)}
            title={`${title} (${MOD_KEY}+\\ switches)`}
            className={`relative inline-flex items-center gap-1 rounded-[2px] px-2 py-1 text-xs font-semibold ${mode === id ? 'bg-ink text-paper' : 'text-ink hover:bg-ink/5'}`}
          >
            <Icon size={14} aria-hidden="true" />
            <span className={compact ? 'sr-only' : ''}>{label}</span>
            {badge && (
              <span className="rounded-full bg-fail px-1 font-mono text-[10px] leading-4 text-white" aria-label={`${problems} ${problems === 1 ? 'problem' : 'problems'}`}>
                {problems}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
