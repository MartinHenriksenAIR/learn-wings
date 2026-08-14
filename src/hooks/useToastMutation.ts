import { useMutation } from '@tanstack/react-query';
import { toast } from '@/components/ui/sonner';

interface UseToastMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  errorTitle: string | ((variables: TVariables) => string);
  onSuccess?: (data: TData, variables: TVariables) => void;
  onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables) => void;
}

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
