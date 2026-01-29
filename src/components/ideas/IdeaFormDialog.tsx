import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Idea, IdeaCategory } from '@/lib/ideas-types';

const ideaFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be less than 200 characters'),
  description: z.string().max(2000).optional(),
  problem_statement: z.string().max(2000).optional(),
  proposed_solution: z.string().max(2000).optional(),
  expected_impact: z.string().max(1000).optional(),
  category_id: z.string().optional(),
});

type IdeaFormValues = z.infer<typeof ideaFormSchema>;

interface IdeaFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  idea: Idea | null;
  onClose: () => void;
}

export function IdeaFormDialog({ open, onOpenChange, idea, onClose }: IdeaFormDialogProps) {
  const { profile, currentOrg } = useAuth();
  const queryClient = useQueryClient();
  const isEditing = !!idea;

  const form = useForm<IdeaFormValues>({
    resolver: zodResolver(ideaFormSchema),
    defaultValues: {
      title: '',
      description: '',
      problem_statement: '',
      proposed_solution: '',
      expected_impact: '',
      category_id: '',
    },
  });

  // Fetch categories
  const { data: categories } = useQuery({
    queryKey: ['idea-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('idea_categories')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as IdeaCategory[];
    },
  });

  useEffect(() => {
    if (idea) {
      form.reset({
        title: idea.title,
        description: idea.description || '',
        problem_statement: idea.problem_statement || '',
        proposed_solution: idea.proposed_solution || '',
        expected_impact: idea.expected_impact || '',
        category_id: idea.category_id || '',
      });
    } else {
      form.reset({
        title: '',
        description: '',
        problem_statement: '',
        proposed_solution: '',
        expected_impact: '',
        category_id: '',
      });
    }
  }, [idea, form]);

  const mutation = useMutation({
    mutationFn: async (values: IdeaFormValues) => {
      if (!profile?.id || !currentOrg?.id) throw new Error('Not authenticated');

      const payload = {
        title: values.title,
        description: values.description || null,
        problem_statement: values.problem_statement || null,
        proposed_solution: values.proposed_solution || null,
        expected_impact: values.expected_impact || null,
        category_id: values.category_id || null,
      };

      if (isEditing) {
        const { error } = await supabase
          .from('ideas')
          .update(payload)
          .eq('id', idea.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('ideas')
          .insert({
            ...payload,
            user_id: profile.id,
            org_id: currentOrg.id,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-ideas'] });
      queryClient.invalidateQueries({ queryKey: ['idea-library'] });
      toast({ title: isEditing ? 'Idea updated' : 'Idea created' });
      onClose();
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleSubmit = (values: IdeaFormValues) => {
    mutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Idea' : 'Create New Idea'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update your idea details. You can submit it for review when ready.'
              : 'Capture your process optimization idea. You can save as draft and refine it later.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input placeholder="Give your idea a clear, descriptive title" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category (optional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories?.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Brief Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Provide a brief overview of your idea"
                      className="min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="problem_statement"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Problem Statement</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="What problem or inefficiency does this address? Be specific."
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Clearly describe the current pain point or opportunity for improvement.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="proposed_solution"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proposed Solution</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="How would you solve this? What would the solution look like?"
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Describe your proposed approach, including any AI or automation opportunities.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expected_impact"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expected Impact</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="What benefits would this bring? Time saved, cost reduction, etc."
                      className="min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Quantify if possible: hours saved per week, error reduction %, etc.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving...' : isEditing ? 'Update Idea' : 'Save as Draft'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
