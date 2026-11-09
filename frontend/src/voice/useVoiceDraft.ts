import { useCallback, useState } from 'react';

/** `phrase` after `text`, with one space between (none when `text` is empty), at most `max` characters. */
export function joinPhrase(text: string, phrase: string, max = Infinity): string {
  const t = text.trimEnd();
  return (t ? `${t} ${phrase}` : phrase).slice(0, max);
}

/**
 * A composer's draft with voice input (MicButton): finished phrases are
 * appended to the draft, and the phrase being spoken is shown after it until
 * it is finished. `shown(draft)` is the textarea's value; `clear()` drops the
 * interim phrase (say, when the user types or sends).
 */
export function useVoiceDraft(setDraft: (update: (draft: string) => string) => void, max = Infinity) {
  const [interim, setInterim] = useState('');
  const onText = useCallback(
    (text: string, final: boolean) => {
      if (final) {
        setInterim('');
        if (text) setDraft((d) => joinPhrase(d, text, max));
      } else setInterim(text);
    },
    [setDraft, max],
  );
  const shown = useCallback((draft: string) => (interim ? joinPhrase(draft, interim, max) : draft), [interim, max]);
  const clear = useCallback(() => setInterim(''), []);
  return { interim, onText, shown, clear };
}
