import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Custom DOM event any part of the app can dispatch to count as user activity
 * even without a raw input event — notably active course-video playback, which
 * fires no mouse/keyboard events but must not let a learner be signed out
 * mid-lecture (#447). Dispatch with `window.dispatchEvent(new Event(ACTIVITY_EVENT))`.
 */
export const ACTIVITY_EVENT = 'app:activity';

// 60-minute inactivity window, with the warning shown in the final 60s (#447).
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_WARNING_MS = 60 * 1000;
// Tick every second so the countdown in the warning modal is smooth.
const DEFAULT_CHECK_INTERVAL_MS = 1000;
// The shared last-activity timestamp is written at most this often, so a burst
// of mousemove events can't thrash localStorage. In-memory tracking (the ref)
// is always exact; only the cross-tab mirror is throttled.
const WRITE_THROTTLE_MS = 5000;

// One shared key across every tab of the origin: the session cache is shared
// (localStorage, #431), so the idle clock must be too — activity in any tab
// keeps them all alive and a timeout signs them all out together.
const STORAGE_KEY = 'idleLastActivity';

// Raw input signals that count as activity. Registered on the capture phase so
// scrolls inside nested containers (which don't bubble to window) still count.
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;
const LISTENER_OPTS = { capture: true, passive: true } as const;
const REMOVE_OPTS = { capture: true } as const;

interface UseIdleTimeoutOptions {
  /** Only arm the timer while the user is authenticated. */
  enabled: boolean;
  /** Fired once when the idle window elapses with no activity. */
  onTimeout: () => void;
  timeoutMs?: number;
  warningMs?: number;
  checkIntervalMs?: number;
}

interface UseIdleTimeoutResult {
  /** True during the final `warningMs`, so a countdown modal can be shown. */
  warningActive: boolean;
  /** Whole seconds left before sign-out, for the countdown. */
  secondsRemaining: number;
  /** Cancel the pending sign-out and reset the timer (the "Stay signed in" action). */
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

/**
 * Signs the user out after a fixed window of inactivity, warning them first.
 *
 * "Activity" = raw input (mouse/keyboard/scroll/touch) plus the {@link ACTIVITY_EVENT}
 * custom event (dispatched during video playback). The last-activity timestamp
 * is mirrored to localStorage so every tab shares one clock: interacting in one
 * tab keeps the others alive, and a timeout trips them all within a tick.
 *
 * App load counts as activity — the clock starts from mount, so this measures
 * *continuous* inactivity within a session, not wall-clock time since login.
 */
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
  // Kept in a ref so the effect below never has to depend on the caller's
  // (possibly inline) onTimeout identity and re-subscribe every render.
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
        // Storage unavailable — this tab still tracks activity in memory.
      }
    }
  }, []);

  const stayActive = useCallback(() => {
    // Force the write so other tabs clear their warning immediately, not on
    // their next throttled cycle.
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
      // Reconcile with the shared clock so another tab's activity counts here.
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
    // Another tab recording activity (or timing out) reconciles this tab at once.
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
