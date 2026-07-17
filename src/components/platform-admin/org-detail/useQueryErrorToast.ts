import { useEffect } from 'react';
import { toast } from '@/components/ui/sonner';

interface UseQueryErrorToastArgs {
  isError: boolean;
  error: unknown;
  /**
   * Destructive-toast title shown on failure. Omit to only `console.error`
   * (matches the profiles fetch, which never toasted).
   */
  toastTitle?: string;
  /** Prefix for the console.error line. */
  logLabel: string;
}

/**
 * Reproduces TanStack Query v5's missing `useQuery` onError for a single query:
 * on `isError`, optionally fire the shared destructive toast and always
 * `console.error`. Mirrors the useEffect-on-isError idiom Batch B1 used in
 * OrganizationsManager.
 */
export function useQueryErrorToast({ isError, error, toastTitle, logLabel }: UseQueryErrorToastArgs) {
  useEffect(() => {
    if (!isError) return;
    if (toastTitle) {
      toast({
        title: toastTitle,
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
    console.error(logLabel, error);
  }, [isError, error, toastTitle, logLabel]);
}
