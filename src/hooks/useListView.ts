import { useState } from 'react';

export type ListView = 'card' | 'list';

/**
 * Reads the stored view for `storageKey`, falling back to `defaultView` when
 * nothing valid is stored (or storage is unavailable, e.g. private mode / SSR).
 * Only the two known values are honored — any other stored string is ignored.
 */
function readStoredView(storageKey: string, defaultView: ListView): ListView {
  if (typeof window === 'undefined') return defaultView;
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === 'card' || stored === 'list' ? stored : defaultView;
  } catch {
    return defaultView;
  }
}

/**
 * A learner's card/list layout preference, persisted across visits under
 * `storageKey`. Shared by the Course Catalog (#360/#443) and My Training (#449)
 * so both pages behave identically; each passes its own key so the preferences
 * stay independent. Storage failures degrade to an in-memory choice for the session.
 */
export function useListView(
  storageKey: string,
  defaultView: ListView = 'list',
): [ListView, (next: ListView) => void] {
  const [view, setViewState] = useState<ListView>(() => readStoredView(storageKey, defaultView));

  const setView = (next: ListView) => {
    setViewState(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      /* private mode / storage disabled — the in-memory choice still applies this session */
    }
  };

  return [view, setView];
}
