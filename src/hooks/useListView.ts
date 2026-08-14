import { useState } from 'react';

export type ListView = 'card' | 'list';

function readStoredView(storageKey: string, defaultView: ListView): ListView {
  if (typeof window === 'undefined') return defaultView;
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === 'card' || stored === 'list' ? stored : defaultView;
  } catch {
    return defaultView;
  }
}

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
    }
  };

  return [view, setView];
}
