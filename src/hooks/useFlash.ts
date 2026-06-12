import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Per-key transient "flashed" state for in-button success feedback
 * (port of the design prototype's `flash()`): `flash(key)` marks the key
 * flashed for `timeoutMs`, then it auto-reverts. Re-flashing a key resets
 * its timer. All pending timers are cleared on unmount.
 */
export function useFlash(timeoutMs = 1600): { flashed: (key: string) => boolean; flash: (key: string) => void } {
  const [flashedKeys, setFlashedKeys] = useState<Record<string, true>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const flash = useCallback(
    (key: string) => {
      clearTimeout(timersRef.current[key]);
      timersRef.current[key] = setTimeout(() => {
        delete timersRef.current[key];
        setFlashedKeys((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, timeoutMs);
      setFlashedKeys((prev) => ({ ...prev, [key]: true }));
    },
    [timeoutMs],
  );

  const flashed = useCallback((key: string) => !!flashedKeys[key], [flashedKeys]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  return { flashed, flash };
}
