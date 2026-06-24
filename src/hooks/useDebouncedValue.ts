import { useEffect, useState } from 'react';

/**
 * Returns a copy of `value` that only updates after it has been stable for
 * `delayMs`. Keep the raw value in the input (stays perfectly responsive) and
 * put the debounced value in a React Query key so typing fires roughly one
 * request per pause instead of one per keystroke (#41).
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
