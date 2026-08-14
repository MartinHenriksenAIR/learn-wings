import { useCallback, useEffect, useRef, useState } from 'react';

export const ACTIVITY_EVENT = 'app:activity';

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_WARNING_MS = 60 * 1000;
const DEFAULT_CHECK_INTERVAL_MS = 1000;
const WRITE_THROTTLE_MS = 5000;

const STORAGE_KEY = 'idleLastActivity';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;
const LISTENER_OPTS = { capture: true, passive: true } as const;
const REMOVE_OPTS = { capture: true } as const;

interface UseIdleTimeoutOptions {
  enabled: boolean;
  onTimeout: () => void;
  timeoutMs?: number;
  warningMs?: number;
  checkIntervalMs?: number;
}

interface UseIdleTimeoutResult {
  warningActive: boolean;
  secondsRemaining: number;
  stayActive: () => void;
}

function readSharedActivity(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function useIdleTimeout({
  enabled,
  onTimeout,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  warningMs = DEFAULT_WARNING_MS,
  checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
}: UseIdleTimeoutOptions): UseIdleTimeoutResult {
  const [warningActive, setWarningActive] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  const lastActivityRef = useRef(Date.now());
  const lastWriteRef = useRef(0);
  const firedRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const recordActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    if (now - lastWriteRef.current >= WRITE_THROTTLE_MS) {
      lastWriteRef.current = now;
      try {
        localStorage.setItem(STORAGE_KEY, String(now));
      } catch {
      }
    }
  }, []);

  const stayActive = useCallback(() => {
    lastWriteRef.current = 0;
    recordActivity();
    setWarningActive(false);
  }, [recordActivity]);

  useEffect(() => {
    if (!enabled) {
      setWarningActive(false);
      return;
    }

    firedRef.current = false;
    lastWriteRef.current = 0;
    recordActivity();

    const check = () => {
      if (firedRef.current) return;
      const last = Math.max(lastActivityRef.current, readSharedActivity());
      lastActivityRef.current = last;
      const idleFor = Date.now() - last;

      if (idleFor >= timeoutMs) {
        firedRef.current = true;
        setWarningActive(false);
        onTimeoutRef.current();
        return;
      }

      const remaining = timeoutMs - idleFor;
      if (remaining <= warningMs) {
        setWarningActive(true);
        setSecondsRemaining(Math.ceil(remaining / 1000));
      } else {
        setWarningActive(false);
      }
    };

    const onActivity = () => recordActivity();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, onActivity, LISTENER_OPTS));
    window.addEventListener(ACTIVITY_EVENT, onActivity);
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) check();
    };
    window.addEventListener('storage', onStorage);

    const intervalId = window.setInterval(check, checkIntervalMs);
    return () => {
      window.clearInterval(intervalId);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity, REMOVE_OPTS));
      window.removeEventListener(ACTIVITY_EVENT, onActivity);
      window.removeEventListener('storage', onStorage);
    };
  }, [enabled, timeoutMs, warningMs, checkIntervalMs, recordActivity]);

  return { warningActive, secondsRemaining, stayActive };
}
