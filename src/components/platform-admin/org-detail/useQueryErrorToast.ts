import { useEffect } from 'react';
import { toast } from '@/components/ui/sonner';

interface UseQueryErrorToastArgs {
  isError: boolean;
  error: unknown;
  toastTitle?: string;
  logLabel: string;
}

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
