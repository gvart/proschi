import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { outlineButton } from '../../components/Playground/ui';
import { DENIED_TEXT } from '../../voice/MicButton';

/**
 * The set-up's mic check: whether the browser may use the microphone, and a
 * level meter that moves when you speak, so a muted or wrong mic shows before
 * the interview. The stream is only read in this browser and stops when the
 * check closes.
 */

type Permission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';

const BARS = 12;

export default function MicCheck() {
  const [permission, setPermission] = useState<Permission>(() => (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'unknown' : 'unsupported'));
  const [level, setLevel] = useState(0);
  const [on, setOn] = useState(false);
  const stop = useRef<() => void>(undefined);

  useEffect(() => {
    let live = true;
    void navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((status) => {
        if (!live) return;
        const read = () => setPermission((p) => (p === 'unsupported' ? p : (status.state as Permission)));
        read();
        status.onchange = read;
      })
      .catch(() => undefined);
    return () => {
      live = false;
      stop.current?.();
    };
  }, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPermission('granted');
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        // RMS of speech is small: scale it so a normal voice fills most of the meter.
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
        frame = requestAnimationFrame(tick);
      };
      tick();
      setOn(true);
      stop.current = () => {
        cancelAnimationFrame(frame);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => undefined);
        setOn(false);
        setLevel(0);
      };
    } catch (e) {
      setPermission(e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unsupported');
    }
  };

  const lit = Math.round(level * BARS);
  return (
    <div className="space-y-2" data-testid="mic-check" data-permission={permission}>
      <div className="flex flex-wrap items-center gap-3">
        {on ? (
          <button type="button" onClick={() => stop.current?.()} className={outlineButton}>
            <MicOff size={14} aria-hidden="true" />
            Stop the check
          </button>
        ) : (
          <button type="button" onClick={() => void start()} disabled={permission === 'unsupported'} className={outlineButton}>
            <Mic size={14} aria-hidden="true" />
            Check the mic
          </button>
        )}
        <div role="meter" aria-label="Mic level" aria-valuemin={0} aria-valuemax={BARS} aria-valuenow={on ? lit : 0} className="flex h-5 items-end gap-0.5" data-testid="mic-level">
          {Array.from({ length: BARS }, (_, i) => (
            <span key={i} className={`w-1.5 rounded-[1px] transition-colors duration-75 ${i < lit ? (i >= BARS - 2 ? 'bg-fail' : 'bg-pass') : 'bg-ink/15'}`} style={{ height: `${30 + (i / BARS) * 70}%` }} />
          ))}
        </div>
      </div>
      <p className="text-xs text-muted" role="status">
        {permission === 'denied'
          ? DENIED_TEXT
          : permission === 'unsupported'
            ? 'This browser has no microphone to check; text works.'
            : on
              ? lit > 1
                ? 'The mic hears you.'
                : 'Say something: the bars move when the mic hears you.'
              : permission === 'granted'
                ? 'The mic is allowed.'
                : 'The browser asks once whether Proschi may use the mic.'}
      </p>
    </div>
  );
}
