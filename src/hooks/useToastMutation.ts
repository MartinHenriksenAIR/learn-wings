import { useMutation } from '@tanstack/react-query';
import { toast } from '@/components/ui/sonner';

interface UseToastMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  /**
   * Title for the destructive toast shown on failure — the one block all 11
   * admin mutation handlers used to hand-roll (issue #48). A function form
   * lets create/update-style handlers pick the title from the variables.
   */
  errorTitle: string | ((variables: TVariables) => string);
  onSuccess?: (data: TData, variables: TVariables) => void;
  onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables) => void;
}

/**
 * `useMutation` with the admin pages' shared failure idiom baked in: a
 * destructive toast built from the error message. Success behavior (cache
 * patching via setQueryData, success toasts, dialog closing) stays at the
 * call site — that part legitimately differs per handler.
 */
export function useToastMutation<TData, TVariables = void>({
  errorTitle,
  ...options
}: UseToastMutationOptions<TData, TVariables>) {
  return useMutation({
    ...options,
    onError: (error: Error, variables: TVariables) => {
      toast({
        title: typeof errorTitle === 'function' ? errorTitle(variables) : errorTitle,
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
